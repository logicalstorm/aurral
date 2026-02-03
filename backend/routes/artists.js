import express from "express";
import axios from "axios";
import { UUID_REGEX } from "../config/constants.js";
import {
  musicbrainzRequest,
  getLastfmApiKey,
  lastfmRequest,
  lastfmGetArtistNameByMbid,
  deezerGetArtistTopTracks,
  deezerSearchArtist,
  deezerGetArtistAlbums,
  deezerGetAlbumTracks,
  musicbrainzGetArtistReleaseGroups,
  enrichReleaseGroupsWithDeezer,
  getArtistBio,
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

          const filteredArtists = artists.filter((a) => a.mbid);
          const mbids = filteredArtists.map((a) => a.mbid);
          const cachedImages = dbOps.getImages(mbids);

          const formattedArtists = filteredArtists.map((a) => {
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

            const cachedImage = cachedImages[a.mbid];
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
            imagePrefetchService
              .prefetchSearchResults(formattedArtists)
              .catch(() => {});

            return res.json({
              artists: formattedArtists,
              count: parseInt(
                lastfmData.results["opensearch:totalResults"] || 0
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

router.get("/search", cacheMiddleware(300), handleSearch);
router.get("/artists", cacheMiddleware(300), handleSearch);

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
      error.message
    );
    res.set("Cache-Control", "public, max-age=60");
    res.json({ images: [] });
  }
});

router.get("/release-group/:mbid/tracks", async (req, res) => {
  try {
    const { mbid } = req.params;
    const deezerAlbumId = req.query.deezerAlbumId
      ? String(req.query.deezerAlbumId).trim()
      : null;
    if (deezerAlbumId) {
      const tracks = await deezerGetAlbumTracks(
        deezerAlbumId.startsWith("dz-") ? deezerAlbumId : `dz-${deezerAlbumId}`
      );
      return res.json(tracks);
    }
    if (String(mbid).startsWith("dz-")) {
      const tracks = await deezerGetAlbumTracks(mbid);
      return res.json(tracks);
    }
    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: "Invalid MBID format" });
    }

    const rgData = await musicbrainzRequest(`/release-group/${mbid}`, {
      inc: "releases",
    });

    if (!rgData.releases || rgData.releases.length === 0) {
      return res.json([]);
    }

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

const sendSSE = (res, event, data) => {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (res.flush && typeof res.flush === "function") {
      res.flush();
    }
  } catch (err) {
    console.error(`[SSE] Error sending event ${event}:`, err.message);
  }
};

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

    if (!verifyTokenAuth(req)) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required",
      });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    let clientDisconnected = false;
    req.on("close", () => {
      clientDisconnected = true;
    });

    const isClientConnected = () =>
      !clientDisconnected && !req.socket.destroyed;

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
              `[Artists Stream] Found artist in Lidarr: ${lidarrArtist.artistName}`
            );
            const libraryArtist = await libraryManager.getArtist(mbid);
            if (libraryArtist) {
              lidarrAlbums = await libraryManager.getAlbums(libraryArtist.id);
            }

            const artistMbid = lidarrArtist.foreignArtistId || mbid;
            const [bio, tagsData] = await Promise.all([
              getArtistBio(lidarrArtist.artistName, artistMbid),
              getLastfmApiKey()
                ? lastfmRequest("artist.getTopTags", { mbid: artistMbid })
                : null,
            ]);
            const tags = tagsData?.toptags?.tag
              ? (Array.isArray(tagsData.toptags.tag)
                  ? tagsData.toptags.tag
                  : [tagsData.toptags.tag]
                ).map((t) => ({ name: t.name, count: t.count || 0 }))
              : [];
            artistData = {
              id: artistMbid,
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
              tags,
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
              },
              ...(bio ? { bio } : {}),
            };

            sendSSE(res, "artist", artistData);

            const libArtist = libraryManager.mapLidarrArtist(lidarrArtist);
            sendSSE(res, "library", {
              exists: true,
              artist: {
                ...libArtist,
                foreignArtistId: libArtist.foreignArtistId || libArtist.mbid,
                added: libArtist.addedAt,
              },
              albums: lidarrAlbums.map((a) => ({
                ...a,
                foreignAlbumId: a.foreignAlbumId || a.mbid,
                title: a.albumName,
                albumType: "Album",
                statistics: a.statistics || {
                  trackCount: 0,
                  sizeOnDisk: 0,
                  percentOfTracks: 0,
                },
              })),
            });
          }
        } catch (error) {
          console.warn(
            `[Artists Stream] Failed to fetch from Lidarr: ${error.message}`
          );
        }
      }

      if (!artistData) {
        if (pendingArtistRequests.has(mbid)) {
          if (streamArtistName) {
            sendSSE(res, "artist", {
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
            });
          }
          console.log(
            `[Artists Stream] Request for ${mbid} already in progress, waiting...`
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
            const name =
              streamArtistName ||
              (getLastfmApiKey()
                ? await lastfmGetArtistNameByMbid(mbid)
                : null) ||
              "Unknown Artist";
            const tagsData = getLastfmApiKey()
              ? await lastfmRequest("artist.getTopTags", { mbid })
              : null;
            const tags = tagsData?.toptags?.tag
              ? (Array.isArray(tagsData.toptags.tag)
                  ? tagsData.toptags.tag
                  : [tagsData.toptags.tag]
                ).map((t) => ({ name: t.name, count: t.count || 0 }))
              : [];
            const releaseGroups = await musicbrainzGetArtistReleaseGroups(mbid);
            await enrichReleaseGroupsWithDeezer(releaseGroups, name);
            const bio = await getArtistBio(name, mbid);
            return {
              id: mbid,
              name,
              "sort-name": name,
              disambiguation: "",
              "type-id": null,
              type: null,
              country: null,
              "life-span": { begin: null, end: null, ended: false },
              tags,
              genres: [],
              "release-groups": releaseGroups,
              relations: [],
              "release-group-count": releaseGroups.length,
              "release-count": releaseGroups.length,
              bio: bio || undefined,
            };
          })();
          pendingArtistRequests.set(mbid, fetchPromise);
          if (streamArtistName) {
            sendSSE(res, "artist", {
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
            });
          }
          try {
            artistData = await fetchPromise;
            sendSSE(res, "artist", artistData);
          } catch (err) {
            const fallback = {
              id: mbid,
              name: streamArtistName || "Unknown Artist",
              "sort-name": streamArtistName || "Unknown Artist",
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
          } finally {
            pendingArtistRequests.delete(mbid);
          }
        }
      }

      const criticalTasks = [];
      const nonCriticalTasks = [];

      const coverTask = (async () => {
        if (!isClientConnected()) return;
        try {
          const artistName = artistData?.name || streamArtistName || null;

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

          dbOps.setImage(mbid, "NOT_FOUND");
          sendSSE(res, "cover", { images: [] });
        } catch (e) {
          sendSSE(res, "cover", { images: [] });
        }
      })();
      criticalTasks.push(coverTask);

      const similarTask = (async () => {
        if (!isClientConnected()) return;
        if (getLastfmApiKey()) {
          try {
            const similarData = await lastfmRequest("artist.getSimilar", {
              mbid,
              limit: 10,
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
      criticalTasks.push(similarTask);

      const releaseGroupCoversTask = (async () => {
        if (!isClientConnected()) return;
        if (artistData?.["release-groups"]?.length === 0) return;
        const releaseGroups = (artistData["release-groups"] || [])
          .filter(
            (rg) =>
              rg["primary-type"] === "Album" ||
              rg["primary-type"] === "EP" ||
              rg["primary-type"] === "Single"
          )
          .slice(0, 20);

        const cacheKeys = releaseGroups.map((rg) => `rg:${rg.id}`);
        const cachedCovers = dbOps.getImages(cacheKeys);

        for (const rg of releaseGroups) {
          if (!isClientConnected()) return;
          const cacheKey = `rg:${rg.id}`;
          const cachedCover = cachedCovers[cacheKey];
          if (rg._coverUrl) {
            dbOps.setImage(cacheKey, rg._coverUrl);
            sendSSE(res, "releaseGroupCover", {
              mbid: rg.id,
              images: [{ image: rg._coverUrl, front: true, types: ["Front"] }],
            });
            continue;
          }
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
            continue;
          }
          if (cachedCover && cachedCover.imageUrl === "NOT_FOUND") {
            sendSSE(res, "releaseGroupCover", { mbid: rg.id, images: [] });
            continue;
          }
          if (String(rg.id).startsWith("dz-")) continue;
        }

        const uncachedGroups = releaseGroups.filter((rg) => {
          if (rg._coverUrl || String(rg.id).startsWith("dz-")) return false;
          const cachedCover = cachedCovers[`rg:${rg.id}`];
          return !cachedCover;
        });

        const BATCH_SIZE = 4;
        for (let i = 0; i < uncachedGroups.length; i += BATCH_SIZE) {
          if (!isClientConnected()) return;
          const batch = uncachedGroups.slice(i, i + BATCH_SIZE);
          await Promise.allSettled(
            batch.map(async (rg) => {
              if (!isClientConnected()) return;
              const cacheKey = `rg:${rg.id}`;
              try {
                const coverArtResponse = await axios
                  .get(`https://coverartarchive.org/release-group/${rg.id}`, {
                    headers: { Accept: "application/json" },
                    timeout: 3000,
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
                dbOps.setImage(cacheKey, "NOT_FOUND");
                sendSSE(res, "releaseGroupCover", { mbid: rg.id, images: [] });
              } catch (e) {
                sendSSE(res, "releaseGroupCover", { mbid: rg.id, images: [] });
              }
            })
          );
        }
      })();
      nonCriticalTasks.push(releaseGroupCoversTask);

      Promise.allSettled(criticalTasks)
        .then(() => {
          sendSSE(res, "complete", {});
        })
        .catch(() => {
          sendSSE(res, "complete", {});
        });

      Promise.allSettled([...criticalTasks, ...nonCriticalTasks])
        .then(() => {
          setTimeout(() => {
            res.end();
          }, 100);
        })
        .catch(() => {
          setTimeout(() => {
            res.end();
          }, 100);
        });
    } catch (error) {
      console.error(
        `[Artists Stream] Error for artist ${mbid}:`,
        error.message
      );
      if (!artistData) {
        sendSSE(res, "error", {
          error: "Failed to fetch artist details",
          message: error.response?.data?.error || error.message,
        });
      } else {
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
    let artistName =
      artistNameParam ||
      (getLastfmApiKey() ? await lastfmGetArtistNameByMbid(mbid) : null) ||
      null;
    if (!artistName) {
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

    if (pendingArtistRequests.has(mbid)) {
      console.log(
        `[Artists Route] Request for ${mbid} already in progress, waiting...`
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
            `[Artists Route] Found artist in Lidarr: ${lidarrArtist.artistName}`
          );
          const libraryArtist = await libraryManager.getArtist(mbid);
          if (libraryArtist) {
            lidarrAlbums = await libraryManager.getAlbums(libraryArtist.id);
          }
        }
      } catch (error) {
        console.warn(
          `[Artists Route] Failed to fetch from Lidarr: ${error.message}`
        );
      }
    }

    if (lidarrArtist) {
      const artistMbid = lidarrArtist.foreignArtistId || mbid;
      const [bio, tagsData] = await Promise.all([
        getArtistBio(lidarrArtist.artistName, artistMbid),
        getLastfmApiKey()
          ? lastfmRequest("artist.getTopTags", { mbid: artistMbid })
          : null,
      ]);
      const tags = tagsData?.toptags?.tag
        ? (Array.isArray(tagsData.toptags.tag)
            ? tagsData.toptags.tag
            : [tagsData.toptags.tag]
          ).map((t) => ({ name: t.name, count: t.count || 0 }))
        : [];
      const payload = {
        id: artistMbid,
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
        tags,
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
        },
        ...(bio ? { bio } : {}),
      };

      res.setHeader("Content-Type", "application/json");
      res.json(payload);
      return;
    }

    const fetchPromise = (async () => {
      const name =
        (req.query.artistName || "").trim() ||
        (getLastfmApiKey() ? await lastfmGetArtistNameByMbid(mbid) : null) ||
        "Unknown Artist";
      const tagsData = getLastfmApiKey()
        ? await lastfmRequest("artist.getTopTags", { mbid })
        : null;
      const tags = tagsData?.toptags?.tag
        ? (Array.isArray(tagsData.toptags.tag)
            ? tagsData.toptags.tag
            : [tagsData.toptags.tag]
          ).map((t) => ({ name: t.name, count: t.count || 0 }))
        : [];
      const releaseGroups = await musicbrainzGetArtistReleaseGroups(mbid);
      await enrichReleaseGroupsWithDeezer(releaseGroups, name);
      const bio = await getArtistBio(name, mbid);
      return {
        id: mbid,
        name,
        "sort-name": name,
        disambiguation: "",
        "type-id": null,
        type: null,
        country: null,
        "life-span": { begin: null, end: null, ended: false },
        tags,
        genres: [],
        "release-groups": releaseGroups,
        relations: [],
        "release-group-count": releaseGroups.length,
        "release-count": releaseGroups.length,
        bio: bio || undefined,
      };
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
    } finally {
      pendingArtistRequests.delete(mbid);
    }
  } catch (error) {
    console.error(
      `[Artists Route] Unexpected error in artist details route:`,
      error.message
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

const fetchCoverInBackground = async (mbid) => {
  if (pendingCoverRequests.has(mbid)) return;

  const fetchPromise = (async () => {
    try {
      const { libraryManager } = await import("../services/libraryManager.js");
      const libraryArtist = libraryManager.getArtist(mbid);
      let artistName =
        libraryArtist?.artistName ||
        (getLastfmApiKey() ? await lastfmGetArtistNameByMbid(mbid) : null);

      if (artistName) {
        try {
          const deezer = await deezerSearchArtist(artistName);
          if (deezer?.imageUrl) {
            dbOps.setImage(mbid, deezer.imageUrl);
          }
        } catch (e) {}
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

      const cacheAge = cachedImage.cacheAge;
      const shouldRefresh =
        !cacheAge || Date.now() - cacheAge > 7 * 24 * 60 * 60 * 1000;

      if (shouldRefresh) {
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

      setTimeout(() => {
        fetchCoverInBackground(mbid).catch(() => {});
      }, 60000);

      return res.json({ images: [] });
    }

    console.log(`[Cover Route] Fetching cover for ${mbid}`);

    const fetchPromise = (async () => {
      try {
        const { libraryManager } = await import(
          "../services/libraryManager.js"
        );
        const libraryArtist = libraryManager.getArtist(mbid);

        let artistName =
          libraryArtist?.artistName ||
          artistNameFromQuery ||
          (getLastfmApiKey() ? await lastfmGetArtistNameByMbid(mbid) : null);

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
              `[Cover Route] Deezer returned no image for: ${artistName}`
            );
          } catch (e) {
            console.log(
              `[Cover Route] Deezer error for ${artistName}:`,
              e.message
            );
          }
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
      console.log(
        `[Cover Route] No cover found for ${mbid}, caching NOT_FOUND`
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

    const { limit = 10 } = req.query;

    if (!getLastfmApiKey()) {
      return res.json({ artists: [] });
    }

    const limitInt = Math.min(Math.max(parseInt(limit, 10) || 7, 1), 20);
    const data = await lastfmRequest("artist.getSimilar", {
      mbid,
      limit: limitInt,
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
