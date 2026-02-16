import express from "express";
import { downloadTracker } from "../services/weeklyFlowDownloadTracker.js";
import { weeklyFlowWorker } from "../services/weeklyFlowWorker.js";
import { playlistSource } from "../services/weeklyFlowPlaylistSource.js";
import { soulseekClient } from "../services/simpleSoulseekClient.js";
import { playlistManager } from "../services/weeklyFlowPlaylistManager.js";
import { flowPlaylistConfig } from "../services/weeklyFlowPlaylistConfig.js";
import {
  requireAuth,
  requirePermission,
} from "../middleware/requirePermission.js";

const router = express.Router();
router.use(requireAuth);
router.use(requirePermission("accessFlow"));
const DEFAULT_LIMIT = 30;
const QUEUE_LIMIT = 50;

router.post("/start/:flowId", async (req, res) => {
  try {
    const { flowId } = req.params;
    const { limit } = req.body;
    const flow = flowPlaylistConfig.getFlow(flowId);
    if (!flow) {
      return res.status(404).json({ error: "Flow not found" });
    }

    if (!soulseekClient.isConfigured()) {
      return res.status(400).json({
        error: "Soulseek credentials not configured",
      });
    }

    const size =
      Number.isFinite(Number(limit)) && Number(limit) > 0
        ? Number(limit)
        : flow.size || DEFAULT_LIMIT;
    const tracks = await playlistSource.getTracksForFlow({
      ...flow,
      size,
    });
    if (tracks.length === 0) {
      return res.status(400).json({
        error: `No tracks found for flow: ${flow.name}`,
      });
    }

    const jobIds = downloadTracker.addJobs(tracks, flowId);

    if (!weeklyFlowWorker.running) {
      await weeklyFlowWorker.start();
    }

    res.json({
      success: true,
      flowId,
      tracksQueued: tracks.length,
      jobIds,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to start weekly flow",
      message: error.message,
    });
  }
});

router.get("/status", (req, res) => {
  const workerStatus = weeklyFlowWorker.getStatus();
  const stats = downloadTracker.getStats();
  const allJobs = downloadTracker.getAll();
  const flows = flowPlaylistConfig.getFlows();

  res.json({
    worker: workerStatus,
    stats,
    jobs: allJobs,
    flows,
  });
});

router.post("/flows", async (req, res) => {
  try {
    const { name, mix, size, deepDive, recipe, tags, relatedArtists } =
      req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    const flow = flowPlaylistConfig.createFlow({
      name,
      mix,
      size,
      deepDive,
      recipe,
      tags,
      relatedArtists,
    });
    await playlistManager.ensureSmartPlaylists();
    res.json({ success: true, flow });
  } catch (error) {
    res.status(500).json({
      error: "Failed to create flow",
      message: error.message,
    });
  }
});

router.put("/flows/:flowId", async (req, res) => {
  try {
    const { flowId } = req.params;
    const { name, mix, size, deepDive, recipe, tags, relatedArtists } =
      req.body || {};
    const updated = flowPlaylistConfig.updateFlow(flowId, {
      name,
      mix,
      size,
      deepDive,
      recipe,
      tags,
      relatedArtists,
    });
    if (!updated) {
      return res.status(404).json({ error: "Flow not found" });
    }
    await playlistManager.ensureSmartPlaylists();
    res.json({ success: true, flow: updated });
  } catch (error) {
    res.status(500).json({
      error: "Failed to update flow",
      message: error.message,
    });
  }
});

router.delete("/flows/:flowId", async (req, res) => {
  try {
    const { flowId } = req.params;
    weeklyFlowWorker.stop();
    playlistManager.updateConfig();
    await playlistManager.weeklyReset([flowId]);
    downloadTracker.clearByPlaylistType(flowId);
    const deleted = flowPlaylistConfig.deleteFlow(flowId);
    await playlistManager.ensureSmartPlaylists();
    const stillPending = downloadTracker.getNextPending();
    if (stillPending && !weeklyFlowWorker.running) {
      await weeklyFlowWorker.start();
    }
    if (!deleted) {
      return res.status(404).json({ error: "Flow not found" });
    }
    res.json({ success: true, flowId });
  } catch (error) {
    res.status(500).json({
      error: "Failed to delete flow",
      message: error.message,
    });
  }
});

