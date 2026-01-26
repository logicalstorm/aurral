import express from "express";
import { getLastfmApiKey, getSpotifyClientId, getSpotifyClientSecret } from "../services/apiClients.js";
import { getAuthUser, getAuthPassword } from "../middleware/auth.js";
import { getDiscoveryCache } from "../services/discoveryService.js";
import { libraryManager } from "../services/libraryManager.js";
import { slskdClient } from "../services/slskdClient.js";
import { db } from "../config/db.js";

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
      musicbrainzConfigured: !!(db.data?.settings?.integrations?.musicbrainz?.email || process.env.CONTACT_EMAIL),
      spotifyConfigured: !!(getSpotifyClientId() && getSpotifyClientSecret()),
      library: {
        artistCount: libraryManager.getAllArtists().length,
        lastScan: db.data?.library?.lastScan || null,
      },
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
