import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { dbOps } from '../config/db-helpers.js';
import {
  recordFlowGenerationStarted,
  recordFlowTracksGenerated,
  recordPlaylistTracksAdded,
} from './aurralHistoryService.js';
import { PLAYLIST_LIBRARY_DIR, isPathInsideRoot } from './playlistPaths.js';
import { remapLegacyWeeklyFlowPath } from './weeklyFlowPaths.js';
import {
  buildSharedTrackIdentity,
  dedupeSharedTracks,
  filterMissingSharedTracks,
  flowPlaylistConfig,
  normalizeSharedTrack,
  tracksShareMembership,
} from './weeklyFlowPlaylistConfig.js';
import {
  normalizeExistingFileMode,
  reuseTrackForPlaylist,
  sortJobsForTrackReuse,
} from './weeklyFlowFileReuse.js';
import { downloadTracker } from './weeklyFlowDownloadTracker.js';
import { playlistManager } from './weeklyFlowPlaylistManager.js';
import { slskdClient } from './slskdClient.js';
import { weeklyFlowWorker } from './weeklyFlowWorker.js';
import {
  restartWorkerIfPending,
  wakeDownloadWorker,
  withPlaylistMutation,
} from './weeklyFlowMutationGuards.js';
import { withHonkerLock } from './honkerDb.js';
import { getUnavailableFlowSourceError } from './weeklyFlowValidation.js';
import { schedulePlaylistMbidEnrichment } from './playlistMbidEnrichmentService.js';

const DEFAULT_LIMIT = 30;
const OPERATION_TOKENS_KEY = 'weeklyFlowOperationTokens';
const SLSKD_NOT_CONFIGURED_MESSAGE =
  'slskd is not configured. Add your slskd URL and API key in Settings > Integrations to enable Soulseek downloads for flows and playlists.';

export function createWeeklyFlowOperationToken(): string {
  return `${Date.now()}-${randomUUID()}`;
}

export function markLatestWeeklyFlowOperationToken(scope: string, token: string): void {
  const safeScope = String(scope || '').trim();
  const safeToken = String(token || '').trim();
  if (!safeScope || !safeToken) return;
  const current: Record<string, string> = dbOps.getJSONSetting(OPERATION_TOKENS_KEY) || {};
  dbOps.setJSONSetting(OPERATION_TOKENS_KEY, {
    ...current,
    [safeScope]: safeToken,
  });
}

function isLatestWeeklyFlowOperationToken(scope: string, token: string): boolean {
  const safeScope = String(scope || '').trim();
  const safeToken = String(token || '').trim();
  if (!safeScope || !safeToken) return true;
  const current: Record<string, string> = dbOps.getJSONSetting(OPERATION_TOKENS_KEY) || {};
  return current[safeScope] === safeToken;
}

function normalizeTrackList(value: unknown): unknown[] {
  return (Array.isArray(value) ? value : [])
    .map((track: unknown) => normalizeSharedTrack(track))
    .filter(Boolean);
}

const getPlaylistLibraryRoot = (playlistType: string): string =>
  path.resolve(
    weeklyFlowWorker.weeklyFlowRoot,
    PLAYLIST_LIBRARY_DIR,
    String(playlistType || '').trim(),
  );

const removePlaylistLocalTrackFile = async (job: Record<string, unknown>, playlistId: string): Promise<void> => {
  if (!job || typeof job.finalPath !== 'string') return;
  const playlistRoot = getPlaylistLibraryRoot(playlistId);
  const safeFinalPath = remapLegacyWeeklyFlowPath(String(job.finalPath), weeklyFlowWorker.weeklyFlowRoot);
  if (isPathInsideRoot(safeFinalPath, playlistRoot)) {
    await fs.rm(safeFinalPath, { force: true });
  }
};

const jobToSharedTrack = (job: Record<string, unknown> | null) =>
  normalizeSharedTrack({
    artistName: job?.artistName,
    trackName: job?.trackName,
    albumName: job?.albumName || null,
    artistMbid: job?.artistMbid || null,
    albumMbid: job?.albumMbid || null,
    trackMbid: job?.trackMbid || null,
    releaseYear: job?.releaseYear || null,
    durationMs: job?.durationMs || null,
    artistAliases: job?.artistAliases || [],
    reason: job?.reason || null,
  });

