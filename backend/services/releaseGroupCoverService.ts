import { dbOps } from '../config/db-helpers.js';
import { buildImageProxyUrl, warmImageProxy } from './imageProxyService.js';
import { getAlbumByMbid, resolveAlbumByArtistAndTitle } from './providers/brainzmashProvider.js';

const RG_CACHE_PREFIX = 'rg:';
const LEGACY_COVER_HOST_PATTERN =
  /https?:\/\/(?:caa\.lkly\.net|coverartarchive\.org|archive\.org|[\w-]+\.ca\.archive\.org)\//i;

const getImageUrl = (image: Record<string, unknown>) => image?.url || image?.Url || null;

const pickAlbumCoverUrl = (images: unknown[] = []) => {
  if (!Array.isArray(images) || images.length === 0) return null;
  const ranked = (images as Record<string, unknown>[])
    .map((image: Record<string, unknown>) => ({
      url: getImageUrl(image),
      kind: String(image?.kind || image?.CoverType || '')
        .trim()
        .toLowerCase(),
    }))
    .filter((entry) => entry.url);
  const preferred = ranked.find((entry: Record<string, unknown>) => ['front', 'cover', 'albumcover'].includes(entry.kind as string));
  return (preferred || ranked[0])?.url || null;
};

const toPublicCoverUrl = (imageUrl: string | null) => {
  if (!imageUrl || imageUrl === 'NOT_FOUND') return null;
  return buildImageProxyUrl(imageUrl) || imageUrl;
};

const getCachedUrl = (cacheKey: string): string | null | undefined => {
  const cached = dbOps.getImage(cacheKey) as Record<string, unknown> | null;
  if (
    cached?.imageUrl &&
    cached.imageUrl !== 'NOT_FOUND' &&
    LEGACY_COVER_HOST_PATTERN.test(cached.imageUrl as string)
  ) {
    dbOps.deleteImage(cacheKey);
    return undefined;
  }
  if (cached?.imageUrl && cached.imageUrl !== 'NOT_FOUND') {
    return cached.imageUrl as string;
  }
  if (cached?.imageUrl === 'NOT_FOUND') {
    return null;
  }
  return undefined;
};

const warmAndPersistCover = (cacheKey: string, sourceUrl: string, proxiedUrl: string) => {
  warmImageProxy(sourceUrl)
    .then((cached: Record<string, unknown>) => {
      if (cached?.localUrl) {
        dbOps.setImage(cacheKey, cached.localUrl as string);
      }
    })
    .catch(() => {});
  dbOps.setImage(cacheKey, proxiedUrl);
};

const buildReleaseGroupCoverResult = (cacheKey: string, album: Record<string, unknown>) => {
  const imageUrl = pickAlbumCoverUrl(album?.images as unknown[]);
  if (!imageUrl) {
    return { imageUrl: null, types: [], notFound: true, transientError: false };
  }
  const proxiedUrl = toPublicCoverUrl(imageUrl as string);
  if (!proxiedUrl) {
    return { imageUrl: null, types: [], notFound: true, transientError: false };
  }
  warmAndPersistCover(cacheKey, imageUrl as string, proxiedUrl);
  return {
    imageUrl: proxiedUrl,
    types: ['Front'],
    notFound: false,
    transientError: false,
  };
};

export const fetchReleaseGroupCoverUrl = async (
  releaseGroupMbid: string,
  { artistName = '', albumTitle = '' }: { artistName?: string; albumTitle?: string } = {},
): Promise<{ imageUrl: string | null; types: string[]; notFound: boolean; transientError: boolean }> => {
  const cacheKey = `${RG_CACHE_PREFIX}${releaseGroupMbid}`;
  const cached = getCachedUrl(cacheKey);
  if (cached !== undefined) {
    const imageUrl = cached === null ? null : toPublicCoverUrl(cached);
    return {
      imageUrl,
      types: [],
      notFound: cached === null,
      transientError: false,
    };
  }
  const normalizedArtistName = typeof artistName === 'string' ? artistName.trim() : '';
  const normalizedAlbumTitle = typeof albumTitle === 'string' ? albumTitle.trim() : '';
  let sawTransientError = false;
  try {
    const album = await getAlbumByMbid(releaseGroupMbid);
    const result = buildReleaseGroupCoverResult(cacheKey, album);
    if (result.imageUrl) {
      return result;
    }
  } catch {
    sawTransientError = true;
  }
  if (normalizedAlbumTitle) {
    try {
      const resolvedAlbumMbid = await resolveAlbumByArtistAndTitle({
        artistName: normalizedArtistName,
        albumTitle: normalizedAlbumTitle,
      });
      if (resolvedAlbumMbid && resolvedAlbumMbid !== releaseGroupMbid) {
        const resolvedAlbum = await getAlbumByMbid(resolvedAlbumMbid as unknown as string);
        const result = buildReleaseGroupCoverResult(cacheKey, resolvedAlbum);
        if (result.imageUrl) {
          return result;
        }
      }
    } catch {
      sawTransientError = true;
    }
  }
  if (sawTransientError) {
    return { imageUrl: null, types: [], notFound: false, transientError: true };
  }
  dbOps.setImage(cacheKey, 'NOT_FOUND');
  return { imageUrl: null, types: [], notFound: true, transientError: false };
};

