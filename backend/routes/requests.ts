import { Router, Request, Response } from 'express';
import { UUID_REGEX } from '../config/constants.js';
import { noCache } from '../middleware/cache.js';
import { requireAuth, requirePermission } from '../middleware/requirePermission.js';
import { invalidateAllDownloadStatusesCache } from './library/handlers/downloads.js';

const router = Router();
const dismissedAlbumIds = new Map<string, number>();
const DISMISSED_ALBUM_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DISMISSED_ALBUMS = 1000;
const REQUESTS_CACHE_MS = 15000;
const REQUESTS_STALE_MS = 5 * 60 * 1000;
const STALE_GRABBED_MS = 15 * 60 * 1000;
let lastRequestsResponse: unknown[] | null = null;
let lastRequestsAt = 0;
let pendingRequestsRefresh: Promise<unknown> | null = null;

type AnyRecord = Record<string, unknown>;

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
  const entries = Array.from(dismissedAlbumIds.entries()).sort((a, b) => a[1] - b[1]);
  const removeCount = dismissedAlbumIds.size - MAX_DISMISSED_ALBUMS;
  for (let i = 0; i < removeCount; i++) {
    dismissedAlbumIds.delete(entries[i][0]);
  }
};

const toIso = (value: unknown): string => {
  if (!value) return new Date().toISOString();
  if (typeof value === 'string') return value;
  try {
    return new Date(value as string | number | Date).toISOString();
  } catch {
    return new Date().toISOString();
  }
};

const filterDismissedRequests = (requests: unknown[]): unknown[] =>
  Array.isArray(requests)
    ? requests.filter((r) => !(r as AnyRecord).albumId || !dismissedAlbumIds.has(String((r as AnyRecord).albumId)))
    : [];

const updateRequestsCache = (requests: unknown[]) => {
  lastRequestsResponse = filterDismissedRequests(requests);
  lastRequestsAt = Date.now();
  return lastRequestsResponse;
};

const removeAlbumFromRequestsCache = (albumId: unknown) => {
  if (!lastRequestsResponse) return;
  const normalizedAlbumId = String(albumId);
  lastRequestsResponse = lastRequestsResponse.filter(
    (request) => String((request as AnyRecord)?.albumId) !== normalizedAlbumId,
  );
  lastRequestsAt = Date.now();
};

