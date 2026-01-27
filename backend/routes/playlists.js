import express from "express";
import { PlaylistManager } from "../services/playlistManager.js";
import { dbOps } from "../config/db-helpers.js";
import { musicbrainzRequest, lastfmRequest } from "../services/apiClients.js";

const router = express.Router();

const playlistManager = new PlaylistManager(null, musicbrainzRequest, lastfmRequest);

router.get("/weekly", (req, res) => {
  const items = dbOps.getWeeklyFlowItems();
  const weekly = {
    enabled: items.length > 0,
    items: items,
    updatedAt: items.length > 0 ? items[0].addedAt : null,
  };
  res.json(weekly);
});

router.post("/weekly/toggle", async (req, res) => {
  try {
    const { enabled } = req.body;
    const result = await playlistManager.setEnabled(enabled);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to toggle weekly flow" });
  }
});

router.post("/weekly/generate", async (req, res) => {
  try {
    const items = await playlistManager.generateWeeklyFlow();
    res.json({ success: true, count: items.length, items });
  } catch (error) {
    res.status(500).json({ error: "Failed to generate weekly playlist", details: error.message });
  }
});

router.post("/weekly/sync", async (req, res) => {
  try {
    const result = await playlistManager.syncToNavidrome();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to sync to Navidrome", details: error.message });
  }
});

router.post("/weekly/process-files", async (req, res) => {
  try {
    await playlistManager.processStuckWeeklyFlowFiles();
    res.json({ success: true, message: "Processed stuck weekly flow files" });
  } catch (error) {
    res.status(500).json({ error: "Failed to process files", details: error.message });
  }
});

router.post("/items/:mbid/keep", async (req, res) => {
  try {
    const success = await playlistManager.keepItem(req.params.mbid);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: "Failed to keep item" });
  }
});

router.delete("/items/:mbid", async (req, res) => {
  try {
    const success = await playlistManager.removeItem(req.params.mbid);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: "Failed to remove item" });
  }
});

export default router;
