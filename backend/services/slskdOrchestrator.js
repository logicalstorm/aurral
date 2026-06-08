import path from "path";
import fs from "fs/promises";
import { db } from "../config/db-sqlite.js";
import { slskdClient } from "./slskdClient.js";
import { logger } from "./logger.js";
import { enqueuePipelineJob } from "./honkerDb.js";
import { downloadTracker } from "./playlistDownloadTracker.js";
import {
  buildFlowAlbumSearchQueries,
  buildFlowTrackFallbackSearchQueries,
  rankFlowSearchResults,
  selectRankedMatchAttempts,
  validateDownloadedTrack,
} from "./weeklyFlowSoulseekMatcher.js";
import {
  buildPlaylistDestination,
  resolvePlaylistRoot,
} from "./playlistPaths.js";

const updateSlskdMetaStmt = db.prepare(`
  UPDATE playlist_download_jobs
  SET slskd_search_id = COALESCE(?, slskd_search_id),
      slskd_batch_id = COALESCE(?, slskd_batch_id),
      remote_username = COALESCE(?, remote_username),
      remote_filename = COALESCE(?, remote_filename)
  WHERE id = ?
`);

const MAX_ALBUM_SEARCH_QUERIES = 4;
const MAX_FALLBACK_SEARCH_QUERIES = 3;
const MIN_SEARCH_CANDIDATES = 1;
const MAX_EMPTY_POLL_ATTEMPTS = 60;
const MAX_POLL_ATTEMPTS = 600;

function sanitizePathPart(value, fallback = "Unknown") {
  const text = String(value || "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .trim();
  return text || fallback;
}

function normalizePositiveInteger(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const normalized = Math.floor(Number(value));
  return normalized > 0 ? normalized : null;
}

function normalizeTrackTitles(value) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
}

function buildResolvedTrack(job, payloadTrack = {}) {
  const track =
    payloadTrack && typeof payloadTrack === "object" ? payloadTrack : {};
  return {
    artistName: job.artistName || track.artistName,
    trackName: job.trackName || track.trackName,
    albumName: job.albumName || track.albumName,
    artistMbid: job.artistMbid || track.artistMbid,
    albumMbid: job.albumMbid || track.albumMbid,
    trackMbid: job.trackMbid || track.trackMbid,
    releaseYear: job.releaseYear || track.releaseYear,
    durationMs: job.durationMs ?? track.durationMs ?? null,
    trackNumber: normalizePositiveInteger(job.trackNumber ?? track.trackNumber),
    albumTrackCount: normalizePositiveInteger(
      job.albumTrackCount ?? track.albumTrackCount,
    ),
    albumTrackTitles: normalizeTrackTitles(
      (job.albumTrackTitles?.length ? job.albumTrackTitles : null) ||
        track.albumTrackTitles,
    ),
    artistAliases:
      Array.isArray(job.artistAliases) && job.artistAliases.length
        ? job.artistAliases
        : normalizeTrackTitles(track.artistAliases),
  };
}

async function getWorkerSearchOptions() {
  const { getSlskdSearchFormatOptions } = await import("./slskdClient.js");
  return getSlskdSearchFormatOptions();
}

function classifyTransferState(state) {
  const normalized = String(state || "").toLowerCase();
  if (!normalized) return "pending";
  if (
    normalized.includes("error") ||
    normalized.includes("fail") ||
    normalized.includes("cancel") ||
    normalized.includes("abort") ||
    normalized.includes("reject") ||
    normalized.includes("timeout")
  ) {
    return "failed";
  }
  if (normalized.includes("completed") || normalized.includes("succeeded")) {
    return "success";
  }
  return "pending";
}

function readBatchTransfers(batch) {
  const transfers = batch?.transfers || batch?.Transfers;
  if (Array.isArray(transfers)) return transfers;
  if (Array.isArray(transfers?.$values)) return transfers.$values;
  return [];
}

function readTransferState(transfer) {
  return transfer?.state || transfer?.State || "";
}

export function enqueueJobPipeline(jobId) {
  return downloadTracker.enqueueSlskdPipeline(jobId);
}

export function enqueuePendingJobsWithoutBatch() {
  if (!slskdClient.isConfigured()) return 0;
  let count = 0;
  for (const job of downloadTracker.getByStatus("pending")) {
    if (job.slskdBatchId || job.slskdSearchId) {
      downloadTracker.clearSlskdPipelineState(job.id);
    }
    if (enqueueJobPipeline(job.id)) count += 1;
  }
  return count;
}

