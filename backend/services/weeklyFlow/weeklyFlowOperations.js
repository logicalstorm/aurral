import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { dbOps } from "../../db/helpers/index.js";
import {
  recordFlowGenerationStarted,
  recordFlowTracksGenerated,
  recordPlaylistTracksAdded,
} from "../aurralHistoryService.js";
import { PLAYLIST_LIBRARY_DIR, isPathInsideRoot } from "../playlistPaths.js";
import { remapLegacyWeeklyFlowPath } from "./weeklyFlowPaths.js";
import {
  dedupeSharedTracks,
  filterMissingSharedTracks,
  flowPlaylistConfig,
  normalizeSharedTrack,
  tracksShareMembership,
} from "./weeklyFlowPlaylistConfig.js";
import {
  normalizeExistingFileMode,
  reuseTrackForPlaylist,
  sortJobsForTrackReuse,
} from "./weeklyFlowFileReuse.js";
import { downloadTracker } from "./weeklyFlowDownloadTracker.js";
import { playlistManager } from "./weeklyFlowPlaylistManager.js";
import { slskdClient } from "../slskdClient.js";
import { weeklyFlowWorker } from "./weeklyFlowWorker.js";
import {
  restartWorkerIfPending,
  wakeDownloadWorker,
  withPlaylistMutation,
} from "./weeklyFlowMutationGuards.js";
import { withHonkerLock } from "../honkerDb.js";
import { getUnavailableFlowSourceError } from "./weeklyFlowValidation.js";
import { schedulePlaylistMbidEnrichment } from "../playlistMbidEnrichmentService.js";

const DEFAULT_LIMIT = 30;
const OPERATION_TOKENS_KEY = "weeklyFlowOperationTokens";
const SLSKD_NOT_CONFIGURED_MESSAGE =
  "slskd is not configured. Add your slskd URL and API key in Settings > Integrations to enable Soulseek downloads for flows and playlists.";

export function createWeeklyFlowOperationToken() {
  return `${Date.now()}-${randomUUID()}`;
}

export function markLatestWeeklyFlowOperationToken(scope, token) {
  const safeScope = String(scope || "").trim();
  const safeToken = String(token || "").trim();
  if (!safeScope || !safeToken) return;
  const current = dbOps.getJSONSetting(OPERATION_TOKENS_KEY) || {};
  dbOps.setJSONSetting(OPERATION_TOKENS_KEY, {
    ...current,
    [safeScope]: safeToken,
  });
}

function isLatestWeeklyFlowOperationToken(scope, token) {
  const safeScope = String(scope || "").trim();
  const safeToken = String(token || "").trim();
  if (!safeScope || !safeToken) return true;
  const current = dbOps.getJSONSetting(OPERATION_TOKENS_KEY) || {};
  return current[safeScope] === safeToken;
}

function normalizeTrackList(value) {
  return (Array.isArray(value) ? value : [])
    .map((track) => normalizeSharedTrack(track))
    .filter(Boolean);
}

const getPlaylistLibraryRoot = (playlistType) =>
  path.resolve(
    weeklyFlowWorker.weeklyFlowRoot,
    PLAYLIST_LIBRARY_DIR,
    String(playlistType || "").trim(),
  );

const removePlaylistLocalTrackFile = async (job, playlistId) => {
  if (!job || typeof job.finalPath !== "string") return;
  const playlistRoot = getPlaylistLibraryRoot(playlistId);
  const safeFinalPath = remapLegacyWeeklyFlowPath(job.finalPath, weeklyFlowWorker.weeklyFlowRoot);
  if (isPathInsideRoot(safeFinalPath, playlistRoot)) {
    await fs.rm(safeFinalPath, { force: true });
  }
};

const jobToSharedTrack = (job) =>
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

