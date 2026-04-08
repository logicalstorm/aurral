import express from "express";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { downloadTracker } from "../services/weeklyFlowDownloadTracker.js";
import { weeklyFlowWorker } from "../services/weeklyFlowWorker.js";
import { playlistSource } from "../services/weeklyFlowPlaylistSource.js";
import { soulseekClient } from "../services/simpleSoulseekClient.js";
import { playlistManager } from "../services/weeklyFlowPlaylistManager.js";
import { flowPlaylistConfig } from "../services/weeklyFlowPlaylistConfig.js";
import { weeklyFlowOperationQueue } from "../services/weeklyFlowOperationQueue.js";
import { getWeeklyFlowStatusSnapshot } from "../services/weeklyFlowStatusSnapshot.js";
import { noCache } from "../middleware/cache.js";
import { hasPermission, verifyTokenAuth } from "../middleware/auth.js";
import {
  requireAuth,
  requirePermission,
} from "../middleware/requirePermission.js";

const router = express.Router();
const FLOW_WORKER_RETRY_CYCLE_OPTIONS_MINUTES = [15, 30, 60, 360, 720, 1440];
const AUDIO_CONTENT_TYPES = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

const isPathInsideRoot = (candidatePath, rootPath) => {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
};

const normalizeImportedTrackList = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((track) => {
      if (!track || typeof track !== "object" || Array.isArray(track))
        return null;
      const artistName = String(
        track.artistName ??
          track.artist ??
          track.artist_name ??
          track["Artist Name(s)"] ??
          "",
      ).trim();
      const trackName = String(
        track.trackName ??
          track.title ??
          track.name ??
          track.track ??
          track["Track Name"] ??
          "",
      ).trim();
      if (!artistName || !trackName) return null;
      const albumName = String(
        track.albumName ?? track.album ?? track["Album Name"] ?? "",
      ).trim();
      const artistMbid = String(
        track.artistMbid ?? track.artistId ?? track.mbid ?? "",
      ).trim();
      const reason = String(track.reason ?? "").trim();
      return {
        artistName,
        trackName,
        albumName: albumName || null,
        artistMbid: artistMbid || null,
        reason: reason || null,
      };
    })
    .filter(Boolean);
};

router.get("/stream/:jobId", noCache, async (req, res) => {
  if (!verifyTokenAuth(req)) {
    return res
      .status(401)
      .json({ error: "Unauthorized", message: "Authentication required" });
  }
  if (req.user && !hasPermission(req.user, "accessFlow")) {
    return res
      .status(403)
      .json({ error: "Forbidden", message: "Permission required: accessFlow" });
  }
  const { jobId } = req.params;
  const job = downloadTracker.getJob(jobId);
  if (!job) {
    return res.status(404).json({ error: "Track not found" });
  }
  if (job.status !== "done" || !job.finalPath) {
    return res.status(400).json({ error: "Track is not ready to stream" });
  }
  const safeRoot = path.resolve(weeklyFlowWorker.weeklyFlowRoot);
  const safePath = path.resolve(job.finalPath);
  if (!safePath.startsWith(safeRoot)) {
    return res.status(403).json({ error: "Invalid track path" });
  }
  let stat;
  try {
    stat = await fsp.stat(safePath);
    if (!stat.isFile()) {
      return res.status(404).json({ error: "Track not found" });
    }
  } catch {
    return res.status(404).json({ error: "Track file missing" });
  }
  const ext = path.extname(safePath).toLowerCase();
  res.setHeader(
    "Content-Type",
    AUDIO_CONTENT_TYPES[ext] || "application/octet-stream",
  );
  res.setHeader("Accept-Ranges", "bytes");

  const range = req.headers.range;
  if (!range) {
    res.setHeader("Content-Length", stat.size);
    fs.createReadStream(safePath).pipe(res);
    return;
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) {
    res.status(416).end();
    return;
  }
  const rawStart = match[1] ? Number(match[1]) : 0;
  const rawEnd = match[2] ? Number(match[2]) : stat.size - 1;
  const start = Number.isFinite(rawStart) ? rawStart : 0;
  const end = Number.isFinite(rawEnd) ? rawEnd : stat.size - 1;
  if (start < 0 || end < start || end >= stat.size) {
    res.status(416).end();
    return;
  }
  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
  res.setHeader("Content-Length", end - start + 1);
  fs.createReadStream(safePath, { start, end }).pipe(res);
});