const groupJobsByMembership = (jobs: unknown[]): Record<string, unknown>[][] => {
  const groups: Array<Array<Record<string, unknown>>> = [];
  for (const job of Array.isArray(jobs) ? jobs as Record<string, unknown>[] : []) {
    let target: Array<Record<string, unknown>> | null = null;
    for (const group of groups) {
      if (tracksShareMembership(group[0], job)) {
        target = group;
        break;
      }
    }
    if (target) {
      target.push(job);
    } else {
      groups.push([job]);
    }
  }
  return groups;
};

const sharedPlaylistTracksMatchJobs = (playlist: Record<string, unknown> | null, jobs: Record<string, unknown>[]): boolean => {
  const configTracks = dedupeSharedTracks(playlist?.tracks);
  if (configTracks.length !== jobs.length) return false;
  const unmatchedJobs = new Set(jobs.map((job) => job.id as string));
  for (const track of configTracks) {
    const match = jobs.find(
      (job) => unmatchedJobs.has(job.id as string) && tracksShareMembership(job, track),
    );
    if (!match) return false;
    unmatchedJobs.delete(match.id as string);
  }
  return unmatchedJobs.size === 0;
};

export async function reconcileSharedPlaylistJobs(playlistId: string): Promise<Record<string, unknown>> {
  const safePlaylistId = String(playlistId || '').trim();
  const playlist = flowPlaylistConfig.getSharedPlaylist(safePlaylistId);
  if (!playlist) return { missing: true, changed: false };

  const existingJobs = downloadTracker.getByPlaylistType(safePlaylistId);
  const groups = groupJobsByMembership(existingJobs);
  const keptJobs: Array<Record<string, unknown>> = [];
  const removedJobIds: string[] = [];
  const playlistRoot = getPlaylistLibraryRoot(safePlaylistId);

  for (const group of groups) {
    const [kept, ...dupes] = sortJobsForTrackReuse(group);
    keptJobs.push(kept);
    for (const dupe of dupes) {
      if (dupe.status === 'done' && typeof dupe.finalPath === 'string') {
        const keptPath =
          kept?.status === 'done' && typeof kept.finalPath === 'string' ? kept.finalPath : null;
        if (!keptPath || dupe.finalPath !== keptPath) {
          const safeFinalPath = remapLegacyWeeklyFlowPath(
            String(dupe.finalPath),
            weeklyFlowWorker.weeklyFlowRoot,
          );
          if (isPathInsideRoot(safeFinalPath, playlistRoot)) {
            await fs.rm(safeFinalPath, { force: true });
          }
        }
      }
      downloadTracker.removeJob(dupe.id as string);
      removedJobIds.push(String(dupe.id));
    }
  }

  const tracksFromJobs = keptJobs.map((job) => jobToSharedTrack(job)).filter(Boolean);
  const configInSync = sharedPlaylistTracksMatchJobs(playlist as unknown as Record<string, unknown>, keptJobs);
  const changed = removedJobIds.length > 0 || !configInSync;
  let updatedPlaylist: unknown = playlist;
  if (changed) {
    updatedPlaylist = flowPlaylistConfig.updateSharedPlaylist(safePlaylistId, {
      tracks: tracksFromJobs,
    });
    playlistManager.updateConfig(false);
    await playlistManager.refreshPlaylist(safePlaylistId);
    playlistManager.scheduleScanLibrary();
  }

  return {
    changed,
    removedJobIds,
    playlist: updatedPlaylist,
    keptJobCount: keptJobs.length,
  };
}

