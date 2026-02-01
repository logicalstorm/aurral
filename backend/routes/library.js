import express from "express";
import axios from "axios";
import fs from "fs/promises";
import { UUID_REGEX } from "../config/constants.js";
import { libraryManager } from "../services/libraryManager.js";
import { playlistManager } from "../services/weeklyFlowPlaylistManager.js";
import { qualityManager } from "../services/qualityManager.js";
import { musicbrainzRequest } from "../services/apiClients.js";
import { dbOps } from "../config/db-helpers.js";
import { cacheMiddleware, noCache } from "../middleware/cache.js";
import { verifyTokenAuth } from "../middleware/auth.js";

const router = express.Router();

router.get("/stream/:songId", noCache, async (req, res) => {
  if (!verifyTokenAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const { songId } = req.params;
  const settings = dbOps.getSettings();
  const nd = settings.integrations?.navidrome;
  if (!nd?.url || !nd?.username || !nd?.password) {
    return res.status(503).json({ error: "Navidrome not configured" });
  }
  try {
    const { NavidromeClient } = await import("../services/navidrome.js");
    const client = new NavidromeClient(nd.url, nd.username, nd.password);
    const streamUrl = client.getStreamUrl(songId);
    const response = await axios.get(streamUrl, {
      responseType: "stream",
      timeout: 30000,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    const contentType = response.headers["content-type"];
    if (contentType) res.setHeader("Content-Type", contentType);
    const contentLength = response.headers["content-length"];
    if (contentLength) res.setHeader("Content-Length", contentLength);
    response.data.pipe(res);
  } catch (error) {
    const status = error.response?.status || 500;
    if (!res.headersSent) {
      res.status(status).json({
        error: "Stream failed",
        message: error.message,
      });
    }
  }
});

router.get("/artists", cacheMiddleware(120), async (req, res) => {
  try {
    const artists = await libraryManager.getAllArtists();
    const formatted = artists.map((artist) => ({
      ...artist,
      foreignArtistId: artist.foreignArtistId || artist.mbid,
      added: artist.addedAt,
    }));
    res.json(formatted);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch artists",
      message: error.message,
    });
  }
});

router.get("/artists/:mbid", cacheMiddleware(120), async (req, res) => {
  try {
    const { mbid } = req.params;
    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: "Invalid MBID format" });
    }

    const artist = await libraryManager.getArtist(mbid);
    if (!artist) {
      return res.status(404).json({ error: "Artist not found" });
    }

    const formatted = {
      ...artist,
      foreignArtistId: artist.foreignArtistId || artist.mbid,
      added: artist.addedAt,
    };
    res.json(formatted);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch artist",
      message: error.message,
    });
  }
});

router.post("/artists", async (req, res) => {
  try {
    const { foreignArtistId: mbid, artistName, quality } = req.body;

    if (!mbid || !artistName) {
      return res.status(400).json({
        error: "foreignArtistId and artistName are required",
      });
    }

    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: "Invalid MBID format" });
    }

    const settings = dbOps.getSettings();
    const artist = await libraryManager.addArtist(mbid, artistName, {
      quality: quality || settings.quality || "standard",
    });
    if (artist?.error) {
      return res.status(503).json({ error: artist.error });
    }
    res.status(201).json(artist);
  } catch (error) {
    res.status(500).json({
      error: "Failed to add artist",
      message: error.message,
    });
  }
});

router.put("/artists/:mbid", async (req, res) => {
  try {
    const { mbid } = req.params;
    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: "Invalid MBID format" });
    }

    const artist = await libraryManager.updateArtist(mbid, req.body);
    if (artist?.error) {
      return res.status(503).json({ error: artist.error });
    }
    res.json(artist);
  } catch (error) {
    res.status(500).json({
      error: "Failed to update artist",
      message: error.message,
    });
  }
});

router.delete("/artists/:mbid", async (req, res) => {
  try {
    const { mbid } = req.params;
    const { deleteFiles = false } = req.query;

    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: "Invalid MBID format" });
    }

    const result = await libraryManager.deleteArtist(mbid, deleteFiles === "true");
    if (!result?.success) {
      return res.status(503).json({ error: result?.error || "Failed to delete artist" });
    }
    res.json({ success: true, message: "Artist deleted successfully" });
  } catch (error) {
    res.status(500).json({
      error: "Failed to delete artist",
      message: error.message,
    });
  }
});

