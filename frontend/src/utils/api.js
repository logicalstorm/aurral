import axios from "axios";
import { getAppBasePath } from "./basePath.js";

const getDefaultApiBaseUrl = () => {
  if (import.meta.env.DEV) return "/api";
  const basePath = getAppBasePath();
  if (basePath === "/") return "/api";
  return `${basePath}/api`;
};

const API_BASE_URL = import.meta.env.VITE_API_URL || getDefaultApiBaseUrl();

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

export const AUTH_INVALID_EVENT = "aurral:auth-invalid";

const AUTH_TOKEN_KEY = "auth_token";
const AUTH_PASSWORD_KEY = "auth_password";
const AUTH_USER_KEY = "auth_user";

function readAuthFromStorage(storage) {
  if (!storage) return { token: "" };
  return {
    token: storage.getItem(AUTH_TOKEN_KEY) || "",
  };
}

export const getStoredAuth = () => {
  const localAuth = readAuthFromStorage(globalThis?.localStorage);
  if (localAuth.token) return localAuth;
  const sessionAuth = readAuthFromStorage(globalThis?.sessionStorage);
  if (sessionAuth.token && globalThis?.localStorage) {
    globalThis.localStorage.setItem(AUTH_TOKEN_KEY, sessionAuth.token);
    return sessionAuth;
  }
  return sessionAuth;
};

export const setStoredAuth = ({ token = "" } = {}) => {
  if (!token) {
    globalThis?.sessionStorage?.removeItem(AUTH_TOKEN_KEY);
    globalThis?.localStorage?.removeItem(AUTH_TOKEN_KEY);
    return;
  }
  globalThis?.sessionStorage?.setItem(AUTH_TOKEN_KEY, token);
  globalThis?.localStorage?.setItem(AUTH_TOKEN_KEY, token);
  globalThis.localStorage?.removeItem(AUTH_PASSWORD_KEY);
  globalThis.localStorage?.removeItem(AUTH_USER_KEY);
};

export const clearAuthStorage = () => {
  globalThis?.sessionStorage?.removeItem(AUTH_TOKEN_KEY);
  globalThis?.localStorage?.removeItem(AUTH_TOKEN_KEY);
  globalThis?.sessionStorage?.removeItem(AUTH_PASSWORD_KEY);
  globalThis?.sessionStorage?.removeItem(AUTH_USER_KEY);
  globalThis?.localStorage?.removeItem(AUTH_PASSWORD_KEY);
  globalThis?.localStorage?.removeItem(AUTH_USER_KEY);
};

const libraryLookupCache = new Map();
const MAX_LIBRARY_LOOKUP_CACHE_SIZE = 1000;
const coverResponseCache = new Map();
const coverInflightRequests = new Map();
const MAX_COVER_CACHE_SIZE = 1000;
const COVER_CACHE_TTL_MS = 30 * 60 * 1000;
const EMPTY_COVER_CACHE_TTL_MS = 60 * 1000;
const searchInflightRequests = new Map();

const setLibraryLookupCacheEntry = (id, value) => {
  if (id == null) return;
  if (libraryLookupCache.has(id)) {
    libraryLookupCache.delete(id);
  }
  libraryLookupCache.set(id, value);
  if (libraryLookupCache.size > MAX_LIBRARY_LOOKUP_CACHE_SIZE) {
    const oldestKey = libraryLookupCache.keys().next().value;
    if (oldestKey !== undefined) {
      libraryLookupCache.delete(oldestKey);
    }
  }
};

const setCoverCacheEntry = (key, value) => {
  if (!key) return;
  const images = Array.isArray(value?.images) ? value.images : [];
  const ttlMs = images.length > 0 ? COVER_CACHE_TTL_MS : EMPTY_COVER_CACHE_TTL_MS;
  if (coverResponseCache.has(key)) {
    coverResponseCache.delete(key);
  }
  coverResponseCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  if (coverResponseCache.size > MAX_COVER_CACHE_SIZE) {
    const oldestKey = coverResponseCache.keys().next().value;
    if (oldestKey !== undefined) {
      coverResponseCache.delete(oldestKey);
    }
  }
};

const getCoverCacheEntry = (key) => {
  const entry = coverResponseCache.get(key);
  if (!entry) return null;
  if (Date.now() >= Number(entry.expiresAt || 0)) {
    coverResponseCache.delete(key);
    return null;
  }
  return entry.value;
};

