import { Router, Request, Response } from 'express';
import { libraryManager } from '../../../services/libraryManager.js';
import { dbOps } from '../../../config/db-helpers.js';
import { noCache } from '../../../middleware/cache.js';
import { requireAuth, requirePermission } from '../../../middleware/requirePermission.js';
import { hasPermission } from '../../../middleware/auth.js';
import {
  parseLidarrSearchContext,
  resolveAlbumSearchOutcome,
} from '../../../services/albumSearchState.js';

const STALE_GRABBED_MS = 15 * 60 * 1000;
const DOWNLOAD_STATUS_CACHE_MS = 5000;
const allDownloadStatusesCache: {
  at: number;
  statuses: Record<string, Record<string, unknown>> | null;
  pending: Promise<Record<string, Record<string, unknown>>> | null;
} = {
  at: 0,
  statuses: null,
  pending: null,
};

export const getDownloadStatusesForAlbumIds = async (
  albumIdArrayInput: string[] | string,
): Promise<Record<string, Record<string, unknown>>> => {
  const albumIdArray = Array.isArray(albumIdArrayInput) ? albumIdArrayInput : [];
  const statuses: Record<string, Record<string, unknown>> = {};
  const { lidarrClient } = await import('../../../services/lidarrClient.js');

  if (lidarrClient.isConfigured()) {
    try {
      const results = await Promise.all([
        lidarrClient.getQueue(),
        lidarrClient.getHistory(1, 200),
        lidarrClient.request('/command').catch(() => []),
      ]);
      const queue = results[0];
      const history = results[1];
      const commands = results[2];

      const rawQueueItems: unknown =
        Array.isArray(queue) ? queue : (queue as Record<string, unknown>)?.records || [];
      const rawHistoryItems: unknown =
        Array.isArray(history) ? history : (history as Record<string, unknown>)?.records || [];
      const queueItems = Array.isArray(rawQueueItems) ? rawQueueItems : [];
      const historyItems = Array.isArray(rawHistoryItems) ? rawHistoryItems : [];

      const searchContext = parseLidarrSearchContext({
        queue,
        history,
        commands,
      });
      const { searchingAlbumIds } = searchContext;

      const latestHistoryByAlbumId = new Map<number, { history: Record<string, unknown>; historyTime: number }>();
      for (const rawH of historyItems) {
        const h = rawH as Record<string, unknown>;
        if (h.albumId == null) continue;
        const historyTime = new Date((h.date || h.eventDate || 0) as string | number).getTime();
        const existing = latestHistoryByAlbumId.get(h.albumId as number);
        if (!existing || historyTime > existing.historyTime) {
          latestHistoryByAlbumId.set(h.albumId as number, {
            history: h,
            historyTime,
          });
        }
      }

      for (const albumId of albumIdArray) {
        if (!albumId || albumId === 'undefined' || albumId === 'null') continue;
        const lidarrAlbumId = parseInt(albumId, 10);
        if (isNaN(lidarrAlbumId)) continue;

        const rawQueueItem = queueItems.find((q: Record<string, unknown>) => {
          const qAlbumId = q.albumId ?? (q.album as Record<string, unknown>)?.id;
          return qAlbumId != null && qAlbumId === lidarrAlbumId;
        });
        const queueItem = rawQueueItem as Record<string, unknown> | undefined;

        if (queueItem) {
          const queueStatus = String(queueItem.status || '').toLowerCase();
          const title = String(queueItem.title || '').toLowerCase();
          const trackedDownloadState = String(queueItem.trackedDownloadState || '').toLowerCase();
          const trackedDownloadStatus = String(queueItem.trackedDownloadStatus || '').toLowerCase();
          const errorMessage = String(queueItem.errorMessage || '').toLowerCase();
          const statusMessages = Array.isArray(queueItem.statusMessages)
            ? (queueItem.statusMessages as unknown[]).map((m: unknown) => String(m || '').toLowerCase()).join(' ')
            : '';

          const size = Number(queueItem.size || 0);
          const sizeLeft = Number(queueItem.sizeleft || 0);
          const hasActiveDownload = size > 0 && sizeLeft < size;
          const isDownloadingState =
            hasActiveDownload ||
            queueStatus.includes('downloading') ||
            queueStatus.includes('queued') ||
            queueStatus.includes('processing');
          const isExplicitFailure =
            trackedDownloadState === 'importfailed' ||
            trackedDownloadState === 'importFailed' ||
            trackedDownloadState.includes('importfailed') ||
            queueStatus.includes('failed') ||
            queueStatus.includes('import fail') ||
            title.includes('import fail') ||
            trackedDownloadState.includes('fail') ||
            trackedDownloadStatus.includes('fail') ||
            (trackedDownloadStatus === 'warning' && !isDownloadingState) ||
            errorMessage.includes('fail') ||
            errorMessage.includes('retrying') ||
            statusMessages.includes('unmatched');

          if (isDownloadingState) {
            const progress = size ? Math.round((1 - sizeLeft / size) * 100) : 0;
            statuses[albumId] = {
              status: 'downloading',
              progress: progress,
              updatedAt: new Date().toISOString(),
            };
          } else if (isExplicitFailure) {
            statuses[albumId] = {
              status: 'failed',
              updatedAt: new Date().toISOString(),
            };
          } else {
            const progress = size ? Math.round((1 - sizeLeft / size) * 100) : 0;
            statuses[albumId] = {
              status: 'downloading',
              progress: progress,
              updatedAt: new Date().toISOString(),
            };
          }
          continue;
        }

        if (searchingAlbumIds.has(lidarrAlbumId)) {
          statuses[albumId] = {
            status: 'searching',
            updatedAt: new Date().toISOString(),
          };
          continue;
        }

        const historyEntry = latestHistoryByAlbumId.get(lidarrAlbumId);
        const recentHistory = historyEntry?.history;
        const historyTime = historyEntry?.historyTime ?? 0;

        if (recentHistory) {
          const eventType = String(recentHistory.eventType || '').toLowerCase();
          const data = (recentHistory.data || {}) as Record<string, unknown>;
          const statusMessages = Array.isArray(data.statusMessages)
            ? (data.statusMessages as unknown[]).map((m: unknown) => String(m || '').toLowerCase()).join(' ')
            : String((data.statusMessages as unknown[])?.[0] || '').toLowerCase();
          const errorMessage = String(data.errorMessage || '').toLowerCase();
          const sourceTitle = String(recentHistory.sourceTitle || '').toLowerCase();
          const dataString = JSON.stringify(data).toLowerCase();
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
            statusMessages.includes('incomplete') ||
            errorMessage.includes('fail') ||
            errorMessage.includes('error');
          const isComplete =
            eventType.includes('import') &&
            !isFailedImport &&
            eventType !== 'albumimportincomplete';
          const isStaleGrabbed = isGrabbed && Date.now() - historyTime > STALE_GRABBED_MS;
          statuses[albumId] = {
            status: isComplete
              ? 'added'
              : isFailedImport || isFailedDownload || isStaleGrabbed
                ? 'failed'
                : 'processing',
            updatedAt: new Date().toISOString(),
          };
          continue;
        }

        const searchOutcome = resolveAlbumSearchOutcome(lidarrAlbumId, searchContext);
        if (searchOutcome?.status === 'failed') {
          statuses[albumId] = {
            status: 'failed',
            updatedAt: new Date().toISOString(),
          };
        } else if (searchOutcome?.status === 'searching') {
          statuses[albumId] = {
            status: 'searching',
            updatedAt: new Date().toISOString(),
          };
        }
      }
    } catch (error) {
      console.warn('Failed to fetch Lidarr status:', (error as Error).message);
    }
  }

  return statuses;
};