const syncSharedPlaylistConfigFromJobs = async (playlistId: string): Promise<unknown> => {
  const safePlaylistId = String(playlistId || '').trim();
  const playlist = flowPlaylistConfig.getSharedPlaylist(safePlaylistId);
  if (!playlist) return null;
  const jobs = downloadTracker.getByPlaylistType(safePlaylistId);
  const tracksFromJobs = jobs.map((job: unknown) => jobToSharedTrack(job as Record<string, unknown>)).filter(Boolean);
  if (sharedPlaylistTracksMatchJobs(playlist as unknown as Record<string, unknown>, jobs)) {
    return playlist;
  }
  const updatedPlaylist = flowPlaylistConfig.updateSharedPlaylist(safePlaylistId, {
    tracks: tracksFromJobs,
  });
  playlistManager.updateConfig(false);
  return updatedPlaylist;
};

const reuseTracksForPlaylist = async (tracks: unknown[], playlistId: string): Promise<Record<string, unknown>> => {
  const settings = weeklyFlowWorker.getWorkerSettings();
  const existingFileMode = normalizeExistingFileMode(settings.existingFileMode);
  const reusedJobIds: string[] = [];
  const tracksToQueue: unknown[] = [];
  for (const track of normalizeTrackList(tracks)) {
    const reuse = await reuseTrackForPlaylist(track as Record<string, unknown>, playlistId, {
      existingFileMode,
      weeklyFlowRoot: weeklyFlowWorker.weeklyFlowRoot,
      targetPlaylistType: playlistId,
      skipHistory: true,
    });
    if (reuse.reused) {
      reusedJobIds.push(String(reuse.jobId));
    } else {
      tracksToQueue.push(track);
    }
  }
  return { reusedJobIds, tracksToQueue };
};

const filterTracksMissingDownloadJobs = (tracks: unknown[], playlistId: string): unknown[] => {
  const existingJobs = downloadTracker.getByPlaylistType(playlistId);
  const missing: unknown[] = [];
  const queued: unknown[] = [];
  for (const track of normalizeTrackList(tracks)) {
    const duplicate =
      existingJobs.some((job: unknown) => tracksShareMembership(job, track)) ||
      queued.some((entry) => tracksShareMembership(entry, track));
    if (duplicate) continue;
    queued.push(track);
    missing.push(track);
  }
  return missing;
};

const recordPlaylistHistory = (playlistId: string, { tracksQueued = 0, tracksReused = 0 }: { tracksQueued?: number; tracksReused?: number } = {}): void => {
  if (tracksQueued + tracksReused <= 0) return;
  recordPlaylistTracksAdded({
    playlistId,
    tracksQueued,
    tracksReused,
  });
};

async function seedSharedPlaylistTracks(playlistId: string, tracks: unknown[]): Promise<Record<string, unknown>> {
  const missingTracks = filterTracksMissingDownloadJobs(tracks, playlistId);
  const { reusedJobIds, tracksToQueue } = await reuseTracksForPlaylist(missingTracks, playlistId) as { reusedJobIds: string[]; tracksToQueue: unknown[] };
  const jobIds = downloadTracker.addJobs(tracksToQueue as Record<string, unknown>[], playlistId);
  playlistManager.updateConfig(false);
  await playlistManager.ensureSmartPlaylists();
  if (reusedJobIds.length > 0) {
    playlistManager.scheduleScanLibrary();
  }
  if (jobIds.length > 0) {
    await wakeDownloadWorker();
  }
  recordPlaylistHistory(playlistId, {
    tracksQueued: jobIds.length,
    tracksReused: reusedJobIds.length,
  });
  return {
    reusedJobIds,
    jobIds,
    tracksQueued: jobIds.length,
    tracksReused: reusedJobIds.length,
  };
}

