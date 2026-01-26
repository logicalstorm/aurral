import express from "express";
import axios from "axios";
import { UUID_REGEX } from "../config/constants.js";
import { musicbrainzRequest, getLastfmApiKey, lastfmRequest } from "../services/apiClients.js";
import { imagePrefetchService } from "../services/imagePrefetchService.js";
import { getAuthUser, getAuthPassword } from "../middleware/auth.js";

const router = express.Router();


const parseLastFmDate = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(dateStr.split(",")[0].trim());
  if (isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
};

// Handle both /search and /artists endpoints for search
const handleSearch = async (req, res) => {
  try {
    const { query, limit = 20, offset = 0 } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Query parameter is required" });
    }

    if (getLastfmApiKey()) {
      try {
        const limitInt = parseInt(limit) || 20;
        const offsetInt = parseInt(offset) || 0;
        const page = Math.floor(offsetInt / limitInt) + 1;

        const lastfmData = await lastfmRequest("artist.search", {
          artist: query,
          limit: limitInt,
          page,
        });

        if (lastfmData?.results?.artistmatches?.artist) {
          const artists = Array.isArray(lastfmData.results.artistmatches.artist)
            ? lastfmData.results.artistmatches.artist
            : [lastfmData.results.artistmatches.artist];

          const { db } = await import("../config/db.js");
          const formattedArtists = artists
            .filter((a) => a.mbid)
            .map((a) => {
              let img = null;
              if (a.image && Array.isArray(a.image)) {
                const i =
                  a.image.find((img) => img.size === "extralarge") ||
                  a.image.find((img) => img.size === "large") ||
                  a.image.find((img) => img.size === "medium");
                if (
                  i &&
                  i["#text"] &&
                  !i["#text"].includes("2a96cbd8b46e442fc41c2b86b821562f")
                ) {
                  img = i["#text"];
                }
              }

              const result = {
                id: a.mbid,
                name: a.name,
                "sort-name": a.name,
                image: img,
                imageUrl: img,
                listeners: a.listeners,
              };
              
              if (db.data.images?.[a.mbid] && db.data.images[a.mbid] !== "NOT_FOUND") {
                result.imageUrl = db.data.images[a.mbid];
                result.image = db.data.images[a.mbid];
              }
              
              return result;
            });

          if (formattedArtists.length > 0) {
            // Pre-fetch images for search results in background
            imagePrefetchService.prefetchSearchResults(formattedArtists).catch(() => {});
            
            return res.json({
              artists: formattedArtists,
              count: parseInt(
                lastfmData.results["opensearch:totalResults"] || 0,
              ),
              offset: offsetInt,
            });
          }
        }
      } catch (error) {
        console.warn(
          "Last.fm search failed",
          error.message,
        );
      }
    }

    res.json({ artists: [], count: 0, offset: 0 });
  } catch (error) {
    res.status(500).json({
      error: "Failed to search artists",
      message: error.message,
    });
  }
};

// Register search handler for both /search and /artists
router.get("/search", handleSearch);
router.get("/artists", handleSearch);

// Root route - return 404 for /api/artists without MBID
router.get("/", async (req, res) => {
  res.status(404).json({ 
    error: "Not found",
    message: "Use /api/artists/:mbid to get artist details, or /api/search/artists to search"
  });
});

