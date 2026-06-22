import { dbOps } from '../config/db-helpers.js';
import {
  musicbrainzGetArtistNameByMbid,
  musicbrainzGetArtistReleaseGroupsPreview,
} from './apiClients.js';
import { warmImageProxy } from './imageProxyService.js';
import { getArtistByMbid } from './providers/brainzmashProvider.js';
import { fetchReleaseGroupCoverUrl } from './releaseGroupCoverService.js';

const MAX_NEGATIVE_CACHE = 1000;
const MAX_PENDING_REQUESTS = 100;
const NEGATIVE_CACHE_TTL_MS = 60 * 60 * 1000;
const RELEASE_GROUP_CONCURRENCY = 4;
const negativeImageCache = new Map();
const pendingImageRequests = new Map();
const LEGACY_COVER_HOST_PATTERN =
  /https?:\/\/(?:caa\.lkly\.net|coverartarchive\.org|archive\.org|[\w-]+\.ca\.archive\.org)\//i;

const ARTIST_IMAGE_KIND_RANK: Record<string, number> = {
  poster: 0,
  artist: 1,
  thumb: 2,
  fanart: 3,
  background: 4,
  banner: 8,
  logo: 9,
  clearlogo: 9,
};

const ALBUM_IMAGE_KIND_RANK: Record<string, number> = {
  front: 0,
  cover: 0,
  albumcover: 0,
  back: 4,
  booklet: 5,
  medium: 6,
  tray: 6,
  spine: 7,
  disc: 8,
  logo: 9,
};

const getArtistImageKindRank = (image: Record<string, unknown>): number => {
  const kind = String(image?.kind || image?.CoverType || '')
    .trim()
    .toLowerCase();
  return ARTIST_IMAGE_KIND_RANK[kind] ?? 5;
};

const getAlbumImageKindRank = (image: Record<string, unknown>): number => {
  const kind = String(image?.kind || image?.CoverType || '')
    .trim()
    .toLowerCase();
  return ALBUM_IMAGE_KIND_RANK[kind] ?? 3;
};

const getImageUrl = (image: Record<string, unknown>): string | null => (image?.url || image?.Url || null) as string | null;

const selectBestImageByKind = (images: unknown[] = [], getKindRank: (image: Record<string, unknown>) => number): Record<string, unknown> | null => {
  if (!Array.isArray(images)) return null;
  return (
    images
      .filter((image: unknown) => getImageUrl(image as Record<string, unknown>))
      .map((image: unknown, index: number) => ({ image: image as Record<string, unknown>, index }))
      .sort((a, b) => {
        const rankDiff = getKindRank(a.image) - getKindRank(b.image);
        if (rankDiff !== 0) return rankDiff;
        return a.index - b.index;
      })[0]?.image || null
  );
};

export const selectBestArtistImage = (images: unknown[] = []): Record<string, unknown> | null => {
  return selectBestImageByKind(images, getArtistImageKindRank);
};

export const selectBestAlbumImage = (images: unknown[] = []): Record<string, unknown> | null => {
  return selectBestImageByKind(images, getAlbumImageKindRank);
};

const sortArtistImages = (images: unknown[] = []): Record<string, unknown>[] => {
  if (!Array.isArray(images)) return [];
  return images
    .filter((image: unknown) => getImageUrl(image as Record<string, unknown>))
    .map((image: unknown, index: number) => ({ image: image as Record<string, unknown>, index }))
    .sort((a, b) => {
      const rankDiff = getArtistImageKindRank(a.image) - getArtistImageKindRank(b.image);
      if (rankDiff !== 0) return rankDiff;
      return a.index - b.index;
    })
    .map((entry) => entry.image);
};

