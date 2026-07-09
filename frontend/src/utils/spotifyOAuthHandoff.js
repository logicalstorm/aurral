export const SPOTIFY_OAUTH_PENDING_KEY = "aurral:spotify-oauth-pending";
export const SPOTIFY_OAUTH_RETURN_PATH_KEY = "aurral:spotify-oauth-return";
const PENDING_MAX_AGE_MS = 10 * 60 * 1000;

export function saveSpotifyOAuthReturnPath() {
  window.sessionStorage.setItem(
    SPOTIFY_OAUTH_RETURN_PATH_KEY,
    `${window.location.pathname}${window.location.search}`,
  );
}

export function consumePendingSpotifyOAuth() {
  const raw = window.localStorage.getItem(SPOTIFY_OAUTH_PENDING_KEY);
  if (!raw) return null;
  window.localStorage.removeItem(SPOTIFY_OAUTH_PENDING_KEY);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const savedAt = Number(parsed?.savedAt || 0);
  if (!savedAt || Date.now() - savedAt > PENDING_MAX_AGE_MS) {
    return null;
  }
  const accessToken = String(parsed.access_token || "").trim();
  const refreshToken = String(parsed.refresh_token || "").trim();
  if (!accessToken || !refreshToken) {
    return null;
  }
  return {
    accessToken,
    refreshToken,
    expiresIn: parsed.expires_in,
  };
}