const fetchCoverWithMemo = async (key, requestFactory, { bypassCache = false } = {}) => {
  if (!bypassCache) {
    const cached = getCoverCacheEntry(key);
    if (cached) {
      return cached;
    }
  }

  if (coverInflightRequests.has(key)) {
    return coverInflightRequests.get(key);
  }

  const request = requestFactory()
    .then((response) => {
      setCoverCacheEntry(key, response);
      return response;
    })
    .finally(() => {
      coverInflightRequests.delete(key);
    });

  coverInflightRequests.set(key, request);
  return request;
};

const fetchInflightOnce = async (store, key, requestFactory) => {
  if (store.has(key)) {
    return store.get(key);
  }

  const request = requestFactory().finally(() => {
    store.delete(key);
  });
  store.set(key, request);
  return request;
};

const responseData = (request) => request.then((response) => response.data);
const getData = (url, config) => responseData(api.get(url, config));
const postData = (url, data, config) => responseData(api.post(url, data, config));
const putData = (url, data, config) => responseData(api.put(url, data, config));
const patchData = (url, data, config) => responseData(api.patch(url, data, config));
const deleteData = (url, config) => responseData(api.delete(url, config));

const lidarrCredentialParams = (url, apiKey, { trimUrl = false } = {}) => ({
  ...(url ? { url: trimUrl ? url.replace(/\/+$/, "") : url } : {}),
  ...(apiKey ? { apiKey } : {}),
});

const getApiBaseUrl = () => import.meta.env.VITE_API_URL || getDefaultApiBaseUrl();

const buildAuthenticatedApiUrl = (path, params = {}) => {
  const normalizedPath = String(path || "").startsWith("/")
    ? String(path || "")
    : `/${String(path || "")}`;
  const query = new URLSearchParams();
  const { token } = getStoredAuth();
  if (token) query.set("token", token);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") query.set(key, String(value));
  });
  const queryString = query.toString();
  const separator = normalizedPath.includes("?") ? "&" : "?";
  return `${getApiBaseUrl()}${normalizedPath}${
    queryString ? `${separator}${queryString}` : ""
  }`;
};

api.interceptors.request.use(
  (config) => {
    const { token } = getStoredAuth();
    if (token) {
      config.headers["Authorization"] = `Bearer ${token}`;
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
    const status = error?.response?.status;
    const code = error?.response?.data?.code;
    const serverMessage =
      error?.response?.data?.message || error?.response?.data?.error;
    if (serverMessage) {
      error.message = String(serverMessage);
    }
    if (status === 401 && code === "SESSION_INVALID") {
      clearAuthStorage();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(AUTH_INVALID_EVENT));
      }
    }
    return Promise.reject(error);
  },
);

export const checkHealth = () => getData("/health");

export const getBootstrapStatus = () => getData("/health/bootstrap");

export const browseFilesystem = (pathValue) =>
  getData("/filesystem/browse", {
    params: pathValue ? { path: pathValue } : undefined,
  });

export const ensureFilesystemPath = (pathValue) =>
  postData("/filesystem/ensure", {
    path: pathValue,
  });

export const loginApi = (username, password) =>
  postData("/auth/login", { username, password });

export const logoutApi = () => postData("/auth/logout");

export const getMe = () => getData("/auth/me");

export const completeOnboarding = (payload) =>
  postData("/onboarding/complete", payload);

export const testLidarrOnboarding = (url, apiKey) =>
  getData("/onboarding/lidarr/test", {
    params: lidarrCredentialParams(url, apiKey, { trimUrl: true }),
  });

export const testNavidromeOnboarding = (url, username, password) =>
  postData("/onboarding/navidrome/test", {
    url: url?.replace(/\/+$/, ""),
    username,
    password,
  });

export const startPlexAuth = (forwardUrl) =>
  postData("/settings/plex/auth/pin", { forwardUrl });

export const checkPlexAuth = (pinId, code) =>
  postData("/settings/plex/auth/check", { pinId, code });

export const getPlexResources = (token) =>
  postData("/settings/plex/resources", { token });

export const testPlexConnection = (url, token) =>
  postData("/settings/plex/test", {
    url: url?.replace(/\/+$/, ""),
    token,
  });

export const syncPlexNow = () => postData("/settings/plex/sync");

export const browsePaths = (path) =>
  getData("/settings/browse", {
    params: path ? { path } : {},
  });

