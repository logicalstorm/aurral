import { lidarrRequest } from "./apiClients.js";
import { LIDARR_CACHE_TTL } from "../config/constants.js";

let cachedLidarrArtists = null;
let lastLidarrFetch = 0;

export const getCachedLidarrArtists = async (forceRefresh = false) => {
  const now = Date.now();
  if (
    forceRefresh ||
    !cachedLidarrArtists ||
    now - lastLidarrFetch > LIDARR_CACHE_TTL
  ) {
    cachedLidarrArtists = (await lidarrRequest("/artist")) || [];
    lastLidarrFetch = now;
  }
  return cachedLidarrArtists;
};

export const invalidateLidarrCache = () => {
  lastLidarrFetch = 0;
};
