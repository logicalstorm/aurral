(function () {
  var query = location.search;
  if (!query && location.hash) {
    query = "?" + String(location.hash).replace(/^#/, "");
  }
  if (window.opener && typeof window.opener.onCompleteOauth === "function") {
    window.opener.onCompleteOauth(query, function () {
      window.close();
    });
    return;
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
  } catch (_) {}
  window.close();
})();
