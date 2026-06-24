import express from "express";
import { UUID_REGEX } from "../config/constants.js";
import { noCache } from "../middleware/cache.js";
import {
  requireAuth,
  requirePermission,
} from "../middleware/requirePermission.js";
import { invalidateAllDownloadStatusesCache } from "./library/handlers/downloads.js";
import { buildLidarrRequests } from "../services/lidarrRequestBuilder.js";

const router = express.Router();
const dismissedAlbumIds = new Map();
const DISMISSED_ALBUM_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DISMISSED_ALBUMS = 1000;
const REQUESTS_CACHE_MS = 15000;
const REQUESTS_STALE_MS = 5 * 60 * 1000;
let lastRequestsResponse = null;
let lastRequestsAt = 0;
let pendingRequestsRefresh = null;

const pruneDismissedAlbumIds = () => {
  const now = Date.now();
  for (const [albumId, dismissedAt] of dismissedAlbumIds.entries()) {
    if (now - dismissedAt > DISMISSED_ALBUM_TTL_MS) {
      dismissedAlbumIds.delete(albumId);
    }
  }
  if (dismissedAlbumIds.size <= MAX_DISMISSED_ALBUMS) {
    return;
  }
  const entries = Array.from(dismissedAlbumIds.entries()).sort(
    (a, b) => a[1] - b[1],
  );
  const removeCount = dismissedAlbumIds.size - MAX_DISMISSED_ALBUMS;
  for (let i = 0; i < removeCount; i++) {
    dismissedAlbumIds.delete(entries[i][0]);
  }
};

const filterDismissedRequests = (requests) =>
  Array.isArray(requests)
    ? requests.filter(
        (r) => !r.albumId || !dismissedAlbumIds.has(String(r.albumId)),
      )
    : [];

const updateRequestsCache = (requests) => {
  lastRequestsResponse = filterDismissedRequests(requests);
  lastRequestsAt = Date.now();
  return lastRequestsResponse;
};

const removeAlbumFromRequestsCache = (albumId) => {
  if (!lastRequestsResponse) return;
  const normalizedAlbumId = String(albumId);
  lastRequestsResponse = lastRequestsResponse.filter(
    (request) => String(request?.albumId) !== normalizedAlbumId,
  );
  lastRequestsAt = Date.now();
};

const refreshRequestsCache = async (lidarrClient) => {
  if (pendingRequestsRefresh) {
    return pendingRequestsRefresh;
  }

  pendingRequestsRefresh = buildRequestsResponse(lidarrClient)
    .then(updateRequestsCache)
    .finally(() => {
      pendingRequestsRefresh = null;
    });

  return pendingRequestsRefresh;
};

const filterRedundantAurralRequests = (aurralRequests, lidarrRequests) => {
  const lidarrAlbumIds = new Set(
    lidarrRequests
      .map((request) => request.albumId)
      .filter(Boolean)
      .map((albumId) => String(albumId)),
  );
  if (!lidarrAlbumIds.size) return aurralRequests;
  return aurralRequests.filter((request) => {
    if (request.kind !== "album_requested") return true;
    if (!request.albumId) return true;
    return !lidarrAlbumIds.has(String(request.albumId));
  });
};


const buildAurralRequests = async (lidarrClient = null) => {
  const { getAurralHistoryRequests } = await import(
    "../services/aurralHistoryService.js"
  );
  return getAurralHistoryRequests(lidarrClient);
};

const buildRequestsResponse = async (lidarrClient) => {
  const [lidarrRequests, aurralRequests] = await Promise.all([
    lidarrClient?.isConfigured()
      ? buildLidarrRequests(lidarrClient)
      : Promise.resolve([]),
    buildAurralRequests(lidarrClient),
  ]);
  const filteredAurral = filterRedundantAurralRequests(
    aurralRequests,
    lidarrRequests,
  );
  return [...lidarrRequests, ...filteredAurral].sort(
    (a, b) => new Date(b.requestedAt) - new Date(a.requestedAt),
  );
};

router.get("/", requireAuth, noCache, async (req, res) => {
  try {
    pruneDismissedAlbumIds();
    const { lidarrClient } = await import("../services/lidarrClient.js");

    if (!lidarrClient?.isConfigured()) {
      const aurralOnly = await buildAurralRequests();
      lastRequestsResponse = aurralOnly;
      lastRequestsAt = Date.now();
      return res.json(aurralOnly);
    }

    const now = Date.now();
    const cacheAge = now - lastRequestsAt;
    if (lastRequestsResponse && cacheAge < REQUESTS_CACHE_MS) {
      return res.json(filterDismissedRequests(lastRequestsResponse));
    }

    if (lastRequestsResponse && cacheAge < REQUESTS_STALE_MS) {
      refreshRequestsCache(lidarrClient).catch(() => null);
      return res.json(filterDismissedRequests(lastRequestsResponse));
    }

    const requests = await refreshRequestsCache(lidarrClient);
    res.json(requests);
  } catch (error) {
    if (lastRequestsResponse) {
      return res.json(filterDismissedRequests(lastRequestsResponse));
    }
    res.status(500).json({ error: "Failed to fetch requests" });
  }
});

router.delete(
  "/album/:albumId",
  requireAuth,
  requirePermission("deleteAlbum"),
  async (req, res) => {
  const { albumId } = req.params;
  if (!albumId) return res.status(400).json({ error: "albumId is required" });

  dismissedAlbumIds.set(String(albumId), Date.now());
  pruneDismissedAlbumIds();
  removeAlbumFromRequestsCache(albumId);

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
    invalidateAllDownloadStatusesCache();

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to remove request" });
  }
  },
);

router.delete(
  "/:mbid",
  requireAuth,
  requirePermission("deleteArtist"),
  async (req, res) => {
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
    invalidateAllDownloadStatusesCache();

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to remove request" });
  }
  },
);

export default router;
