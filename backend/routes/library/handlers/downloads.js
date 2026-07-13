import { libraryManager } from "../../../services/libraryManager.js";
import { dbOps } from "../../../db/helpers/index.js";
import { noCache } from "../../../middleware/cache.js";
import { requireAuth, requirePermission } from "../../../middleware/requirePermission.js";
import {
  parseLidarrSearchContext,
  resolveAlbumSearchOutcome,
} from "../../../services/albumSearchState.js";
import { logger } from "../../../services/logger.js";

const STALE_GRABBED_MS = 15 * 60 * 1000;
const DOWNLOAD_STATUS_CACHE_MS = 5000;
let allDownloadStatusesCache = {
  at: 0,
  statuses: null,
  pending: null,
};

export const getDownloadStatusesForAlbumIds = async (albumIdArrayInput) => {
  const albumIdArray = Array.isArray(albumIdArrayInput) ? albumIdArrayInput : [];
  const statuses = {};
  const { lidarrClient } = await import("../../../services/lidarrClient.js");

  if (lidarrClient.isConfigured()) {
    try {
      const [queue, history, commands] = await Promise.all([
        lidarrClient.getQueue(),
        lidarrClient.getHistory(1, 200),
        lidarrClient.request("/command").catch(() => []),
      ]);
      const queueItems = Array.isArray(queue) ? queue : queue.records || [];
      const historyItems = Array.isArray(history) ? history : history.records || [];
      const searchContext = parseLidarrSearchContext({
        queue,
        history,
        commands,
      });
      const { searchingAlbumIds } = searchContext;

      const latestHistoryByAlbumId = new Map();
      for (const h of historyItems) {
        if (h?.albumId == null) continue;
        const historyTime = new Date(h?.date || h?.eventDate || 0).getTime();
        const existing = latestHistoryByAlbumId.get(h.albumId);
        if (!existing || historyTime > existing.historyTime) {
          latestHistoryByAlbumId.set(h.albumId, {
            history: h,
            historyTime,
          });
        }
      }

      const queueByAlbumId = new Map();
      for (const q of queueItems) {
        const qAlbumId = q?.albumId ?? q?.album?.id;
        if (qAlbumId == null) continue;
        queueByAlbumId.set(qAlbumId, q);
      }

      for (const albumId of albumIdArray) {
        if (!albumId || albumId === "undefined" || albumId === "null") continue;
        const lidarrAlbumId = parseInt(albumId, 10);
        if (isNaN(lidarrAlbumId)) continue;

        const queueItem = queueByAlbumId.get(lidarrAlbumId);

        if (queueItem) {
          const queueStatus = String(queueItem.status || "").toLowerCase();
          const title = String(queueItem.title || "").toLowerCase();
          const trackedDownloadState = String(queueItem.trackedDownloadState || "").toLowerCase();
          const trackedDownloadStatus = String(queueItem.trackedDownloadStatus || "").toLowerCase();
          const errorMessage = String(queueItem.errorMessage || "").toLowerCase();
          const statusMessages = Array.isArray(queueItem.statusMessages)
            ? queueItem.statusMessages.map((m) => String(m || "").toLowerCase()).join(" ")
            : "";

          const size = Number(queueItem.size || 0);
          const sizeLeft = Number(queueItem.sizeleft || 0);
          const hasActiveDownload = size > 0 && sizeLeft < size;
          const isDownloadingState =
            hasActiveDownload ||
            queueStatus.includes("downloading") ||
            queueStatus.includes("queued") ||
            queueStatus.includes("processing");
          const isExplicitFailure =
            trackedDownloadState === "importfailed" ||
            trackedDownloadState === "importFailed" ||
            trackedDownloadState.includes("importfailed") ||
            queueStatus.includes("failed") ||
            queueStatus.includes("import fail") ||
            title.includes("import fail") ||
            trackedDownloadState.includes("fail") ||
            trackedDownloadStatus.includes("fail") ||
            (trackedDownloadStatus === "warning" && !isDownloadingState) ||
            errorMessage.includes("fail") ||
            errorMessage.includes("retrying") ||
            statusMessages.includes("unmatched");

          if (isDownloadingState) {
            const progress = size ? Math.round((1 - sizeLeft / size) * 100) : 0;
            statuses[albumId] = {
              status: "downloading",
              progress: progress,
              updatedAt: new Date().toISOString(),
            };
          } else if (isExplicitFailure) {
            statuses[albumId] = {
              status: "failed",
              updatedAt: new Date().toISOString(),
            };
          } else {
            const progress = size ? Math.round((1 - sizeLeft / size) * 100) : 0;
            statuses[albumId] = {
              status: "downloading",
              progress: progress,
              updatedAt: new Date().toISOString(),
            };
          }
          continue;
        }

        if (searchingAlbumIds.has(lidarrAlbumId)) {
          statuses[albumId] = {
            status: "searching",
            updatedAt: new Date().toISOString(),
          };
          continue;
        }

        const historyEntry = latestHistoryByAlbumId.get(lidarrAlbumId);
        const recentHistory = historyEntry?.history;
        const historyTime = historyEntry?.historyTime ?? 0;

        if (recentHistory) {
          const eventType = String(recentHistory.eventType || "").toLowerCase();
          const data = recentHistory?.data || {};
          const statusMessages = Array.isArray(data?.statusMessages)
            ? data.statusMessages.map((m) => String(m || "").toLowerCase()).join(" ")
            : String(data?.statusMessages?.[0] || "").toLowerCase();
          const errorMessage = String(data?.errorMessage || "").toLowerCase();
          const sourceTitle = String(recentHistory?.sourceTitle || "").toLowerCase();
          if (historyEntry.dataString === undefined) {
            historyEntry.dataString = JSON.stringify(data).toLowerCase();
          }
          const dataString = historyEntry.dataString;
          const isGrabbed =
            eventType.includes("grabbed") ||
            sourceTitle.includes("grabbed") ||
            dataString.includes("grabbed");
          const isFailedDownload =
            eventType.includes("fail") ||
            statusMessages.includes("fail") ||
            statusMessages.includes("error") ||
            errorMessage.includes("fail") ||
            errorMessage.includes("error") ||
            sourceTitle.includes("fail") ||
            dataString.includes("fail");
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
          const isStaleGrabbed = isGrabbed && Date.now() - historyTime > STALE_GRABBED_MS;
          statuses[albumId] = {
            status: isComplete
              ? "added"
              : isFailedImport || isFailedDownload || isStaleGrabbed
                ? "failed"
                : "processing",
            updatedAt: new Date().toISOString(),
          };
          continue;
        }

        const searchOutcome = resolveAlbumSearchOutcome(lidarrAlbumId, searchContext);
        if (searchOutcome?.status === "failed") {
          statuses[albumId] = {
            status: "failed",
            updatedAt: new Date().toISOString(),
          };
        } else if (searchOutcome?.status === "searching") {
          statuses[albumId] = {
            status: "searching",
            updatedAt: new Date().toISOString(),
          };
        }
      }
    } catch (error) {
      logger.warn("downloads", "Failed to fetch Lidarr status:", { message: error.message });
    }
  }

  return statuses;
};