export const searchUnified = async (
  query,
  { mode = "suggest", limit } = {},
) => {
  const params = { q: query, mode };
  if (limit != null) {
    params.limit = limit;
  }
  const key = `search-unified:${JSON.stringify(params)}`;
  const timeoutMs = mode === "full" ? 30000 : 12000;
  return fetchInflightOnce(searchInflightRequests, key, () =>
    getData("/search/unified", {
      params,
      timeout: timeoutMs,
    }),
  );
};

export const searchCatalog = async (
  query,
  scope = "artist",
  {
    limit = 24,
    offset = 0,
    releaseTypes = [],
    sort,
  } = {},
) => {
  const params = { q: query, scope, limit, offset };
  if (scope === "album") {
    if (Array.isArray(releaseTypes) && releaseTypes.length) {
      params.releaseTypes = releaseTypes.join(",");
    }
    if (sort) {
      params.sort = sort;
    }
  }
  const key = `search:${JSON.stringify(params)}`;
  return fetchInflightOnce(searchInflightRequests, key, () =>
    getData("/search", { params }),
  );
};

export const getArtistDetails = async (
  mbid,
  artistName,
  { mode = "", releaseTypes = [], appearsOnLimit = null } = {},
) => {
  const params = {};
  if (artistName) {
    params.artistName = artistName;
  }
  if (mode) {
    params.mode = mode;
  }
  if (Array.isArray(releaseTypes) && releaseTypes.length > 0) {
    params.releaseTypes = releaseTypes.join(",");
  }
  if (Number.isFinite(Number(appearsOnLimit)) && Number(appearsOnLimit) > 0) {
    params.appearsOnLimit = Number.parseInt(appearsOnLimit, 10);
  }
  return getData(`/artists/${mbid}`, {
    params,
  });
};

export const getReleaseGroupDetails = (mbid) =>
  getData(`/artists/release-group/${mbid}`);

export const getReleaseGroupTracks = async (mbid, context = {}) => {
  const params = {};
  if (context.artistMbid) params.artistMbid = context.artistMbid;
  if (context.artistName) params.artistName = context.artistName;
  if (context.albumTitle) params.albumTitle = context.albumTitle;
  if (context.releaseType) params.releaseType = context.releaseType;
  if (context.releaseDate) params.releaseDate = context.releaseDate;
  if (context.deezerAlbumId) params.deezerAlbumId = context.deezerAlbumId;
  return getData(`/artists/release-group/${mbid}/tracks`, {
    params,
  });
};

export const getArtistCover = async (mbid, artistName, refresh = false) => {
  const params = {};
  if (artistName && typeof artistName === "string" && artistName.trim()) {
    params.artistName = artistName.trim();
  }
  if (refresh) {
    params.refresh = true;
  }
  const cacheKey = `artist:${mbid}`;
  return fetchCoverWithMemo(
    cacheKey,
    () =>
      getData(`/artists/${mbid}/cover`, {
        params,
        timeout: 4000,
      }),
    { bypassCache: refresh },
  );
};

export const getReleaseGroupCoversBatch = async (items = []) => {
  const normalizedItems = (Array.isArray(items) ? items : [])
    .map((item) => ({
      mbid: String(item?.mbid || item?.id || "").trim(),
      artistName:
        typeof item?.artistName === "string" ? item.artistName.trim() : "",
      albumTitle:
        typeof item?.albumTitle === "string" ? item.albumTitle.trim() : "",
    }))
    .filter((item) => item.mbid);
  if (!normalizedItems.length) {
    return {};
  }
  const batchKey = normalizedItems
    .map(
      (item) =>
        `${item.mbid}:${item.artistName.toLowerCase()}:${item.albumTitle.toLowerCase()}`,
    )
    .sort()
    .join("\0");
  if (coverInflightRequests.has(batchKey)) {
    return coverInflightRequests.get(batchKey);
  }
  const request = postData("/artists/release-groups/covers", {
    items: normalizedItems,
  })
    .then((data) => data?.covers || {})
    .finally(() => {
      coverInflightRequests.delete(batchKey);
    });
  coverInflightRequests.set(batchKey, request);
  return request;
};