router.put("/flows/:flowId/enabled", async (req, res) => {
  try {
    const { flowId } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be a boolean" });
    }

    const flow = flowPlaylistConfig.getFlow(flowId);
    if (!flow) {
      return res.status(404).json({ error: "Flow not found" });
    }

    if (enabled) {
      if (!soulseekClient.isConfigured()) {
        return res.status(400).json({
          error: "Soulseek credentials not configured",
        });
      }

      weeklyFlowWorker.stop();
      playlistManager.updateConfig();
      await playlistManager.weeklyReset([flowId]);
      downloadTracker.clearByPlaylistType(flowId);

      const tracks = await playlistSource.getTracksForFlow(flow);
      if (tracks.length === 0) {
        flowPlaylistConfig.setEnabled(flowId, true);
        flowPlaylistConfig.scheduleNextRun(flowId);
        await playlistManager.ensureSmartPlaylists();
        return res.json({
          success: true,
          flowId,
          enabled: true,
          tracksQueued: 0,
          message: "Flow enabled; no tracks available yet.",
        });
      }

      downloadTracker.addJobs(tracks, flowId);
      if (!weeklyFlowWorker.running) {
        await weeklyFlowWorker.start();
      }

      flowPlaylistConfig.setEnabled(flowId, true);
      flowPlaylistConfig.scheduleNextRun(flowId);

      await playlistManager.ensureSmartPlaylists();

      res.json({
        success: true,
        flowId,
        enabled: true,
        tracksQueued: tracks.length,
      });
    } else {
      weeklyFlowWorker.stop();
      playlistManager.updateConfig();
      await playlistManager.weeklyReset([flowId]);
      downloadTracker.clearByPlaylistType(flowId);

      flowPlaylistConfig.setEnabled(flowId, false);
      await playlistManager.ensureSmartPlaylists();

      const stillPending = downloadTracker.getNextPending();
      if (stillPending && !weeklyFlowWorker.running) {
        await weeklyFlowWorker.start();
      }

      res.json({
        success: true,
        flowId,
        enabled: false,
      });
    }
  } catch (error) {
    res.status(500).json({
      error: "Failed to update flow",
      message: error.message,
    });
  }
});

router.get("/jobs/:flowId", (req, res) => {
  const { flowId } = req.params;
  const jobs = downloadTracker.getByPlaylistType(flowId);
  res.json(jobs);
});

router.get("/jobs", (req, res) => {
  const { status } = req.query;
  const jobs = status
    ? downloadTracker.getByStatus(status)
    : downloadTracker.getAll();
  res.json(jobs);
});

router.post("/worker/start", async (req, res) => {
  try {
    await weeklyFlowWorker.start();
    res.json({ success: true, message: "Worker started" });
  } catch (error) {
    res.status(500).json({
      error: "Failed to start worker",
      message: error.message,
    });
  }
});

router.post("/worker/stop", (req, res) => {
  weeklyFlowWorker.stop();
  res.json({ success: true, message: "Worker stopped" });
});

router.delete("/jobs/completed", (req, res) => {
  const count = downloadTracker.clearCompleted();
  res.json({ success: true, cleared: count });
});

router.delete("/jobs/all", (req, res) => {
  const count = downloadTracker.clearAll();
  res.json({ success: true, cleared: count });
});

router.post("/reset", async (req, res) => {
  try {
    const { flowIds } = req.body;
    const types =
      flowIds || flowPlaylistConfig.getFlows().map((flow) => flow.id);

    weeklyFlowWorker.stop();
    playlistManager.updateConfig();
    await playlistManager.weeklyReset(types);

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

router.post("/playlist/:playlistType/create", async (req, res) => {
  try {
    playlistManager.updateConfig();
    await playlistManager.ensureSmartPlaylists();
    res.json({
      success: true,
      message:
        "Smart playlists ensured. Tracks in aurral-weekly-flow/<flow-id> will appear in matching smart playlists after Navidrome scans the flow library.",
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to ensure smart playlists or trigger scan",
      message: error.message,
    });
  }
});

router.get("/test/soulseek", async (req, res) => {
  try {
    if (!soulseekClient.isConfigured()) {
      return res.status(400).json({
        error: "Soulseek not configured",
        configured: false,
      });
    }

    const connected = soulseekClient.isConnected();
    if (!connected) {
      try {
        await soulseekClient.connect();
      } catch (error) {
        return res.status(500).json({
          error: "Failed to connect to Soulseek",
          message: error.message,
          configured: true,
          connected: false,
        });
      }
    }

    res.json({
      success: true,
      configured: true,
      connected: true,
      message: "Soulseek client is ready",
    });
  } catch (error) {
    res.status(500).json({
      error: "Soulseek test failed",
      message: error.message,
    });
  }
});

router.post("/test/download", async (req, res) => {
  try {
    const { artistName, trackName } = req.body;

    if (!artistName || !trackName) {
      return res.status(400).json({
        error: "artistName and trackName are required",
      });
    }

    if (!soulseekClient.isConfigured()) {
      return res.status(400).json({
        error: "Soulseek not configured",
      });
    }

    if (!soulseekClient.isConnected()) {
      await soulseekClient.connect();
    }

    const searchWithTimeout = (ms) =>
      Promise.race([
        soulseekClient.search(artistName, trackName),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Search timed out")), ms),
        ),
      ]);

    const results = await searchWithTimeout(15000);
    if (!results || results.length === 0) {
      return res.status(404).json({
        error: "No search results found",
        artistName,
        trackName,
      });
    }

    const bestMatch = soulseekClient.pickBestMatch(results, trackName);
    if (!bestMatch) {
      return res.status(404).json({
        error: "No suitable match found",
        resultsCount: results.length,
      });
    }

    res.json({
      success: true,
      artistName,
      trackName,
      resultsCount: results.length,
      bestMatch: {
        file: bestMatch.file,
        size: bestMatch.size,
        user: bestMatch.user,
        slots: bestMatch.slots,
      },
      message: "Search successful - ready to download",
    });
  } catch (error) {
    console.error("[weekly-flow] test/download error:", error);
    res.status(500).json({
      error: "Test download failed",
      message: error?.message || String(error),
    });
  }
});

export default router;
