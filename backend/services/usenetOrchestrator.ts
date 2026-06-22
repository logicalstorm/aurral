import path from 'path';
import fsAsync from 'fs/promises';
import { downloadTracker } from './playlistDownloadTracker.js';
import { prowlarrClient } from './prowlarrClient.js';
import { nzbgetClient } from './nzbgetClient.js';
import { logger } from './logger.js';
import { buildFlowSearchTiers, validateDownloadedTrack } from './weeklyFlowSoulseekMatcher.js';
import {
  isAudioFile,
  rankUsenetReleases,
  selectRankedUsenetCandidates,
} from './weeklyFlowUsenetMatcher.js';
import { resolvePlaylistRoot } from './playlistPaths.js';
import { getPathMappings, resolveLocalPath } from './pathMappings.js';
import {
  buildResolvedPlaylistTrack as buildResolvedTrack,
  commitImportToPlaylistLibrary,
  joinUnderRoot,
  sanitizePathPart,
} from './playlistDownloadUtils.js';

type PipelinePayload = Record<string, unknown>;
type AnyRecord = Record<string, unknown>;

const MIN_USENET_CANDIDATES = 2;
const MAX_DOWNLOAD_CANDIDATES = 5;
const POLL_DELAY_SECONDS = 5;
const MAX_POLL_ATTEMPTS = 720;

function getPayloadCandidate(payload: PipelinePayload) {
  const candidateIndex = Number(payload?.candidateIndex || 0);
  return (
    payload?.candidate ||
    (Array.isArray(payload?.candidates) ? payload.candidates[candidateIndex] : null)
  );
}

function hasNextCandidate(payload: PipelinePayload) {
  return (
    Number(payload?.candidateIndex || 0) + 1 <
    (Array.isArray(payload?.candidates) ? payload.candidates.length : 0)
  );
}

function buildNextCandidatePayload(payload: PipelinePayload) {
  return {
    ...payload,
    phase: 'download',
    candidate: null,
    candidateIndex: Number(payload?.candidateIndex || 0) + 1,
    pollAttempts: 0,
    nzbId: null,
    history: null,
  };
}

function mergeSearchResults(aggregated: unknown[], seen: Set<string>, releases: unknown[]) {
  for (const release of releases) {
    const r = release as AnyRecord;
    const key = [r.guid, r.downloadUrl, r.indexerId, r.title]
      .map((entry) =>
        String(entry || '')
          .trim()
          .toLowerCase(),
      )
      .join('\0');
    if (seen.has(key)) continue;
    seen.add(key);
    aggregated.push(release);
  }
}

function hasEnoughCandidates(aggregated: unknown[], resolvedTrack: unknown) {
  return (
    rankUsenetReleases(aggregated as Record<string, unknown>[], resolvedTrack as Record<string, unknown>).filter((entry) => entry.preDownloadValid)
      .length >= MIN_USENET_CANDIDATES
  );
}

function classifyHistoryStatus(item: unknown) {
  const status = String((item as AnyRecord)?.Status || (item as AnyRecord)?.status || '').toUpperCase();
  if (!status) return 'pending';
  if (status.startsWith('SUCCESS') || status.startsWith('WARNING')) {
    return 'success';
  }
  if (status.startsWith('FAILURE') || status.startsWith('DELETED')) {
    return 'failed';
  }
  return 'pending';
}

function readQueueStatus(item: unknown) {
  return String((item as AnyRecord)?.Status || (item as AnyRecord)?.status || '').toUpperCase();
}

async function findAudioFilesRecursive(root: string, depth = 0, matches: string[] = []): Promise<string[]> {
  if (depth > 7) return matches;
  let entries: { name: string; isFile: () => boolean; isDirectory: () => boolean }[] = [];
  try {
    entries = await fsAsync.readdir(root, { withFileTypes: true }) as unknown as typeof entries;
  } catch {
    return matches;
  }
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && isAudioFile(fullPath)) {
      matches.push(fullPath);
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name.toLowerCase();
    if (name === '__macosx' || name === '.sync' || name === '.DS_Store') {
      continue;
    }
    await findAudioFilesRecursive(path.join(root, entry.name), depth + 1, matches);
  }
  return matches;
}

