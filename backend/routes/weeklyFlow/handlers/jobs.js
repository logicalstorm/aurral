import { downloadTracker } from "../../../services/weeklyFlow/weeklyFlowDownloadTracker.js";
import { weeklyFlowWorker } from "../../../services/weeklyFlow/weeklyFlowWorker.js";
import { startSlskdOrchestratorWorker } from "../../../services/slskdOrchestratorWorker.js";
import { playlistManager } from "../../../services/weeklyFlow/weeklyFlowPlaylistManager.js";
import {
  flowPlaylistConfig,
} from "../../../services/weeklyFlow/weeklyFlowPlaylistConfig.js";
import { weeklyFlowOperationQueue } from "../../../services/weeklyFlow/weeklyFlowOperationQueue.js";
import {
  reconcileSharedPlaylistJobs,
} from "../../../services/weeklyFlow/weeklyFlowOperations.js";
import { getWeeklyFlowStatusSnapshot } from "../../../services/weeklyFlow/weeklyFlowStatusSnapshot.js";
import { noCache } from "../../../middleware/cache.js";
import { requireAdmin } from "../../../middleware/requirePermission.js";
import {
  EXISTING_FILE_MODE_OPTIONS,
  canAccessPlaylistType,
  filterJobsForUser,
  pauseSharedPlaylistRetryCycle,
  getAccessibleSharedPlaylist,
} from "./utils.js";
import {
  commitImportToPlaylistLibrary,
} from "../../../services/slskdOrchestrator.js";
import { resolvePlaylistRoot } from "../../../services/playlistPaths.js";
import {
  joinUnderRoot,
  sanitizePathPart,
} from "../../../services/playlistDownloadUtils.js";
import path from "path";
import fs from "fs/promises";
import { invalidateRequestsCache } from "../../requests.js";

