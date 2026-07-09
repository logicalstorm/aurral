(function () {
  var query = location.search;
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
  };
  try {
    var channel = new BroadcastChannel("aurral-spotify-oauth");
    channel.postMessage({ type: "ready", payload: payload });
    channel.close();
  } catch (_) {}
  window.close();
})();
