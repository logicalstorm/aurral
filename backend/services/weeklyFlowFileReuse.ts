import fs from 'fs/promises';
import path from 'path';
import { downloadTracker } from './weeklyFlowDownloadTracker.js';
import { buildSharedTrackIdentity } from './weeklyFlowPlaylistConfig.js';
import { libraryManager } from './libraryManager.js';
import { remapLegacyWeeklyFlowPath, resolveWeeklyFlowRoot } from './weeklyFlowPaths.js';
import { getPathMappings, resolveLocalPath } from './pathMappings.js';

export const EXISTING_FILE_MODES = new Set(['download', 'reuse']);
const LEGACY_REUSE_MODES = new Set(['hardlink', 'copy']);
const DEFAULT_EXISTING_FILE_MODE = 'reuse';

export function normalizeExistingFileMode(value: unknown): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (EXISTING_FILE_MODES.has(normalized)) {
    return normalized;
  }
  if (LEGACY_REUSE_MODES.has(normalized)) {
    return 'reuse';
  }
  return DEFAULT_EXISTING_FILE_MODE;
}

export function sortJobsForTrackReuse(jobs: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...jobs].sort((a, b) => {
    const priority = (job: Record<string, unknown>): number => {
      if (job?.status === 'done') return 0;
      if (job?.status === 'failed') return 1;
      if (job?.status === 'downloading') return 2;
      if (job?.status === 'pending') return 3;
      return 4;
    };
    const priorityDiff = priority(a) - priority(b);
    if (priorityDiff !== 0) return priorityDiff;
    return Number(a?.createdAt || 0) - Number(b?.createdAt || 0);
  });
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function statFilesystemLocation(targetPath: unknown) {
  const resolved = path.resolve(String(targetPath || ''));
  if (!resolved) {
    throw new Error('empty path');
  }

  let current = resolved;
  while (true) {
    try {
      const stat = await fs.stat(current);
      if (stat.isFile()) {
        return fs.stat(path.dirname(current));
      }
      return stat;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error(`Path not found: ${resolved}`);
      }
      current = parent;
    }
  }
}