router.get("/albums", cacheMiddleware(120), async (req, res) => {
  try {
    const { artistId } = req.query;
    if (!artistId) {
      return res.status(400).json({ error: "artistId parameter is required" });
    }

    const albums = await libraryManager.getAlbums(artistId);
    const formatted = albums.map((album) => ({
      ...album,
      foreignAlbumId: album.foreignAlbumId || album.mbid,
      title: album.albumName,
      albumType: "Album",
      statistics: album.statistics || {
        trackCount: 0,
        sizeOnDisk: 0,
        percentOfTracks: 0,
      },
    }));
    res.json(formatted);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch albums",
      message: error.message,
    });
  }
});

router.post("/albums", async (req, res) => {
  try {
    const { artistId, releaseGroupMbid, albumName } = req.body;

    if (!artistId || !releaseGroupMbid || !albumName) {
      return res.status(400).json({
        error: "artistId, releaseGroupMbid, and albumName are required",
      });
    }

    const settings = dbOps.getSettings();
    const searchOnAdd = settings.integrations?.lidarr?.searchOnAdd ?? false;

    const album = await libraryManager.addAlbum(
      artistId,
      releaseGroupMbid,
      albumName,
      {
        triggerSearch: searchOnAdd,
      },
    );
    if (album?.error) {
      return res.status(503).json({ error: album.error });
    }
    if (album.artistName && album.albumName) {
      playlistManager.removeDiscoverSymlinksForAlbum(
        album.artistName,
        album.albumName,
      ).catch(() => {});
    }
    const formatted = {
      ...album,
      foreignAlbumId: album.mbid,
      title: album.albumName,
      albumType: "Album",
    };
    res.status(201).json(formatted);
  } catch (error) {
    res.status(500).json({
      error: "Failed to add album",
      message: error.message,
    });
  }
});

router.get("/albums/:id", cacheMiddleware(120), async (req, res) => {
  try {
    const { id } = req.params;
    const album = await libraryManager.getAlbumById(id);
    if (!album) {
      return res.status(404).json({ error: "Album not found" });
    }
    res.json(album);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch album",
      message: error.message,
    });
  }
});

router.put("/albums/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const album = await libraryManager.updateAlbum(id, req.body);
    if (album?.error) {
      return res.status(503).json({ error: album.error });
    }
    res.json(album);
  } catch (error) {
    res.status(500).json({
      error: "Failed to update album",
      message: error.message,
    });
  }
});

router.delete("/albums/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { deleteFiles = false } = req.query;
    const result = await libraryManager.deleteAlbum(id, deleteFiles === "true");
    if (!result?.success) {
      return res.status(503).json({ error: result?.error || "Failed to delete album" });
    }
    res.json({ success: true, message: "Album deleted successfully" });
  } catch (error) {
    res.status(500).json({
      error: "Failed to delete album",
      message: error.message,
    });
  }
});

router.get("/tracks", cacheMiddleware(120), async (req, res) => {
  try {
    const { albumId, releaseGroupMbid } = req.query;

    let tracks = [];

    if (albumId) {
      tracks = await libraryManager.getTracks(albumId);
    }

    if (tracks.length === 0 && releaseGroupMbid) {
      const { musicbrainzRequest } = await import("../services/apiClients.js");
      try {
        const rgData = await musicbrainzRequest(
          `/release-group/${releaseGroupMbid}`,
          { inc: "releases" },
        );

        if (rgData.releases && rgData.releases.length > 0) {
          const releaseId = rgData.releases[0].id;
          const releaseData = await musicbrainzRequest(
            `/release/${releaseId}`,
            {
              inc: "recordings",
            },
          );

          if (releaseData.media && releaseData.media.length > 0) {
            tracks = [];
            for (const medium of releaseData.media) {
              if (medium.tracks) {
                for (const track of medium.tracks) {
                  const recording = track.recording;
                  if (recording) {
                    tracks.push({
                      id: recording.id,
                      mbid: recording.id,
                      trackName: recording.title,
                      trackNumber: track.position || 0,
                      title: recording.title,
                      path: null,
                      hasFile: false,
                      size: 0,
                      quality: null,
                      addedAt: new Date().toISOString(),
                    });
                  }
                }
              }
            }
          }
        }
      } catch (mbError) {
        console.warn(
          `[Library] Failed to fetch tracks from MusicBrainz: ${mbError.message}`,
        );
      }
    }

    const formatted = tracks.map((track) => ({
      ...track,
      title: track.trackName || track.title,
      trackNumber: track.trackNumber || 0,
    }));
    res.json(formatted);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch tracks",
      message: error.message,
    });
  }
});

