export const LISTEN_HISTORY_PROVIDERS = ["lastfm", "listenbrainz"];
export const DEFAULT_LISTEN_HISTORY_PROVIDER = "lastfm";

const CACHE_PREFIX_BY_PROVIDER = {
  lastfm: "lfm",
  listenbrainz: "lb",
};

export function normalizeListenHistoryProvider(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return LISTEN_HISTORY_PROVIDERS.includes(normalized)
    ? normalized
    : DEFAULT_LISTEN_HISTORY_PROVIDER;
}

export function normalizeListenHistoryUsername(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

export function getListenHistoryProfile(source = {}) {
  const explicitUsername =
    source.listenHistoryUsername ?? source.listen_history_username;
  const legacyLastfmUsername = source.lastfmUsername ?? source.lastfm_username;
  const username = normalizeListenHistoryUsername(
    explicitUsername != null ? explicitUsername : legacyLastfmUsername,
  );
  const hasExplicitProvider =
    source.listenHistoryProvider !== undefined ||
    source.listen_history_provider !== undefined;
  const provider = username
    ? hasExplicitProvider
      ? normalizeListenHistoryProvider(
          source.listenHistoryProvider ?? source.listen_history_provider,
        )
      : legacyLastfmUsername != null
        ? "lastfm"
        : DEFAULT_LISTEN_HISTORY_PROVIDER
    : normalizeListenHistoryProvider(
        source.listenHistoryProvider ?? source.listen_history_provider,
      );

  return {
    listenHistoryProvider: provider,
    listenHistoryUsername: username,
    lastfmUsername: provider === "lastfm" ? username : null,
  };
}

export function hasListenHistoryProfile(profile) {
  return !!normalizeListenHistoryUsername(profile?.listenHistoryUsername);
}

export function listenHistoryProfilesEqual(a, b) {
  const left = getListenHistoryProfile(a);
  const right = getListenHistoryProfile(b);
  return (
    left.listenHistoryProvider === right.listenHistoryProvider &&
    left.listenHistoryUsername === right.listenHistoryUsername
  );
}

export function getListenHistoryCacheNamespace(profile) {
  const normalized = getListenHistoryProfile(profile);
  if (!normalized.listenHistoryUsername) return null;
  const prefix = CACHE_PREFIX_BY_PROVIDER[normalized.listenHistoryProvider];
  return prefix
    ? `${prefix}:${normalized.listenHistoryUsername}`
    : null;
}
