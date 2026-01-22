import express from "express";
import { UUID_REGEX } from "../config/constants.js";
import { getCachedLidarrArtists } from "../services/lidarrCache.js";
import { db } from "../config/db.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const requests = db.data.requests || [];
    let lidarrArtists = [];
    try {
      lidarrArtists = await getCachedLidarrArtists();
    } catch (e) {
      console.error("Failed to fetch Lidarr artists for requests sync", e);
    }

    let changed = false;
    const updatedRequests = requests.map((req) => {
      const lidarrArtist = lidarrArtists.find(
        (a) => a.foreignArtistId === req.mbid,
      );
      let newStatus = req.status;
      let lidarrId = req.lidarrId;

      if (lidarrArtist) {
        lidarrId = lidarrArtist.id;
        const isAvailable =
          lidarrArtist.statistics && lidarrArtist.statistics.sizeOnDisk > 0;
        newStatus = isAvailable ? "available" : "processing";
      }

      if (newStatus !== req.status || lidarrId !== req.lidarrId) {
        changed = true;
        return { ...req, status: newStatus, lidarrId };
      }
      return req;
    });

    if (changed) {
      db.data.requests = updatedRequests;
      await db.write();
    }

    const sortedRequests = [...updatedRequests].sort(
      (a, b) => new Date(b.requestedAt) - new Date(a.requestedAt),
    );

    res.json(sortedRequests);
  } catch (error) {
    console.error("Error in /api/requests:", error);
    res.status(500).json({ error: "Failed to fetch requests" });
  }
});

router.delete("/:mbid", async (req, res) => {
  const { mbid } = req.params;

  if (!UUID_REGEX.test(mbid)) {
    return res.status(400).json({ error: "Invalid MBID format" });
  }

  db.data.requests = (db.data.requests || []).filter((r) => r.mbid !== mbid);
  await db.write();
  res.json({ success: true });
});

export default router;