router.post("/downloads/album", async (req, res) => {
  try {
    const { artistId, albumId, artistMbid, artistName } = req.body;

    if (!albumId) {
      return res.status(400).json({ error: "albumId is required" });
    }

    const { lidarrClient } = await import("../services/lidarrClient.js");
    if (!lidarrClient || !lidarrClient.isConfigured()) {
      return res.status(400).json({ error: "Lidarr is not configured" });
    }

    const album = await libraryManager.getAlbumById(albumId);
    if (!album) {
      return res.status(404).json({ error: "Album not found" });
    }

    let artist = artistId ? await libraryManager.getArtistById(artistId) : null;

    if (!artist && artistMbid && artistName) {
      artist = await libraryManager.addArtist(artistMbid, artistName, {
        monitorOption: "none",
        quality: dbOps.getSettings().quality || "standard",
      });
      if (artist?.error) artist = null;
    }

    if (!artist && album.artistId) {
      artist = await libraryManager.getArtistById(album.artistId);
    }

    if (!artist) {
      return res.status(404).json({
        error: "Artist not found. Please add the artist to your library first.",
      });
    }

    try {
      if (!album.monitored) {
        await libraryManager.updateAlbum(albumId, { monitored: true });
      }

      const settings = dbOps.getSettings();
      const searchOnAdd = settings.integrations?.lidarr?.searchOnAdd ?? false;

      if (searchOnAdd) {
        await lidarrClient.request("/command", "POST", {
          name: "AlbumSearch",
          albumIds: [parseInt(albumId, 10)],
        });
      }

      res.json({
        success: true,
        message: searchOnAdd
          ? "Album search triggered"
          : "Album added to library",
      });
    } catch (error) {
      console.error(
        `Failed to trigger album search ${albumId}:`,
        error.message,
      );
      res.status(500).json({
        error: "Failed to trigger album search",
        message: error.message,
      });
    }
  } catch (error) {
    console.error("Error initiating album download:", error);
    res.status(500).json({
      error: "Failed to initiate album download",
      message: error.message,
    });
  }
});

router.post("/downloads/track", async (req, res) => {
  res
    .status(400)
    .json({ error: "Track downloads are not supported by Lidarr" });
});

router.get("/downloads", async (req, res) => {
  try {
    const { lidarrClient } = await import("../services/lidarrClient.js");
    if (!lidarrClient.isConfigured()) {
      return res.json([]);
    }
    const queue = await lidarrClient.getQueue();
    const queueItems = Array.isArray(queue) ? queue : queue.records || [];
    res.json(
      queueItems.map((item) => ({
        id: item.id,
        type: "album",
        state: item.status || "queued",
        title: item.title,
        artistName: item.artist?.artistName,
        albumTitle: item.album?.title,
        progress: item.size
          ? Math.round((1 - item.sizeleft / item.size) * 100)
          : 0,
        source: "lidarr",
      })),
    );
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch downloads",
      message: error.message,
    });
  }
});