export async function pathsShareDevice(leftPath: unknown, rightPath: unknown): Promise<boolean> {
  try {
    const [leftStat, rightStat] = await Promise.all([
      statFilesystemLocation(leftPath),
      statFilesystemLocation(rightPath),
    ]);
    return leftStat.dev === rightStat.dev;
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function sortReusableJobs(jobs: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...jobs].sort((left, right) => {
    const leftCreated = Number(left?.createdAt || 0);
    const rightCreated = Number(right?.createdAt || 0);
    if (leftCreated !== rightCreated) return leftCreated - rightCreated;
    return String(left?.id || '').localeCompare(String(right?.id || ''));
  });
}

interface FindAurralSourceOptions {
  weeklyFlowRoot?: string;
  targetPlaylistType?: string;
  excludeJobIds?: string[];
}

async function findAurralSource(track: Record<string, unknown>, options: FindAurralSourceOptions = {}): Promise<Record<string, unknown> | null> {
  const weeklyFlowRoot = path.resolve(options.weeklyFlowRoot || resolveWeeklyFlowRoot());
  const targetPlaylistType = String(options.targetPlaylistType || '').trim();
  const identity = buildSharedTrackIdentity(track);
  const excludeJobIds = new Set(
    (Array.isArray(options.excludeJobIds) ? options.excludeJobIds : [])
      .map((id: unknown) => String(id || '').trim())
      .filter(Boolean),
  );
  const candidates = [];
  for (const job of downloadTracker.getAll()) {
    if (!job || job.status !== 'done') continue;
    if (excludeJobIds.has(String(job.id || ''))) continue;
    if (!job.finalPath || typeof job.finalPath !== 'string') continue;
    if (buildSharedTrackIdentity(job) !== identity) continue;
    if (targetPlaylistType && String(job.playlistType || '') === targetPlaylistType) {
      continue;
    }
    const sourcePath = remapLegacyWeeklyFlowPath(job.finalPath, weeklyFlowRoot);
    if (!(await fileExists(sourcePath))) continue;
    candidates.push(job);
  }
  const sourceJob = sortReusableJobs(candidates)[0];
  if (!sourceJob) return null;
  return {
    sourceType: 'aurral',
    sourcePath: path.resolve(remapLegacyWeeklyFlowPath(String(sourceJob.finalPath || ''), weeklyFlowRoot)),
    sourceJob,
    albumName: sourceJob.albumName || track.albumName || null,
  };
}

function findMatchingArtist(artists: Record<string, unknown>[], track: Record<string, unknown>): Record<string, unknown> | null {
  const artistMbid = String(track?.artistMbid || '').trim();
  if (artistMbid) {
    const match = artists.find(
      (artist: Record<string, unknown>) =>
        String(artist?.mbid || '').trim() === artistMbid ||
        String(artist?.foreignArtistId || '').trim() === artistMbid,
    );
    if (match) return match;
  }
  const artistKey = normalizeText(track?.artistName);
  if (!artistKey) return null;
  return (
    artists.find((artist: Record<string, unknown>) => normalizeText(artist?.artistName || artist?.name) === artistKey) ||
    null
  );
}

function rankAlbums(albums: Record<string, unknown>[], track: Record<string, unknown>): Record<string, unknown>[] {
  const albumMbid = String(track?.albumMbid || '').trim();
  const albumKey = normalizeText(track?.albumName);
  return [...albums].sort((left, right) => {
    const score = (album: Record<string, unknown>): number => {
      let total = 0;
      if (
        albumMbid &&
        (String(album?.mbid || '').trim() === albumMbid ||
          String(album?.foreignAlbumId || '').trim() === albumMbid)
      ) {
        total += 100;
      }
      if (albumKey && normalizeText(album?.albumName || album?.title) === albumKey) {
        total += 50;
      }
      if (Number((album?.statistics as Record<string, unknown>)?.sizeOnDisk) > 0) total += 5;
      return total;
    };
    return score(right) - score(left);
  });
}

function findMatchingTrack(tracks: Record<string, unknown>[], track: Record<string, unknown>): Record<string, unknown> | null {
  const trackMbid = String(track?.trackMbid || '').trim();
  if (trackMbid) {
    const match = tracks.find(
      (entry: Record<string, unknown>) =>
        String(entry?.mbid || '').trim() === trackMbid ||
        String(entry?.foreignRecordingId || '').trim() === trackMbid ||
        String(entry?.foreignTrackId || '').trim() === trackMbid,
    );
    if (match) return match;
  }
  const trackKey = normalizeText(track?.trackName);
  if (!trackKey) return null;
  return (
    tracks.find((entry: Record<string, unknown>) => normalizeText(entry?.trackName || entry?.title) === trackKey) || null
  );
}

async function findLidarrSource(track: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  let artists = [];
  try {
    artists = await libraryManager.getAllArtists();
  } catch (error) {
    console.warn('[WeeklyFlowReuse] Failed to inspect Lidarr artists:', (error as Error).message);
    return null;
  }
  const artist = findMatchingArtist(Array.isArray(artists) ? artists : [], track);
  if (!artist) return null;
  const artistId = artist.id || artist.artistId;
  if (!artistId) return null;

  let albums = [];
  try {
    albums = await libraryManager.getAlbums(artistId);
  } catch (error) {
    console.warn('[WeeklyFlowReuse] Failed to inspect Lidarr albums:', (error as Error).message);
    return null;
  }

  for (const album of rankAlbums(Array.isArray(albums) ? albums : [], track)) {
    let tracks = [];
    try {
      tracks = await libraryManager.getTracks(album.id);
    } catch (error) {
      console.warn('[WeeklyFlowReuse] Failed to inspect Lidarr tracks:', (error as Error).message);
      continue;
    }
    const matchedTrack = findMatchingTrack(Array.isArray(tracks) ? tracks : [], track);
    if (!matchedTrack || matchedTrack.hasFile !== true || !matchedTrack.path) continue;
    const sourcePath = path.resolve(resolveLocalPath(matchedTrack.path, getPathMappings('lidarr' as unknown as null)));
    if (!(await fileExists(sourcePath))) {
      console.warn(
        `[WeeklyFlowReuse] Lidarr track exists but file is not accessible from Aurral: ${matchedTrack.path}`,
      );
      continue;
    }
    return {
      sourceType: 'lidarr',
      sourcePath,
      externalPath: matchedTrack.path,
      lidarrTrack: matchedTrack,
      albumName: album.albumName || track.albumName || null,
    };
  }
  return null;
}

interface ReuseOptions {
  existingFileMode?: unknown;
  weeklyFlowRoot?: string;
  targetPlaylistType?: string;
  excludeJobIds?: string[];
  requeueOnMissing?: boolean;
  resolveSource?: (job: Record<string, unknown>, opts: Record<string, unknown>) => Promise<{ source: Record<string, unknown> | null; reason: string | null }>;
  batchSize?: number;
  cursor?: number;
  existingJobId?: string;
  skipHistory?: boolean;
}

export async function resolveReusableTrackSource(track: Record<string, unknown>, options: ReuseOptions = {}): Promise<{ source: Record<string, unknown> | null; reason: string | null }> {
  const mode = normalizeExistingFileMode(options.existingFileMode);
  if (mode === 'download') {
    return { source: null, reason: 'Existing file reuse is disabled' };
  }
  const aurralSource = await findAurralSource(track, options);
  if (aurralSource) return { source: aurralSource, reason: null };
  const lidarrSource = await findLidarrSource(track);
  if (lidarrSource) return { source: lidarrSource, reason: null };
  return { source: null, reason: 'No reusable Aurral or Lidarr file found' };
}

export async function resolveRepairTrackSource(track: Record<string, unknown>, options: ReuseOptions = {}): Promise<{ source: Record<string, unknown> | null; reason: string | null }> {
  const mode = normalizeExistingFileMode(options.existingFileMode);
  if (mode === 'download') {
    return { source: null, reason: 'Existing file reuse is disabled' };
  }
  const lidarrSource = await findLidarrSource(track);
  if (lidarrSource) return { source: lidarrSource, reason: null };
  const aurralSource = await findAurralSource(track, options);
  if (aurralSource) return { source: aurralSource, reason: null };
  return { source: null, reason: 'No reusable Aurral or Lidarr file found' };
}

export async function restoreCompletedTrack(job: Record<string, unknown> | null | undefined, options: ReuseOptions = {}): Promise<Record<string, unknown>> {
  const mode = normalizeExistingFileMode(options.existingFileMode);
  if (mode === 'download') {
    return { action: 'skipped', reason: 'Existing file reuse is disabled' };
  }
  if (!job || job.status !== 'done' || !job.finalPath) {
    return { action: 'skipped', reason: 'Track is not completed' };
  }

  const weeklyFlowRoot = path.resolve(options.weeklyFlowRoot || resolveWeeklyFlowRoot());
  const finalPath = path.resolve(remapLegacyWeeklyFlowPath(String(job.finalPath), weeklyFlowRoot));
  if (await fileExists(finalPath)) {
    return { action: 'ok', reason: 'Playlist file exists' };
  }

  const resolveSource = options.resolveSource || resolveRepairTrackSource;
  const { source, reason } = await resolveSource(job as Record<string, unknown>, {
    ...options,
    existingFileMode: mode,
    targetPlaylistType: job.playlistType as string | undefined,
    excludeJobIds: [job.id as string],
  });
  if (source) {
    const sourcePath = path.resolve(String(source.sourcePath));
    if (await fileExists(sourcePath)) {
      if (finalPath === sourcePath) {
        return { action: 'ok', reason: 'Already using source path' };
      }
      downloadTracker.setDone(
        job.id as string,
        sourcePath,
        source.albumName as string || job.albumName as string || null,
        (source as Record<string, unknown>).externalPath as string || null,
      );
      console.log(
        `[WeeklyFlowReuse] Repaired ${job.playlistType} path from ${source.sourceType}: ${job.artistName} - ${job.trackName}`,
      );
      return {
        action: 'repaired',
        sourceType: source.sourceType,
        sourcePath,
        finalPath: sourcePath,
      };
    }
  }

  if (options.requeueOnMissing === false) {
    return {
      action: 'skipped',
      reason: reason || 'No reusable source found',
    };
  }

  const requeued = downloadTracker.setPending(String(job.id), 'Track file is missing');
  if (!requeued) {
    return { action: 'skipped', reason: 'Failed to requeue track' };
  }
  console.log(
    `[WeeklyFlowReuse] Requeued missing track for ${job.playlistType}: ${job.artistName} - ${job.trackName}`,
  );
  return {
    action: 'requeued',
    reason: reason || 'No reusable source found',
  };
}

export async function repairCompletedTrackLink(job: Record<string, unknown>, options: ReuseOptions = {}): Promise<Record<string, unknown>> {
  const result = await restoreCompletedTrack(job, {
    ...options,
    requeueOnMissing: false,
  });
  if (result.action === 'repaired') {
    return {
      repaired: true,
      sourceType: result.sourceType,
      sourcePath: result.sourcePath,
      finalPath: result.finalPath,
    };
  }
  return {
    repaired: false,
    reason: result.reason || 'No reusable source found',
  };
}

const REUSE_REPAIR_BATCH_SIZE = 50;

export async function repairReusableTrackLinks(options: ReuseOptions = {}) {
  const mode = normalizeExistingFileMode(options.existingFileMode);
  if (mode === 'download') {
    return {
      scanned: 0,
      repaired: 0,
      requeued: 0,
      skipped: 0,
      failures: 0,
      nextCursor: 0,
    };
  }

  const weeklyFlowRoot = path.resolve(options.weeklyFlowRoot || resolveWeeklyFlowRoot());
  const jobs = downloadTracker
    .getAll()
    .filter((job) => job?.status === 'done' && typeof job?.finalPath === 'string');
  const batchSize = Math.max(1, Math.floor(Number(options.batchSize) || REUSE_REPAIR_BATCH_SIZE));
  const cursor = Math.max(0, Math.floor(Number(options.cursor) || 0));
  const sortedJobs = [...jobs].sort((left, right) =>
    String(left?.id || '').localeCompare(String(right?.id || '')),
  );
  const batch = [];
  if (sortedJobs.length > 0) {
    for (let index = 0; index < batchSize; index += 1) {
      batch.push(sortedJobs[(cursor + index) % sortedJobs.length]);
    }
  }

  let repaired = 0;
  let requeued = 0;
  let skipped = 0;
  let failures = 0;
  const changedPlaylistTypes = new Set<string>();
  for (const job of batch) {
    try {
      const result = await restoreCompletedTrack(job, {
        ...options,
        existingFileMode: mode,
        weeklyFlowRoot,
        requeueOnMissing: true,
      });
      if (result.action === 'repaired') {
        repaired += 1;
        if (job?.playlistType) {
          changedPlaylistTypes.add(String(job.playlistType));
        }
      } else if (result.action === 'requeued') {
        requeued += 1;
        if (job?.playlistType) {
          changedPlaylistTypes.add(String(job.playlistType));
        }
      } else {
        skipped += 1;
      }
    } catch (error) {
      failures += 1;
      console.warn(
        `[WeeklyFlowReuse] Failed to repair ${job?.id || 'unknown'}: ${(error as Error)?.message || error}`,
      );
    }
  }

  const nextCursor = sortedJobs.length === 0 ? 0 : (cursor + batch.length) % sortedJobs.length;
  if (repaired > 0 || requeued > 0) {
    console.log(
      `[WeeklyFlowReuse] Track health sweep repaired ${repaired}, requeued ${requeued} of ${batch.length} checked tracks`,
    );
    const { playlistManager } = await import('./weeklyFlowPlaylistManager.js');
    for (const playlistType of changedPlaylistTypes) {
      await playlistManager.refreshPlaylist(playlistType).catch(() => {});
    }
    playlistManager.scheduleScanLibrary();
    if (requeued > 0) {
      const [{ weeklyFlowWorker }, { restartWorkerIfPending }] = await Promise.all([
        import('./weeklyFlowWorker.js'),
        import('./weeklyFlowMutationGuards.js'),
      ]);
      await restartWorkerIfPending();
      if (weeklyFlowWorker.running) {
        weeklyFlowWorker.wake();
      }
    }
  }
  return {
    scanned: batch.length,
    repaired,
    requeued,
    skipped,
    failures,
    nextCursor,
    total: sortedJobs.length,
  };
}

async function refreshPlaylistAfterReuse(playlistType: string) {
  const { playlistManager } = await import('./weeklyFlowPlaylistManager.js');
  await playlistManager.refreshPlaylist(playlistType);
  playlistManager.scheduleScanLibrary();
}

export async function reuseTrackForPlaylist(track: Record<string, unknown>, playlistType: string, options: ReuseOptions = {}): Promise<Record<string, unknown>> {
  const mode = normalizeExistingFileMode(options.existingFileMode);
  if (mode === 'download') {
    return { reused: false, reason: 'Existing file reuse is disabled' };
  }
  const weeklyFlowRoot = path.resolve(options.weeklyFlowRoot || resolveWeeklyFlowRoot());
  const { source, reason } = await resolveReusableTrackSource(track, {
    ...options,
    existingFileMode: mode,
    weeklyFlowRoot,
    targetPlaylistType: playlistType,
  });
  if (!source) return { reused: false, reason };

  const finalPath = path.resolve(String(source.sourcePath));
  if (!(await fileExists(finalPath))) {
    return { reused: false, reason: 'Source file is missing' };
  }

  const jobId = options.existingJobId || downloadTracker.addJob(track, playlistType);
  if (!jobId) {
    return { reused: false, reason: 'Failed to create reuse job' };
  }
  downloadTracker.setDone(
    jobId,
    finalPath,
    source.albumName as string || track.albumName as string || null,
    (source as Record<string, unknown>).externalPath as string || null,
  );
  console.log(
    `[WeeklyFlowReuse] Reused ${source.sourceType} track for ${playlistType}: ${track.artistName} - ${track.trackName}`,
  );
  if (!options.skipHistory && source.sourceType !== 'lidarr') {
    import('./aurralHistoryService.js')
      .then(({ recordTrackReused }) =>
        recordTrackReused({
          track,
          playlistId: playlistType,
          sourceType: source.sourceType as string,
        }),
      )
      .catch(() => {});
  }
  refreshPlaylistAfterReuse(playlistType).catch((error) => {
    console.warn(
      `[WeeklyFlowReuse] Failed to refresh playlist ${playlistType}: ${error?.message || error}`,
    );
  });
  return {
    reused: true,
    jobId,
    sourceType: source.sourceType as string,
    sourcePath: finalPath,
    finalPath,
    albumName: source.albumName as string || track.albumName as string || null,
  };
}