async function failJob(job, message) {
  downloadTracker.setFailed(job.id, message);
  try {
    const { recordTrackJobFailed } = await import("./aurralHistoryService.js");
    recordTrackJobFailed(job, message);
  } catch {}
  try {
    const { weeklyFlowWorker } = await import("./weeklyFlowWorker.js");
    weeklyFlowWorker.wake(0);
    await weeklyFlowWorker.checkPlaylistComplete(
      job.playlistId || job.playlistType,
    );
  } catch (error) {
    logger.slskd("warn", "Failed to run post-failure playlist checks", {
      jobId: job.id,
      error: error?.message || String(error),
    });
  }
}

export async function failPipelineJob(payload, message) {
  const jobId = payload?.jobId;
  if (!jobId) return;
  const job = downloadTracker.getJob(jobId);
  if (!job) return;
  if (job.status === "downloading" || job.status === "pending") {
    await failJob(job, message);
  }
}

function joinUnderRoot(root, relativePath, fileName = null) {
  const parts = String(relativePath || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  if (fileName) {
    parts.push(fileName);
  }
  return path.join(root, ...parts);
}

async function findFileRecursive(dir, fileName, depth = 0) {
  if (depth > 8) return null;
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === fileName) {
      return fullPath;
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findFileRecursive(
      path.join(dir, entry.name),
      fileName,
      depth + 1,
    );
    if (found) return found;
  }
  return null;
}

async function moveIntoPlaylistLibrary(sourcePath, targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  if (path.resolve(sourcePath) === path.resolve(targetPath)) {
    return;
  }
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (error) {
    if (error?.code !== "EXDEV") {
      throw error;
    }
    await fs.copyFile(sourcePath, targetPath);
    await fs.rm(sourcePath, { force: true });
  }
}

async function cleanupEmptyAncestors(dir, rootBoundary) {
  const root = path.resolve(String(rootBoundary || "").trim());
  if (!root) return;
  let current = path.resolve(String(dir || "").trim());
  if (!current || current === root) return;
  while (current.startsWith(`${root}${path.sep}`)) {
    try {
      const entries = await fs.readdir(current);
      if (entries.length > 0) break;
      await fs.rmdir(current);
      current = path.dirname(current);
      if (current === root) break;
    } catch {
      break;
    }
  }
}

