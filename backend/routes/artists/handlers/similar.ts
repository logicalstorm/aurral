import { UUID_REGEX } from '../../../config/constants.js';
import {
  getLastfmApiKey,
  lastfmRequest,
  musicbrainzGetArtistNameByMbid,
} from '../../../services/apiClients.js';
import { dbOps } from '../../../config/db-helpers.js';
import { cacheMiddleware } from '../../../middleware/cache.js';
import { buildImageProxyUrl } from '../../../services/imageProxyService.js';

export default function registerSimilar(router: Record<string, (...args: unknown[]) => unknown>) {
  router.get('/:mbid/similar', cacheMiddleware(300), async (req: Record<string, unknown>, res: Record<string, unknown>) => {
    try {
      const { mbid } = req['params'] as Record<string, string>;

      if (!UUID_REGEX.test(mbid)) {
        return (res as any)['status'](400).json({ error: 'Invalid MBID format' });
      }

      const { limit = 10 } = req['query'] as Record<string, unknown>;
      const artistNameParam = String((req['query'] as Record<string, unknown>)?.artistName || '').trim();

      if (!getLastfmApiKey()) {
        return (res as Record<string, (...args: unknown[]) => unknown>).json({ artists: [], provider: 'none', requiresLastfm: true });
      }

      const limitInt = Math.min(Math.max(parseInt(String(limit), 10) || 7, 1), 20);
      const override = dbOps.getArtistOverride(mbid);
      const resolvedMbid = (override as Record<string, unknown>)?.musicbrainzId || mbid;
      let data = await lastfmRequest('artist.getSimilar', {
        mbid: resolvedMbid as string,
        limit: limitInt,
      });

      if (!data?.similarartists?.artist) {
        const fallbackArtistName =
          artistNameParam ||
          (await musicbrainzGetArtistNameByMbid(resolvedMbid as string).catch(() => null)) ||
          '';

        if (fallbackArtistName) {
          data = await lastfmRequest('artist.getSimilar', {
            artist: fallbackArtistName,
            limit: limitInt,
          });
        }
      }

      if (!data?.similarartists?.artist) {
        return (res as Record<string, (...args: unknown[]) => unknown>).json({ artists: [] });
      }

      const artists = Array.isArray(data.similarartists.artist)
        ? data.similarartists.artist
        : [data.similarartists.artist];

      const formattedArtists = artists
        .map((a: Record<string, unknown>) => {
          let img: string | null = null;
          if (a.image && Array.isArray(a.image)) {
            const i =
              (a.image as Array<Record<string, unknown>>).find((img: Record<string, unknown>) => img.size === 'extralarge') ||
              (a.image as Array<Record<string, unknown>>).find((img: Record<string, unknown>) => img.size === 'large');
            if (i && i['#text'] && !String(i['#text']).includes('2a96cbd8b46e442fc41c2b86b821562f'))
              img = String(i['#text']);
          }
          return {
            id: a.mbid,
            name: a.name,
            image: buildImageProxyUrl(img as string) || img,
            match: Math.round((Number(a.match) || 0) * 100),
          };
        })
        .filter((a: Record<string, unknown>) => a.id);

      (res as Record<string, (...args: unknown[]) => unknown>).json({ artists: formattedArtists });
    } catch (error: unknown) {
      (res as any)['status'](500).json({
        error: 'Failed to fetch similar artists',
        message: (error as { message?: string })?.message,
      });
    }
  });
}