const computeAllDownloadStatuses =
  async (): Promise<Record<string, Record<string, unknown>>> => {
    const allStatuses: Record<string, Record<string, unknown>> = {};
    const { lidarrClient } = await import('../../../services/lidarrClient.js');

    if (lidarrClient.isConfigured()) {
      try {
        const results = await Promise.all([
          lidarrClient.getQueue(),
          lidarrClient.getHistory(1, 200),
          lidarrClient.request('/album'),
          lidarrClient.request('/command').catch(() => []),
        ]);
        const queue = results[0];
        const history = results[1];
        const albums = results[2];
        const commands = results[3];

        const rawQueueItems: unknown =
          Array.isArray(queue) ? queue : (queue as Record<string, unknown>)?.records || [];
        const rawHistoryItems: unknown =
          Array.isArray(history) ? history : (history as Record<string, unknown>)?.records || [];
        const queueItems = Array.isArray(rawQueueItems) ? rawQueueItems : [];
        const historyItems = Array.isArray(rawHistoryItems) ? rawHistoryItems : [];

        const allAlbums: unknown[] = Array.isArray(albums) ? albums : [];
        const rawCommandItems: unknown =
          Array.isArray(commands) ? commands : (commands as Record<string, unknown>)?.records || [];
        const commandItems = Array.isArray(rawCommandItems) ? rawCommandItems : [];

        const searchingAlbumIds = new Set<number>();
        for (const rawCommand of commandItems) {
          const command = rawCommand as Record<string, unknown>;
          const name = String(command.name || command.commandName || '')
            .toLowerCase()
            .trim();
          if (!name.includes('albumsearch')) continue;
          const status = String(command.status || '')
            .toLowerCase()
            .trim();
          if (
            status === 'completed' ||
            status === 'failed' ||
            status === 'aborted' ||
            status === 'canceled' ||
            status === 'cancelled'
          ) {
            continue;
          }
          const albumIds = Array.isArray((command.body as Record<string, unknown>)?.albumIds)
            ? (command.body as Record<string, unknown>).albumIds
            : Array.isArray(command.albumIds)
              ? command.albumIds
              : [];
          for (const id of albumIds as unknown[]) {
            if (id != null) searchingAlbumIds.add(id as number);
          }
        }

        const queueByAlbumId = new Map<unknown, Record<string, unknown>>();
        for (const rawQ of queueItems) {
          const q = rawQ as Record<string, unknown>;
          const qAlbumId = q.albumId ?? (q.album as Record<string, unknown>)?.id;
          if (qAlbumId == null) continue;
          queueByAlbumId.set(qAlbumId, q);
        }

        const historyByAlbumId = new Map<
          unknown,
          { history: Record<string, unknown>; historyTime: number }
        >();
        for (const rawH of historyItems) {
          const h = rawH as Record<string, unknown>;
          if (h.albumId == null) continue;
          const historyTime = new Date(
            (h.date || h.eventDate || 0) as string | number,
          ).getTime();
          const existing = historyByAlbumId.get(h.albumId);
          if (!existing || historyTime > existing.historyTime) {
            historyByAlbumId.set(h.albumId, {
              history: h,
              historyTime,
            });
          }
        }

        for (const rawAlbum of allAlbums) {
          const album = rawAlbum as Record<string, unknown>;
          const lidarrAlbumId = album.id;
          if (lidarrAlbumId == null) continue;
          const queueItem = queueByAlbumId.get(lidarrAlbumId);

          if (queueItem) {
            const queueStatus = String(queueItem.status || '').toLowerCase();
            const title = String(queueItem.title || '').toLowerCase();
            const trackedDownloadState = String(
              queueItem.trackedDownloadState || '',
            ).toLowerCase();
            const trackedDownloadStatus = String(
              queueItem.trackedDownloadStatus || '',
            ).toLowerCase();
            const errorMessage = String(queueItem.errorMessage || '').toLowerCase();
            const statusMessages = Array.isArray(queueItem.statusMessages)
              ? (queueItem.statusMessages as unknown[])
                  .map((m: unknown) => String(m || '').toLowerCase())
                  .join(' ')
              : '';

            const size = Number(queueItem.size || 0);
            const sizeLeft = Number(queueItem.sizeleft || 0);
            const hasActiveDownload = size > 0 && sizeLeft < size;
            const isDownloadingState =
              hasActiveDownload ||
              queueStatus.includes('downloading') ||
              queueStatus.includes('queued') ||
              queueStatus.includes('processing');
            const isExplicitFailure =
              trackedDownloadState === 'importfailed' ||
              trackedDownloadState === 'importFailed' ||
              trackedDownloadState.includes('importfailed') ||
              queueStatus.includes('failed') ||
              queueStatus.includes('import fail') ||
              title.includes('import fail') ||
              trackedDownloadState.includes('fail') ||
              trackedDownloadStatus.includes('fail') ||
              (trackedDownloadStatus === 'warning' && !isDownloadingState) ||
              errorMessage.includes('fail') ||
              errorMessage.includes('retrying') ||
              statusMessages.includes('unmatched');

            if (isDownloadingState) {
              const progress = size ? Math.round((1 - sizeLeft / size) * 100) : 0;
              allStatuses[String(lidarrAlbumId)] = {
                status: 'downloading',
                progress: progress,
                updatedAt: new Date().toISOString(),
              };
            } else if (isExplicitFailure) {
              allStatuses[String(lidarrAlbumId)] = {
                status: 'failed',
                updatedAt: new Date().toISOString(),
              };
            } else {
              const progress = size ? Math.round((1 - sizeLeft / size) * 100) : 0;
              allStatuses[String(lidarrAlbumId)] = {
                status: 'downloading',
                progress: progress,
                updatedAt: new Date().toISOString(),
              };
            }
            continue;
          }

          if (searchingAlbumIds.has(lidarrAlbumId as number)) {
            allStatuses[String(lidarrAlbumId)] = {
              status: 'searching',
              updatedAt: new Date().toISOString(),
            };
            continue;
          }

          const historyEntry = historyByAlbumId.get(lidarrAlbumId);
          const recentHistory = historyEntry?.history;
          const historyTime = historyEntry?.historyTime ?? 0;

          if (recentHistory) {
            const eventType = String(recentHistory.eventType || '').toLowerCase();
            const data = (recentHistory.data || {}) as Record<string, unknown>;
            const statusMessages = Array.isArray(data.statusMessages)
              ? (data.statusMessages as unknown[])
                  .map((m: unknown) => String(m || '').toLowerCase())
                  .join(' ')
              : String((data.statusMessages as unknown[])?.[0] || '').toLowerCase();
            const errorMessage = String(data.errorMessage || '').toLowerCase();
            const sourceTitle = String(recentHistory.sourceTitle || '').toLowerCase();
            const dataString = JSON.stringify(data).toLowerCase();
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
              statusMessages.includes('incomplete') ||
              errorMessage.includes('fail') ||
              errorMessage.includes('error');
            const isComplete =
              eventType.includes('import') &&
              !isFailedImport &&
              eventType !== 'albumimportincomplete';
            const isStaleGrabbed = isGrabbed && Date.now() - historyTime > STALE_GRABBED_MS;
            const historyDate = new Date(
              (recentHistory.date || recentHistory.eventDate || 0) as string | number,
            );
            const oneHourAgo = Date.now() - 60 * 60 * 1000;

            if (historyDate.getTime() > oneHourAgo) {
              allStatuses[String(lidarrAlbumId)] = {
                status: isComplete
                  ? 'added'
                  : isFailedImport || isFailedDownload || isStaleGrabbed
                    ? 'failed'
                    : 'processing',
                updatedAt: new Date().toISOString(),
              };
              continue;
            }
          }
        }
      } catch (error) {
        console.warn('Failed to fetch Lidarr status:', (error as Error).message);
      }
    }

    return allStatuses;
  };

