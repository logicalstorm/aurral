import { Router, Request, Response, NextFunction } from 'express';
import { libraryManager } from '../../../services/libraryManager.js';
import { playlistManager } from '../../../services/weeklyFlowPlaylistManager.js';
import { dbOps } from '../../../config/db-helpers.js';
import { hasPermission } from '../../../middleware/auth.js';
import { cacheMiddleware } from '../../../middleware/cache.js';
import { requireAuth, requirePermission } from '../../../middleware/requirePermission.js';

export default function registerAlbums(router: Router) {
  router.get('/albums', cacheMiddleware(5), async (req: Request, res: Response) => {
    try {
      const { artistId } = req.query;
      if (!artistId) {
        return res.status(400).json({ error: 'artistId parameter is required' });
      }

      const albums = await libraryManager.getAlbums(artistId as string);
      const formatted = albums.map((album: Record<string, unknown>) => ({
        ...album,
        foreignAlbumId: album.foreignAlbumId || album.mbid,
        title: album.albumName,
        statistics: album.statistics || {
          trackCount: 0,
          sizeOnDisk: 0,
          percentOfTracks: 0,
        },
      }));
      res.json(formatted);
    } catch (err: unknown) {
      res.status(500).json({
        error: 'Failed to fetch albums',
        message: (err as Error).message,
      });
    }
  });

  router.post('/albums', requireAuth, requirePermission('addAlbum'), async (req: Request, res: Response) => {
    try {
      const { artistId, releaseGroupMbid, albumName } = req.body;

      if (!artistId || !releaseGroupMbid || !albumName) {
        return res.status(400).json({
          error: 'artistId, releaseGroupMbid, and albumName are required',
        });
      }

      let mbid = releaseGroupMbid;
      if (String(releaseGroupMbid).startsWith('dz-')) {
        const { resolveDeezerAlbumToMbid } = await import('../../../services/apiClients.js');
        const artist = await libraryManager.getArtistById(artistId);
        const artistName = artist?.artistName || '';
        mbid = (await resolveDeezerAlbumToMbid(artistName, albumName, releaseGroupMbid)) || null;
        if (!mbid) {
          return res.status(400).json({
            error:
              'Could not resolve metadata for this album. Try adding the artist to Lidarr first or use a different album.',
          });
        }
      }

       
      const settings = dbOps.getSettings() as Record<string, any>;
      const searchOnAdd: boolean = settings.integrations?.lidarr?.searchOnAdd ?? false;

      const album: Record<string, unknown> = await libraryManager.addAlbum(artistId, mbid, albumName, {
        triggerSearch: searchOnAdd,
      }) as Record<string, unknown>;
      if (album?.error) {
        return res.status(503).json({ error: album.error });
      }
      if (album.artistName && album.albumName) {
        const pm = playlistManager as unknown as Record<string, unknown>;
        if (typeof pm.removeDiscoverSymlinksForAlbum === 'function') {
          (pm.removeDiscoverSymlinksForAlbum as (artistName: string, albumName: string) => Promise<void>)(album.artistName as string, album.albumName as string)
            .catch(() => {});
        }
      }
      const { recordAlbumRequested } = await import('../../../services/aurralHistoryService.js');
      recordAlbumRequested({
        albumId: album.id,
        albumName: album.albumName || albumName,
        artistName: album.artistName,
        artistMbid: album.mbid || album.foreignAlbumId,
        searching: searchOnAdd,
      });
      const formatted = {
        ...album,
        foreignAlbumId: album.mbid,
        title: album.albumName,
        albumType: 'Album',
      };
      res.status(201).json(formatted);
    } catch (err: unknown) {
      res.status(500).json({
        error: 'Failed to add album',
        message: (err as Error).message,
      });
    }
  });

  router.post('/albums/request', requireAuth, requirePermission('addAlbum'), async (req: Request, res: Response) => {
    try {
      const {
        albumMbid,
        albumName,
        artistMbid,
        artistName,
        triggerSearch = false,
      } = req.body || {};

      const result: Record<string, unknown> = await libraryManager.requestAlbumFromSearch({
        albumMbid,
        albumName,
        artistName,
        artistMbid,
        triggerSearch,
        user: req.user,
      }) as Record<string, unknown>;

       
      const settings = dbOps.getSettings() as Record<string, any>;
      const searchOnAdd: boolean = settings.integrations?.lidarr?.searchOnAdd ?? false;
      const searching: boolean = triggerSearch === true || searchOnAdd || result?.status === 'searching';
      const { recordAlbumRequested } = await import('../../../services/aurralHistoryService.js');
      recordAlbumRequested({
        albumId: result?.id,
        albumName: result?.albumName || albumName,
        artistName: result?.artistName || artistName,
        artistMbid: result?.mbid || artistMbid,
        searching,
      });

      res.json(result);
    } catch (err: unknown) {
      const statusCode =
        Number.isInteger((err as Record<string, unknown>)?.statusCode) && (err as Record<string, unknown>).statusCode as number >= 400 ? (err as Record<string, unknown>).statusCode as number : 500;
      res.status(statusCode).json({
        error: (err as Error).message || 'Failed to request album',
      });
    }
  });

  router.get('/albums/:id', cacheMiddleware(120), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const album = await libraryManager.getAlbumById(String(id));
      if (!album) {
        return res.status(404).json({ error: 'Album not found' });
      }
      res.json(album);
    } catch (err: unknown) {
      res.status(500).json({
        error: 'Failed to fetch album',
        message: (err as Error).message,
      });
    }
  });

  router.put(
    '/albums/:id',
    requireAuth,
    (req: Request, res: Response, next: NextFunction) => {
      if (hasPermission(req.user as Record<string, unknown>, 'changeMonitoring') || hasPermission(req.user as Record<string, unknown>, 'addAlbum')) {
        return next();
      }
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Permission required: changeMonitoring or addAlbum',
      });
    },
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const album: Record<string, unknown> = await libraryManager.updateAlbum(String(id), req.body) as Record<string, unknown>;
        if (album?.error) {
          return res.status(503).json({ error: album.error });
        }
        res.json(album);
      } catch (err: unknown) {
        res.status(500).json({
          error: 'Failed to update album',
          message: (err as Error).message,
        });
      }
    },
  );

  router.delete('/albums/:id', requireAuth, requirePermission('deleteAlbum'), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { deleteFiles } = req.query;
      const result: Record<string, unknown> = await libraryManager.deleteAlbum(String(id), String(deleteFiles || '') === 'true') as Record<string, unknown>;
      if (!result?.success) {
        return res.status(503).json({ error: result?.error || 'Failed to delete album' });
      }
      res.json({ success: true, message: 'Album deleted successfully' });
    } catch (err: unknown) {
      res.status(500).json({
        error: 'Failed to delete album',
        message: (err as Error).message,
      });
    }
  });
}