export const getReleaseGroupCover = async (
  mbid,
  { artistName = "", albumTitle = "", bypassCache = false } = {},
) => {
  const normalizedArtistName =
    typeof artistName === "string" ? artistName.trim().toLowerCase() : "";
  const normalizedAlbumTitle =
    typeof albumTitle === "string" ? albumTitle.trim().toLowerCase() : "";
  const cacheKey = `release-group:${mbid}:${normalizedArtistName}:${normalizedAlbumTitle}`;
  if (!bypassCache) {
    const cached = getCoverCacheEntry(cacheKey);
    if (cached) {
      return cached;
    }
  }
  if (coverInflightRequests.has(cacheKey)) {
    return coverInflightRequests.get(cacheKey);
  }
  const request = (async () => {
    const params = {};
    if (typeof artistName === "string" && artistName.trim()) {
      params.artistName = artistName.trim();
    }
    if (typeof albumTitle === "string" && albumTitle.trim()) {
      params.albumTitle = albumTitle.trim();
    }
    const data = await getData(`/artists/release-group/${mbid}/cover`, {
      params,
    });
    if (!data?.transientError) {
      setCoverCacheEntry(cacheKey, data);
    }
    return data;
  })().finally(() => {
    coverInflightRequests.delete(cacheKey);
  });
  coverInflightRequests.set(cacheKey, request);
  return request;
};

export const getSimilarArtistsForArtist = (
  mbid,
  artistName = "",
  limit = 20,
) =>
  getData(`/artists/${mbid}/similar`, {
    params: {
      limit,
      ...(artistName && typeof artistName === "string" && artistName.trim()
        ? { artistName: artistName.trim() }
        : {}),
    },
  });

export const getArtistPreview = (mbid, artistName) =>
  getData(`/artists/${mbid}/preview`, {
    params: artistName ? { artistName } : {},
  });

export const getArtistTopSongVideo = (
  mbid,
  artistName,
  trackTitle,
  options = {},
) =>
  getData(`/artists/${mbid}/video`, {
    params: { artistName, trackTitle },
    signal: options.signal,
  });

export const getArtistOverrides = (mbid) =>
  getData(`/artists/${mbid}/overrides`);

export const updateArtistOverrides = (
  mbid,
  { musicbrainzId = null, deezerArtistId = null } = {},
) =>
  putData(`/artists/${mbid}/overrides`, {
    musicbrainzId,
    deezerArtistId,
  });

const buildStreamUrl = (path) => buildAuthenticatedApiUrl(path);

export const getFlowTrackStreamUrl = (jobId) =>
  buildAuthenticatedApiUrl(`/playlists/stream/${encodeURIComponent(jobId)}`);

export const getFlowArtworkUrl = (playlistId, version) =>
  buildAuthenticatedApiUrl(
    `/playlists/artwork/${encodeURIComponent(playlistId)}`,
    { v: version },
  );

export const uploadFlowArtwork = (playlistId, file) =>
  putData(
    `/playlists/artwork/${encodeURIComponent(playlistId)}`,
    file,
    {
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
    },
  );

export const deleteFlowArtwork = (playlistId) =>
  deleteData(
    `/playlists/artwork/${encodeURIComponent(playlistId)}`,
  );

export const generateFlowArtwork = (playlistId) =>
  postData(
    `/playlists/artwork/${encodeURIComponent(playlistId)}/generate`,
  );

export const getLibraryArtists = (options = {}) =>
  getData("/library/artists", options);

export const getLibraryArtist = async (mbid) => {
  const artist = await getData(`/library/artists/${mbid}`);
  if (artist && !artist.foreignArtistId) {
    artist.foreignArtistId = artist.mbid;
  }
  return artist;
};

export const lookupArtistInLibrary = (mbid) => getData(`/library/lookup/${mbid}`);

export const readLibraryLookupCache = (mbids) => {
  const result = {};
  if (!Array.isArray(mbids)) return result;
  mbids.forEach((id) => {
    if (libraryLookupCache.has(id)) {
      result[id] = libraryLookupCache.get(id);
    }
  });
  return result;
};

const writeLibraryLookupCache = (lookup) => {
  if (!lookup || typeof lookup !== "object") return;
  Object.entries(lookup).forEach(([id, value]) => {
    setLibraryLookupCacheEntry(id, value);
  });
};

export const lookupArtistsInLibraryBatch = async (mbids) => {
  const data = await postData("/library/lookup/batch", { mbids });
  writeLibraryLookupCache(data);
  return data;
};

export const lookupAlbumsInLibraryBatch = (mbids) =>
  postData("/library/albums/lookup/batch", { mbids });

export const addArtistToLibrary = (artistData) =>
  postData("/library/artists", artistData);