const buildCachedArtistImagePayload = async (cachedImageUrl: string, metadataArtist: Record<string, unknown> | null = null): Promise<Record<string, unknown>[]> => {
  const images: Record<string, unknown>[] = [
    {
      image: cachedImageUrl,
      front: true,
      types: ['Artist'],
    },
  ];
  const seen = new Set<string>([cachedImageUrl]);
  const directImages = sortArtistImages(metadataArtist?.images as unknown[]);

  for (const image of directImages) {
    try {
      const cached = await warmImageProxy(getImageUrl(image) as string);
      if (!(cached as Record<string, unknown>)?.localUrl || seen.has((cached as Record<string, unknown>).localUrl as string)) continue;
      seen.add((cached as Record<string, unknown>).localUrl as string);
      images.push({
        image: (cached as Record<string, unknown>).localUrl,
        front: false,
        types: [image?.kind || image?.CoverType || 'Artist'],
      });
    } catch {}
  }

  return images;
};

const buildDirectArtistImagePayload = async (directImages: unknown[] = []): Promise<Record<string, unknown>[]> => {
  const sorted = sortArtistImages(directImages);
  const best = sorted[0] || null;
  const images: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const image of sorted) {
    try {
      const cached = await warmImageProxy(getImageUrl(image as Record<string, unknown>) as string);
      if (!(cached as Record<string, unknown>)?.localUrl || seen.has((cached as Record<string, unknown>).localUrl as string)) continue;
      seen.add((cached as Record<string, unknown>).localUrl as string);
      images.push({
        image: (cached as Record<string, unknown>).localUrl,
        front: image === best,
        types: [image?.kind || image?.CoverType || 'Artist'],
      });
    } catch {}
  }

  return images;
};

const addToNegativeCache = (mbid: string) => {
  if (negativeImageCache.size >= MAX_NEGATIVE_CACHE) {
    const firstKey = negativeImageCache.keys().next().value as string;
    negativeImageCache.delete(firstKey);
  }
  negativeImageCache.set(mbid, Date.now());
};

const hasFreshNegativeCache = (mbid: string) => {
  const cachedAt = negativeImageCache.get(mbid);
  if (!cachedAt) return false;
  if (Date.now() - cachedAt > NEGATIVE_CACHE_TTL_MS) {
    negativeImageCache.delete(mbid);
    return false;
  }
  return true;
};

const addToPendingRequests = (mbid: string, promise: Promise<unknown>) => {
  if (pendingImageRequests.size >= MAX_PENDING_REQUESTS) {
    const firstKey = pendingImageRequests.keys().next().value as string;
    pendingImageRequests.delete(firstKey);
  }
  pendingImageRequests.set(mbid, promise);
};

const getCachedUrl = (cacheKey: string): string | null | undefined => {
  const cached = dbOps.getImage(cacheKey) as Record<string, unknown> | null;
  const imageUrl = cached?.imageUrl as string | undefined;
  if (
    imageUrl &&
    imageUrl !== 'NOT_FOUND' &&
    LEGACY_COVER_HOST_PATTERN.test(imageUrl)
  ) {
    dbOps.deleteImage(cacheKey);
    return undefined;
  }
  if (imageUrl && imageUrl !== 'NOT_FOUND') {
    return imageUrl;
  }
  if (imageUrl === 'NOT_FOUND') {
    return null;
  }
  return undefined;
};

export { fetchReleaseGroupCoverUrl };

const typeRank = (primaryType: string) => {
  if (primaryType === 'Album') return 0;
  if (primaryType === 'EP') return 1;
  if (primaryType === 'Single') return 2;
  return 3;
};

const buildArtistCoverFromUrl = (imageUrl: string, types: string[] = ['Front']) => ({
  url: imageUrl,
  images: [
    {
      image: imageUrl,
      front: true,
      types,
    },
  ],
});