async function runFlowSeed({
  flowId,
  size = null,
  tokenScope = null,
  token = null,
  requireEnabled = false,
  scheduleNext = false,
}: {
  flowId?: string;
  size?: number | null;
  tokenScope?: string | null;
  token?: string | null;
  requireEnabled?: boolean;
  scheduleNext?: boolean;
} = {}): Promise<Record<string, unknown>> {
  const safeFlowId = String(flowId || '').trim();
  if (!safeFlowId) return { missing: true };
  if (!isLatestWeeklyFlowOperationToken(tokenScope as string, token as string)) {
    return { cancelled: true };
  }
  if (!slskdClient.isConfigured()) {
    throw new Error(SLSKD_NOT_CONFIGURED_MESSAGE);
  }
  const flow = flowPlaylistConfig.getFlow(safeFlowId);
  if (!flow) return { missing: true };
  if (requireEnabled && (flow as unknown as Record<string, unknown>).enabled !== true) return { skipped: true };
  const unavailableError = getUnavailableFlowSourceError((flow as unknown as Record<string, unknown>).mix);
  if (unavailableError) throw new Error(unavailableError);

  const result = await withPlaylistMutation(safeFlowId, async () => {
    if (!isLatestWeeklyFlowOperationToken(tokenScope as string, token as string)) {
      return { cancelled: true };
    }
    const latestFlow = flowPlaylistConfig.getFlow(safeFlowId);
    if (!latestFlow) return { missing: true };
    if (requireEnabled && (latestFlow as unknown as Record<string, unknown>).enabled !== true) return { skipped: true };

    recordFlowGenerationStarted({ flowId: safeFlowId });
    playlistManager.updateConfig(false);
    await playlistManager.weeklyReset([safeFlowId]);
    weeklyFlowWorker.clearPlaylistRunState(safeFlowId);
    downloadTracker.clearByPlaylistType(safeFlowId);

    if (!isLatestWeeklyFlowOperationToken(tokenScope as string, token as string)) {
      return { cancelled: true };
    }
    const effectiveSize =
      Number.isFinite(Number(size)) && Number(size) > 0
        ? Number(size)
        : ((latestFlow as unknown as Record<string, unknown>).size as number) || DEFAULT_LIMIT;
    const seeded = await weeklyFlowWorker.seedFlowRun(safeFlowId, latestFlow as unknown as Record<string, unknown>, {
      size: effectiveSize,
    });
    if (scheduleNext) {
      flowPlaylistConfig.scheduleNextRun(safeFlowId);
    }
    return {
      jobIds: (seeded as Record<string, unknown>)?.jobIds || [],
      tracksQueued: Number((seeded as Record<string, unknown>)?.tracksQueued || 0),
      reserveTracks: Number((seeded as Record<string, unknown>)?.reserveTracks || 0),
      empty: Number((seeded as Record<string, unknown>)?.tracksQueued || 0) === 0,
      flowName: (latestFlow as unknown as Record<string, unknown>).name,
    };
  });

  if (((result as Record<string, unknown>)?.tracksQueued as number) > 0) {
    await wakeDownloadWorker();
    recordFlowTracksGenerated({
      flowId: safeFlowId,
      tracksQueued: (result as Record<string, unknown>).tracksQueued as number,
      reserveTracks: ((result as Record<string, unknown>).reserveTracks as number) || 0,
    });
  } else {
    await restartWorkerIfPending();
  }
  return result as Record<string, unknown>;
}

async function runFlowCleanup({ flowId, tokenScope = null, token = null }: {
  flowId?: string;
  tokenScope?: string | null;
  token?: string | null;
} = {}): Promise<Record<string, unknown>> {
  const safeFlowId = String(flowId || '').trim();
  if (!safeFlowId) return { missing: true };
  if (!isLatestWeeklyFlowOperationToken(tokenScope as string, token as string)) {
    return { cancelled: true };
  }
  await withPlaylistMutation(safeFlowId, async () => {
    if (!isLatestWeeklyFlowOperationToken(tokenScope as string, token as string)) {
      return;
    }
    playlistManager.updateConfig(false);
    await playlistManager.weeklyReset([safeFlowId]);
    weeklyFlowWorker.clearPlaylistRunState(safeFlowId);
    downloadTracker.clearByPlaylistType(safeFlowId);
  });
  await restartWorkerIfPending();
  return { success: true, flowId: safeFlowId };
}

