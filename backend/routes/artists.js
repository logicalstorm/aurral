import express from "express";
import axios from "axios";
import { UUID_REGEX } from "../config/constants.js";
import {
  musicbrainzRequest,
  getLastfmApiKey,
  lastfmRequest,
  deezerGetArtistTopTracks,
  deezerSearchArtist,
} from "../services/apiClients.js";
import { imagePrefetchService } from "../services/imagePrefetchService.js";
import {
  getAuthUser,
  getAuthPassword,
  verifyTokenAuth,
} from "../middleware/auth.js";
import { dbOps } from "../config/db-helpers.js";
import { cacheMiddleware, noCache } from "../middleware/cache.js";

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
    const { query, limit = 24, offset = 0 } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Query parameter is required" });
    }

    if (getLastfmApiKey()) {
      try {
        const limitInt = parseInt(limit) || 24;
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

          // db import removed - using dbOps directly
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

              const cachedImage = dbOps.getImage(a.mbid);
              if (
                cachedImage &&
                cachedImage.imageUrl &&
                cachedImage.imageUrl !== "NOT_FOUND"
              ) {
                result.imageUrl = cachedImage.imageUrl;
                result.image = cachedImage.imageUrl;
              }

              return result;
            });

          if (formattedArtists.length > 0) {
            // Pre-fetch images for search results in background
            imagePrefetchService
              .prefetchSearchResults(formattedArtists)
              .catch(() => {});

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
        console.warn("Last.fm search failed", error.message);
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
router.get("/search", cacheMiddleware(300), handleSearch);
router.get("/artists", cacheMiddleware(300), handleSearch);

// Root route - return 404 for /api/artists without MBID
router.get("/", async (req, res) => {
  res.status(404).json({
    error: "Not found",
    message:
      "Use /api/artists/:mbid to get artist details, or /api/search/artists to search",
  });
});

router.get("/release-group/:mbid/cover", async (req, res) => {
  try {
    const { mbid } = req.params;

    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: "Invalid MBID format", images: [] });
    }

    const cacheKey = `rg:${mbid}`;
    const cachedImage = dbOps.getImage(cacheKey);

    if (
      cachedImage &&
      cachedImage.imageUrl &&
      cachedImage.imageUrl !== "NOT_FOUND"
    ) {
      const cachedUrl = cachedImage.imageUrl;
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      return res.json({
        images: [
          {
            image: cachedUrl,
            front: true,
            types: ["Front"],
          },
        ],
      });
    }

    if (cachedImage && cachedImage.imageUrl === "NOT_FOUND") {
      res.set("Cache-Control", "public, max-age=3600");
      return res.json({ images: [] });
    }

    try {
      const coverArtJson = await axios
        .get(`https://coverartarchive.org/release-group/${mbid}`, {
          headers: { Accept: "application/json" },
          timeout: 2000,
        })
        .catch(() => null);

      if (coverArtJson?.data?.images && coverArtJson.data.images.length > 0) {
        const frontImage =
          coverArtJson.data.images.find((img) => img.front) ||
          coverArtJson.data.images[0];
        if (frontImage) {
          const imageUrl =
            frontImage.thumbnails?.["500"] ||
            frontImage.thumbnails?.["large"] ||
            frontImage.image;
          if (imageUrl) {
            dbOps.setImage(cacheKey, imageUrl);

            res.set("Cache-Control", "public, max-age=31536000, immutable");
            return res.json({
              images: [
                {
                  image: imageUrl,
                  front: true,
                  types: frontImage.types || ["Front"],
                },
              ],
            });
          }
        }
      }
    } catch (e) {}

    dbOps.setImage(cacheKey, "NOT_FOUND");
    res.set("Cache-Control", "public, max-age=3600");
    res.json({ images: [] });
  } catch (error) {
    console.error(
      `Error in release-group cover route for ${req.params.mbid}:`,
      error.message,
    );
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
      inc: "releases",
    });

    if (!rgData.releases || rgData.releases.length === 0) {
      return res.json([]);
    }

    // Get first release to get tracks
    const releaseId = rgData.releases[0].id;
    const releaseData = await musicbrainzRequest(`/release/${releaseId}`, {
      inc: "recordings",
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
    if (res.flush && typeof res.flush === "function") {
      res.flush();
    }
  } catch (err) {
    console.error(`[SSE] Error sending event ${event}:`, err.message);
  }
};

