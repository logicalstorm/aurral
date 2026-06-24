import { randomUUID } from "crypto";
import { downloadTracker } from "../../../services/weeklyFlow/weeklyFlowDownloadTracker.js";
import { slskdClient } from "../../../services/slskdClient.js";
import {
  dedupeSharedTracks,
} from "../../../services/weeklyFlow/weeklyFlowPlaylistConfig.js";
import { weeklyFlowOperationQueue } from "../../../services/weeklyFlow/weeklyFlowOperationQueue.js";
import {
  SLSKD_NOT_CONFIGURED_MESSAGE,
  getAccessibleSharedPlaylist,
} from "./utils.js";

const normalizeImportedTrackList = (value) => {
  if (!Array.isArray(value)) return [];
  return dedupeSharedTracks(value);
};

export function registerSharedPlaylists(router) {
  router.post("/shared-playlists", async (req, res) => {
    try {
      const {
        name,
        sourceName = null,
        sourceFlowId = null,
        tracks,
      } = req.body || {};
      const safeName = String(name || "").trim();
      const normalizedTracks = normalizeImportedTrackList(tracks);
      const rawTracksProvided = Array.isArray(tracks);

      if (!safeName) {
        return res.status(400).json({ error: "name is required" });
      }
      if (rawTracksProvided && tracks.length > 0 && normalizedTracks.length === 0) {
        return res.status(400).json({
          error: "tracks are invalid",
          message: "Add at least one valid track",
        });
      }

      const result = await weeklyFlowOperationQueue.enqueuePayload({
        kind: "shared-playlist-create",
        label: "shared-playlist:create",
        playlistId: randomUUID(),
        name: safeName,
        sourceName,
        sourceFlowId,
        tracks: normalizedTracks,
        ownerUserId: req.user.id,
      });

      res.json({
        success: true,
        playlist: result?.playlist || null,
        tracksQueued: Number(result?.tracksQueued || 0),
        tracksReused: Number(result?.tracksReused || 0),
        jobIds: result?.jobIds || [],
        queued: result?.queued === true,
      });
    } catch (error) {
      if (error?.code === "SHARED_PLAYLIST_NAME_CONFLICT") {
        return res.status(400).json({
          error: "Shared playlist name already exists",
          message: error.message,
        });
      }
      res.status(500).json({
        error: "Failed to create shared playlist",
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
      if (!slskdClient.isConfigured()) {
        return res.status(400).json({
          error: "slskd not configured",
          message: SLSKD_NOT_CONFIGURED_MESSAGE,
        });
      }

      const result = await weeklyFlowOperationQueue.enqueuePayload({
        kind: "shared-playlist-create",
        label: "shared-playlist:import",
        playlistId: randomUUID(),
        name: safeName,
        sourceName,
        sourceFlowId,
        tracks: normalizedTracks,
        ownerUserId: req.user.id,
      });

      res.json({
        success: true,
        playlist: result?.playlist || null,
        tracksQueued: Number(result?.tracksQueued || 0),
        tracksReused: Number(result?.tracksReused || 0),
        jobIds: result?.jobIds || [],
        queued: result?.queued === true,
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

  router.post("/shared-playlists/:playlistId/tracks", async (req, res) => {
    try {
      const { playlistId } = req.params;
      const playlist = getAccessibleSharedPlaylist(req.user, playlistId);
      if (!playlist) {
        return res.status(404).json({ error: "Shared playlist not found" });
      }
      const rawTracks = req.body?.tracks;
      const normalizedTracks = normalizeImportedTrackList(rawTracks);
      if (Array.isArray(rawTracks) && rawTracks.length > 0 && normalizedTracks.length === 0) {
        return res.status(400).json({
          error: "tracks are invalid",
          message: "Add at least one valid track",
        });
      }
      if (normalizedTracks.length === 0) {
        return res.status(400).json({
          error: "tracks are required",
          message: "Add at least one valid track",
        });
      }

      const result = await weeklyFlowOperationQueue.enqueuePayload({
        kind: "shared-playlist-append-tracks",
        label: `shared-playlist:${playlistId}:tracks:add`,
        playlistId,
        tracks: normalizedTracks,
      });
      if (result?.missing) {
        return res.status(404).json({ error: "Shared playlist not found" });
      }

      res.json({
        success: true,
        playlist: result?.playlist || playlist,
        tracksQueued: Number(result?.tracksQueued || 0),
        tracksReused: Number(result?.tracksReused || 0),
        jobIds: result?.jobIds || [],
        queued: result?.queued === true,
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to add playlist tracks",
        message: error.message,
      });
    }
  });

  router.put("/shared-playlists/:playlistId", async (req, res) => {
    try {
      const { playlistId } = req.params;
      const { name, tracks } = req.body || {};
      const hasNameUpdate = Object.prototype.hasOwnProperty.call(
        req.body || {},
        "name",
      );
      const hasTracksUpdate = Object.prototype.hasOwnProperty.call(
        req.body || {},
        "tracks",
      );
      if (!hasNameUpdate && !hasTracksUpdate) {
        return res.status(400).json({
          error: "At least one playlist field is required",
        });
      }
      const currentPlaylist = getAccessibleSharedPlaylist(req.user, playlistId);
      if (!currentPlaylist) {
        return res.status(404).json({ error: "Shared playlist not found" });
      }
      const safeName = hasNameUpdate
        ? String(name || "").trim()
        : String(currentPlaylist.name || "").trim();
      if (!safeName) {
        return res.status(400).json({ error: "name is required" });
      }
      const normalizedTracks = hasTracksUpdate
        ? normalizeImportedTrackList(tracks)
        : currentPlaylist.tracks;
      if (
        hasTracksUpdate &&
        Array.isArray(tracks) &&
        tracks.length > 0 &&
        normalizedTracks.length === 0
      ) {
        return res.status(400).json({
          error: "tracks are invalid",
          message: "Playlist update must include at least one valid track",
        });
      }

      const result = await weeklyFlowOperationQueue.enqueuePayload({
        kind: "shared-playlist-update",
        label: `shared-playlist:${playlistId}:update`,
        playlistId,
        name: safeName,
        tracks: normalizedTracks,
        hasNameUpdate,
        hasTracksUpdate,
      });
      if (result?.missing) {
        return res.status(404).json({ error: "Shared playlist not found" });
      }
      res.json({
        success: true,
        playlist: result?.playlist || currentPlaylist,
        tracksQueued: Number(result?.tracksQueued || 0),
        queued: result?.queued === true,
      });
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
        const playlist = getAccessibleSharedPlaylist(req.user, playlistId);
        if (!playlist) {
          return res.status(404).json({ error: "Shared playlist not found" });
        }
        const job = downloadTracker.getJob(jobId);
        if (!job || job.playlistType !== playlistId) {
          return res.status(404).json({ error: "Track not found" });
        }
        const result = await weeklyFlowOperationQueue.enqueuePayload({
          kind: "shared-playlist-delete-track",
          label: `shared-playlist:${playlistId}:track:${jobId}:delete`,
          playlistId,
          jobId,
        });
        if (result?.missingPlaylist) {
          return res.status(404).json({ error: "Shared playlist not found" });
        }
        if (result?.missingJob) {
          return res.status(404).json({ error: "Track not found" });
        }

        res.json({
          success: true,
          playlist: result?.playlist || playlist,
          removedJobId: result?.removedJobId || jobId,
          queued: result?.queued === true,
        });
      } catch (error) {
        res.status(500).json({
          error: "Failed to remove shared playlist track",
          message: error.message,
        });
      }
    },
  );

  router.post(
    "/shared-playlists/:playlistId/tracks/:jobId/research",
    async (req, res) => {
      try {
        const { playlistId, jobId } = req.params;
        const playlist = getAccessibleSharedPlaylist(req.user, playlistId);
        if (!playlist) {
          return res.status(404).json({ error: "Shared playlist not found" });
        }

        const job = downloadTracker.getJob(jobId);
        if (!job || job.playlistType !== playlistId) {
          return res.status(404).json({ error: "Track not found" });
        }

        if (job.status === "pending" || job.status === "downloading") {
          return res.status(409).json({
            error: "Track is already being processed",
          });
        }

        const result = await weeklyFlowOperationQueue.enqueuePayload({
          kind: "shared-playlist-research-track",
          label: `shared-playlist:${playlistId}:track:${jobId}:research`,
          playlistId,
          jobId,
        });
        if (result?.missingPlaylist) {
          return res.status(404).json({ error: "Shared playlist not found" });
        }
        if (result?.missingJob) {
          return res.status(404).json({ error: "Track not found" });
        }
        if (result?.alreadyProcessing) {
          return res.status(409).json({
            error: "Track is already being processed",
          });
        }

        res.json({
          success: true,
          jobId,
          playlistId,
          reused: result?.reused === true,
          queued: result?.queued === true,
        });
      } catch (error) {
        res.status(500).json({
          error: "Failed to re-search shared playlist track",
          message: error.message,
        });
      }
    },
  );

  router.delete("/shared-playlists/:playlistId", async (req, res) => {
    try {
      const { playlistId } = req.params;
      const exists = getAccessibleSharedPlaylist(req.user, playlistId);
      if (!exists) {
        return res.status(404).json({ error: "Shared playlist not found" });
      }

      const deleted = await weeklyFlowOperationQueue.enqueuePayload({
        kind: "shared-playlist-delete",
        label: `shared-playlist:${playlistId}:delete`,
        playlistId,
      });
      if (deleted?.queued) {
        return res.json({ success: true, playlistId, queued: true });
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
}
