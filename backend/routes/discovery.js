import express from "express";
import { getDiscoveryCache, updateDiscoveryCache } from "../services/discoveryService.js";
import { lastfmRequest, getLastfmApiKey } from "../services/apiClients.js";
import { libraryManager } from "../services/libraryManager.js";
import { db } from "../config/db.js";
import { defaultData } from "../config/constants.js";

const router = express.Router();

router.post("/refresh", (req, res) => {
  const discoveryCache = getDiscoveryCache();
  if (discoveryCache.isUpdating) {
    return res.status(409).json({
      message: "Discovery update already in progress",
      isUpdating: true,
    });
  }
  updateDiscoveryCache();
  res.json({
    message: "Discovery update started",
    isUpdating: true,
  });
});

router.post("/clear", async (req, res) => {
  const { clearImages = true } = req.body;
  
  db.data.discovery = {
    recommendations: [],
    globalTop: [],
    basedOn: [],
    topTags: [],
    topGenres: [],
    lastUpdated: null,
  };
  
  if (clearImages) {
    db.data.images = {};
  }
  
  await db.write();
  const discoveryCache = getDiscoveryCache();
  Object.assign(discoveryCache, {
    ...db.data.discovery,
    isUpdating: false,
  });
  res.json({ message: clearImages ? "Discovery cache and image cache cleared" : "Discovery cache cleared" });
});

router.get("/", async (req, res) => {
  // Check if discovery is configured
  const hasLastfm = !!getLastfmApiKey();
  const libraryArtists = libraryManager.getAllArtists();
  const hasArtists = libraryArtists.length > 0;
  
  // If nothing is configured, clear any existing data and return empty
  if (!hasLastfm && !hasArtists) {
    // Clear database if it has old data
    if (db.data?.discovery && (
      (db.data.discovery.recommendations?.length > 0) ||
      (db.data.discovery.globalTop?.length > 0) ||
      (db.data.discovery.topGenres?.length > 0) ||
      (db.data.discovery.basedOn?.length > 0)
    )) {
      db.data.discovery = {
        recommendations: [],
        globalTop: [],
        basedOn: [],
        topTags: [],
        topGenres: [],
        lastUpdated: null,
      };
      try {
        await db.write();
      } catch (error) {
        console.error("Failed to clear discovery data:", error.message);
      }
    }
    
    // Clear cache
    const discoveryCache = getDiscoveryCache();
    Object.assign(discoveryCache, {
      recommendations: [],
      globalTop: [],
      basedOn: [],
      topTags: [],
      topGenres: [],
      lastUpdated: null,
      isUpdating: false,
    });
    
    res.set("Cache-Control", "public, max-age=300");
    return res.json({
      recommendations: [],
      globalTop: [],
      basedOn: [],
      topTags: [],
      topGenres: [],
      lastUpdated: null,
      isUpdating: false,
      configured: false,
    });
  }
  
  // Always read directly from database as source of truth
  const dbData = db.data?.discovery || {};
  const discoveryCache = getDiscoveryCache();
  
  // Ensure we have arrays (not undefined)
  const recommendations = Array.isArray(dbData.recommendations) ? dbData.recommendations : (Array.isArray(discoveryCache.recommendations) ? discoveryCache.recommendations : []);
  const globalTop = Array.isArray(dbData.globalTop) ? dbData.globalTop : (Array.isArray(discoveryCache.globalTop) ? discoveryCache.globalTop : []);
  const basedOn = Array.isArray(dbData.basedOn) ? dbData.basedOn : (Array.isArray(discoveryCache.basedOn) ? discoveryCache.basedOn : []);
  const topTags = Array.isArray(dbData.topTags) ? dbData.topTags : (Array.isArray(discoveryCache.topTags) ? discoveryCache.topTags : []);
  const topGenres = Array.isArray(dbData.topGenres) ? dbData.topGenres : (Array.isArray(discoveryCache.topGenres) ? discoveryCache.topGenres : []);
  const lastUpdated = dbData.lastUpdated || discoveryCache.lastUpdated || null;
  const isUpdating = discoveryCache.isUpdating || false;
  
  // Sync cache from database
  if (recommendations.length > 0 || globalTop.length > 0 || topGenres.length > 0) {
    Object.assign(discoveryCache, {
      recommendations,
      globalTop,
      basedOn,
      topTags,
      topGenres,
      lastUpdated,
      isUpdating: false,
    });
  }
  
  res.set("Cache-Control", "public, max-age=300");
  res.json({
    recommendations,
    globalTop,
    basedOn,
    topTags,
    topGenres,
    lastUpdated,
    isUpdating,
    configured: true,
  });
});

router.get("/related", (req, res) => {
  const discoveryCache = getDiscoveryCache();
  res.json({
    recommendations: discoveryCache.recommendations,
    basedOn: discoveryCache.basedOn,
    total: discoveryCache.recommendations.length,
  });
});

router.get("/similar", (req, res) => {
  const discoveryCache = getDiscoveryCache();
  res.json({
    topTags: discoveryCache.topTags,
    topGenres: discoveryCache.topGenres,
    basedOn: discoveryCache.basedOn,
    message: "Served from cache",
  });
});

router.get("/by-tag", async (req, res) => {
  try {
    const { tag, limit = 20 } = req.query;

    if (!tag) {
      return res.status(400).json({ error: "Tag parameter is required" });
    }

    let recommendations = [];

    if (getLastfmApiKey()) {
      try {
        const data = await lastfmRequest("tag.getTopArtists", {
          tag,
          limit: Math.min(parseInt(limit) * 2, 50),
        });

        if (data?.topartists?.artist) {
          const artists = Array.isArray(data.topartists.artist)
            ? data.topartists.artist
            : [data.topartists.artist];

          recommendations = artists
            .map((artist) => {
              let imageUrl = null;
              if (artist.image && Array.isArray(artist.image)) {
                const img =
                  artist.image.find((i) => i.size === "extralarge") ||
                  artist.image.find((i) => i.size === "large") ||
                  artist.image.slice(-1)[0];
                if (
                  img &&
                  img["#text"] &&
                  !img["#text"].includes("2a96cbd8b46e442fc41c2b86b821562f")
                ) {
                  imageUrl = img["#text"];
                }
              }

              return {
                id: artist.mbid,
                name: artist.name,
                sortName: artist.name,
                type: "Artist",
                tags: [tag],
                image: imageUrl,
              };
            })
            .filter((a) => a.id);
        }
      } catch (err) {
        console.error("Last.fm tag search failed:", err.message);
      }
    }

    const libraryArtists = libraryManager.getAllArtists();
    const existingArtistIds = new Set(
      libraryArtists.map((a) => a.mbid),
    );

    const filtered = recommendations
      .filter((artist) => !existingArtistIds.has(artist.id))
      .slice(0, parseInt(limit));

    res.json({
      recommendations: filtered,
      tag,
      total: filtered.length,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to search by tag",
      message: error.message,
    });
  }
});

export default router;