function uniqueResolvedPaths(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const nzbgetMappings = getPathMappings('nzbget' as unknown as string | null);
  for (const value of values) {
    const raw = String(value || '').trim();
    if (!raw) continue;
    const resolved = path.resolve(resolveLocalPath(raw, nzbgetMappings));
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

interface BestAudioResult {
  filePath: string | null;
  validation: { valid: boolean; reason: unknown; scores: Record<string, number>; actualDurationMs: unknown; remoteFilename: unknown } | null;
  score: number;
  valid?: boolean;
}

async function locateBestDownloadedAudio(historyItem: unknown, candidate: unknown, resolvedTrack: unknown): Promise<BestAudioResult> {
  const directories = await nzbgetClient.getDownloadDirectories();
  const roots = uniqueResolvedPaths([
    (historyItem as AnyRecord)?.FinalDir,
    (historyItem as AnyRecord)?.DestDir,
    directories.completedPath,
    directories.destDir,
  ]);
  const files: string[] = [];
  for (const root of roots) {
    const stat = await fsAsync.stat(root).catch(() => null);
    if (stat?.isFile() && isAudioFile(root)) {
      files.push(root);
      continue;
    }
    if (stat?.isDirectory()) {
      files.push(...(await findAudioFilesRecursive(root)));
    }
  }
  const uniqueFiles = uniqueResolvedPaths(files);
  let best: BestAudioResult | null = null;
  for (const filePath of uniqueFiles) {
    const validation = await validateDownloadedTrack(
      filePath,
      {
        ...(candidate as AnyRecord),
        raw: {
          ...((candidate as AnyRecord)?.raw as AnyRecord || {}),
          file: filePath,
        },
      } as Record<string, unknown>,
      resolvedTrack as Record<string,unknown>,
    );
    const score =
      Number(validation?.scores?.title || 0) +
      Number(validation?.scores?.artist || 0) +
      Number(validation?.scores?.album || 0);
    if (validation.valid) {
      if (!best || score > best.score) {
        best = { filePath, validation, score, valid: true };
      }
    } else if (!best?.valid && (!best || score > best.score)) {
      best = { filePath, validation, score };
    }
  }
  return best?.validation?.valid ? best : { filePath: null, validation: best?.validation || null, score: best?.score || 0 };
}

async function handleUsenetSearch(payload: PipelinePayload, helpers: AnyRecord) {
  const job = downloadTracker.getJob(payload.jobId as string);
  if (!job) return null;
  if (job.status === 'failed' || job.status === 'done') return null;
  downloadTracker.setDownloading(job.id);
  downloadTracker.updateDownloadMetadata(job.id, {
    downloadSource: 'usenet',
  });
  import('./aurralHistoryService.js')
    .then(({ recordTrackJobSearching }) => recordTrackJobSearching(job))
    .catch(() => {});

  const resolvedTrack = buildResolvedTrack(job, payload.track);
  const searchTiers = buildFlowSearchTiers(resolvedTrack);
  const aggregated: unknown[] = [];
  const seen = new Set<string>();
  const queries: unknown[] = [];
  let lastError = '';
  for (const tier of searchTiers) {
    if (hasEnoughCandidates(aggregated, resolvedTrack)) break;
    for (const query of (tier as AnyRecord).queries as unknown[]) {
      if (hasEnoughCandidates(aggregated, resolvedTrack)) break;
      queries.push(query);
      try {
        const releases = await prowlarrClient.search(query as string);
        mergeSearchResults(aggregated, seen, releases);
      } catch (error) {
        lastError = (error as Error)?.message || String(error);
        logger.slskd(2, 'Prowlarr search failed', {
          jobId: job.id,
          query,
          error: lastError,
        });
      }
    }
  }
  const ranked = rankUsenetReleases(aggregated as Record<string, unknown>[], resolvedTrack);
  const candidates = selectRankedUsenetCandidates(ranked, MAX_DOWNLOAD_CANDIDATES).map((entry) => ({
    raw: entry.raw,
    score: entry.score,
    scores: entry.scores,
    resolvedAlbumName: entry.resolvedAlbumName,
    preDownloadValid: entry.preDownloadValid === true,
  }));
  if (candidates.length === 0) {
    const message =
      lastError && aggregated.length === 0
        ? `Prowlarr search failed: ${lastError}`
        : 'No suitable Usenet search results';
    return (helpers.failOrTryNextSource as (...args: unknown[]) => unknown)(payload, job, message, {
      queryCount: queries.length,
      rawResultCount: aggregated.length,
      rankedCount: ranked.length,
    });
  }
  return {
    ...payload,
    phase: 'download',
    source: 'usenet',
    candidates,
    candidateIndex: 0,
    resolvedTrack,
  };
}

async function handleUsenetDownload(payload: PipelinePayload, helpers: AnyRecord) {
  const job = downloadTracker.getJob(payload.jobId as string);
  if (!job) return null;
  if (job.status === 'failed' || job.status === 'done') return null;
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const index = Number(payload.candidateIndex || 0);
  const candidate = candidates[index] as AnyRecord;
  const release = (candidate?.raw as AnyRecord)?.release as AnyRecord | undefined;
  if (!release?.downloadUrl) {
    return (helpers.failOrTryNextSource as (...args: unknown[]) => unknown)(payload, job, 'No Usenet release URL available');
  }
  import('./aurralHistoryService.js')
    .then(({ recordTrackJobDownloading }) => recordTrackJobDownloading(job))
    .catch(() => {});
  let appended: { nzbId: number; nzbName: string } | undefined;
  try {
    appended = await nzbgetClient.appendUrl({
      name: release.title,
      url: release.downloadUrl,
      category: undefined,
      priority: undefined,
      addPaused: true,
      dupeKey: `aurral-${job.id}`,
      dupeScore: Number(candidate.score || 0),
    });
  } catch (error) {
    const message = (error as Error)?.message || String(error);
    logger.slskd(2, 'NZBGet append failed for Usenet release', {
      jobId: job.id,
      releaseTitle: release.title,
      error: message,
    });
    if (hasNextCandidate(payload)) return buildNextCandidatePayload(payload);
    return (helpers.failOrTryNextSource as (...args: unknown[]) => unknown)(payload, job, message);
  }
  downloadTracker.updateDownloadMetadata(job.id as string, {
    downloadSource: 'usenet',
    downloadClient: 'nzbget',
    downloadClientId: appended.nzbId,
    releaseGuid: release.guid,
    releaseTitle: release.title,
    indexerId: release.indexerId,
    indexerName: release.indexer,
    remoteUsername: release.indexer,
    remoteFilename: release.title,
  });
  return {
    ...payload,
    phase: 'poll',
    source: 'usenet',
    nzbId: appended.nzbId,
    candidate,
    candidateIndex: index,
    pollAttempts: 0,
  };
}

async function handleUsenetPoll(payload: PipelinePayload, helpers: AnyRecord) {
  const job = downloadTracker.getJob(payload.jobId as string);
  if (!job) return null;
  if (job.status === 'failed' || job.status === 'done') return null;
  const pollAttempts = Number(payload.pollAttempts || 0) + 1;
  if (pollAttempts > MAX_POLL_ATTEMPTS) {
    if (hasNextCandidate(payload)) return buildNextCandidatePayload(payload);
    return (helpers.failOrTryNextSource as (...args: unknown[]) => unknown)(payload, job, 'NZBGet polling timed out');
  }
  const historyItem = await nzbgetClient.getHistoryItem(payload.nzbId);
  if (historyItem) {
    const state = classifyHistoryStatus(historyItem);
    if (state === 'success') {
      return {
        ...payload,
        phase: 'finalize',
        history: historyItem,
        pollAttempts,
      };
    }
    if (state === 'failed') {
      if (hasNextCandidate(payload)) return buildNextCandidatePayload(payload);
      return (helpers.failOrTryNextSource as (...args: unknown[]) => unknown)(
        payload,
        job,
        `NZBGet download failed: ${(historyItem as AnyRecord).Status || 'failed'}`,
      );
    }
  }
  const queueItem = await nzbgetClient.getQueueItem(payload.nzbId);
  const queueStatus = readQueueStatus(queueItem);
  if (queueStatus && queueStatus.includes('PAUSED')) {
    return {
      ...payload,
      phase: 'poll',
      delaySeconds: POLL_DELAY_SECONDS,
      pollAttempts,
    };
  }
  return {
    ...payload,
    phase: 'poll',
    delaySeconds: POLL_DELAY_SECONDS,
    pollAttempts,
  };
}

async function handleUsenetFinalize(payload: PipelinePayload, helpers: AnyRecord) {
  const job = downloadTracker.getJob(payload.jobId as string);
  if (!job) return null;
  if (job.status === 'failed' || job.status === 'done') return null;
  const candidate = getPayloadCandidate(payload);
  const historyItem = payload.history || (await nzbgetClient.getHistoryItem(payload.nzbId));
  const resolvedTrack = buildResolvedTrack(job, payload.track);
  const found = await locateBestDownloadedAudio(historyItem, candidate, resolvedTrack);
  if (!found.filePath) {
    const reason =
      found.validation?.reason || 'NZBGet completed, but no matching audio file was found';
    if (hasNextCandidate(payload)) return buildNextCandidatePayload(payload);
    return (helpers.failOrTryNextSource as (...args: unknown[]) => unknown)(payload, job, reason);
  }

  import('./aurralHistoryService.js')
    .then(({ recordTrackJobMoving }) => recordTrackJobMoving(job))
    .catch(() => {});
  const playlistRoot = resolvePlaylistRoot();
  const destination = String(payload.destination || '').trim();
  const ext = path.extname(found.filePath).toLowerCase();
  const finalDir = joinUnderRoot(playlistRoot, destination);
  const finalName = `${sanitizePathPart(job.trackName as string, 'Unknown Track')}${ext || '.mp3'}`;
  const finalPath = path.join(finalDir, finalName);
  const committedFinalPath = await commitImportToPlaylistLibrary(found.filePath, finalPath);
  downloadTracker.setDone(
    job.id as string,
    committedFinalPath,
    ((candidate as AnyRecord)?.resolvedAlbumName as string) || (job.albumName as string | null),
  );
  import('./aurralHistoryService.js')
    .then(({ recordTrackJobCompleted }) => recordTrackJobCompleted(job))
    .catch(() => {});
  const playlistType = (job.playlistId || job.playlistType) as string;
  const { playlistManager } = await import('./weeklyFlowPlaylistManager.js');
  await playlistManager.refreshPlaylist(playlistType);
  playlistManager.scheduleScanLibrary();
  const { weeklyFlowWorker } = await import('./weeklyFlowWorker.js');
  weeklyFlowWorker.wake(0);
  await weeklyFlowWorker.checkPlaylistComplete(playlistType);
  return null;
}

export async function processUsenetPipelinePayload(payload: PipelinePayload, helpers: AnyRecord = {}) {
  switch (payload.phase) {
    case 'search':
      return handleUsenetSearch(payload, helpers);
    case 'download':
      return handleUsenetDownload(payload, helpers);
    case 'poll':
      return handleUsenetPoll(payload, helpers);
    case 'finalize':
      return handleUsenetFinalize(payload, helpers);
    default:
      throw new Error(`Unknown Usenet pipeline phase: ${payload.phase}`);
  }
}
