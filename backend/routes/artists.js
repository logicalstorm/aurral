import express from "express";
import axios from "axios";
import { UUID_REGEX } from "../config/constants.js";
import { musicbrainzRequest, getLidarrConfig, getLastfmApiKey, lastfmRequest } from "../services/apiClients.js";

const router = express.Router();


const parseLastFmDate = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(dateStr.split(",")[0].trim());
  if (isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
};

router.get("/search", async (req, res) => {
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

router.get("/:mbid", async (req, res) => {
  try {
    const { mbid } = req.params;
    console.log(`[Artists Route] Fetching artist details for MBID: ${mbid}`);

    if (!UUID_REGEX.test(mbid)) {
      console.log(`[Artists Route] Invalid MBID format: ${mbid}`);
      return res.status(400).json({ error: "Invalid MBID format" });
    }

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

router.get("/:mbid/cover", async (req, res) => {
  const { mbid } = req.params;
  
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
    if (db.data.images && db.data.images[mbid] && db.data.images[mbid] !== "NOT_FOUND") {
      console.log(`[Cover Route] Cache hit for ${mbid}`);
      const cachedUrl = db.data.images[mbid];
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      return res.json({
        images: [{
          image: cachedUrl,
          front: true,
          types: ["Front"],
        }]
      });
    }

    if (db.data.images && db.data.images[mbid] === "NOT_FOUND") {
      console.log(`[Cover Route] NOT_FOUND cache for ${mbid}`);
      res.set("Cache-Control", "public, max-age=3600");
      return res.json({ images: [] });
    }

    console.log(`[Cover Route] Fetching cover for ${mbid}`);

    const fetchPromise = (async () => {
      try {
        const { db } = await import("../config/db.js");
        const { getCachedLidarrArtists } = await import("../services/lidarrCache.js");
        const artists = await getCachedLidarrArtists().catch(() => []);
        const lidarrArtist = artists.find(a => a.foreignArtistId === mbid);

        if (lidarrArtist && lidarrArtist.id) {
          const posterImage = lidarrArtist.images?.find(
            img => img.coverType === "poster" || img.coverType === "fanart"
          ) || lidarrArtist.images?.[0];

          if (posterImage && lidarrArtist.id) {
            console.log(`[Cover Route] Found Lidarr image for ${mbid}`);
            const coverType = posterImage.coverType || "poster";
            const imageUrl = `/api/lidarr/mediacover/${lidarrArtist.id}/${coverType}.jpg`;
            const result = {
              images: [{
                image: imageUrl,
                front: true,
                types: ["Front"],
              }]
            };
            if (!db.data.images) db.data.images = {};
            db.data.images[mbid] = imageUrl;
            db.write().catch(e => console.error("Error saving image to database:", e.message));
            return result;
          }
        }

        try {
          const artistData = await Promise.race([
            musicbrainzRequest(`/artist/${mbid}`, {
              inc: "release-groups+url-rels",
            }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error("MusicBrainz timeout")), 8000)
            )
          ]).catch((e) => {
            console.log(`[Cover Route] MusicBrainz failed for ${mbid}:`, e.message);
            return null;
          });

          if (artistData) {
            let deezerId = null;
            if (artistData.relations) {
              const deezerRelation = artistData.relations.find(
                rel => rel.type === "streaming music" && 
                       (rel.url?.resource?.includes("deezer.com/artist") || 
                        rel["target-type"] === "url" && rel.url?.resource?.includes("deezer.com/artist"))
              );
              if (deezerRelation?.url?.resource) {
                const match = deezerRelation.url.resource.match(/deezer\.com\/artist\/(\d+)/);
                if (match) {
                  deezerId = match[1];
                }
              }
            }

            if (deezerId) {
              try {
                const deezerResponse = await axios.get(
                  `https://api.deezer.com/artist/${deezerId}`,
                  { timeout: 3000 }
                ).catch(() => null);

                if (deezerResponse?.data?.picture_xl || deezerResponse?.data?.picture_big) {
                  const imageUrl = deezerResponse.data.picture_xl || deezerResponse.data.picture_big;
                  console.log(`[Cover Route] Found Deezer image for ${mbid} via relationship`);
                  const result = {
                    images: [{
                      image: imageUrl,
                      front: true,
                      types: ["Front"],
                    }]
                  };
                  if (!db.data.images) db.data.images = {};
                  db.data.images[mbid] = imageUrl;
                  db.write().catch(e => console.error("Error saving image to database:", e.message));
                  return result;
                }
              } catch (e) {
                console.log(`[Cover Route] Deezer API failed for ${mbid}:`, e.message);
              }
            } else if (artistData.name) {
              try {
                const searchResponse = await axios.get(
                  `https://api.deezer.com/search/artist`,
                  {
                    params: { q: artistData.name, limit: 1 },
                    timeout: 3000
                  }
                ).catch(() => null);

                if (searchResponse?.data?.data?.[0]?.picture_xl || searchResponse?.data?.data?.[0]?.picture_big) {
                  const artist = searchResponse.data.data[0];
                  const imageUrl = artist.picture_xl || artist.picture_big;
                  console.log(`[Cover Route] Found Deezer image for ${mbid} via name search`);
                  const result = {
                    images: [{
                      image: imageUrl,
                      front: true,
                      types: ["Front"],
                    }]
                  };
                  if (!db.data.images) db.data.images = {};
                  db.data.images[mbid] = imageUrl;
                  db.write().catch(e => console.error("Error saving image to database:", e.message));
                  return result;
                }
              } catch (e) {
                console.log(`[Cover Route] Deezer search failed for ${mbid}:`, e.message);
              }
            }
          }

          if (artistData?.["release-groups"] && artistData["release-groups"].length > 0) {
            const releaseGroups = artistData["release-groups"]
              .filter(rg => rg["primary-type"] === "Album" || rg["primary-type"] === "EP")
              .sort((a, b) => {
                const dateA = a["first-release-date"] || "";
                const dateB = b["first-release-date"] || "";
                return dateB.localeCompare(dateA);
              });

            console.log(`[Cover Route] Found ${releaseGroups.length} release groups for ${mbid}, checking top 2`);

            const coverArtPromises = releaseGroups.slice(0, 2).map(async (rg, idx) => {
              try {
                const result = await axios.get(
                  `https://coverartarchive.org/release-group/${rg.id}`,
                  {
                    headers: { Accept: "application/json" },
                    timeout: 4000,
                  }
                );
                console.log(`[Cover Route] Cover Art Archive success for ${mbid} (RG ${rg.id}, attempt ${idx + 1})`);
                return result;
              } catch (e) {
                if (e.response?.status === 404) {
                  return null;
                }
                console.log(`[Cover Route] Cover Art Archive failed for ${mbid} (RG ${rg.id}, attempt ${idx + 1}):`, e.message);
                return null;
              }
            });

            const coverArtResults = await Promise.all(coverArtPromises);
            
            for (const coverArtJson of coverArtResults) {
              if (!coverArtJson) continue;
              
              if (coverArtJson?.data?.images && coverArtJson.data.images.length > 0) {
                const frontImage = coverArtJson.data.images.find(img => img.front) || coverArtJson.data.images[0];
                if (frontImage) {
                  const imageUrl = frontImage.thumbnails?.["500"] || frontImage.thumbnails?.["large"] || frontImage.image;
                  if (imageUrl) {
                    console.log(`[Cover Route] Successfully found cover for ${mbid}`);
                    const result = {
                      images: [{
                        image: imageUrl,
                        front: true,
                        types: frontImage.types || ["Front"],
                      }]
                    };
                    if (!db.data.images) db.data.images = {};
                    db.data.images[mbid] = imageUrl;
                    db.write().catch(e => console.error("Error saving image to database:", e.message));
                    return result;
                  }
                }
              }
            }
            if (coverArtResults.some(r => r !== null)) {
              console.log(`[Cover Route] No valid images in Cover Art Archive responses for ${mbid}`);
            } else {
              console.log(`[Cover Route] No covers found in Cover Art Archive for ${mbid}`);
            }
          } else {
            console.log(`[Cover Route] No release groups found for ${mbid}`);
          }
        } catch (e) {
          console.log(`[Cover Route] Error in cover fetch for ${mbid}:`, e.message);
        }

        console.log(`[Cover Route] Returning empty images for ${mbid}`);
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