const refreshRequestsCache = async (lidarrClient: unknown) => {
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

const filterRedundantAurralRequests = (aurralRequests: unknown[], lidarrRequests: unknown[]) => {
  const lidarrAlbumIds = new Set(
    lidarrRequests
      .map((request) => (request as AnyRecord).albumId)
      .filter(Boolean)
      .map((albumId) => String(albumId as string)),
  );
  if (!lidarrAlbumIds.size) return aurralRequests;
  return aurralRequests.filter((request) => {
    const r = request as AnyRecord;
    if (r.kind !== 'album_requested') return true;
    if (!r.albumId) return true;
    return !lidarrAlbumIds.has(String(r.albumId));
  });
};

const buildLidarrRequests = async (lidarrClient: unknown) => {
  const client = lidarrClient as AnyRecord;
  const [queue, history] = await Promise.all([
    ((client as AnyRecord).getQueue as () => Promise<unknown>)().catch(() => []),
    ((client as AnyRecord).getHistory as (page: number, size: number) => Promise<unknown>)(1, 200).catch(() => ({ records: [] })),
  ]);

  const requestsByAlbumId = new Map<string, AnyRecord>();

  const queueItems = Array.isArray(queue) ? queue : (queue as AnyRecord)?.records as unknown[] || [];
  const queueByAlbumId = new Map<string, unknown>();
  for (const item of queueItems) {
    const i = item as AnyRecord;
    const albumId = i?.albumId ?? (i?.album as AnyRecord)?.id;
    if (albumId == null) continue;
    queueByAlbumId.set(String(albumId), item);
  }

  for (const item of queueItems) {
    const i = item as AnyRecord;
    const albumId = i?.albumId ?? (i?.album as AnyRecord)?.id;
    if (albumId == null) continue;

    const albumName = (i?.album as AnyRecord)?.title || i?.title || 'Album';
    const artistName = (i?.artist as AnyRecord)?.artistName || 'Artist';

    let artistMbid: string | null = null;

    artistMbid = ((i.artist as AnyRecord)?.foreignArtistId as string | undefined) || null;

    const queueStatus = String(i.status || '').toLowerCase();
    const title = String(i.title || '').toLowerCase();
    const trackedDownloadState = String(i.trackedDownloadState || '').toLowerCase();
    const trackedDownloadStatus = String(i.trackedDownloadStatus || '').toLowerCase();
    const errorMessage = String(i.errorMessage || '').toLowerCase();
    const statusMessages = Array.isArray(i.statusMessages)
      ? (i.statusMessages as unknown[]).map((m: unknown) => String(m || '').toLowerCase()).join(' ')
      : '';

    const isFailed =
      trackedDownloadState === 'importfailed' ||
      trackedDownloadState === 'importFailed' ||
      queueStatus.includes('fail') ||
      queueStatus.includes('import fail') ||
      title.includes('import fail') ||
      title.includes('downloaded - import fail') ||
      trackedDownloadState.includes('fail') ||
      trackedDownloadStatus.includes('fail') ||
      trackedDownloadStatus === 'warning' ||
      errorMessage.includes('fail') ||
      errorMessage.includes('retrying') ||
      statusMessages.includes('fail') ||
      statusMessages.includes('unmatched');

    const status = isFailed ? 'failed' : 'processing';

    requestsByAlbumId.set(String(albumId), {
      id: `lidarr-queue-${i.id ?? albumId}`,
      source: 'lidarr',
      type: 'album',
      albumId: String(albumId),
      albumMbid: (i?.album as AnyRecord)?.foreignAlbumId || null,
      albumName,
      artistId: (i?.artist as AnyRecord)?.id != null ? String((i.artist as AnyRecord).id) : null,
      artistMbid,
      artistName,
      status,
      statusLabel: isFailed ? 'Failed' : 'Downloading',
      requestedAt: toIso(i?.added),
      mbid: artistMbid,
      name: albumName,
      image: null,
      inQueue: true,
      canReSearch: isFailed,
    });
  }

  const h = history as AnyRecord;
  const historyRecords = Array.isArray(h?.records)
    ? h.records
    : Array.isArray(history)
      ? history
      : [];

  const latestHistoryByAlbum = new Map<string, { record: unknown; recordTime: number }>();
  for (const record of historyRecords) {
    const r = record as AnyRecord;
    const albumId = r?.albumId;
    if (albumId == null) continue;
    const recordTime = new Date((r.date || r.eventDate || 0) as string | number | Date).getTime();
    const existing = latestHistoryByAlbum.get(String(albumId));
    if (!existing || recordTime > existing.recordTime) {
      latestHistoryByAlbum.set(String(albumId), {
        record,
        recordTime,
      });
    }
  }

  for (const [albumId, { record, recordTime }] of latestHistoryByAlbum) {
    const existing = requestsByAlbumId.get(String(albumId));
    if (existing) continue;

    const r = record as AnyRecord;
    const albumName = (r?.album as AnyRecord)?.title || r?.sourceTitle || 'Album';
    const artistName = (r?.artist as AnyRecord)?.artistName || 'Artist';

    let artistMbid: string | null = null;

    artistMbid = ((r.artist as AnyRecord)?.foreignArtistId as string | undefined) || null;

    const eventType = String(r?.eventType || '').toLowerCase();
    const data = r?.data || {};
    const dataRecord = data as AnyRecord;
    const statusMessages = Array.isArray(dataRecord?.statusMessages)
      ? (dataRecord.statusMessages as unknown[]).map((m: unknown) => String(m || '').toLowerCase()).join(' ')
      : String((dataRecord?.statusMessages as unknown[])?.[0] || '').toLowerCase();
    const errorMessage = String(dataRecord?.errorMessage || '').toLowerCase();
    const sourceTitle = String(r?.sourceTitle || '').toLowerCase();
    const dataString = JSON.stringify(data).toLowerCase();
    const hasQueue = queueByAlbumId.has(String(albumId));
    const isGrabbed =
      eventType.includes('grabbed') ||
      sourceTitle.includes('grabbed') ||
      dataString.includes('grabbed');
    const isFailedDownload =
      eventType.includes('fail') ||
      statusMessages.includes('fail') ||
      statusMessages.includes('error') ||
      errorMessage.includes('fail') ||
      errorMessage.includes('error') ||
      sourceTitle.includes('fail') ||
      dataString.includes('fail');

    const isFailedImport =
      eventType === 'albumimportincomplete' ||
      eventType.includes('incomplete') ||
      statusMessages.includes('fail') ||
      statusMessages.includes('error') ||
      statusMessages.includes('import fail') ||
      statusMessages.includes('incomplete') ||
      errorMessage.includes('fail') ||
      errorMessage.includes('error') ||
      sourceTitle.includes('import fail') ||
      dataString.includes('import fail');

    const isSuccessfulImport =
      eventType.includes('import') && !isFailedImport && eventType !== 'albumimportincomplete';
    const isStaleGrabbed = isGrabbed && !hasQueue && Date.now() - recordTime > STALE_GRABBED_MS;
    const isActive = hasQueue || (isGrabbed && !isStaleGrabbed);
    if (!isActive && !isSuccessfulImport) {
      if (!(isFailedImport || isFailedDownload || isStaleGrabbed)) {
        continue;
      }
    }
    const status = hasQueue
      ? 'processing'
      : isSuccessfulImport
        ? 'available'
        : isFailedImport || isFailedDownload || isStaleGrabbed
          ? 'failed'
          : 'processing';
    const statusLabel =
      status === 'available'
        ? 'Complete'
        : status === 'failed'
          ? 'Failed'
          : isGrabbed
            ? 'Downloading'
            : 'In progress';

    requestsByAlbumId.set(String(albumId), {
      id: `lidarr-history-${r.id ?? albumId}`,
      source: 'lidarr',
      type: 'album',
      albumId: String(albumId),
      albumMbid: (r?.album as AnyRecord)?.foreignAlbumId || null,
      albumName,
      artistId: r?.artistId != null ? String(r.artistId) : null,
      artistMbid,
      artistName,
      status,
      statusLabel,
      requestedAt: toIso(r?.date || r?.eventDate),
      mbid: artistMbid,
      name: albumName,
      image: null,
      inQueue: false,
      canReSearch: status === 'failed',
    });
  }

  let sorted = [...requestsByAlbumId.values()].sort(
    (a, b) => new Date((b as AnyRecord).requestedAt as string).getTime() - new Date((a as AnyRecord).requestedAt as string).getTime(),
  );

  const isPlaceholder = (value: unknown, fallback: unknown): boolean => {
    if (!value) return true;
    const normalized = String(value).trim().toLowerCase();
    return normalized === String(fallback).trim().toLowerCase();
  };

  const missingAlbumIds = new Set<string>();
  const missingArtistIds = new Set<string>();

  for (const request of sorted) {
    const r = request as AnyRecord;
    if (r.albumId) {
      if (!r.albumMbid || isPlaceholder(r.albumName, 'Album') || !r.artistId) {
        missingAlbumIds.add(String(r.albumId));
      }
    }
    if (r.artistId) {
      if (!r.artistMbid || isPlaceholder(r.artistName, 'Artist')) {
        missingArtistIds.add(String(r.artistId));
      }
    }
  }

  const albumDetailsById = new Map<string, unknown>();
  const artistDetailsById = new Map<string, unknown>();

  if (missingAlbumIds.size > 0) {
    const albumIds = Array.from(missingAlbumIds);
    const getAlbum = (client as AnyRecord).getAlbum as (id: string) => Promise<unknown>;
    const albums = await Promise.all(
      albumIds.map((id) => getAlbum(id).catch(() => null)),
    );
    for (let i = 0; i < albumIds.length; i++) {
      if (albums[i]) {
        albumDetailsById.set(String(albumIds[i]), albums[i]);
        if ((albums[i] as AnyRecord)?.artistId != null) {
          missingArtistIds.add(String((albums[i] as AnyRecord).artistId));
        }
      }
    }
  }

  if (missingArtistIds.size > 0) {
    const artistIds = Array.from(missingArtistIds);
    const getArtist = (client as AnyRecord).getArtist as (id: string) => Promise<unknown>;
    const artists = await Promise.all(
      artistIds.map((id) => getArtist(id).catch(() => null)),
    );
    for (let i = 0; i < artistIds.length; i++) {
      if (artists[i]) {
        artistDetailsById.set(String(artistIds[i]), artists[i]);
      }
    }
  }

  if (albumDetailsById.size > 0 || artistDetailsById.size > 0) {
    sorted = sorted.map((request) => {
      const enriched = { ...(request as AnyRecord) };
      if (enriched.albumId && albumDetailsById.has(String(enriched.albumId))) {
        const album = albumDetailsById.get(String(enriched.albumId)) as AnyRecord;
        if (album) {
          if (!enriched.albumMbid && album.foreignAlbumId) {
            enriched.albumMbid = album.foreignAlbumId;
          }
          if (isPlaceholder(enriched.albumName, 'Album') && album.title) {
            enriched.albumName = album.title;
            enriched.name = album.title;
          }
          if (!enriched.artistId && album.artistId != null) {
            enriched.artistId = String(album.artistId);
          }
        }
      }
      if (enriched.artistId && artistDetailsById.has(String(enriched.artistId))) {
        const artist = artistDetailsById.get(String(enriched.artistId)) as AnyRecord;
        if (artist) {
          if (isPlaceholder(enriched.artistName, 'Artist') && artist.artistName) {
            enriched.artistName = artist.artistName;
          }
          if (!enriched.artistMbid && artist.foreignArtistId) {
            enriched.artistMbid = artist.foreignArtistId;
            enriched.mbid = artist.foreignArtistId;
          }
        }
      }
      return enriched;
    });
  }

  return filterDismissedRequests(sorted);
};

const buildAurralRequests = async (lidarrClient: unknown = null) => {
  const { getAurralHistoryRequests } = await import('../services/aurralHistoryService.js');
  return getAurralHistoryRequests(lidarrClient);
};

const buildRequestsResponse = async (lidarrClient: unknown) => {
  const client = lidarrClient as AnyRecord;
  const [lidarrRequests, aurralRequests] = await Promise.all([
    client?.isConfigured ? (client.isConfigured as () => boolean)() ? buildLidarrRequests(lidarrClient) : Promise.resolve([]) : Promise.resolve([]),
    buildAurralRequests(lidarrClient),
  ]);
  const filteredAurral = filterRedundantAurralRequests(aurralRequests as unknown[], lidarrRequests as unknown[]);
  return [...(lidarrRequests as unknown[]), ...(filteredAurral as unknown[])].sort(
    (a, b) => new Date((a as AnyRecord).requestedAt as string).getTime() - new Date((b as AnyRecord).requestedAt as string).getTime(),
  );
};

router.get('/', requireAuth, noCache, async (_req: Request, res: Response) => {
  try {
    pruneDismissedAlbumIds();
    const { lidarrClient } = await import('../services/lidarrClient.js');

    if (!lidarrClient?.isConfigured()) {
      const aurralOnly = await buildAurralRequests();
      lastRequestsResponse = aurralOnly as unknown[];
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
  } catch {
    if (lastRequestsResponse) {
      return res.json(filterDismissedRequests(lastRequestsResponse));
    }
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

router.delete(
  '/album/:albumId',
  requireAuth,
  requirePermission('deleteAlbum'),
  async (req: Request, res: Response) => {
    const albumId = req.params.albumId as string;
    if (!albumId) return res.status(400).json({ error: 'albumId is required' });

    dismissedAlbumIds.set(String(albumId), Date.now());
    pruneDismissedAlbumIds();
    removeAlbumFromRequestsCache(albumId);

    try {
      const { lidarrClient } = await import('../services/lidarrClient.js');
      if (lidarrClient?.isConfigured()) {
        const queue = await lidarrClient.getQueue().catch(() => []);
        const queueItems = Array.isArray(queue) ? queue : (queue as AnyRecord)?.records as unknown[] || [];
        const targetAlbumId = parseInt(albumId, 10);

        for (const item of queueItems) {
          const i = item as AnyRecord;
          const match =
            (i?.albumId != null && i.albumId === targetAlbumId) ||
            ((i.album as AnyRecord)?.id != null && (i.album as AnyRecord).id === targetAlbumId);
          if (match && i?.id != null) {
            await lidarrClient.request(`/queue/${i.id}`, 'DELETE').catch(() => null);
          }
        }
      }
      invalidateAllDownloadStatusesCache();

      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Failed to remove request' });
    }
  },
);

router.delete('/:mbid', requireAuth, requirePermission('deleteArtist'), async (req: Request, res: Response) => {
  const mbid = req.params.mbid as string;
  if (!UUID_REGEX.test(mbid)) {
    return res.status(400).json({ error: 'Invalid MBID format' });
  }

  try {
    const { lidarrClient } = await import('../services/lidarrClient.js');
    if (!lidarrClient?.isConfigured()) {
      return res.json({ success: true });
    }

    const artist = await (lidarrClient as any).getArtistByMbid(mbid).catch(() => null) as AnyRecord | null;
    if (!artist?.id) {
      return res.json({ success: true });
    }

    const queue = await lidarrClient.getQueue().catch(() => []);
    const queueItems = Array.isArray(queue) ? queue : (queue as AnyRecord)?.records as unknown[] || [];

    for (const item of queueItems) {
      const i = item as AnyRecord;
      const itemArtistId = (i.artist as AnyRecord)?.id ?? (i.album as AnyRecord)?.artistId;
      if (itemArtistId === artist.id && i?.id != null) {
        await lidarrClient.request(`/queue/${i.id}`, 'DELETE').catch(() => null);
      }
    }
    invalidateAllDownloadStatusesCache();

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to remove request' });
  }
});

export default router;
