import express from "express";
import { UUID_REGEX } from "../config/constants.js";
import { noCache } from "../middleware/cache.js";

const router = express.Router();
const dismissedAlbumIds = new Set();

const toIso = (value) => {
  if (!value) return new Date().toISOString();
  if (typeof value === "string") return value;
  try {
    return new Date(value).toISOString();
  } catch {
    return new Date().toISOString();
  }
};

router.get("/", noCache, async (req, res) => {
  try {
    const { lidarrClient } = await import("../services/lidarrClient.js");

    if (!lidarrClient?.isConfigured()) {
      return res.json([]);
    }

    const [queue, history, artists] = await Promise.all([
      lidarrClient.getQueue().catch(() => []),
      lidarrClient.getHistory(1, 200).catch(() => ({ records: [] })),
      lidarrClient.request("/artist").catch(() => []),
    ]);

    const artistById = new Map(
      (Array.isArray(artists) ? artists : []).map((a) => [
        a.id,
        {
          id: a.id,
          artistName: a.artistName,
          foreignArtistId: a.foreignArtistId || a.mbid || null,
        },
      ]),
    );
    
    const requestsByAlbumId = new Map();

    const queueItems = Array.isArray(queue) ? queue : queue?.records || [];
    for (const item of queueItems) {
      const albumId = item?.albumId ?? item?.album?.id;
      if (albumId == null) continue;

      const artistId = item?.artistId ?? item?.artist?.id ?? item?.album?.artistId;
      const artistInfo = artistId != null ? artistById.get(artistId) : null;

      const albumName = item?.album?.title || item?.title || "Album";
      const artistName =
        item?.artist?.artistName || artistInfo?.artistName || "Artist";
      
      let artistMbid = null;
      
      if (artistId && artistById.has(artistId)) {
        artistMbid = artistById.get(artistId).foreignArtistId || null;
      }
      
      if (!artistMbid) {
        artistMbid = item?.artist?.foreignArtistId || null;
      }
      
      if (!artistMbid && artistInfo) {
        artistMbid = artistInfo.foreignArtistId || null;
      }
      
      if (!artistMbid && artistId) {
        try {
          const { libraryManager } = await import("../services/libraryManager.js");
          const libraryArtist = await libraryManager.getArtistById(artistId);
          if (libraryArtist) {
            artistMbid = libraryArtist.foreignArtistId || libraryArtist.mbid || null;
          }
        } catch {}
      }

      const queueStatus = String(item.status || "").toLowerCase();
      const title = String(item.title || "").toLowerCase();
      const trackedDownloadState = String(item.trackedDownloadState || "").toLowerCase();
      const trackedDownloadStatus = String(item.trackedDownloadStatus || "").toLowerCase();
      const errorMessage = String(item.errorMessage || "").toLowerCase();
      const statusMessages = Array.isArray(item.statusMessages) 
        ? item.statusMessages.map(m => String(m || "").toLowerCase()).join(" ")
        : "";
      
      const isFailed = 
        trackedDownloadState === "importfailed" ||
        trackedDownloadState === "importFailed" ||
        queueStatus.includes("fail") || 
        queueStatus.includes("import fail") ||
        title.includes("import fail") ||
        title.includes("downloaded - import fail") ||
        trackedDownloadState.includes("fail") ||
        trackedDownloadStatus.includes("fail") ||
        trackedDownloadStatus === "warning" ||
        errorMessage.includes("fail") ||
        errorMessage.includes("retrying") ||
        statusMessages.includes("fail") ||
        statusMessages.includes("unmatched");
      
      const status = isFailed ? "processing" : "processing";

      requestsByAlbumId.set(String(albumId), {
        id: `lidarr-queue-${item.id ?? albumId}`,
        type: "album",
        albumId: String(albumId),
        albumMbid: item?.album?.foreignAlbumId || null,
        albumName,
        artistId: artistId != null ? String(artistId) : null,
        artistMbid,
        artistName,
        status,
        requestedAt: toIso(item?.added),
        mbid: artistMbid,
        name: albumName,
        image: null,
        inQueue: true,
      });
    }

    const historyRecords = Array.isArray(history?.records)
      ? history.records
      : Array.isArray(history)
        ? history
        : [];

    for (const record of historyRecords) {
      const albumId = record?.albumId;
      if (albumId == null) continue;

      const existing = requestsByAlbumId.get(String(albumId));
      if (existing) continue;

      const artistId = record?.artistId;
      const artistInfo = artistId != null ? artistById.get(artistId) : null;

      const albumName = record?.album?.title || record?.sourceTitle || "Album";
      const artistName =
        record?.artist?.artistName || artistInfo?.artistName || "Artist";
      
      let artistMbid = null;
      
      if (artistId && artistById.has(artistId)) {
        artistMbid = artistById.get(artistId).foreignArtistId || null;
      }
      
      if (!artistMbid) {
        artistMbid = record?.artist?.foreignArtistId || null;
      }
      
      if (!artistMbid && artistInfo) {
        artistMbid = artistInfo.foreignArtistId || null;
      }
      
      if (!artistMbid && artistId) {
        try {
          const { libraryManager } = await import("../services/libraryManager.js");
          const libraryArtist = await libraryManager.getArtistById(artistId);
          if (libraryArtist) {
            artistMbid = libraryArtist.foreignArtistId || libraryArtist.mbid || null;
          }
        } catch {}
      }

      const eventType = String(record?.eventType || "").toLowerCase();
      const data = record?.data || {};
      const statusMessages = Array.isArray(data?.statusMessages) 
        ? data.statusMessages.map(m => String(m || "").toLowerCase()).join(" ")
        : String(data?.statusMessages?.[0] || "").toLowerCase();
      const errorMessage = String(data?.errorMessage || "").toLowerCase();
      const sourceTitle = String(record?.sourceTitle || "").toLowerCase();
      const dataString = JSON.stringify(data).toLowerCase();
      
      const isFailedImport = 
        eventType === "albumimportincomplete" ||
        eventType.includes("incomplete") ||
        statusMessages.includes("fail") || 
        statusMessages.includes("error") ||
        statusMessages.includes("import fail") ||
        statusMessages.includes("incomplete") ||
        errorMessage.includes("fail") ||
        errorMessage.includes("error") ||
        sourceTitle.includes("import fail") ||
        dataString.includes("import fail");
      
      const isSuccessfulImport = eventType.includes("import") && !isFailedImport && eventType !== "albumimportincomplete";
      const status = isSuccessfulImport ? "available" : "processing";

      requestsByAlbumId.set(String(albumId), {
        id: `lidarr-history-${record.id ?? albumId}`,
        type: "album",
        albumId: String(albumId),
        albumMbid: record?.album?.foreignAlbumId || null,
        albumName,
        artistId: artistId != null ? String(artistId) : null,
        artistMbid,
        artistName,
        status,
        requestedAt: toIso(record?.date),
        mbid: artistMbid,
        name: albumName,
        image: null,
        inQueue: false,
      });
    }

    let sorted = [...requestsByAlbumId.values()].sort(
      (a, b) => new Date(b.requestedAt) - new Date(a.requestedAt),
    );
    sorted = sorted.filter(
      (r) => !r.albumId || !dismissedAlbumIds.has(String(r.albumId)),
    );

    res.json(sorted);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch requests" });
  }
});

