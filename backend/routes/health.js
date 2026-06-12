import express from "express";
import {
  getLastfmApiKey,
  getTicketmasterApiKey,
  getMetadataProviderHealthSnapshot,
} from "../services/apiClients.js";
import { getSearchBaseUrl } from "../services/aurralSearchClient.js";
import { APP_VERSION } from "../config/constants.js";
import {
  resolveRequestUser,
  getAuthUser,
  isAuthRequiredByConfig,
  issueStreamToken,
  getLocalNetworkBypassStatus,
} from "../middleware/auth.js";
import {
  getDiscoveryCache,
  getDiscoveryUpdateStatus,
} from "../services/discoveryService.js";
import { getCachedArtistCount } from "../services/libraryManager.js";
import { lidarrClient } from "../services/lidarrClient.js";
import { dbOps } from "../config/db-helpers.js";
import { websocketService } from "../services/websocketService.js";
import { noCache } from "../middleware/cache.js";
import { requireAuth } from "../middleware/requirePermission.js";
import { getImageProxyCacheSizeBytes } from "../services/imageProxyService.js";
import {
  DISCOVERY_PROVIDER_LASTFM,
  DISCOVERY_PROVIDER_LISTENBRAINZ_FALLBACK,
  getDiscoveryCapabilities,
} from "../services/listenbrainzDiscoveryFallback.js";
import { isV2MigrationPending } from "../middleware/migrationGate.js";
import { v2MigrationRuntime } from "../config/db-sqlite.js";
import { migrateToV2 } from "../scripts/migrateToV2.js";
import { startBackgroundWorkers } from "../services/appRuntime.js";

const router = express.Router();

function buildBootstrapPayload(req) {
  lidarrClient.updateConfig();
  const settings = dbOps.getSettings();
  const onboardingDone = settings.onboardingComplete;
  const authRequired = isAuthRequiredByConfig();
  const authUser = getAuthUser();
  const currentUser = resolveRequestUser(req);
  const localNetworkBypass = getLocalNetworkBypassStatus(req);
  const lidarrConfigured = lidarrClient.isConfigured();

  const v2MigrationRequired = isV2MigrationPending();

  const payload = {
    status: v2MigrationRequired ? "migration_required" : "ok",
    authRequired,
    authUser: currentUser ? currentUser.username : authUser,
    onboardingRequired: !onboardingDone && !v2MigrationRequired,
    v2Migration: v2MigrationRequired
      ? {
          required: true,
          preview: v2MigrationRuntime.status?.preview || null,
        }
      : { required: false },
    timestamp: new Date().toISOString(),
    appVersion: APP_VERSION,
    rootFolderConfigured: lidarrConfigured,
    lidarrConfigured,
    lastfmConfigured: !!getLastfmApiKey(),
    ticketmasterConfigured: !!getTicketmasterApiKey(),
    musicbrainzConfigured: !!settings.integrations?.metadata?.baseUrl,
    metadataConfigured: !!settings.integrations?.metadata?.baseUrl,
    searchConfigured: !!getSearchBaseUrl(),
    metadataProviders: getMetadataProviderHealthSnapshot(),
    localNetworkBypass,
  };

  if (currentUser) {
    payload.user = {
      id: currentUser.id,
      username: currentUser.username,
      role: currentUser.role,
      permissions: currentUser.permissions,
    };
  }

  return payload;
}

router.get("/live", noCache, (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/bootstrap", noCache, (req, res) => {
  try {
    res.json(buildBootstrapPayload(req));
  } catch (error) {
    console.error("Bootstrap check error:", error);
    res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.post("/migrate-v2", noCache, (req, res) => {
  try {
    if (!isV2MigrationPending()) {
      return res.json({
        migrated: false,
        skipped: true,
        schemaVersion: v2MigrationRuntime.status?.schemaVersion || 2,
      });
    }
    const result = migrateToV2({ logger: console, force: true });
    startBackgroundWorkers({ logger: console });
    return res.json({
      migrated: !!result.migrated,
      schemaVersion: result.schemaVersion,
      layout: result.layout,
    });
  } catch (error) {
    console.error("V2 migration error:", error);
    return res.status(500).json({
      error: "migration_failed",
      message: error?.message || "Failed to migrate database to v2.",
    });
  }
});

router.post("/stream-token", noCache, (req, res) => {
  const user = resolveRequestUser(req);
  if (!user) {
    return res
      .status(401)
      .json({ error: "Unauthorized", message: "Authentication required" });
  }
  const token = issueStreamToken(user);
  return res.json({ token, expiresIn: 120 });
});

router.get("/", noCache, async (req, res) => {
  try {
    const settings = dbOps.getSettings();
    const currentUser = resolveRequestUser(req);
    const payload = buildBootstrapPayload(req);
    if (currentUser) {
      const discoveryCache = getDiscoveryCache();
      const wsStats = websocketService.getStats();
      const artistCount = getCachedArtistCount();
      payload.library = {
        artistCount: typeof artistCount === "number" ? artistCount : 0,
        lastScan: null,
      };
      const discoveryUpdateStatus = getDiscoveryUpdateStatus();
      payload.discovery = {
        provider: getLastfmApiKey()
          ? DISCOVERY_PROVIDER_LASTFM
          : DISCOVERY_PROVIDER_LISTENBRAINZ_FALLBACK,
        capabilities: getDiscoveryCapabilities(!!getLastfmApiKey()),
        lastUpdated: discoveryCache?.lastUpdated || null,
        isUpdating: !!discoveryCache?.isUpdating,
        ...discoveryUpdateStatus,
        recommendationsCount: discoveryCache?.recommendations?.length || 0,
        globalTopCount: discoveryCache?.globalTop?.length || 0,
        cachedImagesCount: dbOps.countImages(),
        cachedImagesSizeBytes: getImageProxyCacheSizeBytes(),
      };
      payload.websocket = {
        clients: wsStats.totalClients,
        channels: wsStats.channels,
      };
    }
    res.json(payload);
  } catch (error) {
    console.error("Health check error:", error);
    res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.get("/ws", requireAuth, noCache, (req, res) => {
  try {
    const stats = websocketService.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({
      error: "Failed to get WebSocket stats",
    });
  }
});

export default router;
