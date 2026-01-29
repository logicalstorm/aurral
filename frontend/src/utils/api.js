import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use(
  (config) => {
    const password = localStorage.getItem("auth_password");
    const username = localStorage.getItem("auth_user") || "admin";
    if (password) {
      const token = btoa(`${username}:${password}`);
      config.headers["Authorization"] = `Basic ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    return Promise.reject(error);
  },
);

export const checkHealth = async () => {
  const response = await api.get("/health");
  return response.data;
};

export const getAuthConfig = async () => {
  const response = await api.get("/auth/config");
  return response.data;
};

export const searchArtists = async (query, limit = 24, offset = 0) => {
  const response = await api.get("/search/artists", {
    params: { query, limit, offset },
  });
  return response.data;
};

export const getArtistDetails = async (mbid, artistName) => {
  const response = await api.get(`/artists/${mbid}`, {
    params: artistName ? { artistName } : {},
  });
  return response.data;
};

export const getReleaseGroupTracks = async (mbid) => {
  const response = await api.get(`/artists/release-group/${mbid}/tracks`);
  return response.data;
};

export const getArtistCover = async (mbid, artistName) => {
  const params = {};
  if (artistName && typeof artistName === "string" && artistName.trim()) {
    params.artistName = artistName.trim();
  }
  const response = await api.get(`/artists/${mbid}/cover`, {
    params,
    timeout: 4000,
  });
  return response.data;
};

export const getReleaseGroupCover = async (mbid) => {
  const response = await api.get(`/artists/release-group/${mbid}/cover`);
  return response.data;
};

export const getSimilarArtistsForArtist = async (mbid, limit = 20) => {
  const response = await api.get(`/artists/${mbid}/similar`, {
    params: { limit },
  });
  return response.data;
};

export const getArtistPreview = async (mbid, artistName) => {
  const response = await api.get(`/artists/${mbid}/preview`, {
    params: artistName ? { artistName } : {},
  });
  return response.data;
};

export const getStreamUrl = (songId) => {
  const base = import.meta.env.VITE_API_URL || "/api";
  const password = localStorage.getItem("auth_password");
  const username = localStorage.getItem("auth_user") || "admin";
  let url = `${base}/library/stream/${encodeURIComponent(songId)}`;
  if (password) {
    const token = btoa(`${username}:${password}`);
    url += `?token=${encodeURIComponent(token)}`;
  }
  return url;
};

export const getLibraryArtists = async () => {
  const response = await api.get("/library/artists");
  return response.data;
};

export const clearLibrary = async (deleteFiles = false) => {
  const response = await api.delete("/library/clear", {
    params: { deleteFiles },
  });
  return response.data;
};

export const getLibraryArtist = async (mbid) => {
  const response = await api.get(`/library/artists/${mbid}`);
  const artist = response.data;
  if (artist && !artist.foreignArtistId) {
    artist.foreignArtistId = artist.mbid;
  }
  return artist;
};

export const lookupArtistInLibrary = async (mbid) => {
  const response = await api.get(`/library/lookup/${mbid}`);
  return response.data;
};

export const lookupArtistsInLibraryBatch = async (mbids) => {
  const response = await api.post("/library/lookup/batch", { mbids });
  return response.data;
};

export const addArtistToLibrary = async (artistData) => {
  const response = await api.post("/library/artists", artistData);
  return response.data;
};

export const deleteArtistFromLibrary = async (mbid, deleteFiles = false) => {
  const response = await api.delete(`/library/artists/${mbid}`, {
    params: { deleteFiles },
  });
  return response.data;
};

export const deleteAlbumFromLibrary = async (id, deleteFiles = false) => {
  const response = await api.delete(`/library/albums/${id}`, {
    params: { deleteFiles },
  });
  return response.data;
};

export const getLibraryRootFolders = async () => {
  const response = await api.get("/library/rootfolder");
  return response.data;
};

export const getLibraryQualityProfiles = async () => {
  const response = await api.get("/library/qualityprofile");
  return response.data;
};

export const getLibraryAlbums = async (artistId) => {
  const response = await api.get("/library/albums", {
    params: { artistId },
  });
  return response.data.map((album) => ({
    ...album,
    foreignAlbumId: album.foreignAlbumId || album.mbid,
  }));
};

export const addLibraryAlbum = async (
  artistId,
  releaseGroupMbid,
  albumName,
) => {
  const response = await api.post("/library/albums", {
    artistId,
    releaseGroupMbid,
    albumName,
  });
  return response.data;
};

export const getLibraryTracks = async (albumId, releaseGroupMbid = null) => {
  const params = { albumId };
  if (releaseGroupMbid) {
    params.releaseGroupMbid = releaseGroupMbid;
  }
  const response = await api.get("/library/tracks", { params });
  return response.data;
};

export const updateLibraryAlbum = async (id, data) => {
  const response = await api.put(`/library/albums/${id}`, data);
  return response.data;
};

export const updateLibraryArtist = async (mbid, data) => {
  const response = await api.put(`/library/artists/${mbid}`, data);
  return response.data;
};

export const downloadAlbum = async (artistId, albumId, options = {}) => {
  const response = await api.post("/library/downloads/album", {
    artistId,
    albumId,
    artistMbid: options.artistMbid,
    artistName: options.artistName,
  });
  return response.data;
};

export const downloadTrack = async (artistId, trackId) => {
  const response = await api.post("/library/downloads/track", {
    artistId,
    trackId,
  });
  return response.data;
};

export const getDownloadStatus = async (albumIds) => {
  const ids = Array.isArray(albumIds) ? albumIds.join(",") : albumIds;
  const response = await api.get(`/library/downloads/status?albumIds=${ids}`);
  return response.data;
};

export const getAllDownloadStatus = async () => {
  const response = await api.get("/library/downloads/status/all");
  return response.data;
};

export const refreshLibraryArtist = async (mbid) => {
  const response = await api.post(`/library/artists/${mbid}/refresh`);
  return response.data;
};

export const getRequests = async () => {
  const response = await api.get("/requests");
  return response.data;
};

export const deleteRequest = async (id) => {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (uuidRegex.test(id)) {
    const response = await api.delete(`/requests/${id}`);
    return response.data;
  } else {
    const response = await api.delete(`/requests/album/${id}`);
    return response.data;
  }
};

export const getRecentlyAdded = async () => {
  const response = await api.get("/library/recent");
  return response.data;
};

export const getDiscovery = async () => {
  const response = await api.get("/discover");
  return response.data;
};

export const getRelatedArtists = async (limit = 20) => {
  const response = await api.get("/discover/related", {
    params: { limit },
  });
  return response.data;
};

export const getSimilarArtists = async (limit = 20) => {
  const response = await api.get("/discover/similar", {
    params: { limit },
  });
  return response.data;
};

export const searchArtistsByTag = async (tag, limit = 24, offset = 0) => {
  const response = await api.get("/discover/by-tag", {
    params: { tag, limit, offset },
  });
  return response.data;
};

export const verifyCredentials = async (password, username = "admin") => {
  const token = btoa(`${username}:${password}`);
  try {
    await api.get("/settings", {
      headers: {
        Authorization: `Basic ${token}`,
      },
    });
    return true;
  } catch (error) {
    if (error.response && error.response.status === 401) {
      return false;
    }
    throw error;
  }
};

export const getAppSettings = async () => {
  const response = await api.get("/settings");
  return response.data;
};

export const updateAppSettings = async (settings) => {
  const response = await api.post("/settings", settings);
  return response.data;
};

export const getLidarrProfiles = async (url, apiKey) => {
  const params = new URLSearchParams();
  if (url) params.append("url", url);
  if (apiKey) params.append("apiKey", apiKey);
  const queryString = params.toString();
  const endpoint = `/settings/lidarr/profiles${queryString ? `?${queryString}` : ""}`;
  const response = await api.get(endpoint);
  return response.data;
};

export const testLidarrConnection = async (url, apiKey) => {
  const params = new URLSearchParams();
  if (url) params.append("url", url);
  if (apiKey) params.append("apiKey", apiKey);
  const queryString = params.toString();
  const endpoint = `/settings/lidarr/test${queryString ? `?${queryString}` : ""}`;
  const response = await api.get(endpoint);
  return response.data;
};

export const applyLidarrCommunityGuide = async () => {
  const response = await api.post("/settings/lidarr/apply-community-guide");
  return response.data;
};

export default api;