router.use(requireAuth);
router.use(requirePermission("accessFlow"));
const DEFAULT_LIMIT = 30;
const QUEUE_LIMIT = 50;
const flowEnableMutationVersion = new Map();
const queueFlowEnableRefresh = (flowId, mutationVersion) => {
  weeklyFlowOperationQueue
    .enqueue(`enable:${flowId}`, async () => {
      if (
        flowEnableMutationVersion.get(flowId) !== mutationVersion ||
        !flowPlaylistConfig.isEnabled(flowId)
      ) {
        return;
      }

      const flowStats = downloadTracker.getPlaylistTypeStats(flowId);
      const shouldStopWorker =
        weeklyFlowWorker.running &&
        (flowStats.pending > 0 || flowStats.downloading > 0);
      if (shouldStopWorker) {
        weeklyFlowWorker.stop();
      }
      weeklyFlowWorker.clearIncompleteRetry(flowId);
      playlistManager.updateConfig(false);
      await playlistManager.weeklyReset([flowId]);
      downloadTracker.clearByPlaylistType(flowId);

      if (
        flowEnableMutationVersion.get(flowId) !== mutationVersion ||
        !flowPlaylistConfig.isEnabled(flowId)
      ) {
        if (shouldStopWorker) {
          const stillPending = downloadTracker.getNextPending();
          if (stillPending && !weeklyFlowWorker.running) {
            await weeklyFlowWorker.start();
          }
        }
        return;
      }

      const latestFlow = flowPlaylistConfig.getFlow(flowId);
      if (!latestFlow) return;
      const tracks = await playlistSource.getTracksForFlow(latestFlow);

      if (
        flowEnableMutationVersion.get(flowId) !== mutationVersion ||
        !flowPlaylistConfig.isEnabled(flowId)
      ) {
        return;
      }

      if (tracks.length === 0) {
        if (shouldStopWorker) {
          const stillPending = downloadTracker.getNextPending();
          if (stillPending && !weeklyFlowWorker.running) {
            await weeklyFlowWorker.start();
          }
        }
        return;
      }
      downloadTracker.addJobs(tracks, flowId);
      if (!weeklyFlowWorker.running) {
        await weeklyFlowWorker.start();
      } else {
        weeklyFlowWorker.wake();
      }
    })
    .catch((error) => {
      console.error(
        `[WeeklyFlow] Failed to generate tracks for ${flowId}:`,
        error.message,
      );
    });
};

const queueFlowDisableCleanup = (flowId, mutationVersion) => {
  weeklyFlowOperationQueue
    .enqueue(`disable:${flowId}`, async () => {
      if (flowEnableMutationVersion.get(flowId) !== mutationVersion) {
        return;
      }

      const flowStats = downloadTracker.getPlaylistTypeStats(flowId);
      const shouldStopWorker =
        weeklyFlowWorker.running &&
        (flowStats.pending > 0 || flowStats.downloading > 0);
      if (shouldStopWorker) {
        weeklyFlowWorker.stop();
      }
      weeklyFlowWorker.clearIncompleteRetry(flowId);
      playlistManager.updateConfig(false);
      await playlistManager.weeklyReset([flowId]);
      downloadTracker.clearByPlaylistType(flowId);

      if (flowEnableMutationVersion.get(flowId) !== mutationVersion) {
        return;
      }

      const stillPending = downloadTracker.getNextPending();
      if (stillPending && !weeklyFlowWorker.running) {
        await weeklyFlowWorker.start();
      }
    })
    .catch((error) => {
      console.error(
        `[WeeklyFlow] Failed to disable flow cleanup for ${flowId}:`,
        error.message,
      );
    });
};

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
    } else {
      weeklyFlowWorker.wake();
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
  const includeJobs =
    req.query.includeJobs === "1" || req.query.includeJobs === "true";
  const flowId = req.query.flowId ? String(req.query.flowId) : null;
  const parsedLimit = Number(req.query.jobsLimit);
  const jobsLimit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(Math.floor(parsedLimit), 500)
      : null;
  res.json(
    getWeeklyFlowStatusSnapshot({
      includeJobs,
      flowId,
      jobsLimit,
    }),
  );
});