router.delete("/album/:albumId", async (req, res) => {
  const { albumId } = req.params;
  if (!albumId) return res.status(400).json({ error: "albumId is required" });

  dismissedAlbumIds.add(String(albumId));

  try {
    const { lidarrClient } = await import("../services/lidarrClient.js");
    if (lidarrClient?.isConfigured()) {
      const queue = await lidarrClient.getQueue().catch(() => []);
      const queueItems = Array.isArray(queue) ? queue : queue?.records || [];
      const targetAlbumId = parseInt(albumId, 10);

      for (const item of queueItems) {
        const match =
          (item?.albumId != null && item.albumId === targetAlbumId) ||
          (item?.album?.id != null && item.album.id === targetAlbumId);
        if (match && item?.id != null) {
          await lidarrClient
            .request(`/queue/${item.id}`, "DELETE")
            .catch(() => null);
        }
      }
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to remove request" });
  }
});

router.delete("/:mbid", async (req, res) => {
  const { mbid } = req.params;
  if (!UUID_REGEX.test(mbid)) {
    return res.status(400).json({ error: "Invalid MBID format" });
  }

  try {
    const { lidarrClient } = await import("../services/lidarrClient.js");
    if (!lidarrClient?.isConfigured()) {
      return res.json({ success: true });
    }

    const artist = await lidarrClient.getArtistByMbid(mbid).catch(() => null);
    if (!artist?.id) {
      return res.json({ success: true });
    }

    const queue = await lidarrClient.getQueue().catch(() => []);
    const queueItems = Array.isArray(queue) ? queue : queue?.records || [];

    for (const item of queueItems) {
      const itemArtistId = item?.artist?.id ?? item?.album?.artistId;
      if (itemArtistId === artist.id && item?.id != null) {
        await lidarrClient
          .request(`/queue/${item.id}`, "DELETE")
          .catch(() => null);
      }
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to remove request" });
  }
});

export default router;