async function deleteFlow({ flowId, tokenScope = null, token = null }: {
  flowId?: string;
  tokenScope?: string | null;
  token?: string | null;
} = {}): Promise<Record<string, unknown> | boolean> {
  const safeFlowId = String(flowId || '').trim();
  if (!safeFlowId) return false;
  if (!isLatestWeeklyFlowOperationToken(tokenScope as string, token as string)) {
    return { cancelled: true };
  }
  let didDelete = false;
  await withPlaylistMutation(safeFlowId, async () => {
    if (!isLatestWeeklyFlowOperationToken(tokenScope as string, token as string)) {
      return;
    }
    weeklyFlowWorker.setRetryCyclePaused(safeFlowId, false);
    weeklyFlowWorker.clearPlaylistRunState(safeFlowId);
    playlistManager.updateConfig(false);
    await playlistManager.weeklyReset([safeFlowId]);
    downloadTracker.clearByPlaylistType(safeFlowId);
    didDelete = flowPlaylistConfig.deleteFlow(safeFlowId);
    await playlistManager.ensureSmartPlaylists();
  });
  await restartWorkerIfPending();
  return didDelete;
}

async function resetPlaylists({ playlistTypes = [] }: {
  playlistTypes?: string | string[];
} = {}): Promise<Record<string, unknown>> {
  const types = (Array.isArray(playlistTypes) ? playlistTypes : [playlistTypes])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  await withPlaylistMutation(types, async () => {
    playlistManager.updateConfig(false);
    await playlistManager.weeklyReset(types);
  });
  await restartWorkerIfPending();
  return { success: true, playlistTypes: types };
}

async function adoptFlowSeed({ flowId, tracks = [] }: {
  flowId?: string;
  tracks?: unknown[];
} = {}): Promise<unknown> {
  const safeFlowId = String(flowId || '').trim();
  const flow = flowPlaylistConfig.getFlow(safeFlowId);
  if (!flow) return { missing: true };
  const normalizedTracks = normalizeTrackList(tracks);
  const result = await withPlaylistMutation(safeFlowId, async () =>
    weeklyFlowWorker.seedFlowRunWithTracks(safeFlowId, flow as unknown as Record<string, unknown>, normalizedTracks as unknown as Record<string, unknown>[]),
  );
  await wakeDownloadWorker();
  recordFlowTracksGenerated({
    flowId: safeFlowId,
    tracksQueued: (result as Record<string, unknown>)?.tracksQueued as number || normalizedTracks.length,
    reserveTracks: 0,
  });
  return result;
}

async function createSharedPlaylist({
  playlistId,
  name,
  sourceName = null,
  sourceFlowId = null,
  discoverPresetId = null,
  tracks = [],
  ownerUserId = null,
}: {
  playlistId?: string;
  name?: string;
  sourceName?: string | null;
  sourceFlowId?: string | null;
  discoverPresetId?: string | null;
  tracks?: unknown[];
  ownerUserId?: string | null;
} = {}): Promise<Record<string, unknown>> {
  const safePlaylistId = String(playlistId || '').trim() || randomUUID();
  const normalizedTracks = normalizeTrackList(tracks);
  let playlist: unknown = flowPlaylistConfig.getSharedPlaylist(safePlaylistId);
  if (!playlist) {
    playlist = flowPlaylistConfig.createSharedPlaylist({
      id: safePlaylistId,
      name,
      sourceName,
      sourceFlowId,
      discoverPresetId,
      tracks: normalizedTracks,
      ownerUserId,
    });
  }
  const queued = normalizedTracks.length
    ? await seedSharedPlaylistTracks(safePlaylistId, normalizedTracks) as { jobIds: string[]; reusedJobIds: string[]; tracksQueued: number; tracksReused: number }
    : { jobIds: [], reusedJobIds: [], tracksQueued: 0, tracksReused: 0 };
  playlistManager.updateConfig(false);
  await playlistManager.ensureSmartPlaylists();
  if (normalizedTracks.length > 0) {
    schedulePlaylistMbidEnrichment(safePlaylistId, {
      reason: 'shared-playlist-create',
      priority: 5,
    });
  }
  return {
    success: true,
    playlist,
    tracksQueued: queued.tracksQueued,
    tracksReused: queued.tracksReused,
    jobIds: [...(queued as { reusedJobIds: string[]; jobIds: string[] }).reusedJobIds, ...(queued as { jobIds: string[] }).jobIds],
  };
}