router.post("/flows", async (req, res) => {
  try {
    const {
      name,
      mix,
      size,
      deepDive,
      recipe,
      tags,
      relatedArtists,
      scheduleDays,
      scheduleTime,
    } = req.body || {};
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
      scheduleDays,
      scheduleTime,
    });
    await playlistManager.ensureSmartPlaylists();
    res.json({ success: true, flow });
  } catch (error) {
    if (error?.code === "FLOW_NAME_CONFLICT") {
      return res.status(400).json({
        error: "Flow name already exists",
        message: error.message,
      });
    }
    res.status(500).json({
      error: "Failed to create flow",
      message: error.message,
    });
  }
});

router.put("/flows/:flowId", async (req, res) => {
  try {
    const { flowId } = req.params;
    const {
      name,
      mix,
      size,
      deepDive,
      recipe,
      tags,
      relatedArtists,
      scheduleDays,
      scheduleTime,
    } = req.body || {};
    const updated = flowPlaylistConfig.updateFlow(flowId, {
      name,
      mix,
      size,
      deepDive,
      recipe,
      tags,
      relatedArtists,
      scheduleDays,
      scheduleTime,
    });
    if (!updated) {
      return res.status(404).json({ error: "Flow not found" });
    }
    await playlistManager.ensureSmartPlaylists();
    res.json({ success: true, flow: updated });
  } catch (error) {
    if (error?.code === "FLOW_NAME_CONFLICT") {
      return res.status(400).json({
        error: "Flow name already exists",
        message: error.message,
      });
    }
    res.status(500).json({
      error: "Failed to update flow",
      message: error.message,
    });
  }
});

router.delete("/flows/:flowId", async (req, res) => {
  try {
    const { flowId } = req.params;
    const mutationVersion = (flowEnableMutationVersion.get(flowId) || 0) + 1;
    flowEnableMutationVersion.set(flowId, mutationVersion);
    const deleted = await weeklyFlowOperationQueue.enqueue(
      `delete:${flowId}`,
      async () => {
        if (flowEnableMutationVersion.get(flowId) !== mutationVersion) {
          return false;
        }
        weeklyFlowWorker.stop();
        playlistManager.updateConfig(false);
        await playlistManager.weeklyReset([flowId]);
        downloadTracker.clearByPlaylistType(flowId);
        const didDelete = flowPlaylistConfig.deleteFlow(flowId);
        await playlistManager.ensureSmartPlaylists();
        const stillPending = downloadTracker.getNextPending();
        if (stillPending && !weeklyFlowWorker.running) {
          await weeklyFlowWorker.start();
        }
        flowEnableMutationVersion.delete(flowId);
        return didDelete;
      },
    );
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
      const mutationVersion = (flowEnableMutationVersion.get(flowId) || 0) + 1;
      flowEnableMutationVersion.set(flowId, mutationVersion);
      if (!soulseekClient.isConfigured()) {
        return res.status(400).json({
          error: "Soulseek credentials not configured",
        });
      }

      flowPlaylistConfig.setEnabled(flowId, true);
      flowPlaylistConfig.scheduleNextRun(flowId);

      await playlistManager.ensureSmartPlaylists();

      res.json({
        success: true,
        flowId,
        enabled: true,
        tracksQueued: 0,
        message: "Flow enabled. Tracks will start queueing shortly.",
      });

      queueFlowEnableRefresh(flowId, mutationVersion);
    } else {
      const mutationVersion = (flowEnableMutationVersion.get(flowId) || 0) + 1;
      flowEnableMutationVersion.set(flowId, mutationVersion);
      flowPlaylistConfig.setEnabled(flowId, false);
      await playlistManager.ensureSmartPlaylists();

      res.json({
        success: true,
        flowId,
        enabled: false,
      });
      queueFlowDisableCleanup(flowId, mutationVersion);
    }
  } catch (error) {
    res.status(500).json({
      error: "Failed to update flow",
      message: error.message,
    });
  }
});

