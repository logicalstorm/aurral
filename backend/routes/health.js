import express from "express";
import { getLastfmApiKey, getSpotifyClientId, getSpotifyClientSecret } from "../services/apiClients.js";
import { getAuthUser, getAuthPassword } from "../middleware/auth.js";
import { getDiscoveryCache } from "../services/discoveryService.js";
import { libraryManager } from "../services/libraryManager.js";
import { slskdClient } from "../services/slskdClient.js";
import { dbOps } from "../config/db-helpers.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const authUser = getAuthUser();
    const authPassword = getAuthPassword();
    const rootFolder = libraryManager.getRootFolder(); // Always returns /data
    const slskdConfigured = slskdClient.isConfigured();

    const discoveryCache = getDiscoveryCache();

    res.json({
      status: "ok",
      rootFolderConfigured: true, // Always configured as /data
      rootFolder: rootFolder, // Always /data
      slskdConfigured,
      lastfmConfigured: !!getLastfmApiKey(),
      musicbrainzConfigured: !!(dbOps.getSettings().integrations?.musicbrainz?.email || process.env.CONTACT_EMAIL),
      spotifyConfigured: !!(getSpotifyClientId() && getSpotifyClientSecret()),
      library: {
        artistCount: libraryManager.getAllArtists().length,
        lastScan: null, // Last scan time can be added to settings if needed
      },
      discovery: {
        lastUpdated: discoveryCache?.lastUpdated || null,
        isUpdating: !!discoveryCache?.isUpdating,
        recommendationsCount: discoveryCache?.recommendations?.length || 0,
        globalTopCount: discoveryCache?.globalTop?.length || 0,
        cachedImagesCount: dbOps.getAllImages() ? Object.keys(dbOps.getAllImages()).length : 0,
      },
      authRequired: authPassword.length > 0,
      authUser: authUser,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health check error:", error);
    res.status(500).json({
      status: "error",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