router.get("/release-group/:mbid/cover", async (req, res) => {
  try {
    const { mbid } = req.params;

    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: "Invalid MBID format", images: [] });
    }

    const { db } = await import("../config/db.js");
    const cacheKey = `rg:${mbid}`;
    
    if (db.data.images && db.data.images[cacheKey] && db.data.images[cacheKey] !== "NOT_FOUND") {
      const cachedUrl = db.data.images[cacheKey];
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      return res.json({
        images: [{
          image: cachedUrl,
          front: true,
          types: ["Front"],
        }]
      });
    }

    if (db.data.images && db.data.images[cacheKey] === "NOT_FOUND") {
      res.set("Cache-Control", "public, max-age=3600");
      return res.json({ images: [] });
    }

    try {
      const coverArtJson = await axios.get(
        `https://coverartarchive.org/release-group/${mbid}`,
        {
          headers: { Accept: "application/json" },
          timeout: 2000,
        }
      ).catch(() => null);

      if (coverArtJson?.data?.images && coverArtJson.data.images.length > 0) {
        const frontImage = coverArtJson.data.images.find(img => img.front) || coverArtJson.data.images[0];
        if (frontImage) {
          const imageUrl = frontImage.thumbnails?.["500"] || frontImage.thumbnails?.["large"] || frontImage.image;
          if (imageUrl) {
            if (!db.data.images) db.data.images = {};
            db.data.images[cacheKey] = imageUrl;
            db.write().catch(e => console.error("Error saving album cover to database:", e.message));
            
            res.set("Cache-Control", "public, max-age=31536000, immutable");
            return res.json({
              images: [{
                image: imageUrl,
                front: true,
                types: frontImage.types || ["Front"],
              }]
            });
          }
        }
      }
    } catch (e) {
    }

    if (!db.data.images) db.data.images = {};
    db.data.images[cacheKey] = "NOT_FOUND";
    db.write().catch(e => console.error("Error saving NOT_FOUND to database:", e.message));
    res.set("Cache-Control", "public, max-age=3600");
    res.json({ images: [] });
  } catch (error) {
    console.error(`Error in release-group cover route for ${req.params.mbid}:`, error.message);
    res.set("Cache-Control", "public, max-age=60");
    res.json({ images: [] });
  }
});

// Get release group tracks from MusicBrainz
router.get("/release-group/:mbid/tracks", async (req, res) => {
  try {
    const { mbid } = req.params;
    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: "Invalid MBID format" });
    }

    // Get release group to find a release
    const rgData = await musicbrainzRequest(`/release-group/${mbid}`, {
      inc: 'releases',
    });
    
    if (!rgData.releases || rgData.releases.length === 0) {
      return res.json([]);
    }
    
    // Get first release to get tracks
    const releaseId = rgData.releases[0].id;
    const releaseData = await musicbrainzRequest(`/release/${releaseId}`, {
      inc: 'recordings',
    });
    
    const tracks = [];
    if (releaseData.media && releaseData.media.length > 0) {
      for (const medium of releaseData.media) {
        if (medium.tracks) {
          for (const track of medium.tracks) {
            const recording = track.recording;
            if (recording) {
              tracks.push({
                id: recording.id,
                mbid: recording.id,
                title: recording.title,
                trackName: recording.title,
                trackNumber: track.position || 0,
                position: track.position || 0,
                length: recording.length || null,
              });
            }
          }
        }
      }
    }
    
    res.json(tracks);
  } catch (error) {
    console.error("Error fetching release group tracks:", error);
    res.status(500).json({
      error: "Failed to fetch tracks",
      message: error.message,
    });
  }
});

// Helper function to send SSE message
const sendSSE = (res, event, data) => {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // Flush the response to ensure it's sent immediately
    if (res.flush && typeof res.flush === 'function') {
      res.flush();
    }
  } catch (err) {
    console.error(`[SSE] Error sending event ${event}:`, err.message);
  }
};

// Helper to verify token authentication (for EventSource which doesn't support headers)
const verifyTokenAuth = (req) => {
  const passwords = getAuthPassword();
  if (passwords.length === 0) {
    return true; // No auth required
  }

  // Check Authorization header first (if present)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Basic ')) {
    const token = authHeader.substring(6);
    try {
      const [username, password] = atob(token).split(':');
      const userMatches = username === getAuthUser();
      const passwordMatches = passwords.some((p) => password === p);
      if (userMatches && passwordMatches) {
        return true;
      }
    } catch (e) {
      // Invalid token format
    }
  }

  // Check token query parameter (for EventSource)
  const token = req.query.token;
  if (token) {
    try {
      const [username, password] = atob(decodeURIComponent(token)).split(':');
      const userMatches = username === getAuthUser();
      const passwordMatches = passwords.some((p) => password === p);
      if (userMatches && passwordMatches) {
        return true;
      }
    } catch (e) {
      // Invalid token format
    }
  }

  return false;
};