export const deleteArtistFromLibrary = (mbid, deleteFiles = false) =>
  deleteData(`/library/artists/${mbid}`, {
    params: { deleteFiles },
  });

export const deleteAlbumFromLibrary = (id, deleteFiles = false) =>
  deleteData(`/library/albums/${id}`, {
    params: { deleteFiles },
  });

export const getLibraryAlbums = async (artistId) => {
  const data = await getData("/library/albums", {
    params: { artistId },
  });
  return data.map((album) => ({
    ...album,
    foreignAlbumId: album.foreignAlbumId || album.mbid,
  }));
};

export const addLibraryAlbum = async (
  artistId,
  releaseGroupMbid,
  albumName,
) =>
  postData("/library/albums", {
    artistId,
    releaseGroupMbid,
    albumName,
  });

export const requestAlbumFromSearch = (payload) =>
  postData("/library/albums/request", payload);

export const getLibraryTracks = async (
  albumId,
  releaseGroupMbid = null,
  context = {},
) => {
  const params = { albumId };
  if (releaseGroupMbid) {
    params.releaseGroupMbid = releaseGroupMbid;
  }
  if (context.artistName) params.artistName = context.artistName;
  if (context.albumTitle) params.albumTitle = context.albumTitle;
  if (context.releaseType) params.releaseType = context.releaseType;
  if (context.releaseDate) params.releaseDate = context.releaseDate;
  if (context.deezerAlbumId) params.deezerAlbumId = context.deezerAlbumId;
  const data = await getData("/library/tracks", { params });
  const tracks = Array.isArray(data) ? data : [];
  return Promise.all(
    tracks.map(async (track) => {
      if (!track?.streamPath) return track;
      return {
        ...track,
        preview_url: await buildStreamUrl(track.streamPath),
        previewProvider: "lidarr",
      };
    }),
  );
};

export const updateLibraryAlbum = (id, data) =>
  putData(`/library/albums/${id}`, data);

export const updateLibraryArtist = (mbid, data) =>
  putData(`/library/artists/${mbid}`, data);

export const downloadAlbum = (artistId, albumId, options = {}) =>
  postData("/library/downloads/album", {
    artistId,
    albumId,
    artistMbid: options.artistMbid,
    artistName: options.artistName,
  });

export const triggerAlbumSearch = (albumId) =>
  postData("/library/downloads/album/search", {
    albumId,
  });

export const getDownloadStatus = async (albumIds) => {
  const ids = Array.isArray(albumIds) ? albumIds.join(",") : albumIds;
  return getData(`/library/downloads/status?albumIds=${ids}`);
};

export const refreshLibraryArtist = (mbid) =>
  postData(`/library/artists/${mbid}/refresh`);

export const getRequests = () => getData("/requests");

export const getRecentlyAdded = () => getData("/library/recent");

export const getRecentReleases = () => getData("/library/recent-releases");

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

export const getUsers = () => getData("/users");

export const createUser = (username, password, role, permissions) =>
  postData("/users", {
    username,
    password,
    role,
    permissions,
  });

export const updateUser = (id, data) => patchData(`/users/${id}`, data);

export const deleteUser = async (id) => {
  await deleteData(`/users/${id}`);
};

export const changeMyPassword = async (currentPassword, newPassword) => {
  await postData("/users/me/password", { currentPassword, newPassword });
};

export const getMyListeningHistory = () => getData("/users/me/listening-history");

export const getMyLidarrPreferences = () =>
  getData("/users/me/lidarr-preferences");

export const getMyDiscoverLayout = () => getData("/users/me/discover-layout");

export const updateMyListeningHistory = (userId, payload) =>
  patchData(`/users/${userId}`, payload);

export const updateMyLidarrPreferences = (payload) =>
  patchData("/users/me/lidarr-preferences", payload);

export const updateMyDiscoverLayout = (layout) =>
  patchData("/users/me/discover-layout", { layout });

export const getAppSettings = () => getData("/settings");

export const updateAppSettings = (settings) => postData("/settings", settings);

export const getLidarrProfiles = (url, apiKey) =>
  getData("/settings/lidarr/profiles", {
    params: lidarrCredentialParams(url, apiKey),
  });

export const getLidarrMetadataProfiles = (url, apiKey) =>
  getData("/settings/lidarr/metadata-profiles", {
    params: lidarrCredentialParams(url, apiKey),
  });

export const getLidarrTags = (url, apiKey) =>
  getData("/settings/lidarr/tags", {
    params: lidarrCredentialParams(url, apiKey),
  });