const groupJobsByMembership = (jobs) => {
  const groups = [];
  for (const job of Array.isArray(jobs) ? jobs : []) {
    let target = null;
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

const sharedPlaylistTracksMatchJobs = (playlist, jobs) => {
  const configTracks = dedupeSharedTracks(playlist?.tracks);
  if (configTracks.length !== jobs.length) return false;
  const unmatchedJobs = new Set(jobs.map((job) => job.id));
  for (const track of configTracks) {
    const match = jobs.find(
      (job) => unmatchedJobs.has(job.id) && tracksShareMembership(job, track),
    );
    if (!match) return false;
    unmatchedJobs.delete(match.id);
  }
  return unmatchedJobs.size === 0;
};

export async function reconcileSharedPlaylistJobs(playlistId) {
  const safePlaylistId = String(playlistId || "").trim();
  const playlist = flowPlaylistConfig.getSharedPlaylist(safePlaylistId);
  if (!playlist) return { missing: true, changed: false };

  const existingJobs = downloadTracker.getByPlaylistType(safePlaylistId);
  const groups = groupJobsByMembership(existingJobs);
  const keptJobs = [];
  const removedJobIds = [];
  const playlistRoot = getPlaylistLibraryRoot(safePlaylistId);

  for (const group of groups) {
    const [kept, ...dupes] = sortJobsForTrackReuse(group);
    keptJobs.push(kept);
    for (const dupe of dupes) {
      if (dupe.status === "done" && typeof dupe.finalPath === "string") {
        const keptPath =
          kept?.status === "done" && typeof kept.finalPath === "string" ? kept.finalPath : null;
        if (!keptPath || dupe.finalPath !== keptPath) {
          const safeFinalPath = remapLegacyWeeklyFlowPath(
            dupe.finalPath,
            weeklyFlowWorker.weeklyFlowRoot,
          );
          if (isPathInsideRoot(safeFinalPath, playlistRoot)) {
            await fs.rm(safeFinalPath, { force: true });
          }
        }
      }
      downloadTracker.removeJob(dupe.id);
      removedJobIds.push(dupe.id);
    }
  }

  const tracksFromJobs = keptJobs.map((job) => jobToSharedTrack(job)).filter(Boolean);
  const configInSync = sharedPlaylistTracksMatchJobs(playlist, keptJobs);
  const changed = removedJobIds.length > 0 || !configInSync;
  let updatedPlaylist = playlist;
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

const syncSharedPlaylistConfigFromJobs = async (playlistId) => {
  const safePlaylistId = String(playlistId || "").trim();
  const playlist = flowPlaylistConfig.getSharedPlaylist(safePlaylistId);
  if (!playlist) return null;
  const jobs = downloadTracker.getByPlaylistType(safePlaylistId);
  const tracksFromJobs = jobs.map((job) => jobToSharedTrack(job)).filter(Boolean);
  if (sharedPlaylistTracksMatchJobs(playlist, jobs)) {
    return playlist;
  }
  const updatedPlaylist = flowPlaylistConfig.updateSharedPlaylist(safePlaylistId, {
    tracks: tracksFromJobs,
  });
  playlistManager.updateConfig(false);
  return updatedPlaylist;
};

const reuseTracksForPlaylist = async (tracks, playlistId) => {
  const settings = weeklyFlowWorker.getWorkerSettings();
  const existingFileMode = normalizeExistingFileMode(settings.existingFileMode);
  const reusedJobIds = [];
  const tracksToQueue = [];
  for (const track of normalizeTrackList(tracks)) {
    const reuse = await reuseTrackForPlaylist(track, playlistId, {
      existingFileMode,
      weeklyFlowRoot: weeklyFlowWorker.weeklyFlowRoot,
      targetPlaylistType: playlistId,
      skipHistory: true,
    });
    if (reuse.reused) {
      reusedJobIds.push(reuse.jobId);
    } else {
      tracksToQueue.push(track);
    }
  }
  return { reusedJobIds, tracksToQueue };
};

const filterTracksMissingDownloadJobs = (tracks, playlistId) => {
  const existingJobs = downloadTracker.getByPlaylistType(playlistId);
  const missing = [];
  const queued = [];
  for (const track of normalizeTrackList(tracks)) {
    const duplicate =
      existingJobs.some((job) => tracksShareMembership(job, track)) ||
      queued.some((entry) => tracksShareMembership(entry, track));
    if (duplicate) continue;
    queued.push(track);
    missing.push(track);
  }
  return missing;
};

const recordPlaylistHistory = (playlistId, { tracksQueued = 0, tracksReused = 0 } = {}) => {
  if (tracksQueued + tracksReused <= 0) return;
  recordPlaylistTracksAdded({
    playlistId,
    tracksQueued,
    tracksReused,
  });
};

async function seedSharedPlaylistTracks(playlistId, tracks) {
  const missingTracks = filterTracksMissingDownloadJobs(tracks, playlistId);
  const { reusedJobIds, tracksToQueue } = await reuseTracksForPlaylist(missingTracks, playlistId);
  const jobIds = downloadTracker.addJobs(tracksToQueue, playlistId);
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
} = {}) {
  const safeFlowId = String(flowId || "").trim();
  if (!safeFlowId) return { missing: true };
  if (!isLatestWeeklyFlowOperationToken(tokenScope, token)) {
    return { cancelled: true };
  }
  if (!slskdClient.isConfigured()) {
    throw new Error(SLSKD_NOT_CONFIGURED_MESSAGE);
  }
  const flow = flowPlaylistConfig.getFlow(safeFlowId);
  if (!flow) return { missing: true };
  if (requireEnabled && flow.enabled !== true) return { skipped: true };
  const unavailableError = getUnavailableFlowSourceError(flow.mix);
  if (unavailableError) throw new Error(unavailableError);

  const result = await withPlaylistMutation(safeFlowId, async () => {
    if (!isLatestWeeklyFlowOperationToken(tokenScope, token)) {
      return { cancelled: true };
    }
    const latestFlow = flowPlaylistConfig.getFlow(safeFlowId);
    if (!latestFlow) return { missing: true };
    if (requireEnabled && latestFlow.enabled !== true) return { skipped: true };

    recordFlowGenerationStarted({ flowId: safeFlowId });
    playlistManager.updateConfig(false);
    await playlistManager.weeklyReset([safeFlowId]);
    weeklyFlowWorker.clearPlaylistRunState(safeFlowId);
    downloadTracker.clearByPlaylistType(safeFlowId);

    if (!isLatestWeeklyFlowOperationToken(tokenScope, token)) {
      return { cancelled: true };
    }
    const effectiveSize =
      Number.isFinite(Number(size)) && Number(size) > 0
        ? Number(size)
        : latestFlow.size || DEFAULT_LIMIT;
    const seeded = await weeklyFlowWorker.seedFlowRun(safeFlowId, latestFlow, {
      size: effectiveSize,
    });
    if (scheduleNext) {
      flowPlaylistConfig.scheduleNextRun(safeFlowId);
    }
    return {
      jobIds: seeded?.jobIds || [],
      tracksQueued: Number(seeded?.tracksQueued || 0),
      reserveTracks: Number(seeded?.reserveTracks || 0),
      empty: Number(seeded?.tracksQueued || 0) === 0,
      flowName: latestFlow.name,
    };
  });

  if (result?.tracksQueued > 0) {
    await wakeDownloadWorker();
    recordFlowTracksGenerated({
      flowId: safeFlowId,
      tracksQueued: result.tracksQueued,
      reserveTracks: result.reserveTracks || 0,
    });
  } else {
    await restartWorkerIfPending();
  }
  return result;
}

async function runFlowCleanup({ flowId, tokenScope = null, token = null } = {}) {
  const safeFlowId = String(flowId || "").trim();
  if (!safeFlowId) return { missing: true };
  if (!isLatestWeeklyFlowOperationToken(tokenScope, token)) {
    return { cancelled: true };
  }
  await withPlaylistMutation(safeFlowId, async () => {
    if (!isLatestWeeklyFlowOperationToken(tokenScope, token)) {
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

async function deleteFlow({ flowId, tokenScope = null, token = null } = {}) {
  const safeFlowId = String(flowId || "").trim();
  if (!safeFlowId) return false;
  if (!isLatestWeeklyFlowOperationToken(tokenScope, token)) {
    return { cancelled: true };
  }
  let didDelete = false;
  await withPlaylistMutation(safeFlowId, async () => {
    if (!isLatestWeeklyFlowOperationToken(tokenScope, token)) {
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

async function resetPlaylists({ playlistTypes = [] } = {}) {
  const types = (Array.isArray(playlistTypes) ? playlistTypes : [playlistTypes])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  await withPlaylistMutation(types, async () => {
    playlistManager.updateConfig(false);
    await playlistManager.weeklyReset(types);
  });
  await restartWorkerIfPending();
  return { success: true, playlistTypes: types };
}

async function adoptFlowSeed({ flowId, tracks = [] } = {}) {
  const safeFlowId = String(flowId || "").trim();
  const flow = flowPlaylistConfig.getFlow(safeFlowId);
  if (!flow) return { missing: true };
  const normalizedTracks = normalizeTrackList(tracks);
  const result = await withPlaylistMutation(safeFlowId, async () =>
    weeklyFlowWorker.seedFlowRunWithTracks(safeFlowId, flow, normalizedTracks),
  );
  await wakeDownloadWorker();
  recordFlowTracksGenerated({
    flowId: safeFlowId,
    tracksQueued: result?.tracksQueued || normalizedTracks.length,
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
} = {}) {
  const safePlaylistId = String(playlistId || "").trim() || randomUUID();
  const normalizedTracks = normalizeTrackList(tracks);
  let playlist = flowPlaylistConfig.getSharedPlaylist(safePlaylistId);
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
    ? await seedSharedPlaylistTracks(safePlaylistId, normalizedTracks)
    : { jobIds: [], reusedJobIds: [], tracksQueued: 0, tracksReused: 0 };
  playlistManager.updateConfig(false);
  await playlistManager.ensureSmartPlaylists();
  if (normalizedTracks.length > 0) {
    schedulePlaylistMbidEnrichment(safePlaylistId, {
      reason: "shared-playlist-create",
      priority: 5,
    });
  }
  return {
    success: true,
    playlist,
    tracksQueued: queued.tracksQueued,
    tracksReused: queued.tracksReused,
    jobIds: [...queued.reusedJobIds, ...queued.jobIds],
  };
}

async function appendSharedPlaylistTracks({ playlistId, tracks = [] } = {}) {
  const safePlaylistId = String(playlistId || "").trim();
  const playlist = flowPlaylistConfig.getSharedPlaylist(safePlaylistId);
  if (!playlist) return { missing: true };
  const tracksToAdd = filterMissingSharedTracks(playlist.tracks, tracks);
  const updatedPlaylist =
    tracksToAdd.length > 0
      ? flowPlaylistConfig.appendSharedPlaylistTracks(safePlaylistId, tracksToAdd)
      : playlist;
  const queued =
    tracksToAdd.length > 0
      ? await seedSharedPlaylistTracks(safePlaylistId, tracksToAdd)
      : { jobIds: [], reusedJobIds: [], tracksQueued: 0, tracksReused: 0 };
  if (tracksToAdd.length > 0) {
    schedulePlaylistMbidEnrichment(safePlaylistId, {
      reason: "shared-playlist-append",
      priority: 5,
    });
  }
  return {
    success: true,
    playlist: updatedPlaylist,
    tracksQueued: queued.tracksQueued,
    tracksReused: queued.tracksReused,
    jobIds: [...queued.reusedJobIds, ...queued.jobIds],
  };
}

async function updateSharedPlaylist({
  playlistId,
  name = null,
  tracks = [],
  hasNameUpdate = false,
  hasTracksUpdate = false,
} = {}) {
  const safePlaylistId = String(playlistId || "").trim();
  const currentPlaylist = flowPlaylistConfig.getSharedPlaylist(safePlaylistId);
  if (!currentPlaylist) return { missing: true };
  const safeName = hasNameUpdate
    ? String(name || "").trim()
    : String(currentPlaylist.name || "").trim();
  let playlist = null;
  let tracksQueued = 0;
  if (!hasTracksUpdate) {
    playlist = flowPlaylistConfig.updateSharedPlaylist(safePlaylistId, {
      name: safeName,
    });
  } else {
    const normalizedTracks = normalizeTrackList(tracks);
    await withPlaylistMutation(safePlaylistId, async () => {
      const existingJobs = downloadTracker.getByPlaylistType(safePlaylistId);
      const reusableJobsByIdentity = new Map();
      for (const job of existingJobs) {
        const identity = buildSharedTrackIdentity(job);
        const current = reusableJobsByIdentity.get(identity) || [];
        current.push(job);
        reusableJobsByIdentity.set(identity, current);
      }
      for (const [identity, jobsForIdentity] of reusableJobsByIdentity.entries()) {
        reusableJobsByIdentity.set(identity, sortJobsForTrackReuse(jobsForIdentity));
      }

      const matchedJobIds = new Set();
      const tracksNeedingWork = [];
      for (const track of normalizedTracks) {
        const identity = buildSharedTrackIdentity(track);
        const reusableJobs = reusableJobsByIdentity.get(identity) || [];
        const matchedJob = reusableJobs.shift();
        if (matchedJob) {
          matchedJobIds.add(matchedJob.id);
        } else {
          tracksNeedingWork.push(track);
        }
      }

      const playlistRoot = getPlaylistLibraryRoot(safePlaylistId);
      for (const job of existingJobs) {
        if (matchedJobIds.has(job.id)) continue;
        if (job.status === "done" && typeof job.finalPath === "string") {
          const safeFinalPath = remapLegacyWeeklyFlowPath(
            job.finalPath,
            weeklyFlowWorker.weeklyFlowRoot,
          );
          if (isPathInsideRoot(safeFinalPath, playlistRoot)) {
            await fs.rm(safeFinalPath, { force: true });
          }
        }
        downloadTracker.removeJob(job.id);
      }

      playlist = flowPlaylistConfig.updateSharedPlaylist(safePlaylistId, {
        name: safeName,
        tracks: normalizedTracks,
      });
      const { tracksToQueue } = await reuseTracksForPlaylist(tracksNeedingWork, safePlaylistId);
      tracksQueued = downloadTracker.addJobs(tracksToQueue, safePlaylistId).length;
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
    reason: hasTracksUpdate ? "shared-playlist-track-update" : "shared-playlist-update",
    priority: 5,
  });
  return { success: true, playlist, tracksQueued };
}

async function deleteSharedPlaylistTrack({ playlistId, jobId } = {}) {
  const safePlaylistId = String(playlistId || "").trim();
  const safeJobId = String(jobId || "").trim();
  const playlist = flowPlaylistConfig.getSharedPlaylist(safePlaylistId);
  if (!playlist) return { missingPlaylist: true };
  const job = downloadTracker.getJob(safeJobId);
  if (!job || job.playlistType !== safePlaylistId) {
    return { missingJob: true };
  }
  await withPlaylistMutation(
    safePlaylistId,
    async () => {
      if (job.status === "done" && typeof job.finalPath === "string") {
        await removePlaylistLocalTrackFile(job, safePlaylistId);
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

async function researchPlaylistTrack({ playlistId, jobId } = {}) {
  const safePlaylistId = String(playlistId || "").trim();
  const safeJobId = String(jobId || "").trim();
  const sharedPlaylist = flowPlaylistConfig.getSharedPlaylist(safePlaylistId);
  const flow = flowPlaylistConfig.getFlow(safePlaylistId);
  if (!sharedPlaylist && !flow) return { missingPlaylist: true };
  const job = downloadTracker.getJob(safeJobId);
  if (!job || job.playlistType !== safePlaylistId) {
    return { missingJob: true };
  }
  if (job.status === "pending" || job.status === "downloading") {
    return { alreadyProcessing: true };
  }
  const previousFinalPath = job.finalPath;
  let reused = false;
  await withPlaylistMutation(
    safePlaylistId,
    async () => {
      const { existingFileMode } = weeklyFlowWorker.getWorkerSettings();
      const mode = normalizeExistingFileMode(existingFileMode);
      if (mode !== "download" && (job.status === "done" || job.status === "failed")) {
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
            updatedJob?.finalPath &&
            updatedJob.finalPath !== previousFinalPath
          ) {
            await removePlaylistLocalTrackFile({ finalPath: previousFinalPath }, safePlaylistId);
          }
          return;
        }
      }
      await removePlaylistLocalTrackFile(job, safePlaylistId);
      const reset = downloadTracker.setPending(safeJobId, null);
      if (!reset) {
        throw new Error("Failed to requeue track");
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

async function deleteSharedPlaylist({ playlistId } = {}) {
  const safePlaylistId = String(playlistId || "").trim();
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

export async function processWeeklyFlowOperation(payload = {}) {
  const kind = String(payload?.kind || payload?.type || "").trim();
  return withHonkerLock(
    "weekly-flow-operation",
    async () => {
      switch (kind) {
        case "manual-start-flow":
          return runFlowSeed(payload);
        case "scheduled-flow-refresh":
          return runFlowSeed({
            ...payload,
            requireEnabled: true,
            scheduleNext: true,
          });
        case "enable-flow-refresh":
          return runFlowSeed({
            ...payload,
            requireEnabled: true,
          });
        case "disable-flow-cleanup":
          return runFlowCleanup(payload);
        case "delete-flow":
          return deleteFlow(payload);
        case "reset-playlists":
          return resetPlaylists(payload);
        case "adopt-flow-seed":
          return adoptFlowSeed(payload);
        case "shared-playlist-create":
          return createSharedPlaylist(payload);
        case "shared-playlist-append-tracks":
          return appendSharedPlaylistTracks(payload);
        case "shared-playlist-update":
          return updateSharedPlaylist(payload);
        case "shared-playlist-delete-track":
          return deleteSharedPlaylistTrack(payload);
        case "shared-playlist-research-track":
          return researchPlaylistTrack(payload);
        case "shared-playlist-delete":
          return deleteSharedPlaylist(payload);
        default:
          throw new Error(`Unknown weekly flow operation: ${kind || "unknown"}`);
      }
    },
    {
      ttlSeconds: 180,
      waitTimeoutMs: 30 * 60 * 1000,
      retryDelayMs: 250,
    },
  );
}