async function appendSharedPlaylistTracks({ playlistId, tracks = [] }: {
  playlistId?: string;
  tracks?: unknown[];
} = {}): Promise<Record<string, unknown>> {
  const safePlaylistId = String(playlistId || '').trim();
  const playlist = flowPlaylistConfig.getSharedPlaylist(safePlaylistId);
  if (!playlist) return { missing: true };
  const tracksToAdd = filterMissingSharedTracks((playlist as unknown as Record<string, unknown>).tracks, tracks);
  const updatedPlaylist =
    tracksToAdd.length > 0
      ? flowPlaylistConfig.appendSharedPlaylistTracks(safePlaylistId, tracksToAdd)
      : playlist;
  const queued =
    tracksToAdd.length > 0
      ? await seedSharedPlaylistTracks(safePlaylistId, tracksToAdd) as { jobIds: string[]; reusedJobIds: string[]; tracksQueued: number; tracksReused: number }
      : { jobIds: [], reusedJobIds: [], tracksQueued: 0, tracksReused: 0 };
  if (tracksToAdd.length > 0) {
    schedulePlaylistMbidEnrichment(safePlaylistId, {
      reason: 'shared-playlist-append',
      priority: 5,
    });
  }
  return {
    success: true,
    playlist: updatedPlaylist,
    tracksQueued: queued.tracksQueued,
    tracksReused: queued.tracksReused,
    jobIds: [...(queued as { reusedJobIds: string[]; jobIds: string[] }).reusedJobIds, ...(queued as { jobIds: string[] }).jobIds],
  };
}

async function updateSharedPlaylist({
  playlistId,
  name = null,
  tracks = [],
  hasNameUpdate = false,
  hasTracksUpdate = false,
}: {
  playlistId?: string;
  name?: string | null;
  tracks?: unknown[];
  hasNameUpdate?: boolean;
  hasTracksUpdate?: boolean;
} = {}): Promise<Record<string, unknown>> {
  const safePlaylistId = String(playlistId || '').trim();
  const currentPlaylist = flowPlaylistConfig.getSharedPlaylist(safePlaylistId);
  if (!currentPlaylist) return { missing: true };
  const safeName = hasNameUpdate
    ? String(name || '').trim()
    : String((currentPlaylist as unknown as Record<string, unknown>).name || '').trim();
  let playlist: unknown = null;
  let tracksQueued = 0;
  if (!hasTracksUpdate) {
    playlist = flowPlaylistConfig.updateSharedPlaylist(safePlaylistId, {
      name: safeName,
    });
  } else {
    const normalizedTracks = normalizeTrackList(tracks);
    await withPlaylistMutation(safePlaylistId, async () => {
      const existingJobs = downloadTracker.getByPlaylistType(safePlaylistId);
      const reusableJobsByIdentity = new Map<string, Array<Record<string, unknown>>>();
      for (const job of existingJobs) {
        const identity = buildSharedTrackIdentity(job);
        const current = reusableJobsByIdentity.get(identity) || [];
        current.push(job as Record<string, unknown>);
        reusableJobsByIdentity.set(identity, current);
      }
      for (const [identity, jobsForIdentity] of reusableJobsByIdentity.entries()) {
        reusableJobsByIdentity.set(identity, sortJobsForTrackReuse(jobsForIdentity));
      }

      const matchedJobIds = new Set<string>();
      const tracksNeedingWork: unknown[] = [];
      for (const track of normalizedTracks) {
        const identity = buildSharedTrackIdentity(track);
        const reusableJobs = reusableJobsByIdentity.get(identity) || [];
        const matchedJob = reusableJobs.shift();
        if (matchedJob) {
          matchedJobIds.add(String(matchedJob.id));
        } else {
          tracksNeedingWork.push(track);
        }
      }

      const playlistRoot = getPlaylistLibraryRoot(safePlaylistId);
      for (const job of existingJobs) {
        if (matchedJobIds.has(String(job.id))) continue;
        if (job.status === 'done' && typeof job.finalPath === 'string') {
          const safeFinalPath = remapLegacyWeeklyFlowPath(
            String(job.finalPath),
            weeklyFlowWorker.weeklyFlowRoot,
          );
          if (isPathInsideRoot(safeFinalPath, playlistRoot)) {
            await fs.rm(safeFinalPath, { force: true });
          }
        }
        downloadTracker.removeJob(String(job.id));
      }

      playlist = flowPlaylistConfig.updateSharedPlaylist(safePlaylistId, {
        name: safeName,
        tracks: normalizedTracks,
      });
      const reuseResult = await reuseTracksForPlaylist(tracksNeedingWork, safePlaylistId);
      tracksQueued = downloadTracker.addJobs((reuseResult as Record<string, unknown>).tracksToQueue as Record<string, unknown>[], safePlaylistId).length;
    });
    weeklyFlowWorker.pruneOrphanedJobState();
  }

  playlistManager.updateConfig(false);
  await playlistManager.ensureSmartPlaylists();
  await playlistManager.scheduleScanLibrary(true);
  if (tracksQueued > 0) {
    await wakeDownloadWorker();
    recordPlaylistHistory(safePlaylistId, { tracksQueued });
  }
  schedulePlaylistMbidEnrichment(safePlaylistId, {
    reason: hasTracksUpdate ? 'shared-playlist-track-update' : 'shared-playlist-update',
    priority: 5,
  });
  return { success: true, playlist, tracksQueued };
}