// Streaming endpoint for artist details
router.get("/:mbid/stream", async (req, res) => {
  try {
    const { mbid } = req.params;
    
    // Validate MBID format early
    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ 
        error: "Invalid MBID format",
        message: `"${mbid}" is not a valid MusicBrainz ID. MBIDs must be UUIDs.`
      });
    }

    // Verify authentication
    if (!verifyTokenAuth(req)) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required"
      });
    }
    
    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    
    // Send initial connection message
    sendSSE(res, 'connected', { mbid });
    
    try {
      // Fetch basic artist data from MusicBrainz
      console.log(`[Artists Stream] Fetching artist ${mbid}`);
      const artistData = await musicbrainzRequest(`/artist/${mbid}`, {
        inc: "aliases+tags+ratings+genres+release-groups",
      });

      // Send artist data immediately
      sendSSE(res, 'artist', artistData);
      
      // Track all background tasks
      const backgroundTasks = [];

      // Fetch cover image in background
      const coverTask = (async () => {
        try {
          const { db } = await import("../config/db.js");
          const { libraryManager } = await import("../services/libraryManager.js");
          const libraryArtist = libraryManager.getArtist(mbid);
          let artistName = libraryArtist?.artistName || artistData?.name || null;

          // Try cached first
          if (db.data.images && db.data.images[mbid] && db.data.images[mbid] !== "NOT_FOUND") {
            sendSSE(res, 'cover', {
              images: [{
                image: db.data.images[mbid],
                front: true,
                types: ["Front"],
              }]
            });
            return;
          }

          // Try Deezer if we have artist name
          if (artistName) {
            try {
              const deezerResponse = await axios.get(
                `https://api.deezer.com/search/artist`,
                {
                  params: { q: artistName, limit: 1 },
                  timeout: 2000
                }
              ).catch(() => null);

              if (deezerResponse?.data?.data?.[0]?.picture_xl || deezerResponse?.data?.data?.[0]?.picture_big) {
                const artist = deezerResponse.data.data[0];
                const imageUrl = artist.picture_xl || artist.picture_big;
                if (!db.data.images) db.data.images = {};
                if (!db.data.imageCacheAge) db.data.imageCacheAge = {};
                db.data.images[mbid] = imageUrl;
                db.data.imageCacheAge[mbid] = Date.now();
                db.write().catch(() => {});
                
                sendSSE(res, 'cover', {
                  images: [{
                    image: imageUrl,
                    front: true,
                    types: ["Front"],
                  }]
                });
                return;
              }
            } catch (e) {}
          }

          // Try Cover Art Archive as fallback
          if (artistData?.["release-groups"]?.length > 0) {
            const releaseGroups = artistData["release-groups"]
              .filter(rg => rg["primary-type"] === "Album" || rg["primary-type"] === "EP")
              .sort((a, b) => {
                const dateA = a["first-release-date"] || "";
                const dateB = b["first-release-date"] || "";
                return dateB.localeCompare(dateA);
              })
              .slice(0, 2);

            for (const rg of releaseGroups) {
              try {
                const coverArtResponse = await axios.get(
                  `https://coverartarchive.org/release-group/${rg.id}`,
                  {
                    headers: { Accept: "application/json" },
                    timeout: 2000,
                  }
                ).catch(() => null);

                if (coverArtResponse?.data?.images?.length > 0) {
                  const frontImage = coverArtResponse.data.images.find(img => img.front) || coverArtResponse.data.images[0];
                  if (frontImage) {
                    const imageUrl = frontImage.thumbnails?.["500"] || frontImage.thumbnails?.["large"] || frontImage.image;
                    if (imageUrl) {
                      if (!db.data.images) db.data.images = {};
                      if (!db.data.imageCacheAge) db.data.imageCacheAge = {};
                      db.data.images[mbid] = imageUrl;
                      db.data.imageCacheAge[mbid] = Date.now();
                      db.write().catch(() => {});
                      
                      sendSSE(res, 'cover', {
                        images: [{
                          image: imageUrl,
                          front: true,
                          types: frontImage.types || ["Front"],
                        }]
                      });
                      return;
                    }
                  }
                }
              } catch (e) {}
            }
          }

          // No cover found
          if (!db.data.images) db.data.images = {};
          db.data.images[mbid] = "NOT_FOUND";
          db.write().catch(() => {});
          sendSSE(res, 'cover', { images: [] });
        } catch (e) {
          sendSSE(res, 'cover', { images: [] });
        }
      })();
      backgroundTasks.push(coverTask);

      // Fetch similar artists in background
      const similarTask = (async () => {
        if (getLastfmApiKey()) {
          try {
            const similarData = await lastfmRequest("artist.getSimilar", {
              mbid,
              limit: 20,
            });

            if (similarData?.similarartists?.artist) {
              const artists = Array.isArray(similarData.similarartists.artist)
                ? similarData.similarartists.artist
                : [similarData.similarartists.artist];

              const formattedArtists = artists
                .map((a) => {
                  let img = null;
                  if (a.image && Array.isArray(a.image)) {
                    const i =
                      a.image.find((img) => img.size === "extralarge") ||
                      a.image.find((img) => img.size === "large");
                    if (
                      i &&
                      i["#text"] &&
                      !i["#text"].includes("2a96cbd8b46e442fc41c2b86b821562f")
                    )
                      img = i["#text"];
                  }
                  return {
                    id: a.mbid,
                    name: a.name,
                    image: img,
                    match: Math.round((a.match || 0) * 100),
                  };
                })
                .filter((a) => a.id);

              sendSSE(res, 'similar', { artists: formattedArtists });
            } else {
              sendSSE(res, 'similar', { artists: [] });
            }
          } catch (e) {
            sendSSE(res, 'similar', { artists: [] });
          }
        } else {
          sendSSE(res, 'similar', { artists: [] });
        }
      })();
      backgroundTasks.push(similarTask);

      // Fetch release group covers in background
      const releaseGroupCoversTask = (async () => {
        if (artistData?.["release-groups"]?.length > 0) {
          const releaseGroups = artistData["release-groups"]
            .filter(rg => rg["primary-type"] === "Album" || rg["primary-type"] === "EP")
            .slice(0, 20); // Limit to first 20

          // Fetch covers in parallel batches
          const batchSize = 5;
          const allCoverPromises = [];
          
          for (let i = 0; i < releaseGroups.length; i += batchSize) {
            const batch = releaseGroups.slice(i, i + batchSize);
            
            const batchPromises = batch.map(async (rg) => {
              try {
                const { db } = await import("../config/db.js");
                const cacheKey = `rg:${rg.id}`;
                
                // Check cache first
                if (db.data.images && db.data.images[cacheKey] && db.data.images[cacheKey] !== "NOT_FOUND") {
                  sendSSE(res, 'releaseGroupCover', {
                    mbid: rg.id,
                    images: [{
                      image: db.data.images[cacheKey],
                      front: true,
                      types: ["Front"],
                    }]
                  });
                  return;
                }

                if (db.data.images && db.data.images[cacheKey] === "NOT_FOUND") {
                  sendSSE(res, 'releaseGroupCover', {
                    mbid: rg.id,
                    images: []
                  });
                  return;
                }

                // Fetch from Cover Art Archive
                const coverArtResponse = await axios.get(
                  `https://coverartarchive.org/release-group/${rg.id}`,
                  {
                    headers: { Accept: "application/json" },
                    timeout: 2000,
                  }
                ).catch(() => null);

                if (coverArtResponse?.data?.images?.length > 0) {
                  const frontImage = coverArtResponse.data.images.find(img => img.front) || coverArtResponse.data.images[0];
                  if (frontImage) {
                    const imageUrl = frontImage.thumbnails?.["500"] || frontImage.thumbnails?.["large"] || frontImage.image;
                    if (imageUrl) {
                      if (!db.data.images) db.data.images = {};
                      db.data.images[cacheKey] = imageUrl;
                      db.write().catch(() => {});
                      
                      sendSSE(res, 'releaseGroupCover', {
                        mbid: rg.id,
                        images: [{
                          image: imageUrl,
                          front: true,
                          types: frontImage.types || ["Front"],
                        }]
                      });
                      return;
                    }
                  }
                }

                // No cover found
                if (!db.data.images) db.data.images = {};
                db.data.images[cacheKey] = "NOT_FOUND";
                db.write().catch(() => {});
                sendSSE(res, 'releaseGroupCover', {
                  mbid: rg.id,
                  images: []
                });
              } catch (e) {
                sendSSE(res, 'releaseGroupCover', {
                  mbid: rg.id,
                  images: []
                });
              }
            });
            
            allCoverPromises.push(...batchPromises);
          }
          
          // Wait for all cover fetches to complete
          await Promise.allSettled(allCoverPromises);
        }
      })();
      backgroundTasks.push(releaseGroupCoversTask);

      // Wait for all background tasks to complete before closing
      Promise.allSettled(backgroundTasks).then(() => {
        // Send completion event
        sendSSE(res, 'complete', {});
        
        // Close connection after a short delay to ensure all messages are sent
        setTimeout(() => {
          res.end();
        }, 100);
      }).catch(() => {
        // Even if there's an error, try to send complete and close
        sendSSE(res, 'complete', {});
        setTimeout(() => {
          res.end();
        }, 100);
      });
      
    } catch (error) {
      console.error(`[Artists Stream] Error for artist ${mbid}:`, error.message);
      sendSSE(res, 'error', {
        error: "Failed to fetch artist details",
        message: error.response?.data?.error || error.message,
      });
      res.end();
    }
  } catch (error) {
    console.error(`[Artists Stream] Unexpected error:`, error.message);
    res.status(500).json({
      error: "Failed to stream artist details",
      message: error.message,
    });
  }
});

