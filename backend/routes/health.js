import express from "express";
import { lidarrRequest, getLidarrConfig, getLastfmApiKey, getLidarrBasepathDetected } from "../services/apiClients.js";
import { getAuthUser, getAuthPassword } from "../middleware/auth.js";
import { getDiscoveryCache } from "../services/discoveryService.js";
import { db } from "../config/db.js";

const router = express.Router();

router.get("/", async (req, res) => {
  let lidarrStatus = "unknown";
  const { url, apiKey } = getLidarrConfig();
  const authUser = getAuthUser();
  const authPassword = getAuthPassword();

  try {
    if (apiKey) {
      await lidarrRequest("/system/status", "GET", null, true);
      lidarrStatus = "connected";
    } else {
      lidarrStatus = "not_configured";
    }
  } catch (error) {
    lidarrStatus = "unreachable";
  }

  const discoveryCache = getDiscoveryCache();

  res.json({
    status: "ok",
    lidarrConfigured: !!apiKey,
    lidarrStatus,
    lidarrUrl: apiKey ? url : null,
    lidarrBasepathDetected: getLidarrBasepathDetected(),
    lastfmConfigured: !!getLastfmApiKey(),
    musicbrainzConfigured: !!(db.data.settings.integrations?.musicbrainz?.email || process.env.CONTACT_EMAIL),
    discovery: {
      lastUpdated: discoveryCache?.lastUpdated || null,
      isUpdating: !!discoveryCache?.isUpdating,
      recommendationsCount: discoveryCache?.recommendations?.length || 0,
      globalTopCount: discoveryCache?.globalTop?.length || 0,
      cachedImagesCount: db?.data?.images
        ? Object.keys(db.data.images).length
        : 0,
    },
    authRequired: authPassword.length > 0,
    authUser: authUser,
    timestamp: new Date().toISOString(),
  });
});

export default router;
