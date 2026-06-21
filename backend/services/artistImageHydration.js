import { dbOps } from "../config/db-helpers.js";
import { enqueueImagePrefetchJob } from "./honkerDb.js";
import { getArtistImage } from "./imageService.js";
import { buildImageProxyUrl, isImageProxyLocalUrlReady } from "./imageProxyService.js";

const DEFAULT_BATCH_SIZE = 12;
const DEFAULT_DELAY_MS = 15;

const LASTFM_IMAGE_PATTERN = /lastfm|audioscrobbler/i;

export const shouldReplaceExistingImage = (imageUrl) => {
  const image = String(imageUrl || "").trim();
  if (!image) return false;
  if (LASTFM_IMAGE_PATTERN.test(image)) return true;
  if (image.includes("/api/image-proxy/") && image.includes("?src=")) {
    return true;
  }
  if (image.includes("/api/image-proxy/") && !isImageProxyLocalUrlReady(image)) {
    return true;
  }
  return false;
};

const clearReplaceableImages = (artist) => {
  if (!artist || typeof artist !== "object") return artist;
  const existing = artist.imageUrl || artist.image;
  if (!shouldReplaceExistingImage(existing)) return artist;
  return {
    ...artist,
    image: null,
    imageUrl: null,
  };
};

const getArtistId = (artist) =>
  artist?.id || artist?.mbid || artist?.foreignArtistId || null;

const withProxiedImageFields = (artist) => {
  if (!artist || typeof artist !== "object") return artist;
  const rawImage = artist.imageUrl || artist.image || null;
  if (!rawImage) return artist;

  const proxiedImage = buildImageProxyUrl(rawImage) || rawImage;
  if (artist.image === proxiedImage && artist.imageUrl === proxiedImage) {
    return artist;
  }

  return {
    ...artist,
    image: proxiedImage,
    imageUrl: proxiedImage,
  };
};

const applyCachedImages = (artists = []) => {
  const list = Array.isArray(artists) ? artists : [];
  const ids = [...new Set(list.map((artist) => getArtistId(artist)).filter(Boolean))];
  if (!ids.length) return list;

  const cachedImages = dbOps.getImages(ids);
  return list.map((artist) => {
    if (!artist || typeof artist !== "object") return artist;
    const cleared = clearReplaceableImages(artist);
    if (cleared.image || cleared.imageUrl) {
      return withProxiedImageFields(cleared);
    }

    const cachedImage = cachedImages[getArtistId(cleared)]?.imageUrl;
    if (
      !cachedImage ||
      cachedImage === "NOT_FOUND" ||
      shouldReplaceExistingImage(cachedImage)
    ) {
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
    if (!artist || typeof artist !== "object") continue;
    const cleared = clearReplaceableImages(artist);
    Object.assign(artist, cleared);
    if (artist.image || artist.imageUrl) continue;
    const id = getArtistId(artist);
    if (!id) continue;
    pending.push({ artist, id });
    if (pending.length >= limit) break;
  }

  for (let index = 0; index < pending.length; index += batchSize) {
    const batch = pending.slice(index, index + batchSize);
    await Promise.all(
      batch.map(async ({ artist, id }) => {
        try {
          const cached = dbOps.getImage(id);
          const cover = await getArtistImage(id, {
            artistName: artist.name || artist.sortName || null,
            forceRefresh:
              cached?.imageUrl === "NOT_FOUND" ||
              shouldReplaceExistingImage(cached?.imageUrl),
          });
          if (!cover?.url) return;
          const proxiedImage = buildImageProxyUrl(cover.url) || cover.url;
          artist.image = proxiedImage;
          artist.imageUrl = proxiedImage;
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
  const entries = (Array.isArray(artists) ? artists : [])
    .map((artist) => ({
      id: getArtistId(artist),
      artistName:
        typeof artist?.name === "string" && artist.name.trim()
          ? artist.name.trim()
          : typeof artist?.sortName === "string" && artist.sortName.trim()
            ? artist.sortName.trim()
            : null,
    }))
    .filter((artist) => artist.id)
    .filter(
      (artist, index, list) =>
        list.findIndex((entry) => entry.id === artist.id) === index,
    );
  if (entries.length === 0) return Promise.resolve();

  const ids = entries.map((entry) => entry.id);
  const cachedImages = dbOps.getImages(ids);
  const uncached = entries.filter((entry) => {
    const cached = cachedImages[entry.id];
    return !cached || cached.imageUrl === "NOT_FOUND";
  });
  const artistNames = Object.fromEntries(
    uncached
      .filter((entry) => entry.artistName)
      .map((entry) => [entry.id, entry.artistName]),
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
