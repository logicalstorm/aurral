import express from "express";
import { UUID_REGEX } from "../config/constants.js";

const router = express.Router();

const toIso = (value) => {
  if (!value) return new Date().toISOString();
  if (typeof value === "string") return value;
  try {
    return new Date(value).toISOString();
  } catch {
    return new Date().toISOString();
  }
};

router.get("/", async (req, res) => {
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
          foreignArtistId: a.foreignArtistId,
        },
      ]),
    );

    const requestsByAlbumId = new Map();

    const queueItems = Array.isArray(queue) ? queue : queue?.records || [];
    for (const item of queueItems) {
      const albumId = item?.album?.id;
      if (albumId == null) continue;

      const artistId = item?.artist?.id ?? item?.album?.artistId;
      const artistInfo = artistId != null ? artistById.get(artistId) : null;

      const albumName = item?.album?.title || item?.title || "Album";
      const artistName =
        item?.artist?.artistName || artistInfo?.artistName || "Artist";
      const artistMbid =
        item?.artist?.foreignArtistId || artistInfo?.foreignArtistId || null;

      requestsByAlbumId.set(String(albumId), {
        id: `lidarr-queue-${item.id ?? albumId}`,
        type: "album",
        albumId: String(albumId),
        albumMbid: item?.album?.foreignAlbumId || null,
        albumName,
        artistId: artistId != null ? String(artistId) : null,
        artistMbid,
        artistName,
        status: "processing",
        requestedAt: toIso(item?.added),
        mbid: artistMbid,
        name: albumName,
        image: null,
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
      const artistMbid =
        record?.artist?.foreignArtistId || artistInfo?.foreignArtistId || null;

      const eventType = String(record?.eventType || "").toLowerCase();
      const status = eventType.includes("import") ? "available" : "processing";

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
      });
    }

    const sorted = [...requestsByAlbumId.values()].sort(
      (a, b) => new Date(b.requestedAt) - new Date(a.requestedAt),
    );

    res.json(sorted);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch requests" });
  }
});

router.delete("/album/:albumId", async (req, res) => {
  const { albumId } = req.params;
  if (!albumId) return res.status(400).json({ error: "albumId is required" });

  try {
    const { lidarrClient } = await import("../services/lidarrClient.js");
    if (lidarrClient?.isConfigured()) {
      const queue = await lidarrClient.getQueue().catch(() => []);
      const queueItems = Array.isArray(queue) ? queue : queue?.records || [];
      const targetAlbumId = parseInt(albumId, 10);

      for (const item of queueItems) {
        if (item?.album?.id === targetAlbumId && item?.id != null) {
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