router.post("/flows/:flowId/static-playlist", async (req, res) => {
  let playlist = null;
  try {
    const { flowId } = req.params;
    const flow = flowPlaylistConfig.getFlow(flowId);
    if (!flow) {
      return res.status(404).json({ error: "Flow not found" });
    }

    const requestedName = String(req.body?.name || "").trim();
    const flowJobs = downloadTracker.getByPlaylistType(flowId);
    const completedJobs = flowJobs.filter(
      (job) => job?.status === "done" && typeof job?.finalPath === "string",
    );
    if (completedJobs.length === 0) {
      return res.status(400).json({
        error: "No completed tracks available",
        message: "Generate at least one completed flow track before saving it",
      });
    }

    const sourceRoot = path.resolve(
      weeklyFlowWorker.weeklyFlowRoot,
      "aurral-weekly-flow",
      flowId,
    );
    const tracks = completedJobs.map((job) => ({
      artistName: job.artistName,
      trackName: job.trackName,
      albumName: job.albumName || null,
      artistMbid: job.artistMbid || null,
      reason: job.reason || null,
    }));
    playlist = flowPlaylistConfig.createSharedPlaylist({
      name: requestedName || `${flow.name} Static`,
      sourceName: flow.name,
      sourceFlowId: flowId,
      tracks,
    });

    const targetRoot = path.resolve(
      weeklyFlowWorker.weeklyFlowRoot,
      "aurral-weekly-flow",
      playlist.id,
    );
    for (const job of completedJobs) {
      const safeSourcePath = path.resolve(job.finalPath);
      if (!isPathInsideRoot(safeSourcePath, sourceRoot)) {
        throw new Error(
          `Track path is outside the flow library: ${job.finalPath}`,
        );
      }
      const stat = await fsp.stat(safeSourcePath);
      if (!stat.isFile()) {
        throw new Error(`Track file is missing: ${job.finalPath}`);
      }
      const relativePath = path.relative(sourceRoot, safeSourcePath);
      const targetPath = path.join(targetRoot, relativePath);
      await fsp.mkdir(path.dirname(targetPath), { recursive: true });
      await fsp.copyFile(safeSourcePath, targetPath);

      const jobId = downloadTracker.addJob(
        {
          artistName: job.artistName,
          trackName: job.trackName,
          albumName: job.albumName || null,
          artistMbid: job.artistMbid || null,
          reason: job.reason || null,
        },
        playlist.id,
      );
      if (jobId) {
        downloadTracker.setDone(jobId, targetPath, job.albumName || null);
      }
    }

    playlistManager.updateConfig(false);
    await playlistManager.ensureSmartPlaylists();
    await playlistManager.scanLibrary();

    res.json({
      success: true,
      playlist,
      trackCount: completedJobs.length,
    });
  } catch (error) {
    if (playlist?.id) {
      try {
        await playlistManager.weeklyReset([playlist.id]);
        flowPlaylistConfig.deleteSharedPlaylist(playlist.id);
        await playlistManager.ensureSmartPlaylists();
      } catch {}
    }
    if (error?.code === "SHARED_PLAYLIST_NAME_CONFLICT") {
      return res.status(400).json({
        error: "Shared playlist name already exists",
        message: error.message,
      });
    }
    res.status(500).json({
      error: "Failed to create static playlist",
      message: error.message,
    });
  }
});