const computeAllDownloadStatuses = async () => {
  const { lidarrClient } = await import("../../../services/lidarrClient.js");

  if (!lidarrClient.isConfigured()) {
    return {};
  }
  if (lidarrClient.isCircuitOpen()) {
    return allDownloadStatusesCache.statuses || {};
  }

  try {
    const [queue, history, commands] = await Promise.all([
      lidarrClient.getQueue(),
      lidarrClient.getHistory(1, 200),
      lidarrClient.request("/command").catch(() => []),
    ]);
    const queueItems = Array.isArray(queue) ? queue : queue.records || [];
    const historyItems = Array.isArray(history) ? history : history.records || [];
    const commandItems = Array.isArray(commands) ? commands : commands?.records || [];
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const albumIds = new Set();
    const searchContext = parseLidarrSearchContext({
      queue,
      history,
      commands,
    });

    for (const item of queueItems) {
      const albumId = item?.albumId ?? item?.album?.id;
      if (albumId != null) albumIds.add(String(albumId));
    }
    for (const item of historyItems) {
      if (item?.albumId == null) continue;
      const historyTime = new Date(item?.date || item?.eventDate || 0).getTime();
      if (historyTime > oneHourAgo) albumIds.add(String(item.albumId));
    }
    for (const albumId of searchContext.searchingAlbumIds) {
      albumIds.add(String(albumId));
    }

    return getDownloadStatusesForAlbumIds([...albumIds]);
  } catch (error) {
    logger.warn("downloads", "Failed to fetch Lidarr status:", { message: error.message });
    return allDownloadStatusesCache.statuses || {};
  }
};

