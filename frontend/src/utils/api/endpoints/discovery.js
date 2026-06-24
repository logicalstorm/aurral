import { getData, postData, deleteData, buildAuthenticatedApiUrl } from "../core.js";

export const getDiscovery = (cacheBust = false) => {
  const params = cacheBust ? { _: Date.now() } : {};
  return getData("/discover", { params });
};

export const adoptDiscoverPlaylistAsFlow = (presetId) =>
  postData("/discover/playlists/adopt", { presetId });

export const adoptDiscoverPlaylistAsStatic = (presetId) =>
  postData("/discover/playlists/adopt-playlist", {
    presetId,
  });

export const getDiscoverArtworkUrl = (presetId, version) =>
  buildAuthenticatedApiUrl(
    `/discover/artwork/${encodeURIComponent(presetId)}`,
    { v: version },
  );

export const getNearbyShows = async (zipCode = "", limit, options = {}) => {
  const params = { _: Date.now() };
  if (typeof zipCode === "string" && zipCode.trim()) {
    params.zip = zipCode.trim();
  }
  if (Number.isFinite(limit) && limit > 0) {
    params.limit = Math.floor(limit);
  }
  return getData("/discover/nearby-shows", {
    ...options,
    params: {
      ...(options.params || {}),
      ...params,
    },
  });
};

export const getDiscoveryFeedback = () => getData("/discover/feedback");

export const addDiscoveryFeedback = (payload) =>
  postData("/discover/feedback", payload);

export const removeDiscoveryFeedback = (id) =>
  deleteData(`/discover/feedback/${encodeURIComponent(id)}`);

export const resetDiscoveryFeedback = () => postData("/discover/feedback/reset");

export const getTagSuggestions = (q, limit = 10) =>
  getData("/discover/tags", {
    params: { q: q.trim(), limit },
  });
