export function readSpotifyOAuthCallback() {
  const { pathname, search, hash } = window.location;
  if (!pathname.endsWith("/oauth.html")) return null;
  const rawQuery = search || (hash ? `?${String(hash).replace(/^#/, "")}` : "");
  const params = new URLSearchParams(rawQuery.replace(/^\?/, ""));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return null;
  return {
    query: rawQuery.startsWith("?") ? rawQuery : rawQuery ? `?${rawQuery}` : "",
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: params.get("expires_in"),
  };
}

export function isSpotifyOAuthPopupPending() {
  return readSpotifyOAuthCallback() !== null;
}

export function completeSpotifyOAuthPopupBridge() {
  const callback = readSpotifyOAuthCallback();
  if (!callback) return false;

  const closePopup = () => {
    try {
      window.close();
    } catch (_) {}
  };
  const payload = {
    type: "aurral-spotify-oauth",
    access_token: callback.access_token,
    refresh_token: callback.refresh_token,
    expires_in: callback.expires_in,
  };

  try {
    if (window.opener) {
      if (typeof window.opener.onCompleteOauth === "function") {
        window.opener.onCompleteOauth(callback.query, closePopup);
        return true;
      }
      window.opener.postMessage(payload, window.location.origin);
      closePopup();
      return true;
    }
  } catch (_) {}

  closePopup();
  return true;
}
