import { dbOps } from "../config/db-helpers.js";
import {
  deezerSearchArtist,
  lastfmGetArtistNameByMbid,
  getLastfmApiKey,
  getDeezerArtistById,
} from "./apiClients.js";

const MAX_NEGATIVE_CACHE = 1000;
const MAX_PENDING_REQUESTS = 100;
const negativeImageCache = new Set();
const pendingImageRequests = new Map();

const addToNegativeCache = (mbid) => {
  if (negativeImageCache.size >= MAX_NEGATIVE_CACHE) {
    const firstKey = negativeImageCache.values().next().value;
    negativeImageCache.delete(firstKey);
  }
  negativeImageCache.add(mbid);
};

const addToPendingRequests = (mbid, promise) => {
  if (pendingImageRequests.size >= MAX_PENDING_REQUESTS) {
    const firstKey = pendingImageRequests.keys().next().value;
    pendingImageRequests.delete(firstKey);
  }
  pendingImageRequests.set(mbid, promise);
};

export const getArtistImage = async (mbid, forceRefresh = false) => {
  if (!mbid) return { url: null, images: [] };

  const cachedImage = dbOps.getImage(mbid);
  if (
    !forceRefresh &&
    cachedImage &&
    cachedImage.imageUrl &&
    cachedImage.imageUrl !== "NOT_FOUND"
  ) {
    return {
      url: cachedImage.imageUrl,
      images: [
        {
          image: cachedImage.imageUrl,
          front: true,
          types: ["Front"],
        },
      ],
    };
  }

  if (!forceRefresh && cachedImage && cachedImage.imageUrl === "NOT_FOUND") {
    dbOps.deleteImage(mbid);
    negativeImageCache.delete(mbid);
  }

  if (!forceRefresh && negativeImageCache.has(mbid)) {
    negativeImageCache.delete(mbid);
  }

  if (pendingImageRequests.has(mbid)) {
    return pendingImageRequests.get(mbid);
  }

  const fetchPromise = (async () => {
    try {
      const { libraryManager } = await import("./libraryManager.js");
      const override = dbOps.getArtistOverride(mbid);
      const resolvedMbid = override?.musicbrainzId || mbid;
      const deezerArtistId = override?.deezerArtistId || null;
      const libraryArtist = libraryManager.getArtist(mbid);
      let artistName =
        libraryArtist?.artistName ||
        (getLastfmApiKey()
          ? await lastfmGetArtistNameByMbid(resolvedMbid)
          : null);

      if (artistName) {
        try {
          const deezer = deezerArtistId
            ? await getDeezerArtistById(deezerArtistId)
            : await deezerSearchArtist(artistName);
          if (deezer?.imageUrl) {
            dbOps.setImage(mbid, deezer.imageUrl);
            return {
              url: deezer.imageUrl,
              images: [
                { image: deezer.imageUrl, front: true, types: ["Front"] },
              ],
            };
          }
        } catch (e) {}
      }
    } catch (e) {
      console.warn(`Failed to fetch image for ${mbid}:`, e.message);
    }

    addToNegativeCache(mbid);
    dbOps.setImage(mbid, "NOT_FOUND");

    return { url: null, images: [] };
  })();

  addToPendingRequests(mbid, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    pendingImageRequests.delete(mbid);
  }
};
