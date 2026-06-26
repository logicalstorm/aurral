import { logger } from "../logger.js";
import {
  getDiscoveryCache,
  getDiscoveryUpdateStatus,
  getDiscoveryPlaylistBuildStatus,
  requestUserDiscoveryRefresh,
  getUserDiscoveryCacheStaleness,
  isGlobalDiscoveryRefreshInProgress,
  getDiscoveryMode,
  getDiscoveryFeedback,
  serveCachedRecommendations,
} from "./index.js";
import { getLastfmApiKey } from "../apiClients/index.js";
import { libraryManager } from "../libraryManager.js";
import { dbOps, userOps } from "../../db/helpers/index.js";
import {
  DISCOVERY_PROVIDER_LASTFM,
  DISCOVERY_PROVIDER_LISTENBRAINZ_FALLBACK,
  buildListenbrainzFallbackDiscovery,
  getDiscoveryCapabilities,
} from "../listenbrainzDiscoveryFallback.js";
import {
  getListenHistoryCacheNamespace,
  getListenHistoryProfile,
  getDefaultListenHistoryProfile,
  hasListenHistoryProfile,
} from "../listeningHistory.js";
import { enqueueDiscoveryRefresh } from "./refreshScheduler.js";
import {
  buildArtistKeySet,
  isLibraryArtist,
  getDiscoveryRevalidateAt,
  setDiscoveryRevalidateAt,
  DISCOVERY_REVALIDATE_COOLDOWN_MS,
  getDiscoveryStaleMs,
} from "../../routes/discovery/handlers/utils.js";

