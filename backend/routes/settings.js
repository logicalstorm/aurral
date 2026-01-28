import express from "express";
import { dbOps } from "../config/db-helpers.js";
import { defaultData } from "../config/constants.js";

const router = express.Router();

router.get("/", (req, res) => {
  try {
    const settings = dbOps.getSettings();
    res.json(settings);
  } catch (error) {
    console.error("Settings GET error:", error);
    res.status(500).json({ error: "Failed to fetch settings", message: error.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const {
      quality,
      releaseTypes,
      integrations,
      queueCleaner,
    } = req.body;

    const currentSettings = dbOps.getSettings();
    
    const updatedSettings = {
      ...currentSettings,
      quality: quality || currentSettings.quality || 'standard',
      releaseTypes: releaseTypes || currentSettings.releaseTypes || defaultData.settings.releaseTypes,
      integrations: integrations || currentSettings.integrations || defaultData.settings.integrations,
      queueCleaner: queueCleaner || currentSettings.queueCleaner || defaultData.settings.queueCleaner,
    };
    
    if (queueCleaner) {
      try {
        const { queueCleaner: qc } = await import('../services/queueCleaner.js');
        qc.updateConfig();
      } catch (error) {
      }
    }
    
    dbOps.updateSettings(updatedSettings);
    res.json(updatedSettings);
  } catch (error) {
    console.error("Settings POST error:", error);
    res.status(500).json({ error: "Failed to save settings", message: error.message });
  }
});

router.get("/logs", async (req, res) => {
  try {
    const { logger } = await import('../services/logger.js');
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
    res.status(500).json({ error: "Failed to get logs", message: error.message });
  }
});

router.get("/logs/stats", async (req, res) => {
  try {
    const { logger } = await import('../services/logger.js');
    const stats = logger.getLogStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: "Failed to get log stats", message: error.message });
  }
});

router.post("/logs/level", async (req, res) => {
  try {
    const { logger } = await import('../services/logger.js');
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
    res.status(500).json({ error: "Failed to set log level", message: error.message });
  }
});

export default router;