router.get("/downloads/status", noCache, async (req, res) => {
  try {
    const { albumIds } = req.query;

    if (!albumIds) {
      return res
        .status(400)
        .json({ error: "albumIds query parameter is required" });
    }

    const albumIdArray = Array.isArray(albumIds)
      ? albumIds
      : albumIds.split(",");
    const statuses = {};

    const { lidarrClient } = await import("../services/lidarrClient.js");

    if (lidarrClient.isConfigured()) {
      try {
        const queue = await lidarrClient.getQueue();
        const queueItems = Array.isArray(queue) ? queue : queue.records || [];
        const history = await lidarrClient.getHistory(1, 200);
        const historyItems = Array.isArray(history)
          ? history
          : history.records || [];

        for (const albumId of albumIdArray) {
          if (!albumId || albumId === "undefined" || albumId === "null")
            continue;
          const lidarrAlbumId = parseInt(albumId, 10);
          if (isNaN(lidarrAlbumId)) continue;

          const queueItem = queueItems.find((q) => {
            const qAlbumId = q?.albumId ?? q?.album?.id;
            return qAlbumId != null && qAlbumId === lidarrAlbumId;
          });

          if (queueItem) {
            const queueStatus = String(queueItem.status || "").toLowerCase();
            const title = String(queueItem.title || "").toLowerCase();
            const trackedDownloadState = String(
              queueItem.trackedDownloadState || "",
            ).toLowerCase();
            const trackedDownloadStatus = String(
              queueItem.trackedDownloadStatus || "",
            ).toLowerCase();
            const errorMessage = String(
              queueItem.errorMessage || "",
            ).toLowerCase();
            const statusMessages = Array.isArray(queueItem.statusMessages)
              ? queueItem.statusMessages
                  .map((m) => String(m || "").toLowerCase())
                  .join(" ")
              : "";

            const isFailed =
              trackedDownloadState === "importfailed" ||
              trackedDownloadState === "importFailed" ||
              queueStatus.includes("fail") ||
              queueStatus.includes("import fail") ||
              title.includes("import fail") ||
              trackedDownloadState.includes("fail") ||
              trackedDownloadStatus.includes("fail") ||
              trackedDownloadStatus === "warning" ||
              errorMessage.includes("fail") ||
              errorMessage.includes("retrying") ||
              statusMessages.includes("fail") ||
              statusMessages.includes("unmatched");

            if (isFailed) {
              statuses[albumId] = {
                status: "processing",
                updatedAt: new Date().toISOString(),
              };
            } else {
              const progress = queueItem.size
                ? Math.round((1 - queueItem.sizeleft / queueItem.size) * 100)
                : 0;
              statuses[albumId] = {
                status: "downloading",
                progress: progress,
                updatedAt: new Date().toISOString(),
              };
            }
            continue;
          }

          const recentHistory = historyItems.find(
            (h) => h.albumId === lidarrAlbumId,
          );

          if (recentHistory) {
            const eventType = String(
              recentHistory.eventType || "",
            ).toLowerCase();
            const data = recentHistory?.data || {};
            const statusMessages = Array.isArray(data?.statusMessages)
              ? data.statusMessages
                  .map((m) => String(m || "").toLowerCase())
                  .join(" ")
              : String(data?.statusMessages?.[0] || "").toLowerCase();
            const errorMessage = String(data?.errorMessage || "").toLowerCase();
            const isFailedImport =
              eventType === "albumimportincomplete" ||
              eventType.includes("incomplete") ||
              statusMessages.includes("fail") ||
              statusMessages.includes("error") ||
              statusMessages.includes("incomplete") ||
              errorMessage.includes("fail") ||
              errorMessage.includes("error");
            const isComplete =
              eventType.includes("import") &&
              !isFailedImport &&
              eventType !== "albumimportincomplete";
            statuses[albumId] = {
              status: isComplete ? "added" : "processing",
              updatedAt: new Date().toISOString(),
            };
            continue;
          }
        }
      } catch (error) {
        console.warn("Failed to fetch Lidarr status:", error.message);
      }
    }

    res.json(statuses);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch download status",
      message: error.message,
    });
  }
});

