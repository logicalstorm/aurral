import { libraryManager } from "../../../services/libraryManager.js";
import { dbOps } from "../../../config/db-helpers.js";
import { noCache } from "../../../middleware/cache.js";
import {
  requireAuth,
  requirePermission,
} from "../../../middleware/requirePermission.js";
import { hasPermission } from "../../../middleware/auth.js";

export default function registerDownloads(router) {
  router.post(
    "/downloads/album",
    requireAuth,
    requirePermission("addAlbum"),
    async (req, res) => {
      try {
        const { artistId, albumId, artistMbid, artistName } = req.body;

        if (!albumId) {
          return res.status(400).json({ error: "albumId is required" });
        }

        const { lidarrClient } = await import("../../../services/lidarrClient.js");
        if (!lidarrClient || !lidarrClient.isConfigured()) {
          return res.status(400).json({ error: "Lidarr is not configured" });
        }

        const album = await libraryManager.getAlbumById(albumId);
        if (!album) {
          return res.status(404).json({ error: "Album not found" });
        }

        let artist = artistId
          ? await libraryManager.getArtistById(artistId)
          : null;

        if (!artist && artistMbid && artistName) {
          if (!hasPermission(req.user, "addArtist")) {
            return res.status(403).json({
              error: "Forbidden",
              message: "Permission required: addArtist",
            });
          }
          artist = await libraryManager.addArtist(artistMbid, artistName, {
            albumOnly: true,
            quality: dbOps.getSettings().quality || "standard",
          });
          if (artist?.error) artist = null;
        }

        if (!artist && album.artistId) {
          artist = await libraryManager.getArtistById(album.artistId);
        }

        if (!artist) {
          return res.status(404).json({
            error:
              "Artist not found. Please add the artist to your library first.",
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
            error.message
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
    }
  );

  router.post("/downloads/track", async (req, res) => {
    res
      .status(400)
      .json({ error: "Track downloads are not supported by Lidarr" });
  });

  router.get("/downloads", async (req, res) => {
    try {
      const { lidarrClient } = await import("../../../services/lidarrClient.js");
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
        }))
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

      const { lidarrClient } = await import("../../../services/lidarrClient.js");

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
                queueItem.trackedDownloadState || ""
              ).toLowerCase();
              const trackedDownloadStatus = String(
                queueItem.trackedDownloadStatus || ""
              ).toLowerCase();
              const errorMessage = String(
                queueItem.errorMessage || ""
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
              (h) => h.albumId === lidarrAlbumId
            );

            if (recentHistory) {
              const eventType = String(
                recentHistory.eventType || ""
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
      const { lidarrClient } = await import("../../../services/lidarrClient.js");
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
                queueItem.trackedDownloadState || ""
              ).toLowerCase();
              const trackedDownloadStatus = String(
                queueItem.trackedDownloadStatus || ""
              ).toLowerCase();
              const errorMessage = String(
                queueItem.errorMessage || ""
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
                recentHistory.eventType || ""
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
                recentHistory.date || recentHistory.eventDate || 0
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
}
