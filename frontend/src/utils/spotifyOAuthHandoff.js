export const SPOTIFY_OAUTH_PENDING_KEY = "aurral:spotify-oauth-pending";
export const SPOTIFY_OAUTH_RETURN_PATH_KEY = "aurral:spotify-oauth-return";
const PENDING_MAX_AGE_MS = 10 * 60 * 1000;

export function saveSpotifyOAuthReturnPath() {
  window.sessionStorage.setItem(
    SPOTIFY_OAUTH_RETURN_PATH_KEY,
    `${window.location.pathname}${window.location.search}`,
  );
}

export function captureSpotifyOAuthFromLocation() {
  const { pathname, search, hash } = window.location;
  if (!pathname.endsWith("/oauth.html")) return false;
  const rawQuery = search || (hash ? `?${String(hash).replace(/^#/, "")}` : "");
  const params = new URLSearchParams(rawQuery.replace(/^\?/, ""));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return false;
  try {
    window.localStorage.setItem(
      SPOTIFY_OAUTH_PENDING_KEY,
      JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: params.get("expires_in"),
        savedAt: Date.now(),
      }),
    );
  } catch {
    return false;
  }
  let returnPath = "/playlists";
  try {
    returnPath =
      window.sessionStorage.getItem(SPOTIFY_OAUTH_RETURN_PATH_KEY) || returnPath;
    window.sessionStorage.removeItem(SPOTIFY_OAUTH_RETURN_PATH_KEY);
  } catch {}
  window.location.replace(returnPath);
  return true;
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
