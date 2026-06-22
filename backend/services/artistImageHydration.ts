import { dbOps } from '../config/db-helpers.js';
import { enqueueImagePrefetchJob } from './honkerDb.js';
import { getArtistImage } from './imageService.js';
import { buildImageProxyUrl, isImageProxyLocalUrlReady } from './imageProxyService.js';

const DEFAULT_BATCH_SIZE = 12;
const DEFAULT_DELAY_MS = 15;

const LASTFM_IMAGE_PATTERN = /lastfm|audioscrobbler/i;

export const shouldReplaceExistingImage = (imageUrl: string | null | undefined) => {
  const image = String(imageUrl || '').trim();
  if (!image) return false;
  if (LASTFM_IMAGE_PATTERN.test(image)) return true;
  if (image.includes('/api/image-proxy/') && image.includes('?src=')) {
    return true;
  }
  if (image.includes('/api/image-proxy/') && !isImageProxyLocalUrlReady(image)) {
    return true;
  }
  return false;
};

const clearReplaceableImages = (artist: Record<string, unknown> | null) => {
  if (!artist || typeof artist !== 'object') return artist;
  const existing = artist.imageUrl || artist.image;
  if (!shouldReplaceExistingImage(String(existing || ''))) return artist;
  return {
    ...artist,
    image: null,
    imageUrl: null,
  };
};

const getArtistId = (artist: Record<string, unknown> | null) => artist?.id || artist?.mbid || artist?.foreignArtistId || null;

const withProxiedImageFields = (artist: Record<string, unknown> | null) => {
  if (!artist || typeof artist !== 'object') return artist;
  const rawImage = artist.imageUrl || artist.image || null;
  if (!rawImage) return artist;

  const proxiedImage = buildImageProxyUrl(String(rawImage)) || rawImage;
  if (artist.image === proxiedImage && artist.imageUrl === proxiedImage) {
    return artist;
  }

  return {
    ...artist,
    image: proxiedImage,
    imageUrl: proxiedImage,
  };
};

const applyCachedImages = (artists: unknown[] = []) => {
  const list = Array.isArray(artists) ? artists : [];
  const ids = [...new Set(list.map((artist) => getArtistId(artist as Record<string, unknown>)).filter(Boolean))] as string[];
  if (!ids.length) return list;

  const cachedImages = dbOps.getImages(ids);
  return list.map((artist) => {
    if (!artist || typeof artist !== 'object') return artist;
    const cleared = clearReplaceableImages(artist as Record<string, unknown>);
    if (cleared && (cleared.image || cleared.imageUrl)) {
      return withProxiedImageFields(cleared);
    }

    const cachedImage = (cachedImages[getArtistId(cleared) as string] as Record<string, unknown>)?.imageUrl;
    if (!cachedImage || cachedImage === 'NOT_FOUND' || shouldReplaceExistingImage(String(cachedImage || ''))) {
      return cleared;
    }
    return withProxiedImageFields({
      ...cleared,
      image: cachedImage,
      imageUrl: cachedImage,
    });
  });
};

export const hydrateArtistImages = async (
  artists = [],
  { limit = artists.length, batchSize = DEFAULT_BATCH_SIZE, delayMs = DEFAULT_DELAY_MS } = {},
) => {
  const withCached = applyCachedImages(artists);
  const pending = [];

  for (const artist of withCached) {
    if (!artist || typeof artist !== 'object') continue;
    const cleared = clearReplaceableImages(artist as Record<string, unknown>);
    Object.assign(artist, cleared);
    if ((artist as Record<string, unknown>).image || (artist as Record<string, unknown>).imageUrl) continue;
    const id = getArtistId(artist as Record<string, unknown>);
    if (!id) continue;
    pending.push({ artist, id: id as string });
    if (pending.length >= limit) break;
  }

  for (let index = 0; index < pending.length; index += batchSize) {
    const batch = pending.slice(index, index + batchSize);
    await Promise.all(
      batch.map(async ({ artist, id }) => {
        try {
          const cached = dbOps.getImage(id);
          const artistName = (artist as Record<string, unknown>).name || (artist as Record<string, unknown>).sortName || null;
          const cover = await getArtistImage(id, {
            artistName: String(artistName || '') || null,
            forceRefresh:
              cached?.imageUrl === 'NOT_FOUND' || shouldReplaceExistingImage(cached?.imageUrl as string),
          });
          if (!cover?.url) return;
          const proxiedImage = buildImageProxyUrl(cover.url as string) || cover.url;
          (artist as Record<string, unknown>).image = proxiedImage;
          (artist as Record<string, unknown>).imageUrl = proxiedImage;
        } catch {}
      }),
    );

    if (index + batchSize < pending.length && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return withCached;
};

export const primeArtistImageCache = (artists = []) => {
  const entries = (Array.isArray(artists) ? (artists as Record<string, unknown>[]) : [])
    .map((artist) => ({
      id: getArtistId(artist),
      artistName:
        typeof artist?.name === 'string' && (artist.name as string).trim()
          ? (artist.name as string).trim()
          : typeof artist?.sortName === 'string' && (artist.sortName as string).trim()
            ? (artist.sortName as string).trim()
            : null,
    }))
    .filter((artist) => artist.id)
    .filter((artist, index, list) => list.findIndex((entry) => entry.id === artist.id) === index);
  if (entries.length === 0) return Promise.resolve();

  const ids = entries.map((entry) => entry.id as string);
  const cachedImages = dbOps.getImages(ids);
  const uncached = entries.filter((entry) => {
    const cached = cachedImages[entry.id as string] as Record<string, unknown> | undefined;
    return !cached || cached.imageUrl === 'NOT_FOUND';
  });
  const artistNames = Object.fromEntries(
    uncached.filter((entry) => entry.artistName).map((entry) => [entry.id, entry.artistName]),
  );
  for (let index = 0; index < uncached.length; index += DEFAULT_BATCH_SIZE) {
    const batch = uncached.slice(index, index + DEFAULT_BATCH_SIZE);
    enqueueImagePrefetchJob({
      mbids: batch.map((entry) => entry.id),
      artistNames,
      requestedAt: Date.now(),
    });
  }
  return Promise.resolve();
};