router.post("/shared-playlists/import", async (req, res) => {
  try {
    const {
      name,
      sourceName = null,
      sourceFlowId = null,
      tracks,
    } = req.body || {};
    const safeName = String(name || "").trim();
    const normalizedTracks = normalizeImportedTrackList(tracks);

    if (!safeName) {
      return res.status(400).json({ error: "name is required" });
    }
    if (normalizedTracks.length === 0) {
      return res.status(400).json({
        error: "tracks are required",
        message: "Import file must include at least one track",
      });
    }
    if (!soulseekClient.isConfigured()) {
      return res.status(400).json({
        error: "Soulseek credentials not configured",
      });
    }

    const playlist = flowPlaylistConfig.createSharedPlaylist({
      name: safeName,
      sourceName,
      sourceFlowId,
      tracks: normalizedTracks,
    });

    const jobIds = downloadTracker.addJobs(normalizedTracks, playlist.id);
    playlistManager.updateConfig(false);
    await playlistManager.ensureSmartPlaylists();
    if (jobIds.length > 0 && !weeklyFlowWorker.running) {
      await weeklyFlowWorker.start();
    } else if (jobIds.length > 0) {
      weeklyFlowWorker.wake();
    }

    res.json({
      success: true,
      playlist,
      tracksQueued: jobIds.length,
      jobIds,
    });
  } catch (error) {
    if (error?.code === "SHARED_PLAYLIST_NAME_CONFLICT") {
      return res.status(400).json({
        error: "Shared playlist name already exists",
        message: error.message,
      });
    }
    res.status(500).json({
      error: "Failed to import shared playlist",
      message: error.message,
    });
  }
});

router.put("/shared-playlists/:playlistId", async (req, res) => {
  try {
    const { playlistId } = req.params;
    const { name } = req.body || {};
    const safeName = String(name || "").trim();
    if (!safeName) {
      return res.status(400).json({ error: "name is required" });
    }
    const playlist = flowPlaylistConfig.updateSharedPlaylist(playlistId, {
      name: safeName,
    });
    if (!playlist) {
      return res.status(404).json({ error: "Shared playlist not found" });
    }
    playlistManager.updateConfig(false);
    await playlistManager.ensureSmartPlaylists();
    await playlistManager.scanLibrary();
    res.json({ success: true, playlist });
  } catch (error) {
    if (error?.code === "SHARED_PLAYLIST_NAME_CONFLICT") {
      return res.status(400).json({
        error: "Shared playlist name already exists",
        message: error.message,
      });
    }
    res.status(500).json({
      error: "Failed to update shared playlist",
      message: error.message,
    });
  }
});

router.delete(
  "/shared-playlists/:playlistId/tracks/:jobId",
  async (req, res) => {
    try {
      const { playlistId, jobId } = req.params;
      const playlist = flowPlaylistConfig.getSharedPlaylist(playlistId);
      if (!playlist) {
        return res.status(404).json({ error: "Shared playlist not found" });
      }
      const job = downloadTracker.getJob(jobId);
      if (!job || job.playlistType !== playlistId) {
        return res.status(404).json({ error: "Track not found" });
      }
      if (job.status !== "done" || typeof job.finalPath !== "string") {
        return res.status(400).json({
          error: "Only completed tracks can be removed",
        });
      }

      const playlistRoot = path.resolve(
        weeklyFlowWorker.weeklyFlowRoot,
        "aurral-weekly-flow",
        playlistId,
      );
      const safeFinalPath = path.resolve(job.finalPath);
      if (!isPathInsideRoot(safeFinalPath, playlistRoot)) {
        return res.status(400).json({
          error: "Track path is outside the playlist library",
        });
      }

      await fsp.rm(safeFinalPath, { force: true });
      downloadTracker.removeJob(jobId);

      const nextTracks = Array.isArray(playlist.tracks)
        ? [...playlist.tracks]
        : [];
      const trackIndex = nextTracks.findIndex((track) => {
        if (!track || typeof track !== "object" || Array.isArray(track))
          return false;
        return (
          String(track.artistName || "") === String(job.artistName || "") &&
          String(track.trackName || "") === String(job.trackName || "") &&
          String(track.albumName || "") === String(job.albumName || "") &&
          String(track.reason || "") === String(job.reason || "") &&
          String(track.artistMbid || "") === String(job.artistMbid || "")
        );
      });
      if (trackIndex >= 0) {
        nextTracks.splice(trackIndex, 1);
      }
      const updatedPlaylist = flowPlaylistConfig.updateSharedPlaylist(
        playlistId,
        {
          tracks: nextTracks,
        },
      );

      res.json({
        success: true,
        playlist: updatedPlaylist || playlist,
        removedJobId: jobId,
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to remove shared playlist track",
        message: error.message,
      });
    }
  },
);