const recoverArtistCoverFromCachedReleaseGroups = async (resolvedMbid: string): Promise<Record<string, unknown> | null> => {
  const rgCacheKey = `artist_rg:${resolvedMbid}`;
  const cachedRgId = dbOps.getDeezerMbidCache(rgCacheKey);
  if (cachedRgId && cachedRgId !== 'NOT_FOUND') {
    const cachedUrl = getCachedUrl(`rg:${cachedRgId}`);
    if (cachedUrl) {
      return buildArtistCoverFromUrl(cachedUrl);
    }
  }

  const releaseGroups = await musicbrainzGetArtistReleaseGroupsPreview(resolvedMbid, 30).catch(
    () => [],
  );
  const ordered = releaseGroups
    .filter((rg: Record<string, unknown>) => rg?.id)
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      const rankDiff = typeRank(a['primary-type'] as string) - typeRank(b['primary-type'] as string);
      if (rankDiff !== 0) return rankDiff;
      const dateA = String(a['first-release-date'] || '');
      const dateB = String(b['first-release-date'] || '');
      return dateB.localeCompare(dateA);
    });

  for (const rg of ordered) {
    const cachedUrl = getCachedUrl(`rg:${rg.id}`);
    if (cachedUrl) {
      dbOps.setDeezerMbidCache(rgCacheKey, rg.id as string);
      return buildArtistCoverFromUrl(cachedUrl);
    }
  }

  return null;
};

const normalizeGetArtistImageOptions = (forceRefreshOrOptions: unknown, artistNameHint: unknown): { forceRefresh: boolean; artistName: string | null } => {
  if (
    forceRefreshOrOptions &&
    typeof forceRefreshOrOptions === 'object' &&
    !Array.isArray(forceRefreshOrOptions)
  ) {
    const opts = forceRefreshOrOptions as Record<string, unknown>;
    return {
      forceRefresh: !!opts.forceRefresh,
      artistName:
        typeof opts.artistName === 'string' &&
        String(opts.artistName).trim()
          ? String(opts.artistName).trim()
          : null,
    };
  }

  return {
    forceRefresh: !!forceRefreshOrOptions,
    artistName:
      typeof artistNameHint === 'string' && artistNameHint.trim() ? artistNameHint.trim() : null,
  };
};