export const invalidateAllDownloadStatusesCache = () => {
  allDownloadStatusesCache.at = 0;
  allDownloadStatusesCache.statuses = null;
  allDownloadStatusesCache.pending = null;
};

export const getAllDownloadStatuses = async () => {
  const { lidarrClient } = await import("../../../services/lidarrClient.js");
  if (lidarrClient.isCircuitOpen() && allDownloadStatusesCache.statuses) {
    return allDownloadStatusesCache.statuses;
  }

  const now = Date.now();
  if (
    allDownloadStatusesCache.statuses &&
    now - allDownloadStatusesCache.at < DOWNLOAD_STATUS_CACHE_MS
  ) {
    return allDownloadStatusesCache.statuses;
  }

  if (allDownloadStatusesCache.pending) {
    return allDownloadStatusesCache.pending;
  }

  allDownloadStatusesCache.pending = computeAllDownloadStatuses()
    .then((statuses) => {
      allDownloadStatusesCache.statuses = statuses;
      allDownloadStatusesCache.at = Date.now();
      return statuses;
    })
    .finally(() => {
      allDownloadStatusesCache.pending = null;
    });

  return allDownloadStatusesCache.pending;
};

export function registerDownloads(router) {
  router.post("/downloads/album", requireAuth, requirePermission("addAlbum"), async (req, res) => {
    try {
      const { albumId } = req.body;

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

      const artist = album.artistId ? await libraryManager.getArtistById(album.artistId) : null;
      if (artist) {
        await libraryManager.ensureArtistMonitored(artist);
      }
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
        await libraryManager.ensureRequestedAlbumMonitoring(artist.id, albumId);
        libraryManager.scheduleRequestedAlbumMonitoringRepair(artist.id, albumId);
      }
      invalidateAllDownloadStatusesCache();

      const { recordAlbumRequested } = await import("../../../services/aurralHistoryService.js");
      recordAlbumRequested({
        albumId,
        albumName: album.albumName,
        artistName: artist?.artistName || album.artistName,
        artistMbid: artist?.mbid || artist?.foreignArtistId,
        searching: searchOnAdd,
        user: req.user,
      });

      res.json({
        success: true,
        message: searchOnAdd ? "Album search triggered" : "Album added to library",
      });
    } catch (error) {
      logger.error("library", "Error initiating album download:", error.message);
      res.status(500).json({
        error: "Failed to initiate album download",
        message: error.message,
      });
    }
  });

  router.post(
    "/downloads/album/search",
    requireAuth,
    requirePermission("addAlbum"),
    async (req, res) => {
      try {
        const { albumId } = req.body;

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

        const artist = album.artistId ? await libraryManager.getArtistById(album.artistId) : null;
        if (artist) {
          await libraryManager.ensureArtistMonitored(artist);
        }

        if (!album.monitored) {
          await libraryManager.updateAlbum(albumId, { monitored: true });
        }

        await lidarrClient.request("/command", "POST", {
          name: "AlbumSearch",
          albumIds: [parseInt(albumId, 10)],
        });
        if (album.artistId) {
          await libraryManager.ensureRequestedAlbumMonitoring(album.artistId, albumId);
          libraryManager.scheduleRequestedAlbumMonitoringRepair(album.artistId, albumId);
        }
        invalidateAllDownloadStatusesCache();

        const { recordAlbumSearchStarted } =
          await import("../../../services/aurralHistoryService.js");
        recordAlbumSearchStarted({
          albumId,
          albumName: album.albumName,
          artistName: artist?.artistName || album.artistName,
          artistMbid: artist?.mbid || artist?.foreignArtistId,
          user: req.user,
        });

        res.json({
          success: true,
          message: "Album search triggered",
        });
      } catch (error) {
        logger.error("downloads", `Failed to trigger album search ${req.body?.albumId}:`, {
          message: error.message,
        });
        res.status(500).json({
          error: "Failed to trigger album search",
          message: error.message,
        });
      }
    },
  );

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
          progress: item.size ? Math.round((1 - item.sizeleft / item.size) * 100) : 0,
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
        return res.status(400).json({ error: "albumIds query parameter is required" });
      }
      const albumIdArray = Array.isArray(albumIds) ? albumIds : albumIds.split(",");
      const statuses = await getDownloadStatusesForAlbumIds(albumIdArray);
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
      const statuses = await getAllDownloadStatuses();
      res.json(statuses);
    } catch (error) {
      res.status(500).json({
        error: "Failed to fetch download status",
        message: error.message,
      });
    }
  });
}