// Streaming endpoint for artist details
router.get("/:mbid/stream", noCache, async (req, res) => {
  try {
    const { mbid } = req.params;
    const streamArtistName = (req.query.artistName || "").trim();

    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({
        error: "Invalid MBID format",
        message: `"${mbid}" is not a valid MusicBrainz ID. MBIDs must be UUIDs.`,
      });
    }

    // Verify authentication
    if (!verifyTokenAuth(req)) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required",
      });
    }

    // Set up SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering

    // Send initial connection message
    sendSSE(res, "connected", { mbid });

    let artistData = null;

    try {
      const { lidarrClient } = await import("../services/lidarrClient.js");
      const { libraryManager } = await import("../services/libraryManager.js");

      let lidarrArtist = null;
      let lidarrAlbums = [];

      if (lidarrClient.isConfigured()) {
        try {
          lidarrArtist = await lidarrClient.getArtistByMbid(mbid);
          if (lidarrArtist) {
            console.log(
              `[Artists Stream] Found artist in Lidarr: ${lidarrArtist.artistName}`,
            );
            const libraryArtist = await libraryManager.getArtist(mbid);
            if (libraryArtist) {
              lidarrAlbums = await libraryManager.getAlbums(libraryArtist.id);
            }

            artistData = {
              id: lidarrArtist.foreignArtistId || mbid,
              name: lidarrArtist.artistName,
              "sort-name": lidarrArtist.artistName,
              disambiguation: "",
              "type-id": null,
              type: null,
              country: null,
              "life-span": {
                begin: null,
                end: null,
                ended: false,
              },
              tags: [],
              genres: [],
              "release-groups": lidarrAlbums.map((album) => ({
                id: album.mbid,
                title: album.albumName,
                "first-release-date": album.releaseDate || null,
                "primary-type": "Album",
                "secondary-types": [],
              })),
              relations: [],
              "release-group-count": lidarrAlbums.length,
              "release-count": lidarrAlbums.length,
              _lidarrData: {
                id: lidarrArtist.id,
                monitored: lidarrArtist.monitored,
                statistics: lidarrArtist.statistics,
                images: lidarrArtist.images || [],
              },
            };

            sendSSE(res, "artist", artistData);

            if (!shouldSkipMusicBrainz()) {
              (async () => {
                try {
                  const mbData = await Promise.race([
                    musicbrainzRequest(`/artist/${mbid}`, {
                      inc: "tags+genres+release-groups",
                    }),
                    new Promise((_, reject) =>
                      setTimeout(
                        () => reject(new Error("MusicBrainz timeout")),
                        2000,
                      ),
                    ),
                  ]).catch(() => null);

                  if (mbData) {
                    recordMusicBrainzSuccess();

                    const enrichedData = { ...artistData };

                    if (mbData["release-groups"]) {
                      const lidarrAlbumMap = new Map(
                        lidarrAlbums.map((a) => [a.mbid, a]),
                      );
                      enrichedData["release-groups"] = mbData[
                        "release-groups"
                      ].map((rg) => {
                        const lidarrAlbum = lidarrAlbumMap.get(rg.id);
                        if (lidarrAlbum) {
                          return {
                            ...rg,
                            _lidarrData: {
                              id: lidarrAlbum.id,
                              monitored: lidarrAlbum.monitored,
                              statistics: lidarrAlbum.statistics,
                            },
                          };
                        }
                        return rg;
                      });
                    }

                    enrichedData.tags = mbData.tags || [];
                    enrichedData.genres = mbData.genres || [];
                    enrichedData.disambiguation = mbData.disambiguation || "";
                    enrichedData["life-span"] =
                      mbData["life-span"] || enrichedData["life-span"];

                    sendSSE(res, "artist", enrichedData);
                  }
                } catch (error) {
                  recordMusicBrainzFailure();
                }
              })();
            }
          }
        } catch (error) {
          console.warn(
            `[Artists Stream] Failed to fetch from Lidarr: ${error.message}`,
          );
        }
      }

      if (!artistData) {
        if (shouldSkipMusicBrainz()) {
          const basicData = {
            id: mbid,
            name: streamArtistName || "Unknown Artist",
            "sort-name": "Unknown Artist",
            disambiguation: "",
            "type-id": null,
            type: null,
            country: null,
            "life-span": {
              begin: null,
              end: null,
              ended: false,
            },
            tags: [],
            genres: [],
            "release-groups": [],
            relations: [],
            "release-group-count": 0,
            "release-count": 0,
          };
          sendSSE(res, "artist", basicData);
          sendSSE(res, "complete", {});
          setTimeout(() => res.end(), 100);
          return;
        }

        if (pendingArtistRequests.has(mbid)) {
          console.log(
            `[Artists Stream] Request for ${mbid} already in progress, waiting...`,
          );
          try {
            artistData = await pendingArtistRequests.get(mbid);
            sendSSE(res, "artist", artistData);
          } catch (error) {
            sendSSE(res, "error", {
              error: "Failed to fetch artist details",
              message: error.response?.data?.error || error.message,
            });
            return;
          }
        } else {
          const fetchPromise = (async () => {
            try {
              const data = await musicbrainzRequest(`/artist/${mbid}`, {
                inc: "tags+genres+release-groups",
              });
              recordMusicBrainzSuccess();

              if (lidarrArtist && data) {
                const lidarrAlbumMap = new Map(
                  lidarrAlbums.map((a) => [a.mbid, a]),
                );

                if (data["release-groups"]) {
                  data["release-groups"] = data["release-groups"].map((rg) => {
                    const lidarrAlbum = lidarrAlbumMap.get(rg.id);
                    if (lidarrAlbum) {
                      return {
                        ...rg,
                        _lidarrData: {
                          id: lidarrAlbum.id,
                          monitored: lidarrAlbum.monitored,
                          statistics: lidarrAlbum.statistics,
                        },
                      };
                    }
                    return rg;
                  });
                }

                data._lidarrData = {
                  id: lidarrArtist.id,
                  monitored: lidarrArtist.monitored,
                  statistics: lidarrArtist.statistics,
                  images: lidarrArtist.images || [],
                };
              }

              return data;
            } catch (error) {
              recordMusicBrainzFailure();
              throw error;
            } finally {
              pendingArtistRequests.delete(mbid);
            }
          })();
          pendingArtistRequests.set(mbid, fetchPromise);
          try {
            artistData = await fetchPromise;
            sendSSE(res, "artist", artistData);
          } catch (err) {
            if (streamArtistName) {
              const fallback = {
                id: mbid,
                name: streamArtistName,
                "sort-name": streamArtistName,
                disambiguation: "",
                "type-id": null,
                type: null,
                country: null,
                "life-span": { begin: null, end: null, ended: false },
                tags: [],
                genres: [],
                "release-groups": [],
                relations: [],
                "release-group-count": 0,
                "release-count": 0,
              };
              artistData = fallback;
              sendSSE(res, "artist", fallback);
            } else {
              throw err;
            }
          }
        }
      }

      // Track all background tasks
      const backgroundTasks = [];

      // Fetch cover image in background
      const coverTask = (async () => {
        try {
          const { libraryManager } =
            await import("../services/libraryManager.js");
          const libraryArtist = libraryManager.getArtist(mbid);
          let artistName =
            libraryArtist?.artistName ||
            artistData?.name ||
            streamArtistName ||
            null;

          // Try cached first
          const cachedImage = dbOps.getImage(mbid);
          if (
            cachedImage &&
            cachedImage.imageUrl &&
            cachedImage.imageUrl !== "NOT_FOUND"
          ) {
            sendSSE(res, "cover", {
              images: [
                {
                  image: cachedImage.imageUrl,
                  front: true,
                  types: ["Front"],
                },
              ],
            });
            return;
          }

          if (artistName) {
            try {
              const deezer = await deezerSearchArtist(artistName);
              if (deezer?.imageUrl) {
                dbOps.setImage(mbid, deezer.imageUrl);
                sendSSE(res, "cover", {
                  images: [
                    { image: deezer.imageUrl, front: true, types: ["Front"] },
                  ],
                });
                return;
              }
            } catch (e) {}
          }

          // Try Cover Art Archive as fallback
          if (artistData?.["release-groups"]?.length > 0) {
            const releaseGroups = artistData["release-groups"]
              .filter(
                (rg) =>
                  rg["primary-type"] === "Album" || rg["primary-type"] === "EP",
              )
              .sort((a, b) => {
                const dateA = a["first-release-date"] || "";
                const dateB = b["first-release-date"] || "";
                return dateB.localeCompare(dateA);
              })
              .slice(0, 2);

            for (const rg of releaseGroups) {
              try {
                const coverArtResponse = await axios
                  .get(`https://coverartarchive.org/release-group/${rg.id}`, {
                    headers: { Accept: "application/json" },
                    timeout: 2000,
                  })
                  .catch(() => null);

                if (coverArtResponse?.data?.images?.length > 0) {
                  const frontImage =
                    coverArtResponse.data.images.find((img) => img.front) ||
                    coverArtResponse.data.images[0];
                  if (frontImage) {
                    const imageUrl =
                      frontImage.thumbnails?.["500"] ||
                      frontImage.thumbnails?.["large"] ||
                      frontImage.image;
                    if (imageUrl) {
                      dbOps.setImage(mbid, imageUrl);

                      sendSSE(res, "cover", {
                        images: [
                          {
                            image: imageUrl,
                            front: true,
                            types: frontImage.types || ["Front"],
                          },
                        ],
                      });
                      return;
                    }
                  }
                }
              } catch (e) {}
            }
          }

          // No cover found
          dbOps.setImage(mbid, "NOT_FOUND");
          sendSSE(res, "cover", { images: [] });
        } catch (e) {
          sendSSE(res, "cover", { images: [] });
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

              sendSSE(res, "similar", { artists: formattedArtists });
            } else {
              sendSSE(res, "similar", { artists: [] });
            }
          } catch (e) {
            sendSSE(res, "similar", { artists: [] });
          }
        } else {
          sendSSE(res, "similar", { artists: [] });
        }
      })();
      backgroundTasks.push(similarTask);

      const releaseGroupCoversTask = (async () => {
        if (shouldSkipMusicBrainz()) return;
        if (artistData?.["release-groups"]?.length > 0) {
          const releaseGroups = artistData["release-groups"]
            .filter(
              (rg) =>
                rg["primary-type"] === "Album" || rg["primary-type"] === "EP",
            )
            .slice(0, 20); // Limit to first 20

          // Fetch covers in parallel batches
          const batchSize = 5;
          const allCoverPromises = [];

          for (let i = 0; i < releaseGroups.length; i += batchSize) {
            const batch = releaseGroups.slice(i, i + batchSize);

            const batchPromises = batch.map(async (rg) => {
              try {
                // db import removed - using dbOps directly
                const cacheKey = `rg:${rg.id}`;

                // Check cache first
                const cachedCover = dbOps.getImage(cacheKey);
                if (
                  cachedCover &&
                  cachedCover.imageUrl &&
                  cachedCover.imageUrl !== "NOT_FOUND"
                ) {
                  sendSSE(res, "releaseGroupCover", {
                    mbid: rg.id,
                    images: [
                      {
                        image: cachedCover.imageUrl,
                        front: true,
                        types: ["Front"],
                      },
                    ],
                  });
                  return;
                }

                if (cachedCover && cachedCover.imageUrl === "NOT_FOUND") {
                  sendSSE(res, "releaseGroupCover", {
                    mbid: rg.id,
                    images: [],
                  });
                  return;
                }

                // Fetch from Cover Art Archive
                const coverArtResponse = await axios
                  .get(`https://coverartarchive.org/release-group/${rg.id}`, {
                    headers: { Accept: "application/json" },
                    timeout: 2000,
                  })
                  .catch(() => null);

                if (coverArtResponse?.data?.images?.length > 0) {
                  const frontImage =
                    coverArtResponse.data.images.find((img) => img.front) ||
                    coverArtResponse.data.images[0];
                  if (frontImage) {
                    const imageUrl =
                      frontImage.thumbnails?.["500"] ||
                      frontImage.thumbnails?.["large"] ||
                      frontImage.image;
                    if (imageUrl) {
                      dbOps.setImage(cacheKey, imageUrl);

                      sendSSE(res, "releaseGroupCover", {
                        mbid: rg.id,
                        images: [
                          {
                            image: imageUrl,
                            front: true,
                            types: frontImage.types || ["Front"],
                          },
                        ],
                      });
                      return;
                    }
                  }
                }

                // No cover found
                dbOps.setImage(cacheKey, "NOT_FOUND");
                sendSSE(res, "releaseGroupCover", {
                  mbid: rg.id,
                  images: [],
                });
              } catch (e) {
                sendSSE(res, "releaseGroupCover", {
                  mbid: rg.id,
                  images: [],
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
      Promise.allSettled(backgroundTasks)
        .then(() => {
          // Send completion event
          sendSSE(res, "complete", {});

          // Close connection after a short delay to ensure all messages are sent
          setTimeout(() => {
            res.end();
          }, 100);
        })
        .catch(() => {
          // Even if there's an error, try to send complete and close
          sendSSE(res, "complete", {});
          setTimeout(() => {
            res.end();
          }, 100);
        });
    } catch (error) {
      console.error(
        `[Artists Stream] Error for artist ${mbid}:`,
        error.message,
      );
      // Only send error if we haven't already sent artist data
      if (!artistData) {
        sendSSE(res, "error", {
          error: "Failed to fetch artist details",
          message: error.response?.data?.error || error.message,
        });
      } else {
        // If we already sent artist data, just send complete and close
        sendSSE(res, "complete", {});
      }
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

router.get("/:mbid/preview", cacheMiddleware(60), async (req, res) => {
  try {
    const { mbid } = req.params;
    const artistNameParam = (req.query.artistName || "").trim();
    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: "Invalid MBID format", tracks: [] });
    }
    let artistName = artistNameParam || null;
    if (!artistName && !shouldSkipMusicBrainz()) {
      try {
        const mb = await musicbrainzRequest(`/artist/${mbid}`, {}).catch(
          () => null,
        );
        if (mb?.name) artistName = mb.name;
      } catch (e) {}
    }
    if (!artistName) {
      console.warn(
        `[Preview] No artist name for mbid=${mbid} (pass ?artistName= in query or ensure MusicBrainz is up)`,
      );
      return res.json({ tracks: [] });
    }
    const normalized =
      artistName.replace(/\s*\([^)]*\)\s*$/, "").trim() || artistName;
    const tracks = await deezerGetArtistTopTracks(normalized);
    res.json({ tracks });
  } catch (error) {
    res.json({ tracks: [] });
  }
});

router.get("/:mbid", cacheMiddleware(300), async (req, res) => {
  try {
    const { mbid } = req.params;

    if (!UUID_REGEX.test(mbid)) {
      console.log(`[Artists Route] Invalid MBID format: ${mbid}`);
      return res.status(400).json({
        error: "Invalid MBID format",
        message: `"${mbid}" is not a valid MusicBrainz ID. MBIDs must be UUIDs.`,
      });
    }

    // Check if request is already in progress (deduplication)
    if (pendingArtistRequests.has(mbid)) {
      console.log(
        `[Artists Route] Request for ${mbid} already in progress, waiting...`,
      );
      try {
        const data = await pendingArtistRequests.get(mbid);
        res.setHeader("Content-Type", "application/json");
        return res.json(data);
      } catch (error) {
        return res.status(error.response?.status || 500).json({
          error: "Failed to fetch artist details",
          message: error.response?.data?.error || error.message,
        });
      }
    }

    console.log(`[Artists Route] Fetching artist details for MBID: ${mbid}`);

    const { lidarrClient } = await import("../services/lidarrClient.js");
    const { libraryManager } = await import("../services/libraryManager.js");

    let data = null;

    let lidarrArtist = null;
    let lidarrAlbums = [];

    if (lidarrClient.isConfigured()) {
      try {
        lidarrArtist = await lidarrClient.getArtistByMbid(mbid);
        if (lidarrArtist) {
          console.log(
            `[Artists Route] Found artist in Lidarr: ${lidarrArtist.artistName}`,
          );
          const libraryArtist = await libraryManager.getArtist(mbid);
          if (libraryArtist) {
            lidarrAlbums = await libraryManager.getAlbums(libraryArtist.id);
          }
        }
      } catch (error) {
        console.warn(
          `[Artists Route] Failed to fetch from Lidarr: ${error.message}`,
        );
      }
    }

    if (lidarrArtist) {
      const musicbrainzData = {
        id: lidarrArtist.foreignArtistId || mbid,
        name: lidarrArtist.artistName,
        "sort-name": lidarrArtist.artistName,
        disambiguation: "",
        "type-id": null,
        type: null,
        country: null,
        "life-span": {
          begin: null,
          end: null,
          ended: false,
        },
        tags: [],
        genres: [],
        "release-groups": lidarrAlbums.map((album) => ({
          id: album.mbid,
          title: album.albumName,
          "first-release-date": album.releaseDate || null,
          "primary-type": "Album",
          "secondary-types": [],
        })),
        relations: [],
        "release-group-count": lidarrAlbums.length,
        "release-count": lidarrAlbums.length,
        _lidarrData: {
          id: lidarrArtist.id,
          monitored: lidarrArtist.monitored,
          statistics: lidarrArtist.statistics,
          images: lidarrArtist.images || [],
        },
      };

      res.setHeader("Content-Type", "application/json");
      res.json(musicbrainzData);

      if (!shouldSkipMusicBrainz()) {
        (async () => {
          try {
            const mbData = await Promise.race([
              musicbrainzRequest(`/artist/${mbid}`, {
                inc: "tags+genres+release-groups",
              }),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error("MusicBrainz timeout")),
                  3000,
                ),
              ),
            ]).catch(() => null);

            if (mbData) {
              recordMusicBrainzSuccess();
            }
          } catch (error) {
            recordMusicBrainzFailure();
          }
        })();
      }

      return;
    }

    if (shouldSkipMusicBrainz()) {
      console.log(
        `[Artists Route] MusicBrainz circuit breaker is open, but artist not in Lidarr. Returning basic artist data.`,
      );

      const basicData = {
        id: mbid,
        name: "Unknown Artist",
        "sort-name": "Unknown Artist",
        disambiguation: "",
        "type-id": null,
        type: null,
        country: null,
        "life-span": {
          begin: null,
          end: null,
          ended: false,
        },
        tags: [],
        genres: [],
        "release-groups": [],
        relations: [],
        "release-group-count": 0,
        "release-count": 0,
      };

      res.setHeader("Content-Type", "application/json");
      return res.json(basicData);
    }

    const fetchPromise = (async () => {
      try {
        console.log(`[Artists Route] Calling MusicBrainz for ${mbid}`);
        const musicbrainzData = await musicbrainzRequest(`/artist/${mbid}`, {
          inc: "tags+genres+release-groups",
        });

        console.log(`[Artists Route] Successfully fetched artist ${mbid}`);
        recordMusicBrainzSuccess();

        if (lidarrArtist && musicbrainzData) {
          const lidarrAlbumMap = new Map(lidarrAlbums.map((a) => [a.mbid, a]));

          if (musicbrainzData["release-groups"]) {
            musicbrainzData["release-groups"] = musicbrainzData[
              "release-groups"
            ].map((rg) => {
              const lidarrAlbum = lidarrAlbumMap.get(rg.id);
              if (lidarrAlbum) {
                return {
                  ...rg,
                  _lidarrData: {
                    id: lidarrAlbum.id,
                    monitored: lidarrAlbum.monitored,
                    statistics: lidarrAlbum.statistics,
                  },
                };
              }
              return rg;
            });
          }

          musicbrainzData._lidarrData = {
            id: lidarrArtist.id,
            monitored: lidarrArtist.monitored,
            statistics: lidarrArtist.statistics,
            images: lidarrArtist.images || [],
          };
        }

        return musicbrainzData;
      } catch (error) {
        recordMusicBrainzFailure();
        console.error(
          `[Artists Route] MusicBrainz error for artist ${mbid}:`,
          error.message,
        );
        throw error;
      } finally {
        pendingArtistRequests.delete(mbid);
      }
    })();

    pendingArtistRequests.set(mbid, fetchPromise);

    try {
      data = await fetchPromise;
      res.setHeader("Content-Type", "application/json");
      res.json(data);
    } catch (error) {
      const artistNameParam = (req.query.artistName || "").trim();
      const fallback = {
        id: mbid,
        name: artistNameParam || "Unknown Artist",
        "sort-name": artistNameParam || "Unknown Artist",
        disambiguation: "",
        "type-id": null,
        type: null,
        country: null,
        "life-span": { begin: null, end: null, ended: false },
        tags: [],
        genres: [],
        "release-groups": [],
        relations: [],
        "release-group-count": 0,
        "release-count": 0,
      };
      res.setHeader("Content-Type", "application/json");
      res.json(fallback);
    }
  } catch (error) {
    console.error(
      `[Artists Route] Unexpected error in artist details route:`,
      error.message,
    );
    console.error(`[Artists Route] Error stack:`, error.stack);
    res.status(500).json({
      error: "Failed to fetch artist details",
      message: error.message,
    });
  }
});

const pendingCoverRequests = new Map();
const pendingArtistRequests = new Map();

// Simple circuit breaker for MusicBrainz - skip if too many recent failures
let musicbrainzFailureCount = 0;
let musicbrainzLastFailure = 0;
const MUSICBRAINZ_CIRCUIT_BREAKER_THRESHOLD = 2;
const MUSICBRAINZ_CIRCUIT_BREAKER_RESET_MS = 120000;

const shouldSkipMusicBrainz = () => {
  const timeSinceLastFailure = Date.now() - musicbrainzLastFailure;
  if (
    musicbrainzFailureCount >= MUSICBRAINZ_CIRCUIT_BREAKER_THRESHOLD &&
    timeSinceLastFailure < MUSICBRAINZ_CIRCUIT_BREAKER_RESET_MS
  ) {
    return true;
  }
  // Reset counter if enough time has passed
  if (timeSinceLastFailure >= MUSICBRAINZ_CIRCUIT_BREAKER_RESET_MS) {
    musicbrainzFailureCount = 0;
  }
  return false;
};

const recordMusicBrainzFailure = () => {
  musicbrainzFailureCount++;
  musicbrainzLastFailure = Date.now();
};

const recordMusicBrainzSuccess = () => {
  // Reset on success
  if (musicbrainzFailureCount > 0) {
    musicbrainzFailureCount = Math.max(0, musicbrainzFailureCount - 1);
  }
};

// Background fetch function (doesn't block)
const fetchCoverInBackground = async (mbid) => {
  if (pendingCoverRequests.has(mbid)) return;

  const fetchPromise = (async () => {
    try {
      const { libraryManager } = await import("../services/libraryManager.js");
      const libraryArtist = libraryManager.getArtist(mbid);
      let artistName = libraryArtist?.artistName || null;
      let mbResult = null;

      if (!artistName && !shouldSkipMusicBrainz()) {
        try {
          mbResult = await Promise.race([
            musicbrainzRequest(`/artist/${mbid}`, { inc: "release-groups" }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("MusicBrainz timeout")), 2800),
            ),
          ]).catch((e) => {
            recordMusicBrainzFailure();
            return null;
          });

          if (mbResult?.name) {
            artistName = mbResult.name;
            recordMusicBrainzSuccess();
          } else if (mbResult === null) {
            recordMusicBrainzFailure();
          }
        } catch (e) {
          recordMusicBrainzFailure();
        }
      }

      if (artistName) {
        try {
          const deezer = await deezerSearchArtist(artistName);
          if (deezer?.imageUrl) {
            dbOps.setImage(mbid, deezer.imageUrl);
            return;
          }
        } catch (e) {}
      }

      if (mbResult?.["release-groups"]?.length > 0) {
        const releaseGroups = mbResult["release-groups"]
          .filter(
            (rg) =>
              rg["primary-type"] === "Album" || rg["primary-type"] === "EP",
          )
          .sort((a, b) => {
            const dateA = a["first-release-date"] || "";
            const dateB = b["first-release-date"] || "";
            return dateB.localeCompare(dateA);
          })
          .slice(0, 2);
        for (const rg of releaseGroups) {
          try {
            const coverRes = await axios
              .get(`https://coverartarchive.org/release-group/${rg.id}`, {
                headers: { Accept: "application/json" },
                timeout: 2000,
              })
              .catch(() => null);
            if (coverRes?.data?.images?.length > 0) {
              const front =
                coverRes.data.images.find((img) => img.front) ||
                coverRes.data.images[0];
              const imageUrl =
                front.thumbnails?.["500"] ||
                front.thumbnails?.["large"] ||
                front.image;
              if (imageUrl) {
                dbOps.setImage(mbid, imageUrl);
                return;
              }
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
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
  const { refresh = false, artistName: queryArtistName } = req.query;
  const artistNameFromQuery =
    typeof queryArtistName === "string" && queryArtistName.trim()
      ? queryArtistName.trim()
      : null;

  try {
    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: "Invalid MBID format", images: [] });
    }

    if (pendingCoverRequests.has(mbid)) {
      console.log(`[Cover Route] Deduplicating request for ${mbid}`);
      const result = await pendingCoverRequests.get(mbid);
      return res.json({ images: result.images || [] });
    }

    // db import removed - using dbOps directly

    // Optimistic response: return cached data immediately if available
    const cachedImage = dbOps.getImage(mbid);
    if (
      !refresh &&
      cachedImage &&
      cachedImage.imageUrl &&
      cachedImage.imageUrl !== "NOT_FOUND"
    ) {
      console.log(`[Cover Route] Cache hit for ${mbid}`);
      const cachedUrl = cachedImage.imageUrl;
      res.set("Cache-Control", "public, max-age=31536000, immutable");

      // Trigger background refresh if cache is old (older than 7 days)
      const cacheAge = cachedImage.cacheAge;
      const shouldRefresh =
        !cacheAge || Date.now() - cacheAge > 7 * 24 * 60 * 60 * 1000;

      if (shouldRefresh) {
        // Don't await - let it run in background
        fetchCoverInBackground(mbid).catch(() => {});
      }

      return res.json({
        images: [
          {
            image: cachedUrl,
            front: true,
            types: ["Front"],
          },
        ],
      });
    }

    if (!refresh && cachedImage && cachedImage.imageUrl === "NOT_FOUND") {
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
        // db import removed - using dbOps directly
        const { libraryManager } =
          await import("../services/libraryManager.js");
        const libraryArtist = libraryManager.getArtist(mbid);

        let artistName =
          libraryArtist?.artistName || artistNameFromQuery || null;

        let mbResult = null;
        if (!artistName && !shouldSkipMusicBrainz()) {
          try {
            mbResult = await Promise.race([
              musicbrainzRequest(`/artist/${mbid}`, { inc: "release-groups" }),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error("MusicBrainz timeout")),
                  2800,
                ),
              ),
            ]).catch((e) => {
              recordMusicBrainzFailure();
              return null;
            });

            if (mbResult?.name) {
              artistName = mbResult.name;
              recordMusicBrainzSuccess();
            } else if (mbResult === null) {
              recordMusicBrainzFailure();
            }
          } catch (e) {
            recordMusicBrainzFailure();
          }
        }

        if (artistName) {
          try {
            console.log(`[Cover Route] Trying Deezer for cover: ${artistName}`);
            const deezer = await deezerSearchArtist(artistName);
            if (deezer?.imageUrl) {
              console.log(`[Cover Route] Deezer cover found for ${mbid}`);
              dbOps.setImage(mbid, deezer.imageUrl);
              return {
                images: [
                  { image: deezer.imageUrl, front: true, types: ["Front"] },
                ],
              };
            }
            console.log(
              `[Cover Route] Deezer returned no image for: ${artistName}`,
            );
          } catch (e) {
            console.log(
              `[Cover Route] Deezer error for ${artistName}:`,
              e.message,
            );
          }
        }

        if (!artistName || !mbResult?.["release-groups"]) {
          return { images: [] };
        }

        try {
          const artistDataForRG = mbResult;
          if (artistDataForRG?.["release-groups"]?.length > 0) {
            const releaseGroups = artistDataForRG["release-groups"]
              .filter(
                (rg) =>
                  rg["primary-type"] === "Album" || rg["primary-type"] === "EP",
              )
              .sort((a, b) => {
                const dateA = a["first-release-date"] || "";
                const dateB = b["first-release-date"] || "";
                return dateB.localeCompare(dateA);
              })
              .slice(0, 2);
            const coverArtResults = await Promise.allSettled(
              releaseGroups.map((rg) =>
                axios
                  .get(`https://coverartarchive.org/release-group/${rg.id}`, {
                    headers: { Accept: "application/json" },
                    timeout: 2000,
                  })
                  .catch(() => null),
              ),
            );
            for (const result of coverArtResults) {
              if (
                result.status === "fulfilled" &&
                result.value?.data?.images?.length > 0
              ) {
                const frontImage =
                  result.value.data.images.find((img) => img.front) ||
                  result.value.data.images[0];
                if (frontImage) {
                  const imageUrl =
                    frontImage.thumbnails?.["500"] ||
                    frontImage.thumbnails?.["large"] ||
                    frontImage.image;
                  if (imageUrl) {
                    dbOps.setImage(mbid, imageUrl);
                    return {
                      images: [
                        {
                          image: imageUrl,
                          front: true,
                          types: frontImage.types || ["Front"],
                        },
                      ],
                    };
                  }
                }
              }
            }
          }
        } catch (e) {}

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
      console.log(
        `[Cover Route] No cover found for ${mbid}, caching NOT_FOUND`,
      );
      dbOps.setImage(mbid, "NOT_FOUND");
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