export const getArtistImage = async (
  mbid: string,
  forceRefreshOrOptions: unknown = false,
  artistNameHint: unknown = null,
): Promise<Record<string, unknown>> => {
  if (!mbid) return { url: null, images: [] };
  const { forceRefresh, artistName } = normalizeGetArtistImageOptions(
    forceRefreshOrOptions,
    artistNameHint,
  );

  const cachedImage = dbOps.getImage(mbid) as Record<string, unknown> | null;
  const cachedUrl = cachedImage?.imageUrl as string | undefined;
  if (
    !forceRefresh &&
    cachedImage &&
    cachedUrl &&
    cachedUrl !== 'NOT_FOUND' &&
    !LEGACY_COVER_HOST_PATTERN.test(cachedUrl)
  ) {
    const override = dbOps.getArtistOverride(mbid);
    const resolvedMbid: string = (override as Record<string, unknown>)?.musicbrainzId as string || mbid;
    const metadataArtist = await getArtistByMbid(resolvedMbid).catch(() => null);
    return {
      url: cachedUrl,
      images: await buildCachedArtistImagePayload(cachedUrl, metadataArtist as Record<string, unknown> | null),
    };
  }

  if (
    !forceRefresh &&
    ((cachedImage && cachedImage.imageUrl === 'NOT_FOUND') || hasFreshNegativeCache(mbid))
  ) {
    const override = dbOps.getArtistOverride(mbid);
    const resolvedMbid: string = (override as Record<string, unknown>)?.musicbrainzId as string || mbid;
    const recovered = await recoverArtistCoverFromCachedReleaseGroups(resolvedMbid);
    if (recovered?.url) {
      negativeImageCache.delete(mbid);
      dbOps.setImage(mbid, recovered.url as string);
      return recovered;
    }
    return { url: null, images: [], notFound: true };
  }

  if (pendingImageRequests.has(mbid)) {
    return pendingImageRequests.get(mbid);
  }

  const fetchPromise = (async () => {
    try {
      const override = dbOps.getArtistOverride(mbid);
      const resolvedMbid: string = (override as Record<string, unknown>)?.musicbrainzId as string || mbid;
      const metadataArtist = await getArtistByMbid(resolvedMbid).catch(() => null);
      const directArtistImages = sortArtistImages((metadataArtist as Record<string, unknown>)?.images as unknown[]);
      const directArtistImage = directArtistImages[0] || null;

      if (directArtistImage?.url) {
        const images = await buildDirectArtistImagePayload(directArtistImages);
        const primaryImage = images.find((image: Record<string, unknown>) => image.front) || images[0];
        if (primaryImage?.image) {
          negativeImageCache.delete(mbid);
          dbOps.setImage(mbid, primaryImage.image as string);
          return {
            url: primaryImage.image,
            images,
          };
        }
      }

      const resolvedArtistName =
        artistName || (await musicbrainzGetArtistNameByMbid(resolvedMbid).catch(() => null));
      const rgCacheKey = `artist_rg:${resolvedMbid}`;
      const cachedRg = forceRefresh ? null : dbOps.getDeezerMbidCache(rgCacheKey);
      const releaseGroups = cachedRg
        ? cachedRg === 'NOT_FOUND'
          ? []
          : [
              {
                id: cachedRg,
                title: '',
                'primary-type': 'Album',
                'first-release-date': null,
              },
            ]
        : await musicbrainzGetArtistReleaseGroupsPreview(resolvedMbid, 30);

      const ordered = releaseGroups
        .filter((rg: Record<string, unknown>) => rg?.id)
        .sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
          const rankDiff = typeRank(a['primary-type'] as string) - typeRank(b['primary-type'] as string);
          if (rankDiff !== 0) return rankDiff;
          const dateA = String(a['first-release-date'] || '');
          const dateB = String(b['first-release-date'] || '');
          return dateB.localeCompare(dateA);
        })
        .slice(0, 25);

      let nextIndex = 0;
      let foundCover: Record<string, unknown> | null = null;
      let sawTransientError = false;
      const workers = Array.from(
        { length: Math.min(RELEASE_GROUP_CONCURRENCY, ordered.length) },
        async () => {
          while (nextIndex < ordered.length && !foundCover) {
            const rg = ordered[nextIndex++];
            const cover = await fetchReleaseGroupCoverUrl(rg.id as string, {
              artistName: (resolvedArtistName || '') as string,
              albumTitle: (rg.title as string) || '',
            });
            if (cover?.imageUrl) {
              foundCover = {
                releaseGroupId: rg.id,
                imageUrl: cover.imageUrl,
                types: cover.types || ['Front'],
              };
              return;
            }
            if (cover?.transientError) {
              sawTransientError = true;
            }
          }
        },
      );

      await Promise.all(workers);
      const resolvedCover: Record<string, unknown> | null = foundCover;

      if (resolvedCover) {
        const cover = resolvedCover as Record<string, unknown>;
        negativeImageCache.delete(mbid);
        dbOps.setImage(mbid, cover.imageUrl as string);
        if (!cachedRg || forceRefresh) {
          dbOps.setDeezerMbidCache(rgCacheKey, cover.releaseGroupId as string);
        }
        return {
          url: cover.imageUrl,
          images: [
            {
              image: cover.imageUrl,
              front: true,
              types: cover.types,
            },
          ],
        };
      }

      if (sawTransientError) {
        return { url: null, images: [], transientError: true };
      }

      if (!cachedRg || forceRefresh) {
        dbOps.setDeezerMbidCache(rgCacheKey, 'NOT_FOUND');
      }
    } catch (e: unknown) {
      console.warn(`Failed to fetch image for ${mbid}:`, (e as Record<string, unknown>).message);
      return { url: null, images: [], transientError: true };
    }

    addToNegativeCache(mbid);
    dbOps.setImage(mbid, 'NOT_FOUND');

    return { url: null, images: [], notFound: true };
  })();

  addToPendingRequests(mbid, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    pendingImageRequests.delete(mbid);
  }
};