export const testSlskdConnection = () => postData("/settings/slskd/test");

export const testProwlarrConnection = () => postData("/settings/prowlarr/test");

export const getProwlarrIndexers = () => getData("/settings/prowlarr/indexers");

export const testNzbgetConnection = () => postData("/settings/nzbget/test");

export const testLidarrConnection = (url, apiKey) =>
  getData("/settings/lidarr/test", {
    params: lidarrCredentialParams(url, apiKey),
  });

export const testLidarrLibraryAccess = (url, apiKey) =>
  getData("/settings/lidarr/test-library-access", {
    params: lidarrCredentialParams(url, apiKey),
  });

export const testLidarrLibraryAccessOnboarding = (url, apiKey) =>
  getData("/onboarding/lidarr/test-library-access", {
    params: lidarrCredentialParams(url, apiKey),
  });

export const getLidarrProfilesOnboarding = (url, apiKey) =>
  getData("/onboarding/lidarr/profiles", {
    params: lidarrCredentialParams(url, apiKey),
  });

export const getLidarrMetadataProfilesOnboarding = (url, apiKey) =>
  getData("/onboarding/lidarr/metadata-profiles", {
    params: lidarrCredentialParams(url, apiKey),
  });

export const applyLidarrCommunityGuideOnboarding = (url, apiKey) =>
  postData("/onboarding/lidarr/apply-community-guide", {
    url: url?.replace(/\/+$/, ""),
    apiKey,
  });

export const testSlskdOnboarding = (url, apiKey) =>
  postData("/onboarding/slskd/test", {
    url: url?.replace(/\/+$/, ""),
    apiKey,
  });

export const testGotifyConnection = (url, token) =>
  postData("/settings/gotify/test", { url, token });

export const applyLidarrCommunityGuide = () =>
  postData("/settings/lidarr/apply-community-guide");

export const getFlowStatus = async ({
  includeJobs = false,
  flowId,
  jobsLimit,
  signal,
} = {}) => {
  const params = {};
  if (includeJobs) {
    params.includeJobs = "1";
  }
  if (flowId) {
    params.flowId = flowId;
  }
  if (jobsLimit != null) {
    params.jobsLimit = jobsLimit;
  }
  return getData("/playlists/status", { params, signal });
};

export const getFlowJobs = (flowId, limit = null, options = {}) => {
  const params = { ...(options.params || {}) };
  const parsedLimit = Number(limit);
  if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
    params.limit = Math.floor(parsedLimit);
  }
  return getData(`/playlists/jobs/${flowId}`, {
    ...options,
    params,
  });
};

export const createFlow = (payload) => postData("/playlists/flows", payload);

export const updateFlow = (flowId, payload) =>
  putData(`/playlists/flows/${flowId}`, payload);

export const deleteFlow = (flowId) => deleteData(`/playlists/flows/${flowId}`);

export const convertFlowToStaticPlaylist = (flowId, payload = {}) =>
  postData(
    `/playlists/flows/${flowId}/static-playlist`,
    payload,
  );

export const createSharedPlaylist = (payload) =>
  postData("/playlists/shared-playlists", payload);

export const setFlowEnabled = (flowId, enabled) =>
  putData(`/playlists/flows/${flowId}/enabled`, {
    enabled,
  });

export const importSharedPlaylist = (payload) =>
  postData(
    "/playlists/shared-playlists/import",
    payload,
  );

export const updateSharedPlaylist = (playlistId, payload) =>
  putData(
    `/playlists/shared-playlists/${playlistId}`,
    payload,
  );

export const addSharedPlaylistTracks = (playlistId, payload) =>
  postData(
    `/playlists/shared-playlists/${playlistId}/tracks`,
    payload,
  );

export const deleteSharedPlaylist = (playlistId) =>
  deleteData(
    `/playlists/shared-playlists/${playlistId}`,
  );

export const deleteSharedPlaylistTrack = (playlistId, jobId) =>
  deleteData(
    `/playlists/shared-playlists/${playlistId}/tracks/${jobId}`,
  );

export const reSearchSharedPlaylistTrack = (playlistId, jobId) =>
  postData(
    `/playlists/shared-playlists/${playlistId}/tracks/${jobId}/research`,
  );

export const startFlowPlaylist = (flowId, limit = 30) =>
  postData(`/playlists/start/${flowId}`, {
    limit,
  });

export default api;