export async function getUserDiscovery(userId, limit = 50, offset = 0) {
  const hasLastfmKey = !!getLastfmApiKey();
  const libraryArtists = await libraryManager.getAllArtists();

  const reqUser = userOps.getUserById(userId);
  const listenHistoryProfile = getListenHistoryProfile(reqUser || {});
  const userCacheNamespace =
    getListenHistoryCacheNamespace(listenHistoryProfile);
  const defaultProfile = getDefaultListenHistoryProfile(dbOps.getSettings());
  const globalNamespace = defaultProfile
    ? getListenHistoryCacheNamespace(defaultProfile)
    : null;
  const identityMatches = userCacheNamespace && globalNamespace && userCacheNamespace === globalNamespace;
  const effectiveCacheNamespace = identityMatches
    ? null
    : hasLastfmKey
      ? userCacheNamespace
      : null;

  if (
    hasListenHistoryProfile(listenHistoryProfile) &&
    hasLastfmKey &&
    !isGlobalDiscoveryRefreshInProgress()
  ) {
    const staleness = getUserDiscoveryCacheStaleness(userCacheNamespace);
    const staleMs = await getDiscoveryStaleMs();
    if (staleness > staleMs) {
      requestUserDiscoveryRefresh(listenHistoryProfile, {
        feedbackUserId: userId || null,
      }).catch((err) => {
        logger.discovery("error", `On-demand refresh for ${listenHistoryProfile.listenHistoryProvider}:${listenHistoryProfile.listenHistoryUsername} failed`, { error: err.message });
      });
    }
  }

  let discoveryCache = getDiscoveryCache(effectiveCacheNamespace);

  const hasData =
    discoveryCache.recommendations?.length > 0 ||
    discoveryCache.globalTop?.length > 0 ||
    discoveryCache.topGenres?.length > 0 ||
    discoveryCache.fallbackGenres?.length > 0;
  const hasCompletedRefresh =
    !!discoveryCache.lastUpdated &&
    (discoveryCache.recommendations?.length > 0 ||
      discoveryCache.globalTop?.length > 0 ||
      discoveryCache.topGenres?.length > 0 ||
      discoveryCache.fallbackGenres?.length > 0);

  let isUpdating = discoveryCache.isUpdating || false;

  if (
    !hasLastfmKey &&
    (!hasData ||
      discoveryCache.provider !== DISCOVERY_PROVIDER_LISTENBRAINZ_FALLBACK)
  ) {
    const fallbackData = await buildListenbrainzFallbackDiscovery({
      existingArtistKeys: buildArtistKeySet(libraryArtists),
    });
    dbOps.updateDiscoveryCache(fallbackData);
    Object.assign(getDiscoveryCache(), fallbackData, { isUpdating: false });
    discoveryCache = getDiscoveryCache(effectiveCacheNamespace);
    isUpdating = false;
  } else if (!hasData && !hasCompletedRefresh && !isUpdating) {
    setDiscoveryRevalidateAt(Date.now());
    const lazyRefresh = enqueueDiscoveryRefresh({ reason: "lazy" });
    if (lazyRefresh.enqueued) {
      isUpdating = true;
    }
  }

  let {
    recommendations,
    globalTop,
    basedOn,
    topTags,
    topGenres,
    fallbackGenres = [],
    discoverPlaylists = [],
    lastUpdated,
    recommendationQuality,
    isEnriching,
    discoveryRunId,
    enrichmentStartedAt,
    enrichmentCompletedAt,
    enrichmentProgressMessage,
    provider,
    capabilities,
  } = discoveryCache;
  provider = hasLastfmKey
    ? DISCOVERY_PROVIDER_LASTFM
    : provider || DISCOVERY_PROVIDER_LISTENBRAINZ_FALLBACK;
  capabilities = capabilities || getDiscoveryCapabilities(hasLastfmKey);
  const feedback = getDiscoveryFeedback(userId || "global");
  const discoveryMode = getDiscoveryMode();

  const existingArtistKeys = buildArtistKeySet(libraryArtists);

  recommendations = recommendations.filter(
    (artist) => !isLibraryArtist(artist, existingArtistKeys),
  );
  globalTop = globalTop.filter(
    (artist) => !isLibraryArtist(artist, existingArtistKeys),
  );

  recommendations = serveCachedRecommendations({
    recommendations,
    feedback,
  });

  const parsedLastUpdated = lastUpdated ? new Date(lastUpdated).getTime() : 0;
  const staleMs = await getDiscoveryStaleMs();
  const isStale =
    Number.isFinite(parsedLastUpdated) &&
    parsedLastUpdated > 0 &&
    Date.now() - parsedLastUpdated > staleMs;

  if (
    isStale &&
    !isUpdating &&
    !hasListenHistoryProfile(listenHistoryProfile) &&
    Date.now() - getDiscoveryRevalidateAt() > DISCOVERY_REVALIDATE_COOLDOWN_MS
  ) {
    setDiscoveryRevalidateAt(Date.now());
    const staleRefresh = enqueueDiscoveryRefresh({ reason: "stale" });
    if (staleRefresh.enqueued) {
      isUpdating = true;
    }
  }

  const cacheStrategy =
    recommendations.length > 0 || globalTop.length > 0
      ? "fresh"
      : isUpdating
        ? "updating"
        : "empty";

  const { annotateDiscoverPlaylistsForUser } =
    await import("./playlistBuilder.js");
  const playlists = annotateDiscoverPlaylistsForUser(
    discoverPlaylists,
    userId,
  ).filter((playlist) => playlist.trackCount > 0);

  const playlistBuildStatus =
    getDiscoveryPlaylistBuildStatus(effectiveCacheNamespace);

  const limitClamped = Math.max(limit, 1);
  const offsetClamped = Math.max(offset, 0);

  return {
    cacheStrategy,
    body: {
      recommendations: limit
        ? recommendations.slice(offsetClamped, offsetClamped + limitClamped)
        : recommendations,
      recommendationCount: recommendations.length,
      globalTop,
      basedOn,
      topTags,
      topGenres,
      fallbackGenres,
      discoverPlaylists: playlists,
      lastUpdated,
      isUpdating,
      recommendationQuality,
      isEnriching,
      discoveryRunId,
      enrichmentStartedAt,
      enrichmentCompletedAt,
      enrichmentProgressMessage,
      ...(isUpdating ? getDiscoveryUpdateStatus() : {}),
      playlistsUpdating: playlistBuildStatus.playlistsUpdating,
      ...(playlistBuildStatus.playlistsUpdating
        ? {
            playlistsUpdateMessage: playlistBuildStatus.playlistsUpdateMessage,
          }
        : {}),
      stale: isStale,
      configured: true,
      provider,
      capabilities,
      discoveryMode,
    },
  };
}