const normalizeBatchItem = (item: Record<string, unknown> | null) => {
  const mbid = String(item?.mbid || item?.id || '').trim();
  if (!mbid) return null;
  const rawArtistName = item?.artistName;
  const rawAlbumTitle = item?.albumTitle;
  return {
    mbid,
    artistName: typeof rawArtistName === 'string' ? rawArtistName.trim() : '',
    albumTitle: typeof rawAlbumTitle === 'string' ? rawAlbumTitle.trim() : '',
  };
};

export const attachCachedCoverUrls = <T extends Record<string, unknown>>(releaseGroups: T[] = [], limit: number | null = null): T[] => {
  if (!Array.isArray(releaseGroups) || releaseGroups.length === 0) {
    return releaseGroups;
  }
  const targets =
    typeof limit === 'number' && limit > 0 ? releaseGroups.slice(0, limit) : releaseGroups;
  const targetIds = new Set(targets.map((releaseGroup: T) => releaseGroup?.id).filter(Boolean));
  if (targetIds.size === 0) {
    return releaseGroups;
  }
  const cachedEntries = dbOps.getImages([...targetIds].map((id: unknown) => `${RG_CACHE_PREFIX}${id}`)) as Record<string, Record<string, unknown>>;
  return releaseGroups.map((releaseGroup: T) => {
    if (!releaseGroup?.id || !targetIds.has(releaseGroup.id)) {
      return releaseGroup;
    }
    const cached = cachedEntries[`${RG_CACHE_PREFIX}${releaseGroup.id}`] as Record<string, unknown> | undefined;
    if (!cached?.imageUrl || cached.imageUrl === 'NOT_FOUND') {
      return releaseGroup;
    }
    const coverUrl = toPublicCoverUrl(cached.imageUrl as string);
    if (!coverUrl) {
      return releaseGroup;
    }
    return { ...releaseGroup, coverUrl };
  }) as T[];
};

export const resolveReleaseGroupCoversBatch = async (items: Record<string, unknown>[] = [], { concurrency = 6 }: { concurrency?: number } = {}): Promise<Record<string, { image: string | null; notFound: boolean; transientError?: boolean }>> => {
  const seen = new Set<string>();
  const normalized = items
    .map(normalizeBatchItem)
    .filter((item): item is { mbid: string; artistName: string; albumTitle: string } => {
      if (!item || seen.has(item.mbid)) return false;
      seen.add(item.mbid);
      return true;
    })
    .slice(0, 24);
  if (!normalized.length) {
    return {};
  }

  const covers: Record<string, { image: string | null; notFound: boolean; transientError?: boolean }> = {};
  const cachedEntries = dbOps.getImages(normalized.map((item) => `${RG_CACHE_PREFIX}${item.mbid}`)) as Record<string, Record<string, unknown>>;
  const missing: { mbid: string; artistName: string; albumTitle: string }[] = [];

  for (const item of normalized) {
    const cacheKey = `${RG_CACHE_PREFIX}${item.mbid}`;
    const cached = cachedEntries[cacheKey] as Record<string, unknown> | undefined;
    if (cached?.imageUrl && cached.imageUrl !== 'NOT_FOUND') {
      const imageUrl = toPublicCoverUrl(cached.imageUrl as string);
      if (imageUrl) {
        covers[item.mbid] = { image: imageUrl, notFound: false };
        continue;
      }
    }
    if (cached?.imageUrl === 'NOT_FOUND') {
      covers[item.mbid] = { image: null, notFound: true };
      continue;
    }
    missing.push(item);
  }

  const safeConcurrency = Math.min(12, Math.max(1, Number.parseInt(concurrency as unknown as string, 10) || 6));

  for (let index = 0; index < missing.length; index += safeConcurrency) {
    const batch = missing.slice(index, index + safeConcurrency);
    const results = await Promise.allSettled(
      batch.map((item) =>
        fetchReleaseGroupCoverUrl(item.mbid, {
          artistName: item.artistName,
          albumTitle: item.albumTitle,
        }),
      ),
    );
    batch.forEach((item, batchIndex) => {
      const entry = results[batchIndex];
      if (entry.status !== 'fulfilled') {
        covers[item.mbid] = { image: null, notFound: false, transientError: true };
        return;
      }
      const value = entry.value;
      if (value?.imageUrl) {
        covers[item.mbid] = { image: value.imageUrl, notFound: false };
        return;
      }
      if (value?.notFound) {
        covers[item.mbid] = { image: null, notFound: true };
        return;
      }
      covers[item.mbid] = {
        image: null,
        notFound: false,
        transientError: !!value?.transientError,
      };
    });
  }

  return covers;
};
