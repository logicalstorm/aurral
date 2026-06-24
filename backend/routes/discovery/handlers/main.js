import { logger } from "../../../services/logger.js";
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
} from "../../../services/discovery/index.js";
import { getLastfmApiKey } from "../../../services/apiClients/index.js";
import { libraryManager } from "../../../services/libraryManager.js";
import { dbOps, userOps } from "../../../db/helpers/index.js";
import { hydrateArtistImages } from "../../../services/artistImageHydration.js";
import { imagePrefetchService } from "../../../services/imagePrefetchService.js";
import {
  DISCOVERY_PROVIDER_LASTFM,
  DISCOVERY_PROVIDER_LISTENBRAINZ_FALLBACK,
  buildListenbrainzFallbackDiscovery,
  getDiscoveryCapabilities,
} from "../../../services/listenbrainzDiscoveryFallback.js";
import {
  getListenHistoryCacheNamespace,
  getListenHistoryProfile,
  hasListenHistoryProfile,
} from "../../../services/listeningHistory.js";
import { enqueueDiscoveryRefresh } from "../../../services/discoveryRefreshScheduler.js";
import {
  buildArtistKeySet,
  isLibraryArtist,
  getDiscoveryRevalidateAt,
  setDiscoveryRevalidateAt,
  DISCOVERY_REVALIDATE_COOLDOWN_MS,
  getDiscoveryStaleMs,
} from "./utils.js";

export function registerMainRoutes(router) {
  router.get("/", requireAuth, async (req, res) => {
    const hasLastfmKey = !!getLastfmApiKey();
    const libraryArtists = await libraryManager.getAllArtists();

    const reqUser = userOps.getUserById(req.user.id);
    const listenHistoryProfile = getListenHistoryProfile(reqUser || {});
    const userCacheNamespace =
      getListenHistoryCacheNamespace(listenHistoryProfile);
    const effectiveCacheNamespace = hasLastfmKey ? userCacheNamespace : null;

    if (
      hasListenHistoryProfile(listenHistoryProfile) &&
      hasLastfmKey &&
      !isGlobalDiscoveryRefreshInProgress()
    ) {
      const staleness = getUserDiscoveryCacheStaleness(userCacheNamespace);
      const staleMs = await getDiscoveryStaleMs();
      if (staleness > staleMs) {
        requestUserDiscoveryRefresh(listenHistoryProfile, {
          feedbackUserId: req.user?.id || null,
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
    const feedback = getDiscoveryFeedback(req.user?.id || "global");
    const discoveryMode = getDiscoveryMode();

    const existingArtistKeys = buildArtistKeySet(libraryArtists);

    recommendations = recommendations.filter(
      (artist) => !isLibraryArtist(artist, existingArtistKeys),
    );
    globalTop = globalTop.filter(
      (artist) => !isLibraryArtist(artist, existingArtistKeys),
    );
    recommendations = await hydrateArtistImages(recommendations, {
      limit: Math.min(recommendations.length, 36),
      batchSize: 8,
      delayMs: 10,
    });
    globalTop = await hydrateArtistImages(globalTop, {
      limit: Math.min(globalTop.length, 36),
      batchSize: 8,
      delayMs: 10,
    });
    basedOn = await hydrateArtistImages(basedOn, {
      limit: Math.min(basedOn.length, 24),
      batchSize: 6,
      delayMs: 10,
    });
    if (Array.isArray(fallbackGenres) && fallbackGenres.length > 0) {
      for (const section of fallbackGenres) {
        if (!Array.isArray(section?.artists) || section.artists.length === 0) {
          continue;
        }
        section.artists = await hydrateArtistImages(section.artists, {
          limit: Math.min(section.artists.length, 24),
          batchSize: 6,
          delayMs: 10,
        });
      }
    }

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

    if (recommendations.length > 0 || globalTop.length > 0) {
      imagePrefetchService
        .prefetchDiscoveryImages({
          recommendations,
          globalTop,
        })
        .catch((err) => { logger.discovery("warn", "Failed to prefetch discovery images", { error: err?.message || String(err) }); });
    }

    if (recommendations.length > 0 || globalTop.length > 0) {
      res.set(
        "Cache-Control",
        "private, max-age=120, stale-while-revalidate=300",
      );
    } else if (isUpdating) {
      res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    } else {
      res.set("Cache-Control", "private, max-age=30, stale-while-revalidate=120");
    }

    const { annotateDiscoverPlaylistsForUser } =
      await import("../../../services/discoverPlaylistService.js");
    const playlists = annotateDiscoverPlaylistsForUser(
      discoverPlaylists,
      req.user,
    ).filter((playlist) => playlist.trackCount > 0);

    const playlistBuildStatus =
      getDiscoveryPlaylistBuildStatus(effectiveCacheNamespace);

    const recommendationsLimit = Math.max(parseInt(req.query.limit, 10) || 50, 1);

    res.json({
      recommendations: recommendations.slice(0, recommendationsLimit),
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
    });
  });

  router.get("/related", requireAuth, (req, res) => {
    const discoveryCache = getDiscoveryCache();
    res.json({
      recommendations: discoveryCache.recommendations,
      basedOn: discoveryCache.basedOn,
      total: discoveryCache.recommendations.length,
    });
  });

  router.get("/similar", requireAuth, (req, res) => {
    const discoveryCache = getDiscoveryCache();
    res.json({
      topTags: discoveryCache.topTags,
      topGenres: discoveryCache.topGenres,
      basedOn: discoveryCache.basedOn,
      message: "Served from cache",
    });
  });

  router.get("/filtered", requireAuth, async (req, res) => {
    try {
      const discoveryCache = getDiscoveryCache();
      const feedback = getDiscoveryFeedback(req.user?.id || "global");
      const discoveryMode = getDiscoveryMode();
      let recommendations = discoveryCache.recommendations || [];
      let globalTop = discoveryCache.globalTop || [];

      const libraryArtists = await libraryManager.getAllArtists();
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

      res.json({
        recommendations,
        globalTop,
        topTags: discoveryCache.topTags || [],
        topGenres: discoveryCache.topGenres || [],
        basedOn: discoveryCache.basedOn || [],
        lastUpdated: discoveryCache.lastUpdated,
        preferencesApplied: true,
        discoveryMode,
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to get filtered discovery",
        message: error.message,
      });
    }
  });
}

import { requireAuth } from "../../../middleware/requirePermission.js";
