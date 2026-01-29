import express from "express";
import { getLastfmApiKey } from "../services/apiClients.js";
import { getAuthUser, getAuthPassword } from "../middleware/auth.js";
import { getDiscoveryCache } from "../services/discoveryService.js";
import { libraryManager } from "../services/libraryManager.js";
import { lidarrClient } from "../services/lidarrClient.js";
import { dbOps } from "../config/db-helpers.js";
import { websocketService } from "../services/websocketService.js";
import { noCache } from "../middleware/cache.js";

const router = express.Router();

router.get("/", noCache, async (req, res) => {
  try {
    const authUser = getAuthUser();
    const authPassword = getAuthPassword();
    const rootFolder = libraryManager.getRootFolder();
    const lidarrConfigured = lidarrClient.isConfigured();

    const discoveryCache = getDiscoveryCache();
    const wsStats = websocketService.getStats();

    res.json({
      status: "ok",
      rootFolderConfigured: true,
      rootFolder: rootFolder,
      lidarrConfigured,
      lastfmConfigured: !!getLastfmApiKey(),
      musicbrainzConfigured: !!(
        dbOps.getSettings().integrations?.musicbrainz?.email ||
        process.env.CONTACT_EMAIL
      ),
      library: {
        artistCount: (await libraryManager.getAllArtists()).length,
        lastScan: null,
      },
      discovery: {
        lastUpdated: discoveryCache?.lastUpdated || null,
        isUpdating: !!discoveryCache?.isUpdating,
        recommendationsCount: discoveryCache?.recommendations?.length || 0,
        globalTopCount: discoveryCache?.globalTop?.length || 0,
        cachedImagesCount: dbOps.getAllImages()
          ? Object.keys(dbOps.getAllImages()).length
          : 0,
      },
      websocket: {
        clients: wsStats.totalClients,
        channels: wsStats.channels,
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

router.get("/ws", noCache, (req, res) => {
  try {
    const stats = websocketService.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({
      error: "Failed to get WebSocket stats",
      message: error.message,
    });
  }
});

export default router;
