import express from "express";
import { downloadTracker } from "../services/weeklyFlowDownloadTracker.js";
import { weeklyFlowWorker } from "../services/weeklyFlowWorker.js";
import { playlistSource } from "../services/weeklyFlowPlaylistSource.js";
import { soulseekClient } from "../services/simpleSoulseekClient.js";
import { playlistManager } from "../services/weeklyFlowPlaylistManager.js";

const router = express.Router();

router.post("/start/:playlistType", async (req, res) => {
  try {
    const { playlistType } = req.params;
    const { limit = 30 } = req.body;

    if (!soulseekClient.isConfigured()) {
      return res.status(400).json({
        error: "Soulseek credentials not configured",
      });
    }

    const tracks = await playlistSource.getTracksForPlaylist(
      playlistType,
      limit,
    );
    if (tracks.length === 0) {
      return res.status(400).json({
        error: `No tracks found for playlist type: ${playlistType}`,
      });
    }

    const jobIds = downloadTracker.addJobs(tracks, playlistType);

    if (!weeklyFlowWorker.running) {
      await weeklyFlowWorker.start();
    }

    res.json({
      success: true,
      playlistType,
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

  res.json({
    worker: workerStatus,
    stats,
    jobs: allJobs,
  });
});

router.get("/jobs/:playlistType", (req, res) => {
  const { playlistType } = req.params;
  const jobs = downloadTracker.getByPlaylistType(playlistType);
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
    const { playlistTypes } = req.body;
    const types = playlistTypes || ["discover", "recommended"];

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
    const { playlistType } = req.params;
    playlistManager.updateConfig();
    const playlistName = playlistManager.getPlaylistName(playlistType);
    const playlist = await playlistManager.createPlaylist(
      playlistType,
      playlistName,
    );

    if (!playlist) {
      return res.status(404).json({
        error: `No completed downloads found for ${playlistType}`,
      });
    }

    res.json({ success: true, playlist });
  } catch (error) {
    res.status(500).json({
      error: "Failed to create playlist",
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