router.get("/:mbid", async (req, res) => {
  try {
    const { mbid } = req.params;
    
    // Validate MBID format early to catch invalid requests
    if (!UUID_REGEX.test(mbid)) {
      console.log(`[Artists Route] Invalid MBID format: ${mbid}`);
      return res.status(400).json({ 
        error: "Invalid MBID format",
        message: `"${mbid}" is not a valid MusicBrainz ID. MBIDs must be UUIDs.`
      });
    }
    
    console.log(`[Artists Route] Fetching artist details for MBID: ${mbid}`);

    try {
      console.log(`[Artists Route] Calling MusicBrainz for ${mbid}`);
      const data = await musicbrainzRequest(`/artist/${mbid}`, {
        inc: "aliases+tags+ratings+genres+release-groups",
      });

      console.log(`[Artists Route] Successfully fetched artist ${mbid}`);
      console.log(`[Artists Route] Response data type:`, typeof data);
      console.log(`[Artists Route] Response has id:`, !!data?.id);
      console.log(`[Artists Route] Response keys:`, data ? Object.keys(data).slice(0, 10) : 'null');
      res.setHeader('Content-Type', 'application/json');
      res.json(data);
    } catch (error) {
      console.error(`[Artists Route] MusicBrainz error for artist ${mbid}:`, error.message);
      console.error(`[Artists Route] Error stack:`, error.stack);
      res.status(error.response?.status || 500).json({
        error: "Failed to fetch artist details",
        message: error.response?.data?.error || error.message,
      });
    }
  } catch (error) {
    console.error(`[Artists Route] Unexpected error in artist details route:`, error.message);
    console.error(`[Artists Route] Error stack:`, error.stack);
    res.status(500).json({
      error: "Failed to fetch artist details",
      message: error.message,
    });
  }
});

