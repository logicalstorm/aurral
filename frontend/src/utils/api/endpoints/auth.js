import { getData, postData, patchData, deleteData, fetchInflightOnce, bootstrapInflight, lidarrCredentialParams, AUTH_INVALID_EVENT } from "../core.js";

export const checkHealth = () => getData("/health");

const BOOTSTRAP_CACHE_TTL_MS = 25_000;
let bootstrapCache = null;

const invalidateBootstrapCache = () => {
  bootstrapCache = null;
};

if (typeof window !== "undefined") {
  window.addEventListener(AUTH_INVALID_EVENT, invalidateBootstrapCache);
}

export const getBootstrapStatus = () => {
  if (bootstrapCache && Date.now() - bootstrapCache.at < BOOTSTRAP_CACHE_TTL_MS) {
    return Promise.resolve(bootstrapCache.value);
  }
  return fetchInflightOnce(bootstrapInflight, "bootstrap", () => {
    const at = Date.now();
    return getData("/health/bootstrap").then((value) => {
      bootstrapCache = { at, value };
      return value;
    });
  });
};

export const browseFilesystem = (pathValue) =>
  getData("/filesystem/browse", {
    params: pathValue ? { path: pathValue } : undefined,
  });

export const ensureFilesystemPath = (pathValue) =>
  postData("/filesystem/ensure", {
    path: pathValue,
  });

export const loginApi = async (username, password) => {
  const result = await postData("/auth/login", { username, password });
  invalidateBootstrapCache();
  return result;
};

export const logoutApi = async () => {
  const result = await postData("/auth/logout");
  invalidateBootstrapCache();
  return result;
};

export const getMe = () => getData("/auth/me");

export const getApiKey = () => getData("/auth/api-key");

export const rotateApiKey = () => postData("/auth/api-key/rotate");

export const completeOnboarding = async (payload) => {
  const result = await postData("/onboarding/complete", payload);
  invalidateBootstrapCache();
  return result;
};

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
