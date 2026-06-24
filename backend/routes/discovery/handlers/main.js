import {
  getDiscoveryCache,
  getDiscoveryFeedback,
  getDiscoveryMode,
  serveCachedRecommendations,
} from "../../../services/discovery/index.js";
import { libraryManager } from "../../../services/libraryManager.js";
import { requireAuth } from "../../../middleware/requirePermission.js";
import {
  buildArtistKeySet,
  isLibraryArtist,
} from "./utils.js";
import { getUserDiscovery } from "../../../services/discovery/userDiscovery.js";

export function registerMainRoutes(router) {
  router.get("/", requireAuth, async (req, res) => {
    const limit = Math.max(parseInt(req.query.limit, 10) || 50, 1);
    const { body, cacheStrategy } = await getUserDiscovery(req.user.id, limit);

    const cacheHeaders = {
      fresh: "private, max-age=120, stale-while-revalidate=300",
      updating: "no-cache, no-store, must-revalidate",
      empty: "private, max-age=30, stale-while-revalidate=120",
    };
    res.set("Cache-Control", cacheHeaders[cacheStrategy]);
    res.json(body);
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