async function deleteSharedPlaylistTrack({ playlistId, jobId }: {
  playlistId?: string;
  jobId?: string;
} = {}): Promise<Record<string, unknown>> {
  const safePlaylistId = String(playlistId || '').trim();
  const safeJobId = String(jobId || '').trim();
  const playlist = flowPlaylistConfig.getSharedPlaylist(safePlaylistId);
  if (!playlist) return { missingPlaylist: true };
  const job = downloadTracker.getJob(safeJobId);
  if (!job || (job as Record<string, unknown>).playlistType !== safePlaylistId) {
    return { missingJob: true };
  }
  await withPlaylistMutation(
    safePlaylistId,
    async () => {
      if ((job as Record<string, unknown>).status === 'done' && typeof (job as Record<string, unknown>).finalPath === 'string') {
        await removePlaylistLocalTrackFile(job as Record<string, unknown>, safePlaylistId);
      }
      downloadTracker.removeJob(safeJobId);
    },
    { clearPending: false },
  );
  weeklyFlowWorker.pruneOrphanedJobState();
  const updatedPlaylist = (await syncSharedPlaylistConfigFromJobs(safePlaylistId)) || playlist;
  playlistManager.updateConfig(false);
  await playlistManager.refreshPlaylist(safePlaylistId);
  await playlistManager.scheduleScanLibrary(true);
  return {
    success: true,
    playlist: updatedPlaylist,
    removedJobId: safeJobId,
  };
}

async function researchPlaylistTrack({ playlistId, jobId }: {
  playlistId?: string;
  jobId?: string;
} = {}): Promise<Record<string, unknown>> {
  const safePlaylistId = String(playlistId || '').trim();
  const safeJobId = String(jobId || '').trim();
  const sharedPlaylist = flowPlaylistConfig.getSharedPlaylist(safePlaylistId);
  const flow = flowPlaylistConfig.getFlow(safePlaylistId);
  if (!sharedPlaylist && !flow) return { missingPlaylist: true };
  const job = downloadTracker.getJob(safeJobId);
  if (!job || (job as Record<string, unknown>).playlistType !== safePlaylistId) {
    return { missingJob: true };
  }
  if ((job as Record<string, unknown>).status === 'pending' || (job as Record<string, unknown>).status === 'downloading') {
    return { alreadyProcessing: true };
  }
  const previousFinalPath = (job as Record<string, unknown>).finalPath;
  let reused = false;
  await withPlaylistMutation(
    safePlaylistId,
    async () => {
      const { existingFileMode } = weeklyFlowWorker.getWorkerSettings();
      const mode = normalizeExistingFileMode(existingFileMode);
      if (mode !== 'download' && ((job as Record<string, unknown>).status === 'done' || (job as Record<string, unknown>).status === 'failed')) {
        const reuse = await reuseTrackForPlaylist(job, safePlaylistId, {
          existingFileMode: mode,
          weeklyFlowRoot: weeklyFlowWorker.weeklyFlowRoot,
          existingJobId: safeJobId,
          excludeJobIds: [safeJobId],
        });
        if (reuse.reused) {
          reused = true;
          const updatedJob = downloadTracker.getJob(safeJobId);
          if (
            previousFinalPath &&
            (updatedJob as Record<string, unknown>)?.finalPath &&
            (updatedJob as Record<string, unknown>).finalPath !== previousFinalPath
          ) {
            await removePlaylistLocalTrackFile({ finalPath: previousFinalPath } as Record<string, unknown>, safePlaylistId);
          }
          return;
        }
      }
      await removePlaylistLocalTrackFile(job as Record<string, unknown>, safePlaylistId);
      const reset = downloadTracker.setPending(safeJobId, null);
      if (!reset) {
        throw new Error('Failed to requeue track');
      }
    },
    { clearPending: false },
  );
  playlistManager.updateConfig(false);
  await playlistManager.refreshPlaylist(safePlaylistId);
  playlistManager.scheduleScanLibrary();
  if (!reused) {
    await restartWorkerIfPending();
    if (weeklyFlowWorker.running) {
      weeklyFlowWorker.wake();
    }
  }
  return {
    success: true,
    reused,
    jobId: safeJobId,
    playlistId: safePlaylistId,
  };
}

