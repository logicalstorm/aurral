(function () {
  var query = location.search;
  if (!query && location.hash) {
    query = "?" + String(location.hash).replace(/^#/, "");
  }
  try {
    if (window.opener && typeof window.opener.onCompleteOauth === "function") {
      window.opener.onCompleteOauth(query, function () {
        window.close();
      });
      return;
    }
  } catch (_) {}
  var params = new URLSearchParams(String(query || "").replace(/^\?/, ""));
  var accessToken = params.get("access_token");
  var refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) {
    window.close();
    return;
  }
  var payload = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: params.get("expires_in"),
    savedAt: Date.now(),
  };
  try {
    var channel = new BroadcastChannel("aurral-spotify-oauth");
    channel.postMessage({ type: "ready", payload: payload });
    channel.close();
  } catch (_) {}
  try {
    localStorage.setItem("aurral:spotify-oauth-pending", JSON.stringify(payload));
  } catch (_) {}
  setTimeout(function () {
    window.close();
  }, 100);
})();
