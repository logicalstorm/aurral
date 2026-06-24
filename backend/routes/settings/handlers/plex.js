import { dbOps } from "../../../db/helpers/index.js";
import { validateExternalUrl } from "../../../middleware/urlValidator.js";
import { logger } from "../../../services/logger.js";

function getPlexConfig() {
  return dbOps.getSettings()?.integrations?.plex || {};
}

export function registerPlex(router) {
  router.post("/plex/auth/pin", async (req, res) => {
    try {
      const { PlexClient } = await import("../../../services/plex.js");
      const settings = dbOps.getSettings();
      const plex = settings.integrations?.plex || {};
      let clientId = plex.clientId;
      if (!clientId) {
        clientId = PlexClient.generateClientId();
        dbOps.updateSettings({
          ...settings,
          integrations: {
            ...settings.integrations,
            plex: { ...plex, clientId },
          },
        });
      }
      const { id, code } = await PlexClient.generatePin(clientId);
      const forwardUrl = req.body?.forwardUrl;
      res.json({
        pinId: id,
        code,
        clientId,
        authUrl: PlexClient.buildAuthUrl(clientId, code, forwardUrl),
      });
    } catch (error) {
      logger.error("settings", "Plex PIN generation failed:", error.message);
      res.status(500).json({
        error: "Failed to start Plex authentication",
        message: error.message,
      });
    }
  });

  router.post("/plex/auth/check", async (req, res) => {
    try {
      const { PlexClient } = await import("../../../services/plex.js");
      const { pinId, code } = req.body || {};
      if (!pinId || !code) {
        return res.status(400).json({ error: "pinId and code are required" });
      }
      const clientId = getPlexConfig().clientId;
      if (!clientId) {
        return res.status(400).json({ error: "Plex client not initialized" });
      }
      const token = await PlexClient.checkPin(pinId, code, clientId);
      if (!token) return res.json({ pending: true });
      res.json({ token });
    } catch (error) {
      logger.error("settings", "Plex PIN check failed:", error.message);
      res.status(500).json({
        error: "Failed to check Plex authentication",
        message: error.message,
      });
    }
  });

  router.post("/plex/resources", async (req, res) => {
    try {
      const { PlexClient } = await import("../../../services/plex.js");
      const stored = getPlexConfig();
      const token = req.body?.token || stored.token;
      const clientId = stored.clientId;
      if (!token || !clientId) {
        return res.status(400).json({ error: "Plex authentication required" });
      }
      const { servers, total } = await PlexClient.getResources(token, clientId);
      res.json({ servers, total });
    } catch (error) {
      const status = error.response?.status;
      logger.error(
        "settings",
        "Plex resources failed:",
        status ? `${status} ${JSON.stringify(error.response?.data)}` : error.message,
      );
      res.status(status === 401 ? 401 : 500).json({
        error: "Failed to list Plex servers",
        message:
          status === 401
            ? "Plex rejected the token (401). Reconnect your Plex account."
            : error.message,
      });
    }
  });

  router.post("/plex/test", async (req, res) => {
    try {
      const { PlexClient } = await import("../../../services/plex.js");
      const stored = getPlexConfig();
      let url = (req.body?.url || stored.url || "").trim().replace(/\/+$/, "");
      const token = req.body?.token || stored.token;
      const clientId = stored.clientId;
      if (!url || !token) {
        return res.status(400).json({ error: "Server URL and token are required" });
      }
      const urlValidation = validateExternalUrl(url);
      if (!urlValidation.valid) {
        return res.status(400).json({ error: urlValidation.error });
      }
      url = urlValidation.url;
      const client = new PlexClient(url, token, clientId);
      const identity = await client.ping();
      res.json({
        success: true,
        message: "Connection successful",
        machineIdentifier: identity.machineIdentifier,
        version: identity.version,
      });
    } catch (error) {
      res.status(400).json({
        error: "Connection failed",
        message: error.response?.data || error.message,
      });
    }
  });

  router.post("/plex/sync", async (req, res) => {
    try {
      const plex = getPlexConfig();
      if (!plex.url || !plex.token) {
        return res.status(400).json({
          error: "Plex not configured",
          message: "Connect Plex and save settings before syncing",
        });
      }
      const { playlistManager } = await import(
        "../../../services/weeklyFlow/weeklyFlowPlaylistManager.js"
      );
      playlistManager.updateConfig(false);
      const result = await playlistManager.syncPlexNow();
      res.json({ success: true, ...result });
    } catch (error) {
      logger.error("settings", "Plex sync failed:", error.message);
      res.status(500).json({
        error: "Plex sync failed",
        message: error.response?.data || error.message,
      });
    }
  });
}