async function deleteSharedPlaylist({ playlistId }: {
  playlistId?: string;
} = {}): Promise<boolean> {
  const safePlaylistId = String(playlistId || '').trim();
  const exists = flowPlaylistConfig.getSharedPlaylist(safePlaylistId);
  if (!exists) return false;
  let deleted = false;
  await withPlaylistMutation(safePlaylistId, async () => {
    weeklyFlowWorker.setRetryCyclePaused(safePlaylistId, false);
    playlistManager.updateConfig(false);
    await playlistManager.weeklyReset([safePlaylistId]);
    downloadTracker.clearByPlaylistType(safePlaylistId);
    deleted = flowPlaylistConfig.deleteSharedPlaylist(safePlaylistId);
    await playlistManager.ensureSmartPlaylists();
  });
  await restartWorkerIfPending();
  return deleted;
}

export async function processWeeklyFlowOperation(payload: Record<string, unknown> = {}): Promise<unknown> {
  const kind = String(payload?.kind || payload?.type || '').trim();
  return withHonkerLock(
    'weekly-flow-operation',
    async () => {
      switch (kind) {
        case 'manual-start-flow':
          return runFlowSeed(payload as Record<string, unknown>);
        case 'scheduled-flow-refresh':
          return runFlowSeed({
            ...payload,
            requireEnabled: true,
            scheduleNext: true,
          } as Record<string, unknown>);
        case 'enable-flow-refresh':
          return runFlowSeed({
            ...payload,
            requireEnabled: true,
          } as Record<string, unknown>);
        case 'disable-flow-cleanup':
          return runFlowCleanup(payload as Record<string, unknown>);
        case 'delete-flow':
          return deleteFlow(payload as Record<string, unknown>);
        case 'reset-playlists':
          return resetPlaylists(payload as Record<string, unknown>);
        case 'adopt-flow-seed':
          return adoptFlowSeed(payload as Record<string, unknown>);
        case 'shared-playlist-create':
          return createSharedPlaylist(payload as Record<string, unknown>);
        case 'shared-playlist-append-tracks':
          return appendSharedPlaylistTracks(payload as Record<string, unknown>);
        case 'shared-playlist-update':
          return updateSharedPlaylist(payload as Record<string, unknown>);
        case 'shared-playlist-delete-track':
          return deleteSharedPlaylistTrack(payload as Record<string, unknown>);
        case 'shared-playlist-research-track':
          return researchPlaylistTrack(payload as Record<string, unknown>);
        case 'shared-playlist-delete':
          return deleteSharedPlaylist(payload as Record<string, unknown>);
        default:
          throw new Error(`Unknown weekly flow operation: ${kind || 'unknown'}`);
      }
    },
    {
      ttlSeconds: 180,
      waitTimeoutMs: 30 * 60 * 1000,
      retryDelayMs: 250,
    },
  );
}