router.get("/downloads/status/all", noCache, async (req, res) => {
  try {
    const { lidarrClient } = await import("../services/lidarrClient.js");
    const allStatuses = {};

    if (lidarrClient.isConfigured()) {
      try {
        const [queue, history, albums] = await Promise.all([
          lidarrClient.getQueue(),
          lidarrClient.getHistory(1, 200),
          lidarrClient.request("/album"),
        ]);

        const queueItems = Array.isArray(queue) ? queue : queue.records || [];
        const historyItems = Array.isArray(history)
          ? history
          : history.records || [];
        const allAlbums = Array.isArray(albums) ? albums : [];

        const queueByAlbumId = new Map();
        for (const q of queueItems) {
          const qAlbumId = q?.albumId ?? q?.album?.id;
          if (qAlbumId == null) continue;
          queueByAlbumId.set(qAlbumId, q);
        }

        const historyByAlbumId = new Map();
        for (const h of historyItems) {
          if (h?.albumId == null) continue;
          if (!historyByAlbumId.has(h.albumId)) {
            historyByAlbumId.set(h.albumId, h);
          }
        }

        for (const album of allAlbums) {
          const lidarrAlbumId = album?.id;
          if (lidarrAlbumId == null) continue;
          const queueItem = queueByAlbumId.get(lidarrAlbumId);

          if (queueItem) {
            const queueStatus = String(queueItem.status || "").toLowerCase();
            const title = String(queueItem.title || "").toLowerCase();
            const trackedDownloadState = String(
              queueItem.trackedDownloadState || "",
            ).toLowerCase();
            const trackedDownloadStatus = String(
              queueItem.trackedDownloadStatus || "",
            ).toLowerCase();
            const errorMessage = String(
              queueItem.errorMessage || "",
            ).toLowerCase();
            const statusMessages = Array.isArray(queueItem.statusMessages)
              ? queueItem.statusMessages
                  .map((m) => String(m || "").toLowerCase())
                  .join(" ")
              : "";

            const isFailed =
              trackedDownloadState === "importfailed" ||
              trackedDownloadState === "importFailed" ||
              queueStatus.includes("fail") ||
              queueStatus.includes("import fail") ||
              title.includes("import fail") ||
              trackedDownloadState.includes("fail") ||
              trackedDownloadStatus.includes("fail") ||
              trackedDownloadStatus === "warning" ||
              errorMessage.includes("fail") ||
              errorMessage.includes("retrying") ||
              statusMessages.includes("fail") ||
              statusMessages.includes("unmatched");

            if (isFailed) {
              allStatuses[String(lidarrAlbumId)] = {
                status: "processing",
                updatedAt: new Date().toISOString(),
              };
            } else {
              const progress = queueItem.size
                ? Math.round((1 - queueItem.sizeleft / queueItem.size) * 100)
                : 0;
              allStatuses[String(lidarrAlbumId)] = {
                status: "downloading",
                progress: progress,
                updatedAt: new Date().toISOString(),
              };
            }
            continue;
          }

          const recentHistory = historyByAlbumId.get(lidarrAlbumId);

          if (recentHistory) {
            const eventType = String(
              recentHistory.eventType || "",
            ).toLowerCase();
            const data = recentHistory?.data || {};
            const statusMessages = Array.isArray(data?.statusMessages)
              ? data.statusMessages
                  .map((m) => String(m || "").toLowerCase())
                  .join(" ")
              : String(data?.statusMessages?.[0] || "").toLowerCase();
            const errorMessage = String(data?.errorMessage || "").toLowerCase();
            const isFailedImport =
              eventType === "albumimportincomplete" ||
              eventType.includes("incomplete") ||
              statusMessages.includes("fail") ||
              statusMessages.includes("error") ||
              statusMessages.includes("incomplete") ||
              errorMessage.includes("fail") ||
              errorMessage.includes("error");
            const isComplete =
              eventType.includes("import") &&
              !isFailedImport &&
              eventType !== "albumimportincomplete";
            const historyDate = new Date(
              recentHistory.date || recentHistory.eventDate || 0,
            );
            const oneHourAgo = Date.now() - 60 * 60 * 1000;

            if (historyDate.getTime() > oneHourAgo) {
              allStatuses[String(lidarrAlbumId)] = {
                status: isComplete ? "added" : "processing",
                updatedAt: new Date().toISOString(),
              };
              continue;
            }
          }
        }
      } catch (error) {
        console.warn("Failed to fetch Lidarr status:", error.message);
      }
    }

    res.json(allStatuses);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch download status",
      message: error.message,
    });
  }
});

router.post("/scan", async (req, res) => {
  res.status(400).json({ error: "Scanning is handled by Lidarr" });
});

router.get("/rootfolder", async (req, res) => {
  try {
    const { lidarrClient } = await import("../services/lidarrClient.js");
    if (!lidarrClient.isConfigured()) {
      return res.json([]);
    }
    const rootFolders = await lidarrClient.getRootFolders();
    const list = Array.isArray(rootFolders)
      ? rootFolders.map((r) => ({ path: r.path }))
      : [];
    res.json(list);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch root folder",
      message: error.message,
    });
  }
});

router.get("/qualityprofile", async (req, res) => {
  try {
    const profiles = qualityManager.getQualityProfiles();
    res.json(profiles);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch quality profiles",
      message: error.message,
    });
  }
});

router.get("/lookup/:mbid", async (req, res) => {
  try {
    const { mbid } = req.params;
    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: "Invalid MBID format" });
    }

    const artist = await libraryManager.getArtist(mbid);
    if (artist) {
      res.json({
        exists: true,
        artist: {
          ...artist,
          foreignArtistId: artist.foreignArtistId || artist.mbid,
        },
      });
    } else {
      res.json({
        exists: false,
        artist: null,
      });
    }
  } catch (error) {
    res.status(500).json({
      error: "Failed to lookup artist",
      message: error.message,
    });
  }
});

