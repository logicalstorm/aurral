import { Router, Request, Response } from 'express';
import { UUID_REGEX } from '../../../config/constants.js';
import { dbOps } from '../../../config/db-helpers.js';
import { buildImageProxyUrl } from '../../../services/imageProxyService.js';
import { fetchReleaseGroupCoverUrl } from '../../../services/imageService.js';
import { libraryManager, getCachedArtists } from '../../../services/libraryManager.js';
import { qualityManager } from '../../../services/qualityManager.js';

export default function registerMisc(router: Router) {
  const normalizePercentOfTracks = (value: unknown) => {
    const raw = Number(value);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    if (raw > 1 && raw <= 100) return Math.round(raw);
    if (raw <= 1) return Math.round(raw * 100);
    return Math.min(100, Math.round(raw / 10));
  };

  router.post('/scan', async (_req: Request, res: Response) => {
    res.status(400).json({ error: 'Scanning is handled by Lidarr' });
  });

  router.get('/rootfolder', async (_req: Request, res: Response) => {
    try {
      const { lidarrClient } = await import('../../../services/lidarrClient.js');
      if (!lidarrClient.isConfigured()) {
        return res.json([]);
      }
      const rootFolders = await lidarrClient.getRootFolders();
      const list = Array.isArray(rootFolders) ? rootFolders.map((r) => ({ path: r.path })) : [];
      res.json(list);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to fetch root folder',
        message: (error as Error).message,
      });
    }
  });

  router.get('/qualityprofile', async (_req: Request, res: Response) => {
    try {
      const profiles = qualityManager.getQualityProfiles();
      res.json(profiles);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to fetch quality profiles',
        message: (error as Error).message,
      });
    }
  });

  router.get('/lookup/:mbid', async (req: Request, res: Response) => {
    try {
      const mbid = req.params.mbid as string;
      if (!UUID_REGEX.test(mbid)) {
        return res.status(400).json({ error: 'Invalid MBID format' });
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
        error: 'Failed to lookup artist',
        message: (error as Error).message,
      });
    }
  });

  router.post('/lookup/batch', async (req: Request, res: Response) => {
    try {
      const { mbids } = req.body;
      if (!Array.isArray(mbids)) {
        return res.status(400).json({ error: 'mbids must be an array' });
      }

      const libraryArtists = getCachedArtists();
      const existingArtistIds = new Set(
        libraryArtists.map((artist) => artist.mbid).filter(Boolean),
      );
      const results: Record<string, boolean> = {};
      for (const mbid of mbids) {
        results[mbid] = existingArtistIds.has(mbid);
      }

      res.json(results);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to batch lookup artists',
        message: (error as Error).message,
      });
    }
  });

  router.post('/albums/lookup/batch', async (req: Request, res: Response) => {
    try {
      const { mbids } = req.body;
      if (!Array.isArray(mbids)) {
        return res.status(400).json({ error: 'mbids must be an array' });
      }

      const { lidarrClient } = await import('../../../services/lidarrClient.js');
      if (!lidarrClient.isConfigured()) {
        return res.json({});
      }

      const albums = await lidarrClient.request('/album');
      const wanted = new Set(mbids.map((mbid: unknown) => String(mbid || '').trim()).filter(Boolean));
      const results: Record<string, unknown> = {};

      for (const album of Array.isArray(albums) ? albums : []) {
        const foreignAlbumId = String(album?.foreignAlbumId || '').trim();
        if (!foreignAlbumId || !wanted.has(foreignAlbumId)) continue;

        const percentOfTracks = normalizePercentOfTracks(album?.statistics?.percentOfTracks);
        const sizeOnDisk = Number(album?.statistics?.sizeOnDisk || 0);
        const trackCount = Number(album?.statistics?.trackCount || 0);
        const trackFileCount = Number(album?.statistics?.trackFileCount || 0);
        const hasFiles = sizeOnDisk > 0 || trackFileCount > 0;

        results[foreignAlbumId] = {
          inLibrary: true,
          libraryAlbumId: album.id !== undefined && album.id !== null ? String(album.id) : null,
          libraryArtistId:
            album.artistId !== undefined && album.artistId !== null ? String(album.artistId) : null,
          status: hasFiles ? 'available' : 'inLibrary',
          monitored: Boolean(album?.monitored),
          percentOfTracks,
          sizeOnDisk,
          trackCount,
          trackFileCount,
          albumName: String(album?.title || '').trim(),
          releaseDate: String(album?.releaseDate || '').trim(),
        };
      }

      res.json(results);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to batch lookup albums',
        message: (error as Error).message,
      });
    }
  });

  router.get('/recent', async (_req: Request, res: Response) => {
    try {
      const artists = await libraryManager.getAllArtists();
      const recent = [...artists]
        .sort((a, b) => new Date((b.addedAt || b.added) as string).getTime() - new Date((a.addedAt || a.added) as string).getTime())
        .slice(0, 20)
        .map((artist: Record<string, unknown>) => ({
          ...artist,
          foreignArtistId: artist.foreignArtistId || artist.mbid,
          added: artist.addedAt || artist.added,
        }));
      res.set('Cache-Control', 'public, max-age=300');
      res.json(recent);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to fetch recent artists',
        message: (error as Error).message,
      });
    }
  });

  router.get('/recent-releases', async (_req: Request, res: Response) => {
    try {
      const { getRecentMissingReleases } =
        await import('../../../services/recentReleasesService.js');
      const recentMissing = await getRecentMissingReleases(24);

      const cachedCovers = dbOps.getImages(
        recentMissing
          .map((album: Record<string, unknown> | null) => (album ? album.mbid || album.foreignAlbumId : null))
          .filter(Boolean)
          .map((id: unknown) => `rg:${id}`),
      );

      const coverTargets = recentMissing.slice(0, 6);
      const warmedVisibleCovers = await Promise.all(
        coverTargets.map(async (album: Record<string, unknown> | null) => {
          if (!album) return [null, null];
          const coverId = album.mbid || album.foreignAlbumId;
          if (!coverId) return [null, null];

          const cachedUrl = (cachedCovers as Record<string, { imageUrl?: string }>)[`rg:${coverId}`]?.imageUrl || null;
          if (cachedUrl && cachedUrl !== 'NOT_FOUND') {
            return [coverId, buildImageProxyUrl(cachedUrl) || cachedUrl];
          }

          const cover = await fetchReleaseGroupCoverUrl(coverId as string, {
            artistName: (album.artistName as string) || '',
            albumTitle: (album.albumName as string) || '',
          }).catch(() => null);

          if (!cover?.imageUrl) {
            return [coverId, null];
          }

          return [coverId, buildImageProxyUrl(cover.imageUrl) || cover.imageUrl];
        }),
      );

      const warmedCoverMap = Object.fromEntries(
        warmedVisibleCovers.filter(([coverId, coverUrl]) => coverId && coverUrl),
      );

      const withCachedCovers = recentMissing.map((album: Record<string, unknown> | null) => {
        const coverId = album ? album.mbid || album.foreignAlbumId : null;
        const coverUrl =
          (coverId ? warmedCoverMap[coverId as string] : null) ||
          (coverId ? (cachedCovers as Record<string, { imageUrl?: string }>)[`rg:${coverId}`]?.imageUrl || null : null);
        return {
          ...(album || {}),
          coverUrl:
            coverUrl && coverUrl !== 'NOT_FOUND' ? buildImageProxyUrl(coverUrl) || coverUrl : null,
        };
      });

      res.set('Cache-Control', 'public, max-age=300');
      res.json(withCachedCovers);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to fetch recent releases',
        message: (error as Error).message,
      });
    }
  });
}
