import express from "express";
import { cacheMiddleware } from "../middleware/cache.js";
import {
  searchAlbums,
  searchArtists,
  searchArtistsLegacy,
  searchTags,
} from "../services/searchService.js";

const router = express.Router();

router.get("/", cacheMiddleware(300), async (req, res) => {
  try {
    const {
      q,
      scope = "artist",
      limit = 24,
      offset = 0,
      tagScope = "recommended",
      releaseTypes = "",
    } = req.query;

    if (!String(q || "").trim()) {
      return res.status(400).json({ error: "q parameter is required" });
    }

    if (scope === "album") {
      return res.json(await searchAlbums(q, limit, offset, releaseTypes));
    }

    if (scope === "tag") {
      return res.json(await searchTags(q, limit, offset, tagScope));
    }

    return res.json(await searchArtists(q, limit, offset));
  } catch (error) {
    res.status(500).json({
      error: "Failed to search",
      message: error.message,
    });
  }
});

router.get("/artists", cacheMiddleware(300), async (req, res) => {
  try {
    const { query, limit = 24, offset = 0 } = req.query;
    if (!String(query || "").trim()) {
      return res.status(400).json({ error: "Query parameter is required" });
    }
    return res.json(await searchArtistsLegacy(query, limit, offset));
  } catch (error) {
    res.status(500).json({
      error: "Failed to search artists",
      message: error.message,
    });
  }
});

export default router;