router.post("/lookup/batch", async (req, res) => {
  try {
    const { mbids } = req.body;
    if (!Array.isArray(mbids)) {
      return res.status(400).json({ error: "mbids must be an array" });
    }

    const results = {};
    for (const mbid of mbids) {
      const artist = await libraryManager.getArtist(mbid);
      results[mbid] = !!artist;
    }

    res.json(results);
  } catch (error) {
    res.status(500).json({
      error: "Failed to batch lookup artists",
      message: error.message,
    });
  }
});

router.get("/recent", async (req, res) => {
  try {
    const artists = await libraryManager.getAllArtists();
    const recent = [...artists]
      .sort(
        (a, b) =>
          new Date(b.addedAt || b.added) - new Date(a.addedAt || a.added),
      )
      .slice(0, 20)
      .map((artist) => ({
        ...artist,
        foreignArtistId: artist.foreignArtistId || artist.mbid,
        added: artist.addedAt || artist.added,
      }));
    res.set("Cache-Control", "public, max-age=300");
    res.json(recent);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch recent artists",
      message: error.message,
    });
  }
});

router.post("/artists/:mbid/refresh", async (req, res) => {
  try {
    const { mbid } = req.params;
    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: "Invalid MBID format" });
    }

    const artist = await libraryManager.getArtist(mbid);
    if (!artist) {
      return res.status(404).json({ error: "Artist not found" });
    }

    const { lidarrClient } = await import("../services/lidarrClient.js");
    if (lidarrClient && lidarrClient.isConfigured()) {
      const lidarrArtist = await lidarrClient.getArtist(artist.id);
      if (
        lidarrArtist &&
        lidarrArtist.monitor !== "none" &&
        lidarrArtist.monitored
      ) {
        await libraryManager.fetchArtistAlbums(artist.id, mbid);
      }
    }

    const albums = await libraryManager.getAlbums(artist.id);

    for (const album of albums) {
      await libraryManager.updateAlbumStatistics(album.id).catch((err) => {
        console.error(
          `Failed to update statistics for album ${album.albumName}:`,
          err.message,
        );
      });
    }

    await libraryManager.updateArtistStatistics(artist.id);

    if (
      artist.monitored &&
      artist.monitorOption &&
      artist.monitorOption !== "none"
    ) {
      const albumsToMonitor = [];

      const sortedAlbums = [...albums].sort((a, b) => {
        const dateA = a.releaseDate || a.addedAt || "";
        const dateB = b.releaseDate || b.addedAt || "";
        return dateB.localeCompare(dateA);
      });

      switch (artist.monitorOption) {
        case "all":
          albumsToMonitor.push(...albums.filter((a) => !a.monitored));
          break;
        case "latest":
          if (sortedAlbums.length > 0 && !sortedAlbums[0].monitored) {
            albumsToMonitor.push(sortedAlbums[0]);
          }
          break;
        case "first": {
          const oldestAlbum = sortedAlbums[sortedAlbums.length - 1];
          if (oldestAlbum && !oldestAlbum.monitored) {
            albumsToMonitor.push(oldestAlbum);
          }
          break;
        }
        case "missing":
          albumsToMonitor.push(
            ...albums.filter((a) => {
              const stats = a.statistics || {};
              return !a.monitored && (stats.percentOfTracks || 0) < 100;
            }),
          );
          break;
        case "future": {
          const artistAddedDate = new Date(artist.addedAt);
          albumsToMonitor.push(
            ...albums.filter((a) => {
              if (a.monitored) return false;
              if (!a.releaseDate) return false;
              const releaseDate = new Date(a.releaseDate);
              return releaseDate > artistAddedDate;
            }),
          );
          break;
        }
      }

      if (lidarrClient && lidarrClient.isConfigured()) {
        for (const album of albumsToMonitor) {
          try {
            await libraryManager.updateAlbum(album.id, { monitored: true });
            await lidarrClient.request("/command", "POST", {
              name: "AlbumSearch",
              albumIds: [parseInt(album.id, 10)],
            });
          } catch (err) {
            console.error(
              `Failed to monitor/search album ${album.albumName}:`,
              err.message,
            );
          }
        }
      }
    }

    res.json({
      success: true,
      message: "Artist refreshed successfully",
      albums: albums.length,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to refresh artist",
      message: error.message,
    });
  }
});

export default router;