router.delete("/shared-playlists/:playlistId", async (req, res) => {
  try {
    const { playlistId } = req.params;
    const exists = flowPlaylistConfig.getSharedPlaylist(playlistId);
    if (!exists) {
      return res.status(404).json({ error: "Shared playlist not found" });
    }

    weeklyFlowWorker.stop();
    weeklyFlowWorker.clearIncompleteRetry(playlistId);
    playlistManager.updateConfig(false);
    await playlistManager.weeklyReset([playlistId]);
    const deleted = flowPlaylistConfig.deleteSharedPlaylist(playlistId);
    await playlistManager.ensureSmartPlaylists();
    const stillPending = downloadTracker.getNextPending();
    if (stillPending && !weeklyFlowWorker.running) {
      await weeklyFlowWorker.start();
    }

    if (!deleted) {
      return res.status(404).json({ error: "Shared playlist not found" });
    }

    res.json({ success: true, playlistId });
  } catch (error) {
    res.status(500).json({
      error: "Failed to delete shared playlist",
      message: error.message,
    });
  }
});

router.get("/jobs/:flowId", (req, res) => {
  const { flowId } = req.params;
  const parsedLimit = Number(req.query.limit);
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(Math.floor(parsedLimit), 500)
      : 200;
  const jobs = downloadTracker.getByPlaylistType(flowId, limit);
  res.json(jobs);
});

router.get("/jobs", (req, res) => {
  const { status } = req.query;
  const jobs = status
    ? downloadTracker.getByStatus(status)
    : downloadTracker.getAll();
  res.json(jobs);
});

router.get("/worker/settings", (req, res) => {
  res.json(weeklyFlowWorker.getWorkerSettings());
});

router.put("/worker/settings", async (req, res) => {
  const {
    concurrency,
    preferredFormat,
    preferredFormatStrict,
    retryCycleMinutes,
    seedDownloads,
  } = req.body || {};
  if (concurrency !== undefined) {
    const parsed = Number(concurrency);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
      return res.status(400).json({
        error: "concurrency must be an integer between 1 and 5",
      });
    }
  }
  if (preferredFormat !== undefined) {
    const normalized = String(preferredFormat || "").toLowerCase();
    if (normalized !== "flac" && normalized !== "mp3") {
      return res.status(400).json({
        error: "preferredFormat must be either 'flac' or 'mp3'",
      });
    }
  }
  if (
    preferredFormatStrict !== undefined &&
    typeof preferredFormatStrict !== "boolean"
  ) {
    return res.status(400).json({
      error: "preferredFormatStrict must be a boolean",
    });
  }
  if (retryCycleMinutes !== undefined) {
    const parsed = Number(retryCycleMinutes);
    if (
      !Number.isInteger(parsed) ||
      !FLOW_WORKER_RETRY_CYCLE_OPTIONS_MINUTES.includes(parsed)
    ) {
      return res.status(400).json({
        error: "retryCycleMinutes must be one of: 15, 30, 60, 360, 720, 1440",
      });
    }
  }
  if (seedDownloads !== undefined && typeof seedDownloads !== "boolean") {
    return res.status(400).json({
      error: "seedDownloads must be a boolean",
    });
  }
  const settings = weeklyFlowWorker.updateWorkerSettings({
    concurrency,
    preferredFormat,
    preferredFormatStrict,
    retryCycleMinutes,
    seedDownloads,
  });
  try {
    await soulseekClient.applyConfigChanges();
  } catch (error) {
    console.warn(
      "[WeeklyFlow] Failed to apply Soulseek config changes:",
      error.message,
    );
  }
  return res.json({ success: true, settings });
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

    await weeklyFlowOperationQueue.enqueue("reset:manual", async () => {
      weeklyFlowWorker.stop();
      playlistManager.updateConfig(false);
      await playlistManager.weeklyReset(types);
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

router.post("/playlist/:playlistType/create", async (req, res) => {
  try {
    playlistManager.updateConfig(false);
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