async function locateCompletedDownload(
  slskdRoot,
  playlistRoot,
  destination,
  fileName,
) {
  const directCandidates = [];
  if (slskdRoot) {
    directCandidates.push(joinUnderRoot(slskdRoot, destination, fileName));
  }
  if (playlistRoot) {
    const playlistCandidate = joinUnderRoot(
      playlistRoot,
      destination,
      fileName,
    );
    if (
      !directCandidates.some(
        (entry) => path.resolve(entry) === path.resolve(playlistCandidate),
      )
    ) {
      directCandidates.push(playlistCandidate);
    }
  }
  for (const candidate of directCandidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  const searchRoots = [];
  if (slskdRoot) {
    searchRoots.push(joinUnderRoot(slskdRoot, destination));
    searchRoots.push(slskdRoot);
  }
  if (playlistRoot) {
    searchRoots.push(joinUnderRoot(playlistRoot, destination));
  }
  for (const root of searchRoots) {
    const found = await findFileRecursive(root, fileName);
    if (found) return found;
  }
  return null;
}

function countPreDownloadValidCandidates(results, resolvedTrack, searchOptions) {
  const ranked = rankFlowSearchResults(results, resolvedTrack, searchOptions);
  return ranked.filter((entry) => entry.preDownloadValid).length;
}

function mergeSearchResults(aggregated, seen, results) {
  for (const result of results) {
    const key = `${result.user}\0${result.file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    aggregated.push(result);
  }
}

function hasEnoughSearchCandidates(
  aggregated,
  queryResults,
  seen,
  resolvedTrack,
  searchOptions,
) {
  const probe = aggregated.slice();
  const probeSeen = new Set(seen);
  for (const result of queryResults) {
    const key = `${result.user}\0${result.file}`;
    if (probeSeen.has(key)) continue;
    probeSeen.add(key);
    probe.push(result);
  }
  return (
    countPreDownloadValidCandidates(probe, resolvedTrack, searchOptions) >=
    MIN_SEARCH_CANDIDATES
  );
}

async function runSearchQuery(
  query,
  searchIdRef,
  resolvedTrack,
  searchOptions,
  aggregated,
  seen,
) {
  const created = await slskdClient.createSearch(query);
  if (!searchIdRef.value) {
    searchIdRef.value = created.id;
  }
  const completed = await slskdClient.waitForSearch(created.id, undefined, {
    earlyExitWhen: (data) =>
      hasEnoughSearchCandidates(
        aggregated,
        slskdClient.flattenSearchResults(data),
        seen,
        resolvedTrack,
        searchOptions,
      ),
  });
  return slskdClient.flattenSearchResults(completed);
}

async function handleSearch(payload) {
  const job = downloadTracker.getJob(payload.jobId);
  if (!job) return null;
  if (job.status === "failed" || job.status === "done") return null;
  downloadTracker.setDownloading(job.id);
  import("./aurralHistoryService.js")
    .then(({ recordTrackJobSearching }) => recordTrackJobSearching(job))
    .catch(() => {});
  const resolvedTrack = buildResolvedTrack(job, payload.track);
  const albumQueries = buildFlowAlbumSearchQueries(resolvedTrack).slice(
    0,
    MAX_ALBUM_SEARCH_QUERIES,
  );
  const fallbackQueries = buildFlowTrackFallbackSearchQueries(
    resolvedTrack,
  ).slice(0, MAX_FALLBACK_SEARCH_QUERIES);
  const searchOptions = await getWorkerSearchOptions();
  const aggregated = [];
  const seen = new Set();
  const searchIdRef = { value: null };
  const queries = [];
  const runQueryBatch = async (batch) => {
    for (const query of batch) {
      queries.push(query);
      const results = await runSearchQuery(
        query,
        searchIdRef,
        resolvedTrack,
        searchOptions,
        aggregated,
        seen,
      );
      mergeSearchResults(aggregated, seen, results);
      if (
        countPreDownloadValidCandidates(
          aggregated,
          resolvedTrack,
          searchOptions,
        ) >= MIN_SEARCH_CANDIDATES
      ) {
        return true;
      }
    }
    return false;
  };
  const albumSatisfied = await runQueryBatch(albumQueries);
  if (
    !albumSatisfied &&
    countPreDownloadValidCandidates(aggregated, resolvedTrack, searchOptions) <
      MIN_SEARCH_CANDIDATES
  ) {
    await runQueryBatch(fallbackQueries);
  }
  if (searchIdRef.value) {
    updateSlskdMetaStmt.run(searchIdRef.value, null, null, null, job.id);
    job.slskdSearchId = searchIdRef.value;
  }
  const ranked = rankFlowSearchResults(
    aggregated,
    resolvedTrack,
    searchOptions,
  );
  const eligible = ranked.filter((entry) => entry.preDownloadValid);
  const candidatePool = eligible.length > 0 ? eligible : ranked;
  const candidates = selectRankedMatchAttempts(candidatePool, 7).map((entry) => ({
    raw: entry.raw,
    score: entry.score,
    resolvedAlbumName: entry.resolvedAlbumName,
  }));
  if (candidates.length === 0) {
    logger.slskd("warn", "No slskd download candidates after search", {
      jobId: job.id,
      artistName: job.artistName,
      trackName: job.trackName,
      queryCount: queries.length,
      rawResultCount: aggregated.length,
      rankedCount: ranked.length,
      eligibleCount: eligible.length,
    });
    await failJob(job, "No suitable slskd search results");
    return null;
  }
  return {
    ...payload,
    phase: "download",
    searchId: searchIdRef.value,
    candidates,
    candidateIndex: 0,
  };
}

async function handleDownload(payload) {
  const job = downloadTracker.getJob(payload.jobId);
  if (!job) return null;
  if (job.status === "failed" || job.status === "done") return null;
  import("./aurralHistoryService.js")
    .then(({ recordTrackJobDownloading }) => recordTrackJobDownloading(job))
    .catch(() => {});
  const candidates = Array.isArray(payload.candidates)
    ? payload.candidates
    : [];
  const index = Number(payload.candidateIndex || 0);
  const candidate = candidates[index];
  if (!candidate?.raw?.user || !candidate?.raw?.file) {
    await failJob(job, "No download candidate available");
    return null;
  }
  const searchId = payload.searchId || null;
  updateSlskdMetaStmt.run(
    searchId,
    null,
    candidate.raw.user,
    candidate.raw.file,
    job.id,
  );
  let result;
  try {
    result = await slskdClient.enqueueBatch({
      username: candidate.raw.user,
      files: [
        {
          filename: candidate.raw.file,
          size: Number(candidate.raw.size || 0),
        },
      ],
      options: {
        destination: payload.destination,
        externalId: job.id,
        searchId,
      },
    });
  } catch (error) {
    const message = error?.message || String(error);
    logger.slskd("warn", "slskd batch enqueue failed for candidate", {
      jobId: job.id,
      username: candidate.raw.user,
      file: candidate.raw.file,
      candidateIndex: index,
      error: message,
    });
    const nextIndex = index + 1;
    if (nextIndex < candidates.length) {
      return {
        ...payload,
        phase: "download",
        candidateIndex: nextIndex,
        pollAttempts: 0,
      };
    }
    await failJob(job, message);
    return null;
  }
  updateSlskdMetaStmt.run(null, result.batchId || null, null, null, job.id);
  job.slskdBatchId = result.batchId || null;
  return {
    ...payload,
    phase: "poll",
    batchId: result.batchId,
    legacyTransfer: result.legacy
      ? {
          id: result.transferId,
          username: result.username || candidate.raw.user,
        }
      : null,
    candidate,
    candidateIndex: index,
    pollAttempts: 0,
  };
}

async function handlePoll(payload) {
  const job = downloadTracker.getJob(payload.jobId);
  if (!job) return null;
  if (job.status === "failed" || job.status === "done") return null;
  const pollAttempts = Number(payload.pollAttempts || 0) + 1;
  if (pollAttempts > MAX_POLL_ATTEMPTS) {
    await failJob(job, "slskd transfer polling timed out");
    return null;
  }
  if (payload.legacyTransfer?.id && payload.legacyTransfer?.username) {
    const transfer = await slskdClient.getTransfer(
      payload.legacyTransfer.username,
      payload.legacyTransfer.id,
    );
    if (!transfer) {
      return { ...payload, phase: "poll", delaySeconds: 3, pollAttempts };
    }
    const state = classifyTransferState(readTransferState(transfer));
    if (state === "failed") {
      const nextIndex = Number(payload.candidateIndex || 0) + 1;
      if (nextIndex < (payload.candidates?.length || 0)) {
        return {
          ...payload,
          phase: "download",
          candidateIndex: nextIndex,
          pollAttempts: 0,
          legacyTransfer: null,
        };
      }
      await failJob(job, "slskd transfer failed");
      return null;
    }
    if (state !== "success") {
      return { ...payload, phase: "poll", delaySeconds: 3, pollAttempts };
    }
    return {
      ...payload,
      phase: "finalize",
      batch: { transfers: [transfer] },
      pollAttempts,
    };
  }
  const batch = await slskdClient.getBatch(payload.batchId);
  if (!batch) {
    return { ...payload, phase: "poll", delaySeconds: 3, pollAttempts };
  }
  const transfers = readBatchTransfers(batch);
  if (transfers.length === 0) {
    const nextIndex = Number(payload.candidateIndex || 0) + 1;
    if (pollAttempts >= 3 && nextIndex < (payload.candidates?.length || 0)) {
      logger.slskd("warn", "slskd batch has no transfers; trying next candidate", {
        jobId: job.id,
        batchId: payload.batchId,
        candidateIndex: Number(payload.candidateIndex || 0),
      });
      return {
        ...payload,
        phase: "download",
        candidateIndex: nextIndex,
        pollAttempts: 0,
      };
    }
    if (pollAttempts >= MAX_EMPTY_POLL_ATTEMPTS) {
      await failJob(job, "slskd batch returned no transfers");
      return null;
    }
    return { ...payload, phase: "poll", delaySeconds: 3, pollAttempts };
  }
  const states = transfers.map((transfer) =>
    classifyTransferState(readTransferState(transfer)),
  );
  const anyFailed = states.some((state) => state === "failed");
  const allSuccess = states.every((state) => state === "success");
  if (anyFailed) {
    const nextIndex = Number(payload.candidateIndex || 0) + 1;
    if (nextIndex < (payload.candidates?.length || 0)) {
      return {
        ...payload,
        phase: "download",
        candidateIndex: nextIndex,
        pollAttempts: 0,
      };
    }
    await failJob(job, "slskd transfer failed");
    return null;
  }
  if (!allSuccess) {
    return { ...payload, phase: "poll", delaySeconds: 3, pollAttempts };
  }
  return { ...payload, phase: "finalize", batch, pollAttempts };
}

async function handleFinalize(payload) {
  const job = downloadTracker.getJob(payload.jobId);
  if (!job) return null;
  if (job.status === "failed" || job.status === "done") return null;
  const playlistRoot = resolvePlaylistRoot();
  const slskdRoot = await slskdClient.getDownloadDirectory();
  const destination = String(payload.destination || "").trim();
  const candidate = payload.candidate;
  const remoteFile = String(candidate?.raw?.file || "");
  const fileName = path.basename(remoteFile.replace(/\\/g, "/"));
  const sourcePath = await locateCompletedDownload(
    slskdRoot,
    playlistRoot,
    destination,
    fileName,
  );
  if (!sourcePath) {
    const expected = slskdRoot
      ? joinUnderRoot(slskdRoot, destination, fileName)
      : joinUnderRoot(playlistRoot, destination, fileName);
    await failJob(job, `Downloaded file missing: ${expected}`);
    return null;
  }
  const ext = path.extname(sourcePath).toLowerCase();
  const finalDir = joinUnderRoot(playlistRoot, destination);
  const finalName = `${sanitizePathPart(job.trackName, "Unknown Track")}${ext || ".mp3"}`;
  const finalPath = path.join(finalDir, finalName);
  import("./aurralHistoryService.js")
    .then(({ recordTrackJobMoving }) => recordTrackJobMoving(job))
    .catch(() => {});
  await moveIntoPlaylistLibrary(sourcePath, finalPath);
  if (slskdRoot) {
    await cleanupEmptyAncestors(path.dirname(sourcePath), slskdRoot).catch(
      () => {},
    );
  }
  const validation = await validateDownloadedTrack(
    finalPath,
    candidate,
    buildResolvedTrack(job, payload.track),
  );
  if (!validation.valid) {
    await fs.rm(finalPath, { force: true }).catch(() => {});
    const nextIndex = Number(payload.candidateIndex || 0) + 1;
    if (nextIndex < (payload.candidates?.length || 0)) {
      return {
        ...payload,
        phase: "download",
        candidateIndex: nextIndex,
        pollAttempts: 0,
      };
    }
    await failJob(job, validation.reason || "Download validation failed");
    return null;
  }
  downloadTracker.setDone(
    job.id,
    finalPath,
    candidate?.resolvedAlbumName || job.albumName,
  );
  import("./aurralHistoryService.js")
    .then(({ recordTrackJobCompleted }) => recordTrackJobCompleted(job))
    .catch(() => {});
  const playlistType = job.playlistId || job.playlistType;
  const { playlistManager } = await import("./weeklyFlowPlaylistManager.js");
  await playlistManager.refreshPlaylist(playlistType);
  playlistManager.scheduleScanLibrary();
  const { weeklyFlowWorker } = await import("./weeklyFlowWorker.js");
  weeklyFlowWorker.wake(0);
  await weeklyFlowWorker.checkPlaylistComplete(playlistType);
  return null;
}

export async function processPipelinePayload(payload) {
  if (!payload || !payload.phase || !payload.jobId) {
    throw new Error("Invalid pipeline payload");
  }
  if (!slskdClient.isConfigured()) {
    const job = downloadTracker.getJob(payload.jobId);
    if (job) {
      await failJob(job, "slskd not configured");
    }
    return null;
  }
  switch (payload.phase) {
    case "search":
      return handleSearch(payload);
    case "download":
      return handleDownload(payload);
    case "poll":
      return handlePoll(payload);
    case "finalize":
      return handleFinalize(payload);
    default:
      throw new Error(`Unknown pipeline phase: ${payload.phase}`);
  }
}

export async function continuePipeline(payload) {
  if (!payload) return;
  if (payload.delaySeconds) {
    enqueuePipelineJob(payload, {
      delaySeconds: Number(payload.delaySeconds),
    });
    return;
  }
  enqueuePipelineJob(payload, {});
}
