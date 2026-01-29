import express from "express";
import { dbOps } from "../config/db-helpers.js";
import { defaultData } from "../config/constants.js";
import { noCache } from "../middleware/cache.js";

const router = express.Router();

router.get("/", noCache, (req, res) => {
  try {
    const settings = dbOps.getSettings();
    res.json(settings);
  } catch (error) {
    console.error("Settings GET error:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch settings", message: error.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { quality, releaseTypes, integrations } = req.body;

    const currentSettings = dbOps.getSettings();

    // Deep merge integrations to preserve existing values
    let mergedIntegrations =
      currentSettings.integrations || defaultData.settings.integrations || {};
    if (integrations) {
      mergedIntegrations = {
        ...mergedIntegrations,
        ...integrations,
        // Deep merge nested objects
        lidarr: integrations.lidarr
          ? {
              ...(mergedIntegrations.lidarr || {}),
              ...integrations.lidarr,
            }
          : mergedIntegrations.lidarr,
        navidrome: integrations.navidrome
          ? {
              ...(mergedIntegrations.navidrome || {}),
              ...integrations.navidrome,
            }
          : mergedIntegrations.navidrome,
        slskd: integrations.slskd
          ? {
              ...(mergedIntegrations.slskd || {}),
              ...integrations.slskd,
            }
          : mergedIntegrations.slskd,
        lastfm: integrations.lastfm
          ? {
              ...(mergedIntegrations.lastfm || {}),
              ...integrations.lastfm,
            }
          : mergedIntegrations.lastfm,
        musicbrainz: integrations.musicbrainz
          ? {
              ...(mergedIntegrations.musicbrainz || {}),
              ...integrations.musicbrainz,
            }
          : mergedIntegrations.musicbrainz,
        spotify: integrations.spotify
          ? {
              ...(mergedIntegrations.spotify || {}),
              ...integrations.spotify,
            }
          : mergedIntegrations.spotify,
        general: integrations.general
          ? {
              ...(mergedIntegrations.general || {}),
              ...integrations.general,
            }
          : mergedIntegrations.general,
      };
    }

    const updatedSettings = {
      ...currentSettings,
      quality:
        quality !== undefined ? quality : currentSettings.quality || "standard",
      releaseTypes:
        releaseTypes !== undefined
          ? releaseTypes
          : currentSettings.releaseTypes || defaultData.settings.releaseTypes,
      integrations: mergedIntegrations,
    };

    dbOps.updateSettings(updatedSettings);
    res.json(updatedSettings);
  } catch (error) {
    console.error("Settings POST error:", error);
    res
      .status(500)
      .json({ error: "Failed to save settings", message: error.message });
  }
});

router.get("/logs", async (req, res) => {
  try {
    const { logger } = await import("../services/logger.js");
    const { limit = 100, category, level } = req.query;

    const logs = logger.getRecentLogs({
      limit: parseInt(limit, 10),
      category,
      level,
    });

    res.json({
      logs,
      count: logs.length,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to get logs", message: error.message });
  }
});

router.get("/logs/stats", async (req, res) => {
  try {
    const { logger } = await import("../services/logger.js");
    const stats = logger.getLogStats();
    res.json(stats);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to get log stats", message: error.message });
  }
});

router.get("/lidarr/profiles", async (req, res) => {
  try {
    const { lidarrClient } = await import("../services/lidarrClient.js");

    // Allow fetching with provided URL/API key (from query params) or use saved settings
    const testUrl = req.query.url;
    const testApiKey = req.query.apiKey;

    let url, apiKey;
    if (testUrl && testApiKey) {
      // Use provided values
      url = testUrl.trim();
      apiKey = testApiKey.trim();
    } else {
      // Use saved settings
      lidarrClient.updateConfig();
      const config = lidarrClient.getConfig();
      url = config.url;
      apiKey = config.apiKey;
    }

    if (!url || !apiKey) {
      return res.status(400).json({
        error: "Lidarr not configured",
        message: "Please configure Lidarr URL and API key in settings first",
      });
    }

    // Temporarily override config for this request
    const originalConfig = { ...lidarrClient.config };
    const originalApiPath = lidarrClient.apiPath;

    lidarrClient.config = {
      url: url.replace(/\/+$/, ""),
      apiKey: apiKey.trim(),
    };
    lidarrClient.apiPath = "/api/v1";

    try {
      // Pass skipConfigUpdate=true so it doesn't overwrite our test config
      const profiles = await lidarrClient.getQualityProfiles(true);
      res.json(profiles);
    } finally {
      // Restore original config
      lidarrClient.config = originalConfig;
      lidarrClient.apiPath = originalApiPath;
      lidarrClient.updateConfig();
    }
  } catch (error) {
    console.error("[Settings] Failed to fetch Lidarr profiles:", error);
    res.status(500).json({
      error: "Failed to fetch Lidarr quality profiles",
      message: error.message,
      details: error.response?.data,
    });
  }
});

router.get("/lidarr/test", async (req, res) => {
  try {
    const { lidarrClient } = await import("../services/lidarrClient.js");

    // Allow testing with provided URL/API key (from query params) or use saved settings
    const testUrl = req.query.url;
    const testApiKey = req.query.apiKey;

    let url, apiKey;
    if (testUrl && testApiKey) {
      // Use provided values for testing
      url = testUrl.trim();
      apiKey = testApiKey.trim();
    } else {
      // Use saved settings
      lidarrClient.updateConfig();
      const config = lidarrClient.getConfig();
      url = config.url;
      apiKey = config.apiKey;
    }

    console.log("[Settings] Testing Lidarr connection...", {
      url: url,
      hasApiKey: !!apiKey,
      apiKeyLength: apiKey?.length || 0,
      usingProvided: !!(testUrl && testApiKey),
    });

    if (!url || !apiKey) {
      return res
        .status(400)
        .json({ error: "Lidarr URL and API key are required" });
    }

    // Temporarily override config for this test
    const originalConfig = { ...lidarrClient.config };
    const originalApiPath = lidarrClient.apiPath;

    lidarrClient.config = {
      url: url.replace(/\/+$/, ""),
      apiKey: apiKey.trim(),
    };
    lidarrClient.apiPath = "/api/v1";

    try {
      // Pass skipConfigUpdate=true so it doesn't overwrite our test config
      const result = await lidarrClient.testConnection(true);
      console.log("[Settings] Lidarr test result:", result);

      if (result.connected) {
        res.json({
          success: true,
          message: "Connection successful",
          version: result.version,
          instanceName: result.instanceName,
          apiPath: result.apiPath,
        });
      } else {
        res.status(400).json({
          error: "Connection failed",
          message: result.error,
          details: result.details,
          url: result.url,
          fullUrl: result.fullUrl,
          statusCode: result.statusCode,
          apiPath: result.apiPath,
        });
      }
    } finally {
      // Restore original config
      lidarrClient.config = originalConfig;
      lidarrClient.apiPath = originalApiPath;
      lidarrClient.updateConfig();
    }
  } catch (error) {
    console.error("[Settings] Lidarr test error:", error);
    res.status(500).json({
      error: "Connection failed",
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

router.post("/lidarr/apply-community-guide", async (req, res) => {
  try {
    const { lidarrClient } = await import("../services/lidarrClient.js");

    lidarrClient.updateConfig();
    const config = lidarrClient.getConfig();

    if (!config.url || !config.apiKey) {
      return res.status(400).json({
        error: "Lidarr not configured",
        message: "Please configure Lidarr URL and API key in settings first",
      });
    }

    const results = {
      qualityDefinitions: [],
      customFormats: [],
      namingConfig: null,
      qualityProfile: null,
    };

    try {
      const qualityDefs = await lidarrClient.getQualityDefinitions();

      const flacDef = qualityDefs.find(
        (q) => q.quality?.name === "FLAC" || q.title === "FLAC",
      );
      const flac24Def = qualityDefs.find(
        (q) => q.quality?.name === "FLAC 24bit" || q.title === "FLAC 24bit",
      );

      if (flacDef) {
        const updated = await lidarrClient.updateQualityDefinition(flacDef.id, {
          ...flacDef,
          minSize: 0,
          maxSize: 1400,
          preferredSize: 895,
        });
        results.qualityDefinitions.push({
          name: "FLAC",
          updated: { min: 0, max: 1400, preferred: 895 },
        });
      }

      if (flac24Def) {
        const updated = await lidarrClient.updateQualityDefinition(
          flac24Def.id,
          {
            ...flac24Def,
            minSize: 0,
            maxSize: 1495,
            preferredSize: 895,
          },
        );
        results.qualityDefinitions.push({
          name: "FLAC 24bit",
          updated: { min: 0, max: 1495, preferred: 895 },
        });
      }

      const customFormats = [
        {
          name: "Preferred Groups",
          includeCustomFormatWhenRenaming: false,
          specifications: [
            {
              name: "DeVOiD",
              implementation: "ReleaseGroupSpecification",
              negate: false,
              required: false,
              fields: { value: "\\bDeVOiD\\b" },
            },
            {
              name: "PERFECT",
              implementation: "ReleaseGroupSpecification",
              negate: false,
              required: false,
              fields: { value: "\\bPERFECT\\b" },
            },
            {
              name: "ENRiCH",
              implementation: "ReleaseGroupSpecification",
              negate: false,
              required: false,
              fields: { value: "\\bENRiCH\\b" },
            },
          ],
        },
        {
          name: "CD",
          includeCustomFormatWhenRenaming: false,
          specifications: [
            {
              name: "CD",
              implementation: "ReleaseTitleSpecification",
              negate: false,
              required: false,
              fields: { value: "\\bCD\\b" },
            },
          ],
        },
        {
          name: "WEB",
          includeCustomFormatWhenRenaming: false,
          specifications: [
            {
              name: "WEB",
              implementation: "ReleaseTitleSpecification",
              negate: false,
              required: false,
              fields: { value: "\\bWEB\\b" },
            },
          ],
        },
        {
          name: "Lossless",
          includeCustomFormatWhenRenaming: false,
          specifications: [
            {
              name: "Lossless",
              implementation: "ReleaseTitleSpecification",
              negate: false,
              required: false,
              fields: { value: "\\blossless\\b" },
            },
          ],
        },
        {
          name: "Vinyl",
          includeCustomFormatWhenRenaming: false,
          specifications: [
            {
              name: "Vinyl",
              implementation: "ReleaseTitleSpecification",
              negate: false,
              required: false,
              fields: { value: "\\bVinyl\\b" },
            },
          ],
        },
      ];

      const existingFormats = await lidarrClient.getCustomFormats();
      for (const format of customFormats) {
        const existing = existingFormats.find((f) => f.name === format.name);
        if (!existing) {
          try {
            const created = await lidarrClient.createCustomFormat(format);
            results.customFormats.push(created);
          } catch (err) {
            results.errors.push(
              `Failed to create custom format "${format.name}": ${err.message}`,
            );
          }
        } else {
          results.customFormats.push(existing);
        }
      }

      const namingConfig = await lidarrClient.getNamingConfig();
      const updatedNamingConfig = {
        ...namingConfig,
        renameTracks: true,
        replaceIllegalCharacters: true,
        standardTrackFormat:
          "{Album Title} {(Album Disambiguation)}/{Artist Name}_{Album Title}_{track:00}_{Track Title}",
        multiDiscTrackFormat:
          "{Album Title} {(Album Disambiguation)}/{Artist Name}_{Album Title}_{medium:00}-{track:00}_{Track Title}",
        artistFolderFormat: "{Artist Name}",
      };

      await lidarrClient.updateNamingConfig(updatedNamingConfig);
      results.namingConfig = updatedNamingConfig;

      const existingProfiles = await lidarrClient.getQualityProfiles();
      let aurralProfile = existingProfiles.find(
        (p) => p.name === "Aurral - HQ",
      );

      if (!aurralProfile) {
        const profileData = {
          name: "Aurral - HQ",
          upgradeAllowed: true,
          cutoff: 1005,
          items: [
            {
              name: "High Quality Lossy",
              items: [
                { quality: { id: 2, name: "MP3-VBR-V0" }, allowed: false },
                { quality: { id: 12, name: "AAC-VBR" }, allowed: false },
                { quality: { id: 4, name: "MP3-320" }, allowed: true },
                { quality: { id: 15, name: "OGG Vorbis Q9" }, allowed: false },
                { quality: { id: 11, name: "AAC-320" }, allowed: false },
                { quality: { id: 14, name: "OGG Vorbis Q10" }, allowed: false },
              ],
              allowed: true,
              id: 1004,
            },
            {
              name: "Lossless",
              items: [
                { quality: { id: 6, name: "FLAC" }, allowed: true },
                { quality: { id: 7, name: "ALAC" }, allowed: false },
                { quality: { id: 35, name: "APE" }, allowed: false },
                { quality: { id: 36, name: "WavPack" }, allowed: false },
                { quality: { id: 21, name: "FLAC 24bit" }, allowed: false },
                { quality: { id: 37, name: "ALAC 24bit" }, allowed: false },
              ],
              allowed: true,
              id: 1005,
            },
            { quality: { id: 0, name: "Unknown" }, allowed: false },
            {
              name: "Trash Quality Lossy",
              items: [
                { quality: { id: 32, name: "MP3-8" }, allowed: false },
                { quality: { id: 31, name: "MP3-16" }, allowed: false },
                { quality: { id: 30, name: "MP3-24" }, allowed: false },
                { quality: { id: 29, name: "MP3-32" }, allowed: false },
                { quality: { id: 28, name: "MP3-40" }, allowed: false },
                { quality: { id: 27, name: "MP3-48" }, allowed: false },
                { quality: { id: 26, name: "MP3-56" }, allowed: false },
                { quality: { id: 25, name: "MP3-64" }, allowed: false },
                { quality: { id: 24, name: "MP3-80" }, allowed: false },
              ],
              allowed: false,
              id: 1000,
            },
            {
              name: "Poor Quality Lossy",
              items: [
                { quality: { id: 23, name: "MP3-96" }, allowed: false },
                { quality: { id: 33, name: "MP3-112" }, allowed: false },
                { quality: { id: 22, name: "MP3-128" }, allowed: false },
                { quality: { id: 19, name: "OGG Vorbis Q5" }, allowed: false },
                { quality: { id: 5, name: "MP3-160" }, allowed: false },
              ],
              allowed: false,
              id: 1001,
            },
            {
              name: "Low Quality Lossy",
              items: [
                { quality: { id: 1, name: "MP3-192" }, allowed: false },
                { quality: { id: 18, name: "OGG Vorbis Q6" }, allowed: false },
                { quality: { id: 9, name: "AAC-192" }, allowed: false },
                { quality: { id: 20, name: "WMA" }, allowed: false },
                { quality: { id: 34, name: "MP3-224" }, allowed: false },
              ],
              allowed: false,
              id: 1002,
            },
            {
              name: "Mid Quality Lossy",
              items: [
                { quality: { id: 17, name: "OGG Vorbis Q7" }, allowed: false },
                { quality: { id: 8, name: "MP3-VBR-V2" }, allowed: false },
                { quality: { id: 3, name: "MP3-256" }, allowed: false },
                { quality: { id: 16, name: "OGG Vorbis Q8" }, allowed: false },
                { quality: { id: 10, name: "AAC-256" }, allowed: false },
              ],
              allowed: false,
              id: 1003,
            },
            { quality: { id: 13, name: "WAV" }, allowed: false },
          ],
          minFormatScore: 1,
          cutoffFormatScore: 0,
          formatItems: results.customFormats.map((cf, index) => {
            const scores = {
              "Preferred Groups": 10,
              CD: 10,
              WEB: 5,
              Lossless: 10,
              Vinyl: -10,
            };
            return {
              format: cf.id,
              name: cf.name,
              score: scores[cf.name] || 0,
            };
          }),
        };

        aurralProfile = await lidarrClient.createQualityProfile(profileData);
        results.qualityProfile = {
          id: aurralProfile.id,
          name: aurralProfile.name,
        };

        const currentSettings = dbOps.getSettings();
        dbOps.updateSettings({
          ...currentSettings,
          integrations: {
            ...currentSettings.integrations,
            lidarr: {
              ...(currentSettings.integrations?.lidarr || {}),
              qualityProfileId: aurralProfile.id,
            },
          },
        });
      } else {
        results.qualityProfile = {
          id: aurralProfile.id,
          name: aurralProfile.name,
          alreadyExists: true,
        };
      }

      res.json({
        success: true,
        message: "Community guide settings applied successfully",
        results,
      });
    } catch (error) {
      console.error("[Settings] Failed to apply community guide:", error);
      res.status(500).json({
        error: "Failed to apply community guide settings",
        message: error.message,
        details: error.response?.data,
        partialResults: results,
      });
    }
  } catch (error) {
    console.error("[Settings] Error applying community guide:", error);
    res.status(500).json({
      error: "Failed to apply community guide settings",
      message: error.message,
    });
  }
});

router.post("/logs/level", async (req, res) => {
  try {
    const { logger } = await import("../services/logger.js");
    const { level, category } = req.body;

    if (!level) {
      return res.status(400).json({ error: "level is required" });
    }

    if (category) {
      logger.setCategoryLevel(category, level);
      res.json({ message: `Log level for ${category} set to ${level}` });
    } else {
      logger.setLevel(level);
      res.json({ message: `Global log level set to ${level}` });
    }
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to set log level", message: error.message });
  }
});

export default router;