export const invalidateAllDownloadStatusesCache = () => {
  allDownloadStatusesCache.at = 0;
  allDownloadStatusesCache.statuses = null;
  allDownloadStatusesCache.pending = null;
};

export const getAllDownloadStatuses = async (): Promise<
  Record<string, Record<string, unknown>>
> => {
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

export default function registerDownloads(router: Router) {
  router.post(
    '/downloads/album',
    requireAuth,
    requirePermission('addAlbum'),
    async (req: Request, res: Response) => {
      try {
        const { artistId, albumId, artistMbid, artistName } = req.body as Record<
          string,
          string
        >;

        if (!albumId) {
          return res.status(400).json({ error: 'albumId is required' });
        }

        const { lidarrClient } = await import('../../../services/lidarrClient.js');
        if (!lidarrClient || !lidarrClient.isConfigured()) {
          return res.status(400).json({ error: 'Lidarr is not configured' });
        }

        const album = await libraryManager.getAlbumById(albumId);
        if (!album) {
          return res.status(404).json({ error: 'Album not found' });
        }

        let artist: Record<string, unknown> | null = artistId
          ? (await libraryManager.getArtistById(artistId)) as Record<string, unknown>
          : null;

        if (!artist && artistMbid && artistName) {
          if (!hasPermission(req.user as Record<string, unknown>, 'addArtist')) {
            return res.status(403).json({
              error: 'Forbidden',
              message: 'Permission required: addArtist',
            });
          }
          artist = (await libraryManager.addArtistWithPreferences(
            artistMbid,
            artistName,
            {
              user: req.user,
              quality: (dbOps.getSettings() as Record<string, unknown>).quality || 'standard',
              albumOnly: true,
              albumMbid: (album as Record<string, unknown>).mbid || (album as Record<string, unknown>).foreignAlbumId,
            },
          )) as Record<string, unknown>;
          if ((artist as Record<string, unknown>)?.error) artist = null;
        }

        if (!artist && (album as Record<string, unknown>).artistId) {
          artist = (await libraryManager.getArtistById(
            (album as Record<string, unknown>).artistId as string,
          )) as Record<string, unknown>;
        }

        if (!artist) {
          return res.status(404).json({
            error: 'Artist not found. Please add the artist to your library first.',
          });
        }

        try {
          artist = await libraryManager.ensureArtistMonitored(artist);
          if (!(album as Record<string, unknown>).monitored) {
            await libraryManager.updateAlbum(albumId, { monitored: true });
          }

          const settings = dbOps.getSettings() as Record<string, unknown>;
          const ints = settings.integrations as Record<string, unknown> | undefined;
          const lidarrSettings = ints?.lidarr as Record<string, unknown> | undefined;
          const searchOnAdd = (lidarrSettings?.searchOnAdd as boolean) ?? false;

          if (searchOnAdd) {
            await lidarrClient.request('/command', 'POST', {
              name: 'AlbumSearch',
              albumIds: [parseInt(albumId, 10)],
            });
            await libraryManager.ensureRequestedAlbumMonitoring(
              (artist as Record<string, unknown>).id as string,
              albumId,
            );
            libraryManager.scheduleRequestedAlbumMonitoringRepair(
              (artist as Record<string, unknown>).id as string,
              albumId,
            );
          }
          invalidateAllDownloadStatusesCache();

          const { recordAlbumRequested } = await import(
            '../../../services/aurralHistoryService.js'
          );
          recordAlbumRequested({
            albumId,
            albumName: (album as Record<string, unknown>).albumName,
            artistName:
              (artist as Record<string, unknown>)?.artistName ||
              (album as Record<string, unknown>).artistName,
            artistMbid:
              (artist as Record<string, unknown>)?.mbid ||
              (artist as Record<string, unknown>)?.foreignArtistId,
            searching: searchOnAdd,
          });

          res.json({
            success: true,
            message: searchOnAdd
              ? 'Album search triggered'
              : 'Album added to library',
          });
        } catch (error) {
          console.error(
            `Failed to trigger album search ${albumId}:`,
            (error as Error).message,
          );
          res.status(500).json({
            error: 'Failed to trigger album search',
            message: (error as Error).message,
          });
        }
      } catch (error) {
        console.error('Error initiating album download:', error as Error);
        res.status(500).json({
          error: 'Failed to initiate album download',
          message: (error as Error).message,
        });
      }
    },
  );

  router.post(
    '/downloads/album/search',
    requireAuth,
    requirePermission('addAlbum'),
    async (req: Request, res: Response) => {
      try {
        const { albumId } = req.body as Record<string, string>;

        if (!albumId) {
          return res.status(400).json({ error: 'albumId is required' });
        }

        const { lidarrClient } = await import('../../../services/lidarrClient.js');
        if (!lidarrClient || !lidarrClient.isConfigured()) {
          return res.status(400).json({ error: 'Lidarr is not configured' });
        }

        const album = await libraryManager.getAlbumById(albumId);
        if (!album) {
          return res.status(404).json({ error: 'Album not found' });
        }

        const artist: Record<string, unknown> | null = (album as Record<string, unknown>).artistId
          ? (await libraryManager.getArtistById(
              (album as Record<string, unknown>).artistId as string,
            )) as Record<string, unknown>
          : null;
        if (artist) {
          await libraryManager.ensureArtistMonitored(artist);
        }

        if (!(album as Record<string, unknown>).monitored) {
          await libraryManager.updateAlbum(albumId, { monitored: true });
        }

        await lidarrClient.request('/command', 'POST', {
          name: 'AlbumSearch',
          albumIds: [parseInt(albumId, 10)],
        });
        if ((album as Record<string, unknown>).artistId) {
          await libraryManager.ensureRequestedAlbumMonitoring(
            (album as Record<string, unknown>).artistId as string,
            albumId,
          );
          libraryManager.scheduleRequestedAlbumMonitoringRepair(
            (album as Record<string, unknown>).artistId as string,
            albumId,
          );
        }
        invalidateAllDownloadStatusesCache();

        const { recordAlbumSearchStarted } = await import(
          '../../../services/aurralHistoryService.js'
        );
        recordAlbumSearchStarted({
          albumId,
          albumName: (album as Record<string, unknown>).albumName,
          artistName:
            artist?.artistName || (album as Record<string, unknown>).artistName,
          artistMbid:
            (artist as Record<string, unknown>)?.mbid ||
            (artist as Record<string, unknown>)?.foreignArtistId,
        });

        res.json({
          success: true,
          message: 'Album search triggered',
        });
      } catch (error) {
        console.error(
          `Failed to trigger album search ${(req.body as Record<string, string>)?.albumId}:`,
          (error as Error).message,
        );
        res.status(500).json({
          error: 'Failed to trigger album search',
          message: (error as Error).message,
        });
      }
    },
  );

  router.post('/downloads/track', async (_req: Request, res: Response) => {
    res
      .status(400)
      .json({ error: 'Track downloads are not supported by Lidarr' });
  });

  router.get('/downloads', async (_req: Request, res: Response) => {
    try {
      const { lidarrClient } = await import('../../../services/lidarrClient.js');
      if (!lidarrClient.isConfigured()) {
        return res.json([]);
      }
      const queue = await lidarrClient.getQueue();
      const rawQueueItems: unknown =
        Array.isArray(queue)
          ? queue
          : (queue as Record<string, unknown>)?.records || [];
      const queueItems = Array.isArray(rawQueueItems) ? rawQueueItems : [];
      res.json(
        queueItems.map((rawItem: unknown) => {
          const item = rawItem as Record<string, unknown>;
          const size = Number(item.size || 0);
          const sizeleft = Number(item.sizeleft || 0);
          return {
            id: item.id,
            type: 'album',
            state: item.status || 'queued',
            title: item.title,
            artistName: (item.artist as Record<string, unknown>)?.artistName,
            albumTitle: (item.album as Record<string, unknown>)?.title,
            progress: size ? Math.round((1 - sizeleft / size) * 100) : 0,
            source: 'lidarr',
          };
        }),
      );
    } catch (error) {
      res.status(500).json({
        error: 'Failed to fetch downloads',
        message: (error as Error).message,
      });
    }
  });

  router.get('/downloads/status', noCache, async (req: Request, res: Response) => {
    try {
      const { albumIds } = req.query as Record<string, string | string[]>;
      if (!albumIds) {
        return res
          .status(400)
          .json({ error: 'albumIds query parameter is required' });
      }
      const albumIdArray: string[] = Array.isArray(albumIds)
        ? albumIds
        : (albumIds as string).split(',');
      const statuses = await getDownloadStatusesForAlbumIds(albumIdArray);
      res.json(statuses);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to fetch download status',
        message: (error as Error).message,
      });
    }
  });

  router.get(
    '/downloads/status/all',
    noCache,
    async (_req: Request, res: Response) => {
      try {
        const statuses = await getAllDownloadStatuses();
        res.json(statuses);
      } catch (error) {
        res.status(500).json({
          error: 'Failed to fetch download status',
          message: (error as Error).message,
        });
      }
    },
  );
}
