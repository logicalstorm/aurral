import path from "path";
import fs from "fs/promises";
import { db } from "../config/db-sqlite.js";
import { slskdClient } from "./slskdClient.js";
import { enqueuePipelineJob } from "./honkerDb.js";
import { downloadTracker } from "./playlistDownloadTracker.js";
import {
  buildFlowSearchQueries,
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

const MAX_SEARCH_QUERIES = 4;
const MAX_EMPTY_POLL_ATTEMPTS = 60;
const MAX_POLL_ATTEMPTS = 600;

function sanitizePathPart(value, fallback = "Unknown") {
  const text = String(value || "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .trim();
  return text || fallback;
}

function buildResolvedTrack(job) {
  return {
    artistName: job.artistName,
    trackName: job.trackName,
    albumName: job.albumName,
    artistMbid: job.artistMbid,
    albumMbid: job.albumMbid,
    trackMbid: job.trackMbid,
    releaseYear: job.releaseYear,
    durationMs: job.durationMs,
    artistAliases: job.artistAliases || [],
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

export function enqueueJobPipeline(jobId) {
  return downloadTracker.enqueueSlskdPipeline(jobId);
}

export function enqueuePendingJobsWithoutBatch() {
  if (!slskdClient.isConfigured()) return 0;
  let count = 0;
  for (const job of downloadTracker.getByStatus("pending")) {
    if (job.slskdBatchId) {
      downloadTracker.clearSlskdPipelineState(job.id);
    }
    if (enqueueJobPipeline(job.id)) count += 1;
  }
  return count;
}

async function failJob(job, message) {
  downloadTracker.setFailed(job.id, message);
  import("./aurralHistoryService.js")
    .then(({ recordTrackJobFailed }) => recordTrackJobFailed(job, message))
    .catch(() => {});
  const { weeklyFlowWorker } = await import("./weeklyFlowWorker.js");
  weeklyFlowWorker.wake(0);
  await weeklyFlowWorker.checkPlaylistComplete(job.playlistId || job.playlistType);
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

async function locateCompletedDownload(slskdRoot, playlistRoot, destination, fileName) {
  const directCandidates = [];
  if (slskdRoot) {
    directCandidates.push(joinUnderRoot(slskdRoot, destination, fileName));
  }
  if (playlistRoot) {
    const playlistCandidate = joinUnderRoot(playlistRoot, destination, fileName);
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

async function runSearchQuery(query, searchIdRef) {
  const created = await slskdClient.createSearch(query);
  if (!searchIdRef.value) {
    searchIdRef.value = created.id;
  }
  const completed = await slskdClient.waitForSearch(created.id);
  return slskdClient.flattenSearchResults(completed);
}

async function handleSearch(payload) {
  const job = downloadTracker.getJob(payload.jobId);
  if (!job) return null;
  downloadTracker.setDownloading(job.id);
  import("./aurralHistoryService.js")
    .then(({ recordTrackJobSearching }) => recordTrackJobSearching(job))
    .catch(() => {});
  const resolvedTrack = buildResolvedTrack(job);
  const queries = buildFlowSearchQueries(resolvedTrack).slice(0, MAX_SEARCH_QUERIES);
  const searchOptions = await getWorkerSearchOptions();
  const aggregated = [];
  const seen = new Set();
  const searchIdRef = { value: null };
  for (const query of queries) {
    const results = await runSearchQuery(query, searchIdRef);
    for (const result of results) {
      const key = `${result.user}\0${result.file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      aggregated.push(result);
    }
    if (aggregated.length >= 3) break;
  }
  if (searchIdRef.value) {
    updateSlskdMetaStmt.run(searchIdRef.value, null, null, null, job.id);
    job.slskdSearchId = searchIdRef.value;
  }
  const ranked = rankFlowSearchResults(aggregated, resolvedTrack, searchOptions);
  const candidates = selectRankedMatchAttempts(ranked, 7).map((entry) => ({
    raw: entry.raw,
    score: entry.score,
    resolvedAlbumName: entry.resolvedAlbumName,
  }));
  if (candidates.length === 0) {
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
  import("./aurralHistoryService.js")
    .then(({ recordTrackJobDownloading }) => recordTrackJobDownloading(job))
    .catch(() => {});
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
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
  const result = await slskdClient.enqueueBatch({
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
    },
  });
  updateSlskdMetaStmt.run(null, result.batchId, null, null, job.id);
  job.slskdBatchId = result.batchId;
  return {
    ...payload,
    phase: "poll",
    batchId: result.batchId,
    candidate,
    candidateIndex: index,
    pollAttempts: 0,
  };
}

async function handlePoll(payload) {
  const job = downloadTracker.getJob(payload.jobId);
  if (!job) return null;
  const pollAttempts = Number(payload.pollAttempts || 0) + 1;
  if (pollAttempts > MAX_POLL_ATTEMPTS) {
    await failJob(job, "slskd transfer polling timed out");
    return null;
  }
  const batch = await slskdClient.getBatch(payload.batchId);
  if (!batch) {
    return { ...payload, phase: "poll", delaySeconds: 3, pollAttempts };
  }
  const transfers = Array.isArray(batch?.transfers) ? batch.transfers : [];
  if (transfers.length === 0) {
    if (pollAttempts >= MAX_EMPTY_POLL_ATTEMPTS) {
      await failJob(job, "slskd batch returned no transfers");
      return null;
    }
    return { ...payload, phase: "poll", delaySeconds: 3, pollAttempts };
  }
  const states = transfers.map((transfer) =>
    classifyTransferState(transfer?.state),
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
  await moveIntoPlaylistLibrary(sourcePath, finalPath);
  const validation = await validateDownloadedTrack(
    finalPath,
    candidate,
    buildResolvedTrack(job),
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
  enqueuePipelineJob(payload);
}