const pendingCoverRequests = new Map();

// Background fetch function (doesn't block)
const fetchCoverInBackground = async (mbid) => {
  if (pendingCoverRequests.has(mbid)) return;
  
  const fetchPromise = (async () => {
    try {
      const { db } = await import("../config/db.js");
      const { libraryManager } = await import("../services/libraryManager.js");
      const libraryArtist = libraryManager.getArtist(mbid);
      let artistName = libraryArtist?.artistName || null;

      const [mbResult, deezerResult] = await Promise.allSettled([
        !artistName ? Promise.race([
          musicbrainzRequest(`/artist/${mbid}`, {}),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("MusicBrainz timeout")), 2000)
          )
        ]).catch(() => null) : Promise.resolve(null),
        artistName ? axios.get(
          `https://api.deezer.com/search/artist`,
          {
            params: { q: artistName, limit: 1 },
            timeout: 2000
          }
        ).catch(() => null) : Promise.resolve(null)
      ]);

      if (!artistName && mbResult.status === 'fulfilled' && mbResult.value?.name) {
        artistName = mbResult.value.name;
        if (artistName) {
          try {
            const searchResponse = await axios.get(
              `https://api.deezer.com/search/artist`,
              {
                params: { q: artistName, limit: 1 },
                timeout: 2000
              }
            ).catch(() => null);

            if (searchResponse?.data?.data?.[0]?.picture_xl || searchResponse?.data?.data?.[0]?.picture_big) {
              const artist = searchResponse.data.data[0];
              const imageUrl = artist.picture_xl || artist.picture_big;
              if (!db.data.images) db.data.images = {};
              if (!db.data.imageCacheAge) db.data.imageCacheAge = {};
              db.data.images[mbid] = imageUrl;
              db.data.imageCacheAge[mbid] = Date.now();
              db.write().catch(() => {});
              return;
            }
          } catch (e) {}
        }
      }

      if (deezerResult.status === 'fulfilled' && deezerResult.value?.data?.data?.[0]) {
        const artist = deezerResult.value.data.data[0];
        if (artist.picture_xl || artist.picture_big) {
          const imageUrl = artist.picture_xl || artist.picture_big;
          if (!db.data.images) db.data.images = {};
          if (!db.data.imageCacheAge) db.data.imageCacheAge = {};
          db.data.images[mbid] = imageUrl;
          db.data.imageCacheAge[mbid] = Date.now();
          db.write().catch(() => {});
          return;
        }
      }
    } catch (e) {
      // Silent fail for background updates
    }
  })();
  
  pendingCoverRequests.set(mbid, fetchPromise);
  try {
    await fetchPromise;
  } finally {
    pendingCoverRequests.delete(mbid);
  }
};

