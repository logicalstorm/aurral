import { UUID_REGEX } from '../../../config/constants.js';
import {
  getLastfmApiKey,
  lastfmRequest,
  musicbrainzGetArtistAppearsOnReleaseGroups,
  musicbrainzGetArtistReleaseGroups,
  musicbrainzGetArtistNameByMbid,
} from '../../../services/apiClients.js';
import { dbOps } from '../../../config/db-helpers.js';
import { cacheMiddleware } from '../../../middleware/cache.js';
import { requireAuth } from '../../../middleware/requirePermission.js';
import { buildArtistRequestKey, pendingArtistRequests } from '../utils.js';
import { getArtistByMbid } from '../../../services/providers/brainzmashProvider.js';

 
type Handler = (...args: any[]) => any;

interface Req {
  params: Record<string, string>;
  query: Record<string, string>;
  body?: Record<string, unknown>;
}

interface Res {
  status(code: number): Res;
  json(data: unknown): Res;
  setHeader(name: string, value: string): void;
}

export default function registerDetails(router: Record<string, (...args: unknown[]) => unknown>) {
  const toLegacyRelations = (metadataArtist: Record<string, unknown> | null) =>
    Array.isArray(metadataArtist?.links)
      ? (metadataArtist!.links as Record<string, unknown>[])
          .filter((link: Record<string, unknown> | null) => link?.target)
          .map((link: Record<string, unknown> | null) => ({
            type: link!.type || 'external',
            url: { resource: link!.target },
          }))
      : [];

  const getLastfmTags = async (mbid: string, artistName = '') => {
    if (!getLastfmApiKey()) return [];
    let data: Record<string, unknown> | null = await lastfmRequest('artist.getTopTags', { mbid }).catch(() => null);
    if (!(data?.toptags as Record<string, unknown>)?.tag && artistName) {
      data = await lastfmRequest('artist.getTopTags', { artist: artistName }).catch(() => null);
    }
    const topTags = (data?.toptags as Record<string, unknown> | undefined)?.tag;
    const rawTags: unknown[] = topTags
      ? Array.isArray(topTags)
        ? topTags as unknown[]
        : [topTags]
      : [];
    return rawTags
      .map((tag: unknown) => ({
        name: String((tag as Record<string, unknown>)?.name || '').trim(),
        count: Number((tag as Record<string, unknown>)?.count || 0),
      }))
      .filter((tag) => tag.name);
  };

  const getArtistTagPayload = async (mbid: string, artistName = '', metadataArtist: Record<string, unknown> | null = null) => {
    const lastfmTags = await getLastfmTags(mbid, artistName);
    if (lastfmTags.length > 0) {
      return {
        tags: lastfmTags,
        genres: lastfmTags.map((tag) => tag.name),
      };
    }
    const fallbackGenres: unknown[] = Array.isArray(metadataArtist?.genres)
      ? (metadataArtist!.genres as unknown[]).filter(Boolean)
      : [];
    return {
      tags: fallbackGenres.map((genre: unknown) => ({ name: String(genre || ''), count: 0 })),
      genres: fallbackGenres as string[],
    };
  };

  const parseSelectedReleaseTypes = (value: unknown): string[] | null =>
    typeof value === 'string' && value.trim()
      ? value
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : null;

  const parseAppearsOnLimit = (value: unknown): number | null => {
    const parsed = Number.parseInt(value as string, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  router.get('/', ((_req: Req, res: Res) => {
    res.status(404).json({
      error: 'Not found',
      message: 'Use /api/artists/:mbid to get artist details, or /api/search/artists to search',
    });
  }) as Handler);

  router.get('/:mbid/overrides', requireAuth as Handler, ((req: Req, res: Res) => {
    const { mbid } = req.params;
    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({
        error: 'Invalid MBID format',
        message: `"${mbid}" is not a valid MusicBrainz ID. MBIDs must be UUIDs.`,
      });
    }
    const override = dbOps.getArtistOverride(mbid);
    return res.json({
      mbid,
      musicbrainzId: override?.musicbrainzId || null,
      deezerArtistId: override?.deezerArtistId || null,
    });
  }) as Handler);

  router.put('/:mbid/overrides', requireAuth as Handler, ((req: Req, res: Res) => {
    const { mbid } = req.params;
    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({
        error: 'Invalid MBID format',
        message: `"${mbid}" is not a valid MusicBrainz ID. MBIDs must be UUIDs.`,
      });
    }

    const body = req.body as Record<string, unknown> | undefined;
    const rawMusicbrainzId =
      body?.musicbrainzId != null ? String(body.musicbrainzId).trim() : '';
    const rawDeezerArtistId =
      body?.deezerArtistId != null ? String(body.deezerArtistId).trim() : '';

    const musicbrainzId = rawMusicbrainzId || null;
    const deezerArtistId = rawDeezerArtistId || null;

    if (musicbrainzId && !UUID_REGEX.test(musicbrainzId)) {
      return res.status(400).json({
        error: 'Invalid MusicBrainz ID format',
        message: `"${musicbrainzId}" is not a valid MusicBrainz ID. MBIDs must be UUIDs.`,
      });
    }

    if (deezerArtistId && !/^\d+$/.test(deezerArtistId)) {
      return res.status(400).json({
        error: 'Invalid Deezer Artist ID',
        message: `"${deezerArtistId}" must be a numeric Deezer artist ID.`,
      });
    }

    if (!musicbrainzId && !deezerArtistId) {
      dbOps.deleteArtistOverride(mbid);
      dbOps.deleteImage(mbid);
      return res.json({
        mbid,
        musicbrainzId: null,
        deezerArtistId: null,
      });
    }

    const saved = dbOps.setArtistOverride(mbid, {
      musicbrainzId,
      deezerArtistId,
    });
    dbOps.deleteImage(mbid);
    return res.json(saved);
  }) as Handler);

  router.get('/:mbid', cacheMiddleware(300) as Handler, (async (req: Req, res: Res) => {
    try {
      const { mbid } = req.params;
      const responseMode =
        typeof req.query.mode === 'string' && req.query.mode.trim()
          ? req.query.mode.trim().toLowerCase()
          : 'full';
      const coreOnly = responseMode === 'core';
      const selectedReleaseTypes = parseSelectedReleaseTypes(req.query.releaseTypes);
      const appearsOnLimit = parseAppearsOnLimit(req.query.appearsOnLimit);
      const requestKey = buildArtistRequestKey({
        mbid,
        mode: responseMode,
        selectedReleaseTypes: selectedReleaseTypes as unknown as null | undefined,
        appearsOnLimit: appearsOnLimit as unknown as null | undefined,
      });

      if (!UUID_REGEX.test(mbid)) {
        console.log(`[Artists Route] Invalid MBID format: ${mbid}`);
        return res.status(400).json({
          error: 'Invalid MBID format',
          message: `"${mbid}" is not a valid MusicBrainz ID. MBIDs must be UUIDs.`,
        });
      }

      if (pendingArtistRequests.has(requestKey)) {
        console.log(`[Artists Route] Request for ${requestKey} already in progress, waiting...`);
        try {
          const data = await pendingArtistRequests.get(requestKey);
          res.setHeader('Content-Type', 'application/json');
          return res.json(data);
        } catch (err: unknown) {
          const error = err as { response?: { status?: number; data?: { error?: string } }; message?: string };
          return res.status(error.response?.status || 500).json({
            error: 'Failed to fetch artist details',
            message: error.response?.data?.error || error.message,
          });
        }
      }

      console.log(`[Artists Route] Fetching artist details for MBID: ${mbid}`);

      const { lidarrClient } = await import('../../../services/lidarrClient.js');
      const { libraryManager } = await import('../../../services/libraryManager.js');

      let data: Record<string, unknown> | null = null;
      const override = dbOps.getArtistOverride(mbid);
      const resolvedMbid: string = (override as Record<string, unknown>)?.musicbrainzId as string || mbid;

      let lidarrData: Record<string, unknown> | null = null;

      if ((lidarrClient as unknown as Record<string, (...args: unknown[]) => unknown>).isConfigured()) {
        try {
          const raw = await (lidarrClient as unknown as Record<string, (...args: unknown[]) => unknown>).getArtistByMbid(mbid);
          lidarrData = raw as Record<string, unknown> | null;
          if (lidarrData) {
            console.log(`[Artists Route] Found artist in Lidarr: ${lidarrData.artistName}`);
            const libArtist = await (libraryManager as unknown as Record<string, (...args: unknown[]) => unknown>).getArtist(mbid) as Record<string, unknown> | null;
            if (libArtist) {
              await (libraryManager as unknown as Record<string, (...args: unknown[]) => unknown>).getAlbums(libArtist.id, lidarrData);
            }
          }
        } catch (err: unknown) {
          console.warn(`[Artists Route] Failed to fetch from Lidarr: ${(err as Error).message}`);
        }
      }

      if (lidarrData) {
        const artistMbid: string = (override as Record<string, unknown>)?.musicbrainzId as string || lidarrData.foreignArtistId as string || mbid;
        const metadataArtist: Record<string, unknown> | null = coreOnly
          ? null
          : await getArtistByMbid(artistMbid).catch(() => null);
        const releaseGroups = await musicbrainzGetArtistReleaseGroups(
          artistMbid,
          selectedReleaseTypes as unknown as string[] | null,
          { includeTrackCounts: !appearsOnLimit },
        );
        const appearsOnReleaseGroups = coreOnly
          ? []
          : await musicbrainzGetArtistAppearsOnReleaseGroups(artistMbid, releaseGroups as Record<string, unknown>[], {
              limit: appearsOnLimit as unknown as number | undefined,
            });
        const tagPayload = coreOnly
          ? { tags: [], genres: [] }
          : await getArtistTagPayload(
              artistMbid,
              (metadataArtist?.name || lidarrData.artistName) as string,
              metadataArtist,
            );
        const payload = {
          id: artistMbid,
          name: metadataArtist?.name || lidarrData.artistName,
          'sort-name': metadataArtist?.sortName || metadataArtist?.name || lidarrData.artistName,
          disambiguation: metadataArtist?.disambiguation || '',
          'type-id': null,
          type: metadataArtist?.type || null,
          country: null,
          'life-span': {
            begin: null,
            end: null,
            ended: false,
          },
          tags: tagPayload.tags,
          genres: tagPayload.genres,
          links: Array.isArray(metadataArtist?.links) ? metadataArtist.links : [],
          'release-groups': releaseGroups,
          'appears-on-release-groups': appearsOnReleaseGroups,
          relations: toLegacyRelations(metadataArtist),
          rating: metadataArtist?.rating || null,
          'release-group-count': (releaseGroups as unknown[]).length,
          'release-count': (releaseGroups as unknown[]).length,
          _lidarrData: {
            id: lidarrData.id,
            monitored: lidarrData.monitored,
            statistics: lidarrData.statistics,
          },
          ...(metadataArtist?.overview ? { bio: metadataArtist.overview } : {}),
        };

        res.setHeader('Content-Type', 'application/json');
        res.json(payload);
        return;
      }

      const fetchPromise = (async () => {
        const metadataArtist: Record<string, unknown> | null = coreOnly
          ? null
          : await getArtistByMbid(resolvedMbid).catch(() => null);
        const name =
          (req.query.artistName || '').trim() ||
          metadataArtist?.name ||
          (await musicbrainzGetArtistNameByMbid(resolvedMbid)) ||
          'Unknown Artist';
        const tagPayload = coreOnly
          ? { tags: [], genres: [] }
          : await getArtistTagPayload(resolvedMbid, name as string, metadataArtist);
        const releaseGroups = await musicbrainzGetArtistReleaseGroups(
          resolvedMbid,
          selectedReleaseTypes as unknown as string[] | null,
          { includeTrackCounts: !appearsOnLimit },
        );
        const appearsOnReleaseGroups = coreOnly
          ? []
          : await musicbrainzGetArtistAppearsOnReleaseGroups(resolvedMbid, releaseGroups as Record<string, unknown>[], {
              limit: appearsOnLimit as unknown as number | undefined,
            });
        return {
          id: resolvedMbid,
          name,
          'sort-name': metadataArtist?.sortName || name,
          disambiguation: metadataArtist?.disambiguation || '',
          'type-id': null,
          type: metadataArtist?.type || null,
          country: null,
          'life-span': { begin: null, end: null, ended: false },
          tags: tagPayload.tags,
          genres: tagPayload.genres,
          links: Array.isArray(metadataArtist?.links) ? metadataArtist.links : [],
          'release-groups': releaseGroups,
          'appears-on-release-groups': appearsOnReleaseGroups,
          relations: toLegacyRelations(metadataArtist),
          rating: metadataArtist?.rating || null,
          'release-group-count': (releaseGroups as unknown[]).length,
          'release-count': (releaseGroups as unknown[]).length,
          bio: metadataArtist?.overview || undefined,
        };
      })();

      pendingArtistRequests.set(requestKey, fetchPromise);

      try {
        data = await fetchPromise;
        res.setHeader('Content-Type', 'application/json');
        res.json(data);
      } catch {
        const artistNameParam = (req.query.artistName || '').trim();
        const fallback = {
          id: resolvedMbid,
          name: artistNameParam || 'Unknown Artist',
          'sort-name': artistNameParam || 'Unknown Artist',
          disambiguation: '',
          'type-id': null,
          type: null,
          country: null,
          'life-span': { begin: null, end: null, ended: false },
          tags: [],
          genres: [],
          links: [],
          'release-groups': [],
          'appears-on-release-groups': [],
          relations: [],
          'release-group-count': 0,
          'release-count': 0,
        };
        res.setHeader('Content-Type', 'application/json');
        res.json(fallback);
      } finally {
        pendingArtistRequests.delete(requestKey);
      }
    } catch (err: unknown) {
      const error = err as { message?: string; stack?: string };
      console.error(`[Artists Route] Unexpected error in artist details route:`, error.message);
      console.error(`[Artists Route] Error stack:`, error.stack);
      res.status(500).json({
        error: 'Failed to fetch artist details',
        message: error.message,
      });
    }
  }) as Handler);
}
