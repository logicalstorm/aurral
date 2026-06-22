import { enqueuePlaylistMbidEnrichmentJob, withHonkerLock } from './honkerDb.js';
import { downloadTracker } from './weeklyFlowDownloadTracker.js';
import { playlistManager } from './weeklyFlowPlaylistManager.js';
import { resolveWeeklyFlowTrackContext } from './weeklyFlowTrackResolver.js';
import {
  flowPlaylistConfig,
  normalizeSharedTrack,
  tracksShareMembership,
} from './weeklyFlowPlaylistConfig.js';

const PLAYLIST_MBID_ENRICHMENT_DELAY_SECONDS = 20;

type AnyRecord = Record<string, unknown>;

function hasValue(value: unknown) {
  return String(value || '').trim() !== '';
}

function isMissingMbid(track: unknown) {
  const t = track as AnyRecord;
  return !hasValue(t?.artistMbid) || !hasValue(t?.albumMbid) || !hasValue(t?.trackMbid);
}

function hasMissingJobMbid(track: unknown, jobs: unknown) {
  return (Array.isArray(jobs) ? jobs : [])
    .filter((job) => tracksShareMembership(job, track))
    .some((job) => isMissingMbid(job));
}

function hasMissingPlaylistMbids(playlist: unknown) {
  const p = playlist as AnyRecord;
  return (Array.isArray(p?.tracks) ? p.tracks : []).some((track: unknown) =>
    isMissingMbid(track),
  );
}

function mergeMissingString(target: unknown, source: unknown, key: string) {
  const t = target as AnyRecord;
  const s = source as AnyRecord;
  if (hasValue(t?.[key]) || !hasValue(s?.[key])) return undefined;
  return String(s[key]).trim();
}

function mergeMissingMetadata(target: unknown, source: unknown, { includeJobFields = false }: { includeJobFields?: boolean } = {}) {
  const t = target as AnyRecord;
  const s = source as AnyRecord;
  const patch: AnyRecord = {};
  for (const key of ['artistMbid', 'albumMbid', 'trackMbid', 'albumName', 'releaseYear']) {
    const value = mergeMissingString(t, s, key);
    if (value !== undefined) patch[key] = value;
  }

  if (
    t?.durationMs == null &&
    s?.durationMs != null &&
    Number.isFinite(Number(s.durationMs))
  ) {
    patch.durationMs = Math.max(0, Math.round(Number(s.durationMs)));
  }

  const targetAliases = Array.isArray(t?.artistAliases)
    ? (t.artistAliases as unknown[]).filter(Boolean)
    : [];
  const sourceAliases = Array.isArray(s?.artistAliases)
    ? (s.artistAliases as unknown[]).map((entry: unknown) => String(entry || '').trim()).filter(Boolean)
    : [];
  if (targetAliases.length === 0 && sourceAliases.length > 0) {
    patch.artistAliases = [...new Set(sourceAliases)];
  }

  if (!includeJobFields) return patch;

  for (const key of ['trackNumber', 'albumTrackCount']) {
    if (t?.[key] == null && s?.[key] != null && Number.isFinite(Number(s[key]))) {
      patch[key] = Math.max(1, Math.round(Number(s[key])));
    }
  }

  const targetTitles = Array.isArray(t?.albumTrackTitles)
    ? (t.albumTrackTitles as unknown[]).filter(Boolean)
    : [];
  const sourceTitles = Array.isArray(s?.albumTrackTitles)
    ? (s.albumTrackTitles as unknown[]).map((entry: unknown) => String(entry || '').trim()).filter(Boolean)
    : [];
  if (targetTitles.length === 0 && sourceTitles.length > 0) {
    patch.albumTrackTitles = [...new Set(sourceTitles)];
  }

  return patch;
}

function hasPatch(patch: unknown): patch is AnyRecord {
  return patch != null && typeof patch === 'object' && Object.keys(patch as object).length > 0;
}