router.get("/:mbid/cover", async (req, res) => {
  const { mbid } = req.params;
  const { refresh = false } = req.query;
  
  try {
    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: "Invalid MBID format", images: [] });
    }

    if (pendingCoverRequests.has(mbid)) {
      console.log(`[Cover Route] Deduplicating request for ${mbid}`);
      const result = await pendingCoverRequests.get(mbid);
      return res.json({ images: result.images || [] });
    }

    const { db } = await import("../config/db.js");
    
    // Optimistic response: return cached data immediately if available
    if (!refresh && db.data.images && db.data.images[mbid] && db.data.images[mbid] !== "NOT_FOUND") {
      console.log(`[Cover Route] Cache hit for ${mbid}`);
      const cachedUrl = db.data.images[mbid];
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      
      // Trigger background refresh if cache is old (older than 7 days)
      const cacheAge = db.data.imageCacheAge?.[mbid];
      const shouldRefresh = !cacheAge || (Date.now() - cacheAge > 7 * 24 * 60 * 60 * 1000);
      
      if (shouldRefresh) {
        // Don't await - let it run in background
        fetchCoverInBackground(mbid).catch(() => {});
      }
      
      return res.json({
        images: [{
          image: cachedUrl,
          front: true,
          types: ["Front"],
        }]
      });
    }

    if (!refresh && db.data.images && db.data.images[mbid] === "NOT_FOUND") {
      console.log(`[Cover Route] NOT_FOUND cache for ${mbid}`);
      res.set("Cache-Control", "public, max-age=3600");
      
      // Try again in background after some time (maybe new images available)
      setTimeout(() => {
        fetchCoverInBackground(mbid).catch(() => {});
      }, 60000); // Try again after 1 minute
      
      return res.json({ images: [] });
    }

    console.log(`[Cover Route] Fetching cover for ${mbid}`);

    const fetchPromise = (async () => {
      try {
        const { db } = await import("../config/db.js");
        const { libraryManager } = await import("../services/libraryManager.js");
        const libraryArtist = libraryManager.getArtist(mbid);

        // Try to get artist name from library first (fastest, no API call)
        let artistName = libraryArtist?.artistName || null;

        // Parallel strategy: try MusicBrainz (if needed) and Deezer simultaneously
        const [mbResult, deezerResult] = await Promise.allSettled([
          // Only fetch from MusicBrainz if we don't have the name
          !artistName ? Promise.race([
            musicbrainzRequest(`/artist/${mbid}`, {}),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error("MusicBrainz timeout")), 2000)
            )
          ]).catch(() => null) : Promise.resolve(null),
          // Try Deezer search if we have a name
          artistName ? axios.get(
            `https://api.deezer.com/search/artist`,
            {
              params: { q: artistName, limit: 1 },
              timeout: 2000
            }
          ).catch(() => null) : Promise.resolve(null)
        ]);

        // Extract artist name from MusicBrainz if we got it
        if (!artistName && mbResult.status === 'fulfilled' && mbResult.value?.name) {
          artistName = mbResult.value.name;
          
          // Now try Deezer with the name we just got
          if (artistName) {
            try {
              const searchResponse = await axios.get(
                `https://api.deezer.com/search/artist`,
                {
                  params: { q: artistName, limit: 1 },
                  timeout: 2000
                }
              ).catch(() => null);

              if (searchResponse?.data?.data?.[0]?.picture_xl || searchResponse?.data?.data?.[0]?.picture_big) {
                const artist = searchResponse.data.data[0];
                const imageUrl = artist.picture_xl || artist.picture_big;
                if (!db.data.images) db.data.images = {};
                db.data.images[mbid] = imageUrl;
                db.write().catch(e => console.error("Error saving image to database:", e.message));
                return {
                  images: [{
                    image: imageUrl,
                    front: true,
                    types: ["Front"],
                  }]
                };
              }
            } catch (e) {
              // Continue to fallback
            }
          }
        }

        // Check if Deezer search succeeded
        if (deezerResult.status === 'fulfilled' && deezerResult.value?.data?.data?.[0]) {
          const artist = deezerResult.value.data.data[0];
          if (artist.picture_xl || artist.picture_big) {
            const imageUrl = artist.picture_xl || artist.picture_big;
            if (!db.data.images) db.data.images = {};
            if (!db.data.imageCacheAge) db.data.imageCacheAge = {};
            db.data.images[mbid] = imageUrl;
            db.data.imageCacheAge[mbid] = Date.now();
            db.write().catch(e => console.error("Error saving image to database:", e.message));
            return {
              images: [{
                image: imageUrl,
                front: true,
                types: ["Front"],
              }]
            };
          }
        }

        // Fallback: Try Cover Art Archive (parallel fetch for multiple release groups)
        try {
          const artistDataForRG = mbResult.status === 'fulfilled' && mbResult.value?.["release-groups"] 
            ? mbResult.value 
            : await Promise.race([
                musicbrainzRequest(`/artist/${mbid}`, { inc: "release-groups" }),
                new Promise((_, reject) => 
                  setTimeout(() => reject(new Error("MusicBrainz timeout")), 2000)
                )
              ]).catch(() => null);

          if (artistDataForRG?.["release-groups"]?.length > 0) {
            const releaseGroups = artistDataForRG["release-groups"]
              .filter(rg => rg["primary-type"] === "Album" || rg["primary-type"] === "EP")
              .sort((a, b) => {
                const dateA = a["first-release-date"] || "";
                const dateB = b["first-release-date"] || "";
                return dateB.localeCompare(dateA);
              })
              .slice(0, 2); // Only check top 2

            // Try cover art in parallel
            const coverArtResults = await Promise.allSettled(
              releaseGroups.map(rg => 
                axios.get(
                  `https://coverartarchive.org/release-group/${rg.id}`,
                  {
                    headers: { Accept: "application/json" },
                    timeout: 2000,
                  }
                ).catch(() => null)
              )
            );

            for (const result of coverArtResults) {
              if (result.status === 'fulfilled' && result.value?.data?.images?.length > 0) {
                const frontImage = result.value.data.images.find(img => img.front) || result.value.data.images[0];
                if (frontImage) {
                  const imageUrl = frontImage.thumbnails?.["500"] || frontImage.thumbnails?.["large"] || frontImage.image;
                  if (imageUrl) {
                    if (!db.data.images) db.data.images = {};
                    if (!db.data.imageCacheAge) db.data.imageCacheAge = {};
                    db.data.images[mbid] = imageUrl;
                    db.data.imageCacheAge[mbid] = Date.now();
                    db.write().catch(e => console.error("Error saving image to database:", e.message));
                    return {
                      images: [{
                        image: imageUrl,
                        front: true,
                        types: frontImage.types || ["Front"],
                      }]
                    };
                  }
                }
              }
            }
          }
        } catch (e) {
          // Continue to negative cache
        }

        return { images: [] };
      } catch (error) {
        console.error(`Error fetching cover for ${mbid}:`, error.message);
        return { images: [] };
      }
    })();

    pendingCoverRequests.set(mbid, fetchPromise);
    const result = await fetchPromise;
    
    if (result.images && result.images.length > 0) {
      console.log(`[Cover Route] Successfully returning cover for ${mbid}`);
      res.set("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      console.log(`[Cover Route] No cover found for ${mbid}, caching NOT_FOUND`);
      const { db } = await import("../config/db.js");
      if (!db.data.images) db.data.images = {};
      db.data.images[mbid] = "NOT_FOUND";
      db.write().catch(e => console.error("Error saving NOT_FOUND to database:", e.message));
      res.set("Cache-Control", "public, max-age=3600");
    }
    
    res.json({ images: result.images || [] });
  } catch (error) {
    console.error(`Error in cover route for ${mbid}:`, error.message);
    res.set("Cache-Control", "public, max-age=60");
    res.json({ images: [] });
  } finally {
    if (mbid) {
      pendingCoverRequests.delete(mbid);
    }
  }
});

router.get("/:mbid/similar", async (req, res) => {
  try {
    const { mbid } = req.params;

    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: "Invalid MBID format" });
    }

    const { limit = 20 } = req.query;

    if (!getLastfmApiKey()) {
      return res.json({ artists: [] });
    }

    const data = await lastfmRequest("artist.getSimilar", {
      mbid,
      limit,
    });

    if (!data?.similarartists?.artist) {
      return res.json({ artists: [] });
    }

    const artists = Array.isArray(data.similarartists.artist)
      ? data.similarartists.artist
      : [data.similarartists.artist];

    const formattedArtists = artists
      .map((a) => {
        let img = null;
        if (a.image && Array.isArray(a.image)) {
          const i =
            a.image.find((img) => img.size === "extralarge") ||
            a.image.find((img) => img.size === "large");
          if (
            i &&
            i["#text"] &&
            !i["#text"].includes("2a96cbd8b46e442fc41c2b86b821562f")
          )
            img = i["#text"];
        }
        return {
          id: a.mbid,
          name: a.name,
          image: img,
          match: Math.round((a.match || 0) * 100),
        };
      })
      .filter((a) => a.id);

    res.json({ artists: formattedArtists });
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch similar artists",
      message: error.message,
    });
  }
});

export default router;
