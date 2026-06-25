import { validateExternalUrl } from "../../../middleware/urlValidator.js";

export function registerDownloadClients(router) {
  router.post("/slskd/test", async (req, res) => {
    try {
      const { slskdClient } = await import("../../../services/slskdClient.js");
      const result = await slskdClient.testConnection({ force: true });
      if (!result.configured) {
        return res.status(400).json(result);
      }
      if (!result.ok) {
        return res.status(502).json(result);
      }
      return res.json({
        success: true,
        warning: result.warning === true,
        ...result,
      });
    } catch (error) {
      return res.status(500).json({
        error: "slskd test failed",
        message: error.message,
      });
    }
  });

  router.post("/prowlarr/test", async (req, res) => {
    try {
      const { prowlarrClient } = await import("../../../services/prowlarrClient.js");
      const result = await prowlarrClient.testConnection({ force: true });
      if (!result.configured) {
        return res.status(400).json(result);
      }
      if (!result.ok) {
        return res.status(502).json(result);
      }
      return res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      return res.status(500).json({
        error: "Prowlarr test failed",
        message: error.message,
      });
    }
  });

  router.get("/prowlarr/indexers", async (_req, res) => {
    try {
      const { prowlarrClient } = await import("../../../services/prowlarrClient.js");
      const indexers = await prowlarrClient.listUsenetIndexers();
      return res.json({ indexers });
    } catch (error) {
      return res.status(500).json({
        error: "Failed to load Prowlarr indexers",
        message: error.message,
      });
    }
  });

  router.post("/nzbget/test", async (req, res) => {
    try {
      const { nzbgetClient } = await import("../../../services/nzbgetClient.js");
      const result = await nzbgetClient.testConnection({ force: true });
      if (!result.configured) {
        return res.status(400).json(result);
      }
      if (!result.ok) {
        return res.status(502).json(result);
      }
      return res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      return res.status(500).json({
        error: "NZBGet test failed",
        message: error.message,
      });
    }
  });

  router.post("/sabnzbd/test", async (req, res) => {
    try {
      const { sabnzbdClient } = await import("../../../services/sabnzbdClient.js");
      const result = await sabnzbdClient.testConnection({ force: true });
      if (!result.configured) {
        return res.status(400).json(result);
      }
      if (!result.ok) {
        return res.status(502).json(result);
      }
      return res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      return res.status(500).json({
        error: "SABnzbd test failed",
        message: error.message,
      });
    }
  });

  router.post("/gotify/test", async (req, res) => {
    try {
      const { sendGotifyTest } =
        await import("../../../services/notificationService.js");
      const url = req.body?.url?.trim();
      const token = req.body?.token?.trim();
      if (!url || !token) {
        return res.status(400).json({
          error: "URL and token required",
          message: "Provide Gotify URL and application token in the request body",
        });
      }
      const urlValidation = validateExternalUrl(url);
      if (!urlValidation.valid) {
        return res.status(400).json({ error: urlValidation.error });
      }
      await sendGotifyTest(urlValidation.url, token);
      res.json({ success: true, message: "Test notification sent" });
    } catch (error) {
      if (error.code === "MISSING_CONFIG") {
        return res.status(400).json({
          error: "Invalid configuration",
          message: error.message,
        });
      }
      const status = error.response?.status;
      const msg =
        error.response?.data?.description ||
        error.response?.data?.error ||
        error.message;
      res
        .status(status && status >= 400 ? status : 500)
        .json({ error: "Gotify test failed", message: msg });
    }
  });
}