function applyPlaylistTrackPatch(track: unknown, source: unknown) {
  const patch = mergeMissingMetadata(track, source);
  if (!hasPatch(patch)) return track;
  return (
    normalizeSharedTrack({
      ...(track as AnyRecord),
      ...patch,
    }) || track
  );
}

function findResolutionForTrack(track: unknown, resolutions: unknown[], usedResolutionIndexes: Set<number>) {
  for (let index = 0; index < resolutions.length; index += 1) {
    if (usedResolutionIndexes.has(index)) continue;
    const resolution = resolutions[index] as AnyRecord;
    if (
      tracksShareMembership(track, resolution.originalTrack) ||
      tracksShareMembership(track, resolution.resolvedTrack)
    ) {
      usedResolutionIndexes.add(index);
      return resolution;
    }
  }
  return null;
}

function matchingJobsForTrack(track: unknown, jobs: unknown[]) {
  return (Array.isArray(jobs) ? jobs : []).filter((job) => tracksShareMembership(job, track));
}

async function buildResolution(track: unknown, jobs: unknown[], resolveTrackContext: (track: Record<string, unknown>) => Promise<unknown>) {
  if (!isMissingMbid(track) && !hasMissingJobMbid(track, jobs)) {
    return null;
  }

  const originalTrack = normalizeSharedTrack(track);
  if (!originalTrack) return null;

  let resolvedTrack: unknown = originalTrack;
  if (isMissingMbid(originalTrack)) {
    resolvedTrack = await Promise.resolve()
      .then(() => resolveTrackContext(originalTrack as unknown as Record<string, unknown>))
      .catch(() => originalTrack);
  }

  const enrichedTrack = applyPlaylistTrackPatch(originalTrack, resolvedTrack);
  const jobMetadata = {
    ...(resolvedTrack as AnyRecord),
    ...(enrichedTrack as AnyRecord),
  };
  const trackPatch = mergeMissingMetadata(originalTrack, enrichedTrack);
  const jobNeedsPatch = matchingJobsForTrack(originalTrack, jobs).some((job) =>
    hasPatch(mergeMissingMetadata(job, jobMetadata, { includeJobFields: true })),
  );

  if (!hasPatch(trackPatch) && !jobNeedsPatch) {
    return null;
  }

  return {
    originalTrack,
    resolvedTrack: enrichedTrack,
    jobMetadata,
  };
}

export function schedulePlaylistMbidEnrichment(
  playlistId: unknown,
  {
    reason = 'playlist-update',
    delaySeconds = PLAYLIST_MBID_ENRICHMENT_DELAY_SECONDS,
    priority = 0,
  }: { reason?: string; delaySeconds?: number; priority?: number } = {},
) {
  const safePlaylistId = String(playlistId || '').trim();
  if (!safePlaylistId) return null;
  return enqueuePlaylistMbidEnrichmentJob(
    {
      kind: 'playlist-mbid-enrichment',
      playlistId: safePlaylistId,
      reason,
      requestedAt: Date.now(),
    },
    {
      delaySeconds,
      priority,
    },
  );
}

export function schedulePlaylistMbidEnrichmentForMissingPlaylists({ reason = 'sweep' }: { reason?: string } = {}) {
  const jobIds = [];
  for (const playlist of flowPlaylistConfig.getSharedPlaylists()) {
    const jobs = downloadTracker.getByPlaylistType(playlist.id);
    const hasMissingConfig = hasMissingPlaylistMbids(playlist);
    const hasMissingJobs = (Array.isArray(playlist?.tracks) ? playlist.tracks : []).some((track) =>
      hasMissingJobMbid(track, jobs),
    );
    if (!hasMissingConfig && !hasMissingJobs) continue;
    const jobId = schedulePlaylistMbidEnrichment(playlist.id, {
      reason,
      delaySeconds: 0,
      priority: -5,
    });
    if (jobId != null) jobIds.push(jobId);
  }
  return jobIds;
}

