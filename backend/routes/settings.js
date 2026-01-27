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
    
    // Update QueueCleaner config if it exists
    if (queueCleaner) {
      try {
        const { queueCleaner: qc } = await import('../services/queueCleaner.js');
        qc.updateConfig();
      } catch (error) {
        // QueueCleaner might not be available
      }
    }
    
    dbOps.updateSettings(updatedSettings);
    res.json(updatedSettings);
  } catch (error) {
    console.error("Settings POST error:", error);
    res.status(500).json({ error: "Failed to save settings", message: error.message });
  }
});

export default router;
