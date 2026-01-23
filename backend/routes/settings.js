import express from "express";
import { db } from "../config/db.js";
import { defaultData } from "../config/constants.js";

const router = express.Router();

router.get("/", (req, res) => {
  try {
    res.json(db.data?.settings || defaultData.settings);
  } catch (error) {
    console.error("Settings GET error:", error);
    res.status(500).json({ error: "Failed to fetch settings", message: error.message });
  }
});

router.post("/", async (req, res) => {
  try {
    if (!db.data) {
      db.data = defaultData;
    }
    if (!db.data.settings) {
      db.data.settings = defaultData.settings;
    }

    const {
      quality,
      releaseTypes,
      integrations,
      queueCleaner,
    } = req.body;

    db.data.settings = {
      ...(db.data.settings || defaultData.settings),
      // rootFolderPath is always /data - removed from settings
      quality: quality || db.data.settings?.quality || 'standard',
      releaseTypes: releaseTypes || db.data.settings?.releaseTypes || defaultData.settings.releaseTypes,
      integrations: integrations || db.data.settings?.integrations || defaultData.settings.integrations,
      queueCleaner: queueCleaner || db.data.settings?.queueCleaner || defaultData.settings.queueCleaner,
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
    await db.write();
    res.json(db.data.settings);
  } catch (error) {
    console.error("Settings POST error:", error);
    res.status(500).json({ error: "Failed to save settings", message: error.message });
  }
});

export default router;
