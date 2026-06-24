import { downloadTracker } from "../../../services/weeklyFlowDownloadTracker.js";
import { weeklyFlowWorker } from "../../../services/weeklyFlowWorker.js";
import { startSlskdOrchestratorWorker } from "../../../services/slskdOrchestratorWorker.js";
import { playlistManager } from "../../../services/weeklyFlowPlaylistManager.js";
import {
  flowPlaylistConfig,
} from "../../../services/weeklyFlowPlaylistConfig.js";
import { weeklyFlowOperationQueue } from "../../../services/weeklyFlowOperationQueue.js";
import {
  reconcileSharedPlaylistJobs,
} from "../../../services/weeklyFlowOperations.js";
import { getWeeklyFlowStatusSnapshot } from "../../../services/weeklyFlowStatusSnapshot.js";
import { noCache } from "../../../middleware/cache.js";
import { requireAdmin } from "../../../middleware/requirePermission.js";
import {
  EXISTING_FILE_MODE_OPTIONS,
  canAccessPlaylistType,
  filterJobsForUser,
  pauseSharedPlaylistRetryCycle,
  getAccessibleSharedPlaylist,
} from "./utils.js";

export default function register(router) {
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
