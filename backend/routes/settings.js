import express from "express";
import { db } from "../config/db.js";
import { defaultData } from "../config/constants.js";

const router = express.Router();

router.get("/", (req, res) => {
  res.json(db.data.settings || defaultData.settings);
});

router.post("/", async (req, res) => {
  try {
    const {
      rootFolderPath,
      qualityProfileId,
      metadataProfileId,
      monitored,
      searchForMissingAlbums,
      albumFolders,
      integrations,
      metadataProfileReleaseTypes
    } = req.body;

    db.data.settings = {
      ...(db.data.settings || defaultData.settings),
      rootFolderPath,
      qualityProfileId,
      metadataProfileId,
      monitored,
      searchForMissingAlbums,
      albumFolders,
      integrations: integrations || db.data.settings.integrations,
      metadataProfileReleaseTypes: metadataProfileReleaseTypes || db.data.settings.metadataProfileReleaseTypes
    };
    await db.write();
    res.json(db.data.settings);
  } catch (error) {
    res.status(500).json({ error: "Failed to save settings" });
  }
});

export default router;