export async function enrichSharedPlaylistMbids(
  playlistId: unknown,
  { resolveTrackContext = resolveWeeklyFlowTrackContext }: { resolveTrackContext?: (track: Record<string, unknown>) => Promise<unknown> } = {},
) {
  const safePlaylistId = String(playlistId || '').trim();
  if (!safePlaylistId) return { missing: true, changed: false };

  const snapshotPlaylist = flowPlaylistConfig.getSharedPlaylist(safePlaylistId);
  if (!snapshotPlaylist) return { missing: true, changed: false };

  const snapshotJobs = downloadTracker.getByPlaylistType(safePlaylistId);
  const snapshotTracks = Array.isArray(snapshotPlaylist.tracks) ? snapshotPlaylist.tracks : [];
  const resolutions: unknown[] = [];
  let tracksExamined = 0;
  let tracksResolved = 0;

  for (const track of snapshotTracks) {
    tracksExamined += 1;
    const resolution = await buildResolution(
      track,
      snapshotJobs,
      typeof resolveTrackContext === 'function'
        ? resolveTrackContext
        : resolveWeeklyFlowTrackContext,
    );
    if (!resolution) continue;
    resolutions.push(resolution);
    if (!isMissingMbid(resolution.resolvedTrack)) {
      tracksResolved += 1;
    }
  }

  if (resolutions.length === 0) {
    return {
      missing: false,
      changed: false,
      playlistId: safePlaylistId,
      tracksExamined,
      tracksResolved,
      playlistTracksUpdated: 0,
      jobsUpdated: 0,
    };
  }

  return withHonkerLock(
    `playlist-mutation:${safePlaylistId}`,
    async () => {
      const currentPlaylist = flowPlaylistConfig.getSharedPlaylist(safePlaylistId);
      if (!currentPlaylist) return { missing: true, changed: false };

      const currentTracks = Array.isArray(currentPlaylist.tracks) ? currentPlaylist.tracks : [];
      const usedResolutionIndexes = new Set<number>();
      let playlistTracksUpdated = 0;
      const nextTracks = currentTracks.map((track) => {
        const resolution = findResolutionForTrack(track, resolutions, usedResolutionIndexes);
        if (!resolution) return track;
        const nextTrack = applyPlaylistTrackPatch(track, resolution.resolvedTrack);
        if (nextTrack !== track) playlistTracksUpdated += 1;
        return nextTrack;
      });

      let updatedPlaylist: unknown = currentPlaylist;
      if (playlistTracksUpdated > 0) {
        updatedPlaylist = flowPlaylistConfig.updateSharedPlaylist(safePlaylistId, {
          tracks: nextTracks,
        });
      }

      const jobs = downloadTracker.getByPlaylistType(safePlaylistId);
      let jobsUpdated = 0;
      const updatedJobIds = new Set<unknown>();
      for (const track of nextTracks) {
        const resolution = resolutions.find(
          (entry) => {
            const e = entry as AnyRecord;
            return tracksShareMembership(track, e.originalTrack) ||
              tracksShareMembership(track, e.resolvedTrack);
          },
        ) as AnyRecord | undefined;
        const source = resolution?.jobMetadata || resolution?.resolvedTrack || track;
        for (const job of matchingJobsForTrack(track, jobs)) {
          const j = job as AnyRecord;
          if (updatedJobIds.has(j.id)) continue;
          const patch = mergeMissingMetadata(j, source, {
            includeJobFields: true,
          });
          if (!hasPatch(patch)) continue;
          if (downloadTracker.updateMetadata(j.id as string, patch)) {
            jobsUpdated += 1;
            updatedJobIds.add(j.id);
          }
        }
      }

      if (playlistTracksUpdated > 0 || jobsUpdated > 0) {
        playlistManager.updateConfig(false);
      }

      return {
        missing: false,
        changed: playlistTracksUpdated > 0 || jobsUpdated > 0,
        playlistId: safePlaylistId,
        playlist: updatedPlaylist,
        tracksExamined,
        tracksResolved,
        playlistTracksUpdated,
        jobsUpdated,
      };
    },
    {
      ttlSeconds: 180,
      waitTimeoutMs: 15 * 60 * 1000,
      retryDelayMs: 250,
    },
  );
}