export function registerJobs(router) {
  router.get("/status", noCache, (req, res) => {
    const includeJobs =
      req.query.includeJobs === "1" || req.query.includeJobs === "true";
    const flowId = req.query.flowId ? String(req.query.flowId) : null;
    const parsedLimit = Number(req.query.jobsLimit);
    const jobsLimit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(Math.floor(parsedLimit), 500)
        : null;
    const snapshot = getWeeklyFlowStatusSnapshot({
      user: req.user,
      includeJobs,
      flowId,
      jobsLimit,
    });
    res.json({
      ...snapshot,
      slskd: snapshot.slskd,
    });
  });

  router.get("/jobs/:flowId", async (req, res) => {
    const { flowId } = req.params;
    if (!canAccessPlaylistType(req.user, flowId)) {
      return res.status(404).json({ error: "Playlist not found" });
    }
    if (flowPlaylistConfig.getSharedPlaylist(flowId)) {
      try {
        await reconcileSharedPlaylistJobs(flowId);
      } catch {}
    }
    const rawLimit =
      req.query.limit == null ? "" : String(req.query.limit).trim();
    const parsedLimit = Number(rawLimit);
    const limit =
      rawLimit && Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.floor(parsedLimit)
        : null;
    const jobs = filterJobsForUser(
      req.user,
      downloadTracker.getByPlaylistType(flowId, limit),
    );
    res.json(jobs);
  });

  router.get("/jobs", (req, res) => {
    const { status } = req.query;
    const jobs = filterJobsForUser(
      req.user,
      status ? downloadTracker.getByStatus(status) : downloadTracker.getAll(),
    );
    res.json(jobs);
  });

  router.put("/playlists/:playlistId/retry-cycle", async (req, res) => {
    try {
      const { playlistId } = req.params;
      const { paused } = req.body || {};
      if (typeof paused !== "boolean") {
        return res.status(400).json({
          error: "paused must be a boolean",
        });
      }
      const shared = getAccessibleSharedPlaylist(req.user, playlistId);
      if (!shared) {
        return res.status(404).json({
          error: "Static playlist not found",
        });
      }
      if (paused) {
        await pauseSharedPlaylistRetryCycle(playlistId);
      } else {
        weeklyFlowWorker.setRetryCyclePaused(playlistId, false);
        await weeklyFlowWorker.retryIncompletePlaylist(playlistId);
      }
      return res.json({
        success: true,
        playlistId,
        paused,
      });
    } catch (error) {
      return res.status(500).json({
        error: "Failed to update retry cycle",
        message: error.message,
      });
    }
  });

  router.get("/worker/settings", requireAdmin, (req, res) => {
    res.json(weeklyFlowWorker.getWorkerSettings());
  });

  router.put("/worker/settings", requireAdmin, async (req, res) => {
    const { concurrency, existingFileMode } = req.body || {};
    if (concurrency !== undefined) {
      const parsed = Number(concurrency);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3) {
        return res.status(400).json({
          error: "concurrency must be an integer between 1 and 3",
        });
      }
    }
    if (existingFileMode !== undefined) {
      const normalized = String(existingFileMode || "").trim().toLowerCase();
      if (!EXISTING_FILE_MODE_OPTIONS.includes(normalized)) {
        return res.status(400).json({
          error: "existingFileMode must be one of: download, reuse",
        });
      }
    }
    const settings = weeklyFlowWorker.updateWorkerSettings({
      concurrency,
      existingFileMode,
    });
    return res.json({ success: true, settings });
  });

  router.post("/worker/start", requireAdmin, async (req, res) => {
    try {
      startSlskdOrchestratorWorker();
      await weeklyFlowWorker.start();
      res.json({ success: true, message: "Worker started" });
    } catch (error) {
      res.status(500).json({
        error: "Failed to start worker",
        message: error.message,
      });
    }
  });

  router.post("/worker/stop", requireAdmin, async (req, res) => {
    try {
      await weeklyFlowWorker.stopAndDrain();
      res.json({ success: true, message: "Worker stopped" });
    } catch (error) {
      res.status(500).json({
        error: "Failed to stop worker",
        message: error.message,
      });
    }
  });

  router.delete("/jobs/completed", requireAdmin, (req, res) => {
    const count = downloadTracker.clearCompleted();
    res.json({ success: true, cleared: count });
  });

  router.post("/jobs/:jobId/approve", async (req, res) => {
    const job = downloadTracker.getJob(req.params.jobId);
    if (!job || job.status !== "blocked") {
      return res.status(404).json({ error: "Blocked job not found" });
    }
    const sourcePath = String(job.stagingPath || "").trim();
    if (!sourcePath) {
      return res.status(400).json({ error: "Staging file path missing" });
    }
    try {
      await fs.access(sourcePath);
    } catch {
      return res.status(404).json({ error: "Staging file no longer exists" });
    }
    const playlistRoot = resolvePlaylistRoot();
    const ext = path.extname(sourcePath).toLowerCase();
    const albumDir = sanitizePathPart(job.albumName, "Unknown Album");
    const artistDir = sanitizePathPart(job.artistName, "Unknown Artist");
    const finalDir = joinUnderRoot(playlistRoot, path.join(job.playlistType, artistDir, albumDir));
    const finalName = `${sanitizePathPart(job.trackName, "Unknown Track")}${ext || ".mp3"}`;
    const finalPath = path.join(finalDir, finalName);
    try {
      const committedPath = await commitImportToPlaylistLibrary(sourcePath, finalPath);
      downloadTracker.setDone(job.id, committedPath, job.albumName);
      import("../../../services/aurralHistoryService.js")
        .then(({ recordTrackJobCompleted }) => recordTrackJobCompleted(job))
        .catch(() => {});
      invalidateRequestsCache();
      res.json({ success: true, path: committedPath });
    } catch (error) {
      res.status(500).json({ error: "Import failed", message: error.message });
    }
  });

  router.post("/jobs/:jobId/deny", async (req, res) => {
    const job = downloadTracker.getJob(req.params.jobId);
    if (!job || job.status !== "blocked") {
      return res.status(404).json({ error: "Blocked job not found" });
    }
    const sourcePath = String(job.stagingPath || "").trim();
    if (sourcePath) {
      await fs.rm(sourcePath, { force: true }).catch(() => {});
    }
    const deniedSourceKey =
      job.downloadSource === "usenet"
        ? String(job.releaseGuid || "").trim()
        : job.downloadSource === "ytdlp"
          ? String(job.releaseGuid || "").trim()
          : `${String(job.remoteUsername || "").trim()}\0${String(job.remoteFilename || "").trim()}`;
    if (job.downloadSource && deniedSourceKey) {
      downloadTracker.recordDeniedSource(job.id, job.downloadSource, deniedSourceKey);
    }
    downloadTracker.setPending(job.id, "Denied by user", { asRetryCycle: false });
    import("../../../services/aurralHistoryService.js")
      .then(({ recordTrackJobFailed }) =>
        recordTrackJobFailed(job, "Denied by user — will retry"),
      )
      .catch(() => {});
    invalidateRequestsCache();
    weeklyFlowWorker.wake();
    res.json({ success: true });
  });

  router.delete("/jobs/all", requireAdmin, (req, res) => {
    const count = downloadTracker.clearAll();
    res.json({ success: true, cleared: count });
  });

  router.post("/reset", requireAdmin, async (req, res) => {
    try {
      const { flowIds } = req.body;
      const types =
        flowIds || flowPlaylistConfig.getFlows().map((flow) => flow.id);

      await weeklyFlowOperationQueue.enqueuePayload({
        kind: "reset-playlists",
        label: "reset:manual",
        playlistTypes: types,
      });

      res.json({
        success: true,
        message: `Weekly reset completed for: ${types.join(", ")}`,
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to perform weekly reset",
        message: error.message,
      });
    }
  });

  router.post("/playlist/:playlistType/create", requireAdmin, async (req, res) => {
    try {
      playlistManager.updateConfig(false);
      await playlistManager.ensureSmartPlaylists();
      res.json({
        success: true,
        message:
          "Playlists ensured. M3U files in the Aurral playlist library reference completed track paths and import after Navidrome scans that library.",
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to ensure playlists or trigger scan",
        message: error.message,
      });
    }
  });
}
