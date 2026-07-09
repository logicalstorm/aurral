(function () {
  if (!location.pathname.endsWith("/oauth.html")) return;
  var query = location.search;
  if (!query && location.hash) {
    query = "?" + String(location.hash).replace(/^#/, "");
  }
  var params = new URLSearchParams(String(query || "").replace(/^\?/, ""));
  var accessToken = params.get("access_token");
  var refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return;
  try {
    localStorage.setItem(
      "aurral:spotify-oauth-pending",
      JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: params.get("expires_in"),
        savedAt: Date.now(),
      }),
    );
  } catch (_) {
    return;
  }
  if (window.opener) {
    try {
      window.opener.postMessage({ type: "aurral-spotify-oauth-ready" }, location.origin);
    } catch (_) {}
    window.close();
    return;
  }
  var returnPath = "/playlists";
  try {
    returnPath = sessionStorage.getItem("aurral:spotify-oauth-return") || returnPath;
    sessionStorage.removeItem("aurral:spotify-oauth-return");
  } catch (_) {}
  location.replace(returnPath);
})();
