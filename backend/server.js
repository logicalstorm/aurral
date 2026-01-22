import express from "express";
import basicAuth from "express-basic-auth";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import axios from "axios";
import Bottleneck from "bottleneck";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import fs from "fs";
import path from "path";

import { PlaylistManager } from "./services/playlistManager.js";
import { applyOptimalLidarrSettings } from "./services/lidarrOptimizer.js";

dotenv.config();

const GENRE_KEYWORDS = [
  "rock",
  "pop",
  "electronic",
  "metal",
  "jazz",
  "hip-hop",
  "indie",
  "alternative",
  "punk",
  "soul",
  "r&b",
  "folk",
  "classical",
  "blues",
  "country",
  "reggae",
  "disco",
  "funk",
];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const defaultData = {
  discovery: {
    recommendations: [],
    globalTop: [],
    basedOn: [],
    topTags: [],
    topGenres: [],
    lastUpdated: null,
  },
  images: {},
  requests: [],
  settings: {
    rootFolderPath: null,
    qualityProfileId: null,
    metadataProfileId: null,
    monitored: true,
    searchForMissingAlbums: false,
    albumFolders: true,
    metadataProfileReleaseTypes: ["Album", "EP", "Single", "Broadcast", "Soundtrack", "Spokenword", "Remix", "Live", "Compilation", "Demo"],
  },
};

const DATA_DIR = "data";
const DB_PATH = path.join(DATA_DIR, "db.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const adapter = new JSONFile(DB_PATH);
const db = new Low(adapter, defaultData);
await db.read();

// Ensure settings structure for new integrations
if (!db.data.settings.integrations) {
  db.data.settings.integrations = {
    navidrome: { url: "", username: "", password: "" },
    lastfm: { username: "" },
    lidarr: { url: "", apiKey: "" },
    musicbrainz: { email: "" },
    general: { authUser: "", authPassword: "" }
  };
  await db.write();
}

// Ensure musicbrainz structure exists if integrations already exists
if (db.data.settings.integrations && !db.data.settings.integrations.musicbrainz) {
    db.data.settings.integrations.musicbrainz = { email: "" };
    await db.write();
}

const app = express();
const PORT = process.env.PORT || 3001;

const negativeImageCache = new Set();
const pendingImageRequests = new Map();
let cachedLidarrArtists = null;
let lastLidarrFetch = 0;
const LIDARR_CACHE_TTL = 5 * 60 * 1000;

const getCachedLidarrArtists = async (forceRefresh = false) => {
  const now = Date.now();
  if (
    forceRefresh ||
    !cachedLidarrArtists ||
    now - lastLidarrFetch > LIDARR_CACHE_TTL
  ) {
    cachedLidarrArtists = (await lidarrRequest("/artist")) || [];
    lastLidarrFetch = now;
  }
  return cachedLidarrArtists;
};

app.use(cors());
app.use(helmet());
app.use(express.json());

// Auth Middleware using DB settings OR env vars
const getAuthUser = () => {
    return db.data.settings.integrations?.general?.authUser || process.env.AUTH_USER || "admin";
};

const getAuthPassword = () => {
    const dbPass = db.data.settings.integrations?.general?.authPassword;
    if (dbPass) return [dbPass];
    return process.env.AUTH_PASSWORD ? process.env.AUTH_PASSWORD.split(",").map(p => p.trim()) : [];
};

if (getAuthPassword().length > 0) {
  const auth = basicAuth({
    authorizer: (username, password) => {
      const userMatches = basicAuth.safeCompare(username, getAuthUser());
      const passwordMatches = getAuthPassword().some((p) =>
        basicAuth.safeCompare(password, p),
      );
      return userMatches && passwordMatches;
    },
    challenge: false,
  });

  app.use((req, res, next) => {
    if (req.path === "/api/health") return next();
    // Allow settings update without auth if no password set initially? 
    // No, security risk.
    return auth(req, res, next);
  });
}

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
});
app.use("/api/", limiter);

app.get("/api/settings", (req, res) => {
  res.json(db.data.settings || defaultData.settings);
});

app.post("/api/settings", async (req, res) => {
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

let lidarrBasepathDetected = false;

// Helper to get effective Lidarr config (DB > Env)
const getLidarrConfig = () => {
    const dbConfig = db.data.settings.integrations?.lidarr || {};
    return {
        url: (dbConfig.url || process.env.LIDARR_URL || "http://localhost:8686").replace(/\/+$/, ''),
        apiKey: dbConfig.apiKey || process.env.LIDARR_API_KEY || ""
    };
};

// Probe Lidarr URL and auto-detect basepath if needed
const probeLidarrUrl = async () => {
  const { url, apiKey } = getLidarrConfig();
  if (!apiKey) return;

  // If DB override is set, trust it, but check connectivity
  // We use local vars here, not the global 'lidarrUrl' which might be stale
  let currentUrl = url;

  const basePaths = ['', '/lidarr'];
  
  for (const basePath of basePaths) {
    const testUrl = basePath ? `${currentUrl}${basePath}` : currentUrl;
    try {
      const response = await axios.get(`${testUrl}/api/v1/system/status`, {
        headers: { 'X-Api-Key': apiKey },
        timeout: 5000,
      });

      if (response.data?.appName === 'Lidarr') {
        if (basePath) {
          console.log(`Lidarr basepath auto-detected: ${basePath}`);
          lidarrBasepathDetected = true;
          // Update global tracking if needed, though we should prefer the getter
        }
        return true;
      }
    } catch (error) {
      // Continue
    }
  }

  console.warn('WARNING: Could not connect to Lidarr at configured URL or with /lidarr basepath');
  return false;
};

const MUSICBRAINZ_API = "https://musicbrainz.org/ws/2";
const LASTFM_API = "https://ws.audioscrobbler.com/2.0/";

const getLastfmApiKey = () => {
  return db.data.settings.integrations?.lastfm?.apiKey || process.env.LASTFM_API_KEY;
};

const APP_NAME = "Aurral";
const APP_VERSION = "1.0.0";

const getMusicBrainzContact = () => {
    return db.data.settings.integrations?.musicbrainz?.email || process.env.CONTACT_EMAIL || "user@example.com";
};

const mbLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1100,
});

const lastfmLimiter = new Bottleneck({
  maxConcurrent: 30,
  minTime: 33,
});

const musicbrainzRequest = mbLimiter.wrap(async (endpoint, params = {}) => {
  const queryParams = new URLSearchParams({
    fmt: "json",
    ...params,
  });

  try {
    const response = await axios.get(
      `${MUSICBRAINZ_API}${endpoint}?${queryParams}`,
      {
        headers: {
          "User-Agent": `${APP_NAME}/${APP_VERSION} ( ${getMusicBrainzContact()} )`,
        },
        timeout: 20000,
      },
    );
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 503) {
      console.warn(
        "MusicBrainz 503 Service Unavailable (Rate Limit), retrying...",
      );
      throw error;
    }
    console.error("MusicBrainz API error:", error.message);
    throw error;
  }
});

const lastfmRequest = lastfmLimiter.wrap(async (method, params = {}) => {
  const apiKey = getLastfmApiKey();
  if (!apiKey) return null;

  console.log(`Last.fm Request: ${method}`);
  try {
    const response = await axios.get(LASTFM_API, {
      params: {
        method,
        api_key: apiKey,
        format: "json",
        ...params,
      },
      timeout: 5000,
    });
    return response.data;
  } catch (error) {
    console.error(`Last.fm API error (${method}):`, error.message);
    return null;
  }
});

const lidarrRequest = async (endpoint, method = "GET", data = null, silent = false) => {
  const { url, apiKey } = getLidarrConfig();
  
  if (!apiKey) {
    throw new Error("Lidarr API key not configured");
  }

  // Handle basepath detection logic inside the request or assume URL is correct from probe
  // For simplicity, we assume the user/probe sets the correct URL in DB/Env.
  // If basepath detected earlier, we might need to append it? 
  // Let's rely on the URL stored.
  
  let finalUrl = url;
  // Small hack: if we detected basepath but it's not in the URL string
  if (lidarrBasepathDetected && !finalUrl.endsWith('/lidarr')) {
      finalUrl += '/lidarr';
  }

  try {
    const config = {
      method,
      url: `${finalUrl}/api/v1${endpoint}`,
      headers: {
        "X-Api-Key": apiKey,
      },
    };

    if (data) {
      config.data = data;
    }

    const response = await axios(config);

    if (typeof response.data === 'string' && response.data.includes('<!doctype html>')) {
      const error = new Error(
        'Lidarr returned HTML instead of JSON. ' +
        'If Lidarr is behind a basepath, add it to LIDARR_URL (e.g., http://host:8686/lidarr)'
      );
      error.isBasepathError = true;
      throw error;
    }

    return response.data;
  } catch (error) {
    if (!silent) {
      console.error("Lidarr API error:", error.response?.data || error.message);
    }
    throw error;
  }
};

const playlistManager = new PlaylistManager(db, lidarrRequest, musicbrainzRequest, lastfmRequest);

app.get("/api/health", async (req, res) => {
  let lidarrStatus = "unknown";
  const { url, apiKey } = getLidarrConfig();
  const authUser = getAuthUser();
  const authPassword = getAuthPassword();

  try {
    if (apiKey) {
      await lidarrRequest("/system/status", "GET", null, true);
      lidarrStatus = "connected";
    } else {
      lidarrStatus = "not_configured";
    }
  } catch (error) {
    lidarrStatus = "unreachable";
  }

  res.json({
    status: "ok",
    lidarrConfigured: !!apiKey,
    lidarrStatus,
    lidarrUrl: apiKey ? url : null,
    lidarrBasepathDetected,
    lastfmConfigured: !!getLastfmApiKey(),
    musicbrainzConfigured: !!(db.data.settings.integrations?.musicbrainz?.email || process.env.CONTACT_EMAIL),
    discovery: {
      lastUpdated: discoveryCache?.lastUpdated || null,
      isUpdating: !!discoveryCache?.isUpdating,
      recommendationsCount: discoveryCache?.recommendations?.length || 0,
      globalTopCount: discoveryCache?.globalTop?.length || 0,
      cachedImagesCount: db?.data?.images
        ? Object.keys(db.data.images).length
        : 0,
    },
    authRequired: authPassword.length > 0,
    authUser: authUser,
    timestamp: new Date().toISOString(),
  });
});

// Playlist / Flow Endpoints

app.get("/api/playlists/weekly", (req, res) => {
  const weekly = db.data.flows?.weekly || { enabled: false, items: [], updatedAt: null };
  res.json(weekly);
});

app.post("/api/playlists/weekly/toggle", async (req, res) => {
  try {
    const { enabled } = req.body;
    const result = await playlistManager.setEnabled(enabled);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to toggle weekly flow" });
  }
});

app.post("/api/playlists/weekly/generate", async (req, res) => {
  try {
    const items = await playlistManager.generateWeeklyFlow();
    res.json({ success: true, count: items.length, items });
  } catch (error) {
    res.status(500).json({ error: "Failed to generate weekly playlist", details: error.message });
  }
});

app.post("/api/playlists/weekly/sync", async (req, res) => {
  try {
    const result = await playlistManager.syncToNavidrome();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to sync to Navidrome", details: error.message });
  }
});

app.post("/api/playlists/items/:mbid/keep", async (req, res) => {
  try {
    const success = await playlistManager.keepItem(req.params.mbid);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: "Failed to keep item" });
  }
});

app.delete("/api/playlists/items/:mbid", async (req, res) => {
  try {
    const success = await playlistManager.removeItem(req.params.mbid);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: "Failed to remove item" });
  }
});

const parseLastFmDate = (dateStr) => {
  if (!dateStr) return "";
  // Try to clean up common Last.fm date formats if needed, but Date() parses "01 Jan 1990" well.
  const d = new Date(dateStr.split(",")[0].trim()); // Remove time if present "22 Mar 1982, 00:00"
  if (isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
};

app.get("/api/search/artists", async (req, res) => {
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

              return {
                id: a.mbid,
                name: a.name,
                "sort-name": a.name,
                image: img,
                listeners: a.listeners,
              };
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

app.get("/api/artists/:mbid", async (req, res) => {
  try {
    const { mbid } = req.params;

    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: "Invalid MBID format" });
    }

    /* 
     * Switching to MusicBrainz as primary source for album lists per user request.
     * Last.fm data was deemed too convoluted.
     */
    /*
    if (getLastfmApiKey()) {
      try {
        const lastfmData = await lastfmRequest("artist.getInfo", { mbid });
        if (lastfmData?.artist) {
          const a = lastfmData.artist;
          const artist = {
            id: a.mbid,
            name: a.name,
            "sort-name": a.name,
            type: "Person", // Last.fm doesn't provide type reliably
            "life-span": {
              begin: "", 
            },
            country: "",
            area: { name: "" },
            genres: (a.tags?.tag || []).map((t) => ({ name: t.name })),
            tags: (a.tags?.tag || []).map((t) => ({
              name: t.name,
              count: 100,
            })),
            disambiguation:
              typeof a.bio?.summary === "string"
                ? a.bio.summary.replace(/<[^>]*>/g, "").split(".")[0]
                : "",
            "release-groups": [], 
            aliases: [],
          };

          try {
            const albumData = await lastfmRequest("artist.getTopAlbums", {
              mbid,
              limit: 50,
            });
            
            if (albumData?.topalbums?.album) {
              const albums = Array.isArray(albumData.topalbums.album)
                ? albumData.topalbums.album
                : [albumData.topalbums.album];
              
              // Map initial data
              let releaseGroups = albums
                .filter(alb => alb.mbid || alb.name)
                .map(alb => ({
                  id: alb.mbid || `lfm-${Buffer.from(alb.name).toString('base64')}`, // Fallback ID if no MBID
                  title: alb.name,
                  "primary-type": "Album",
                  "first-release-date": "", 
                  "secondary-types": [],
                  image: alb.image?.find(i => i.size === 'large')?.['#text']
                }));

              // Enrich with details to get dates (Top 25 to ensure speed)
              const enrichPromises = releaseGroups.slice(0, 25).map(async (album) => {
                  try {
                      // Prefer MBID, fallback to Artist+Album Name
                      const params = album.id.startsWith('lfm-') 
                        ? { artist: artist.name, album: album.title }
                        : { mbid: album.id };
                      
                      const details = await lastfmRequest("album.getInfo", params);
                      
                      if (details?.album) {
                          // Try to find a date
                          let date = "";
                          if (details.album.wiki?.published) {
                              date = parseLastFmDate(details.album.wiki.published);
                          } else if (details.album.releasedate) {
                              date = parseLastFmDate(details.album.releasedate.trim());
                          }

                          return {
                              ...album,
                              "first-release-date": date,
                              "primary-type": details.album.tags?.tag?.some(t => t.name?.toLowerCase() === 'ep') ? 'EP' : 'Album'
                          };
                      }
                  } catch (e) {
                      // Ignore enrichment errors
                  }
                  return album;
              });

              artist["release-groups"] = await Promise.all(enrichPromises);
              
              // Append the rest unenriched
              if (releaseGroups.length > 25) {
                  artist["release-groups"].push(...releaseGroups.slice(25));
              }
            }
          } catch (e) {
            console.warn("Last.fm album fetch failed:", e.message);
          }
          
          return res.json(artist);
        }
      } catch (e) {
        // Fallback
      }
    }
    */

    // MusicBrainz Fallback
    const data = await musicbrainzRequest(`/artist/${mbid}`, {
      inc: "aliases+tags+ratings+genres+release-groups",
    });

    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch artist details",
      message: error.message,
    });
  }
});

const getArtistImage = async (mbid) => {
  if (!mbid) return { url: null, images: [] };

  if (db.data.images[mbid]) {
    if (db.data.images[mbid] === "NOT_FOUND") {
      return { url: null, images: [] };
    }
    return {
      url: db.data.images[mbid],
      images: [
        {
          image: db.data.images[mbid],
          front: true,
          types: ["Front"],
        },
      ],
    };
  }

  if (negativeImageCache.has(mbid)) {
    return { url: null, images: [] };
  }

  if (pendingImageRequests.has(mbid)) {
    return pendingImageRequests.get(mbid);
  }

  const fetchPromise = (async () => {
    if (getLastfmApiKey()) {
      try {
        const lastfmData = await lastfmRequest("artist.getInfo", { mbid });
        if (lastfmData?.artist?.image) {
          const images = lastfmData.artist.image
            .filter(
              (img) =>
                img["#text"] &&
                !img["#text"].includes("2a96cbd8b46e442fc41c2b86b821562f"),
            )
            .map((img) => ({
              image: img["#text"],
              front: true,
              types: ["Front"],
              size: img.size,
            }));

          if (images.length > 0) {
            const sizeOrder = {
              mega: 4,
              extralarge: 3,
              large: 2,
              medium: 1,
              small: 0,
            };
            images.sort(
              (a, b) => (sizeOrder[b.size] || 0) - (sizeOrder[a.size] || 0),
            );

            db.data.images[mbid] = images[0].image;
            await db.write();

            return { url: images[0].image, images };
          }
        }
      } catch (e) {}
    }

    try {
      // Last.fm logic remains, MusicBrainz fallback removed.
      // If Last.fm fails, we just don't have an image.
    } catch (e) {}

    negativeImageCache.add(mbid);
    db.data.images[mbid] = "NOT_FOUND";
    await db.write();

    return { url: null, images: [] };
  })();

  pendingImageRequests.set(mbid, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    pendingImageRequests.delete(mbid);
  }
};

app.get("/api/artists/:mbid/cover", async (req, res) => {
  try {
    const { mbid } = req.params;

    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: "Invalid MBID format" });
    }

    const result = await getArtistImage(mbid);
    res.json({ images: result.images });
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch cover art",
      message: error.message,
    });
  }
});

app.get("/api/artists/:mbid/similar", async (req, res) => {
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

app.get("/api/lidarr/artists", async (req, res) => {
  try {
    const artists = await getCachedLidarrArtists();
    res.json(artists);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch Lidarr artists",
      message: error.message,
    });
  }
});

app.get("/api/lidarr/mediacover/:artistId/:filename", async (req, res) => {
  try {
    const { artistId, filename } = req.params;
    const { url, apiKey } = getLidarrConfig();
    let finalUrl = url;
    if (lidarrBasepathDetected && !finalUrl.endsWith('/lidarr')) finalUrl += '/lidarr';

    const coverType = filename.split(".")[0];

    const imageResponse = await axios.get(
      `${finalUrl}/api/v1/mediacover/${artistId}/${coverType}`,
      {
        headers: {
          "X-Api-Key": apiKey,
        },
        responseType: "arraybuffer",
      },
    );

    res.set("Content-Type", imageResponse.headers["content-type"]);
    res.set("Cache-Control", "public, max-age=86400");
    res.send(imageResponse.data);
  } catch (error) {
    console.error(
      `Failed to proxy image for artist ${req.params.artistId}: ${error.message}`,
    );
    res.status(404).json({
      error: "Image not found",
      message: error.message,
    });
  }
});

app.get("/api/lidarr/artists/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const artist = await lidarrRequest(`/artist/${id}`);
    res.json(artist);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: "Failed to fetch Lidarr artist",
      message: error.message,
    });
  }
});

app.put("/api/lidarr/artists/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await lidarrRequest(`/artist/${id}`, "PUT", req.body);
    lastLidarrFetch = 0; // Invalidate cache
    res.json(result);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: "Failed to update artist in Lidarr",
      message: error.message,
    });
  }
});

app.get("/api/lidarr/lookup/:mbid", async (req, res) => {
  try {
    const { mbid } = req.params;

    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: "Invalid MBID format" });
    }

    const artists = await getCachedLidarrArtists();

    const existingArtist = artists.find(
      (artist) => artist.foreignArtistId === mbid,
    );

    res.json({
      exists: !!existingArtist,
      artist: existingArtist || null,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to lookup artist in Lidarr",
      message: error.message,
    });
  }
});

app.post("/api/lidarr/lookup/batch", async (req, res) => {
  try {
    const { mbids } = req.body;
    if (!Array.isArray(mbids)) {
      return res.status(400).json({ error: "mbids must be an array" });
    }

    const artists = await getCachedLidarrArtists();

    const results = {};
    mbids.forEach((mbid) => {
      const artist = artists.find((a) => a.foreignArtistId === mbid);
      results[mbid] = !!artist;
    });

    res.json(results);
  } catch (error) {
    res.status(500).json({
      error: "Failed to batch lookup artists in Lidarr",
      message: error.message,
    });
  }
});

app.post("/api/lidarr/artists", async (req, res) => {
  try {
    const {
      foreignArtistId,
      artistName,
      qualityProfileId,
      metadataProfileId,
      rootFolderPath,
      monitored,
      searchForMissingAlbums,
      albumFolders,
    } = req.body;

    if (!foreignArtistId || !artistName) {
      return res.status(400).json({
        error: "foreignArtistId and artistName are required",
      });
    }

    const savedSettings = db.data.settings || defaultData.settings;

    let rootFolder = rootFolderPath ?? savedSettings.rootFolderPath;
    let qualityProfile = qualityProfileId ?? savedSettings.qualityProfileId;
    let metadataProfile = metadataProfileId ?? savedSettings.metadataProfileId;
    let isMonitored = monitored ?? savedSettings.monitored;
    let searchMissing =
      searchForMissingAlbums ?? savedSettings.searchForMissingAlbums;
    let useAlbumFolders = albumFolders ?? savedSettings.albumFolders;

    if (!rootFolder) {
      const rootFolders = await lidarrRequest("/rootfolder");
      if (rootFolders.length === 0) {
        return res.status(400).json({
          error: "No root folders configured in Lidarr",
        });
      }
      rootFolder = rootFolders[0].path;
    }

    if (!qualityProfile) {
      const qualityProfiles = await lidarrRequest("/qualityprofile");
      if (qualityProfiles.length === 0) {
        return res.status(400).json({
          error: "No quality profiles configured in Lidarr",
        });
      }
      qualityProfile = qualityProfiles[0].id;
    }

    if (!metadataProfile) {
      const metadataProfiles = await lidarrRequest("/metadataprofile");
      if (metadataProfiles.length === 0) {
        return res.status(400).json({
          error: "No metadata profiles configured in Lidarr",
        });
      }
      metadataProfile = metadataProfiles[0].id;
    }

    const artistData = {
      foreignArtistId,
      artistName,
      qualityProfileId: qualityProfile,
      metadataProfileId: metadataProfile,
      rootFolderPath: rootFolder,
      monitored: isMonitored,
      albumFolder: useAlbumFolders,
      addOptions: {
        searchForMissingAlbums: searchMissing,
        monitor: req.body.monitor || "all", 
      },
    };

    const result = await lidarrRequest("/artist", "POST", artistData);

    const newRequest = {
      mbid: foreignArtistId,
      name: artistName,
      image: req.body.image || null,
      requestedAt: new Date().toISOString(),
      status: "requested",
    };

    db.data.requests = db.data.requests || [];
    const existingIdx = db.data.requests.findIndex(
      (r) => r.mbid === foreignArtistId,
    );
    if (existingIdx > -1) {
      db.data.requests[existingIdx] = {
        ...db.data.requests[existingIdx],
        ...newRequest,
      };
    } else {
      db.data.requests.push(newRequest);
    }
    await db.write();

    lastLidarrFetch = 0;
    res.status(201).json(result);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: "Failed to add artist to Lidarr",
      message: error.response?.data?.message || error.message,
      details: error.response?.data,
    });
  }
});

app.get("/api/requests", async (req, res) => {
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

app.delete("/api/requests/:mbid", async (req, res) => {
  const { mbid } = req.params;

  if (!UUID_REGEX.test(mbid)) {
    return res.status(400).json({ error: "Invalid MBID format" });
  }

  db.data.requests = (db.data.requests || []).filter((r) => r.mbid !== mbid);
  await db.write();
  res.json({ success: true });
});

app.get("/api/lidarr/recent", async (req, res) => {
  try {
    const artists = await getCachedLidarrArtists();
    const recent = [...artists]
      .sort((a, b) => new Date(b.added) - new Date(a.added))
      .slice(0, 20);
    res.json(recent);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to fetch recent artists from Lidarr" });
  }
});

app.get("/api/lidarr/rootfolder", async (req, res) => {
  try {
    const rootFolders = await lidarrRequest("/rootfolder");
    res.json(rootFolders);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch root folders",
      message: error.message,
    });
  }
});

app.get("/api/lidarr/qualityprofile", async (req, res) => {
  try {
    const profiles = await lidarrRequest("/qualityprofile");
    res.json(profiles);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch quality profiles",
      message: error.message,
    });
  }
});

app.get("/api/lidarr/metadataprofile", async (req, res) => {
  try {
    const profiles = await lidarrRequest("/metadataprofile");
    res.json(profiles);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch metadata profiles",
      message: error.message,
    });
  }
});

app.put("/api/lidarr/albums/monitor", async (req, res) => {
  try {
    const { albumIds, monitored } = req.body;
    if (!Array.isArray(albumIds) || typeof monitored !== "boolean") {
      return res.status(400).json({ error: "Invalid request body" });
    }

    const result = await lidarrRequest("/album/monitor", "PUT", {
      albumIds,
      monitored,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: "Failed to batch update albums",
      message: error.message,
    });
  }
});

app.get("/api/lidarr/albums", async (req, res) => {
  try {
    const { artistId } = req.query;
    if (!artistId) {
      return res.status(400).json({ error: "artistId parameter is required" });
    }
    const albums = await lidarrRequest(`/album?artistId=${artistId}`);
    res.json(albums);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch albums from Lidarr",
      message: error.message,
    });
  }
});

app.get("/api/lidarr/tracks", async (req, res) => {
  try {
    const { albumId } = req.query;
    if (!albumId) {
      return res.status(400).json({ error: "albumId parameter is required" });
    }
    const tracks = await lidarrRequest(`/track?albumId=${albumId}`);
    res.json(tracks);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch tracks from Lidarr",
      message: error.message,
    });
  }
});

app.put("/api/lidarr/albums/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await lidarrRequest(`/album/${id}`, "PUT", req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: "Failed to update album in Lidarr",
      message: error.message,
    });
  }
});

app.post("/api/lidarr/command/albumsearch", async (req, res) => {
  try {
    const { albumIds } = req.body;
    if (!albumIds || !Array.isArray(albumIds)) {
      return res
        .status(400)
        .json({ error: "albumIds array is required" });
    }
    const result = await lidarrRequest("/command", "POST", {
      name: "AlbumSearch",
      albumIds,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: "Failed to trigger album search",
      message: error.message,
    });
  }
});

app.post("/api/lidarr/command/refreshartist", async (req, res) => {
  try {
    const { artistId } = req.body;
    if (!artistId) {
      return res
        .status(400)
        .json({ error: "artistId is required" });
    }
    const result = await lidarrRequest("/command", "POST", {
      name: "RefreshArtist",
      artistId: parseInt(artistId),
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: "Failed to refresh artist",
      message: error.message,
    });
  }
});

app.delete("/api/lidarr/artists/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { deleteFiles = false } = req.query;

    await lidarrRequest(`/artist/${id}?deleteFiles=${deleteFiles}`, "DELETE");
    lastLidarrFetch = 0;

    res.json({ success: true, message: "Artist deleted successfully" });
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: "Failed to delete artist from Lidarr",
      message: error.message,
    });
  }
});

app.delete("/api/lidarr/albums/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { deleteFiles = false } = req.query;

    await lidarrRequest(`/album/${id}?deleteFiles=${deleteFiles}`, "DELETE");
    lastLidarrFetch = 0;

    res.json({ success: true, message: "Album deleted successfully" });
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: "Failed to delete album from Lidarr",
      message: error.message,
    });
  }
});

app.post("/api/lidarr/optimize", async (req, res) => {
  try {
    const { enableMetadataProfile, releaseTypes } = req.body;
    const result = await applyOptimalLidarrSettings(lidarrRequest, {
      enableMetadataProfile,
      releaseTypes
    });

    // Automatically update app settings with the new profiles
    if (result.qualityProfileId || result.metadataProfileId) {
      db.data.settings = {
        ...(db.data.settings || defaultData.settings),
        qualityProfileId: result.qualityProfileId || db.data.settings.qualityProfileId,
        metadataProfileId: result.metadataProfileId || db.data.settings.metadataProfileId,
      };
      await db.write();
      result.message += " App defaults updated.";
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: "Failed to apply optimizations",
      message: error.message,
    });
  }
});

let discoveryCache = {
  ...db.data.discovery,
  isUpdating: false,
};

const updateDiscoveryCache = async () => {
  if (discoveryCache.isUpdating) return;
  discoveryCache.isUpdating = true;
  console.log("Starting background update of discovery recommendations...");

  try {
    const lidarrArtists = await getCachedLidarrArtists(true);
    console.log(`Found ${lidarrArtists.length} artists in Lidarr.`);

    const existingArtistIds = new Set(
      lidarrArtists.map((a) => a.foreignArtistId),
    );

    if (lidarrArtists.length === 0 && !getLastfmApiKey()) {
      console.log(
        "No artists in Lidarr and no Last.fm key. Skipping discovery.",
      );
      discoveryCache.isUpdating = false;
      return;
    }

    const tagCounts = new Map();
    const genreCounts = new Map();
    const profileSample = [...lidarrArtists]
      .sort(() => 0.5 - Math.random())
      .slice(0, 25);

    console.log(`Sampling tags/genres from ${profileSample.length} artists...`);

    await Promise.all(
      profileSample.map(async (artist) => {
        let foundTags = false;
        if (getLastfmApiKey()) {
          try {
            const data = await lastfmRequest("artist.getTopTags", {
              mbid: artist.foreignArtistId,
            });
            if (data?.toptags?.tag) {
              const tags = Array.isArray(data.toptags.tag)
                ? data.toptags.tag
                : [data.toptags.tag];
              tags.slice(0, 15).forEach((t) => {
                tagCounts.set(
                  t.name,
                  (tagCounts.get(t.name) || 0) + (parseInt(t.count) || 1),
                );
                const l = t.name.toLowerCase();
                if (GENRE_KEYWORDS.some((g) => l.includes(g)))
                  genreCounts.set(t.name, (genreCounts.get(t.name) || 0) + 1);
              });
              foundTags = true;
            }
          } catch (e) {
            console.warn(
              `Failed to get Last.fm tags for ${artist.artistName}: ${e.message}`,
            );
          }
        }

        if (!foundTags) {
          // No MB fallback
        }
      }),
    );

    discoveryCache.topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map((t) => t[0]);
    discoveryCache.topGenres = Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 24)
      .map((t) => t[0]);

    console.log(
      `Identified Top Genres: ${discoveryCache.topGenres.join(", ")}`,
    );

    if (getLastfmApiKey()) {
      console.log("Fetching Global Trending artists from Last.fm...");
      try {
        const topData = await lastfmRequest("chart.getTopArtists", {
          limit: 100,
        });
        if (topData?.artists?.artist) {
          const topArtists = Array.isArray(topData.artists.artist)
            ? topData.artists.artist
            : [topData.artists.artist];
          discoveryCache.globalTop = topArtists
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
              return { id: a.mbid, name: a.name, image: img, type: "Artist" };
            })
            .filter((a) => a.id && !existingArtistIds.has(a.id))
            .slice(0, 32);
          console.log(
            `Found ${discoveryCache.globalTop.length} trending artists.`,
          );
        }
      } catch (e) {
        console.error(`Failed to fetch Global Top: ${e.message}`);
      }
    }

    const recSampleSize = Math.min(25, lidarrArtists.length);
    const recSample = [...lidarrArtists]
      .sort(() => 0.5 - Math.random())
      .slice(0, recSampleSize);
    const recommendations = new Map();

    console.log(
      `Generating recommendations based on ${recSample.length} artists...`,
    );

    if (getLastfmApiKey()) {
      await Promise.all(
        recSample.map(async (artist) => {
          try {
            let sourceTags = [];
            const tagData = await lastfmRequest("artist.getTopTags", {
              mbid: artist.foreignArtistId,
            });
            if (tagData?.toptags?.tag) {
              const allTags = Array.isArray(tagData.toptags.tag)
                ? tagData.toptags.tag
                : [tagData.toptags.tag];
              sourceTags = allTags.slice(0, 15).map((t) => t.name);
            }

            const similar = await lastfmRequest("artist.getSimilar", {
              mbid: artist.foreignArtistId,
              limit: 25,
            });
            if (similar?.similarartists?.artist) {
              const list = Array.isArray(similar.similarartists.artist)
                ? similar.similarartists.artist
                : [similar.similarartists.artist];
              for (const s of list) {
                if (
                  s.mbid &&
                  !existingArtistIds.has(s.mbid) &&
                  !recommendations.has(s.mbid)
                ) {
                  let img = null;
                  if (s.image && Array.isArray(s.image)) {
                    const i =
                      s.image.find((img) => img.size === "extralarge") ||
                      s.image.find((img) => img.size === "large");
                    if (
                      i &&
                      i["#text"] &&
                      !i["#text"].includes("2a96cbd8b46e442fc41c2b86b821562f")
                    )
                      img = i["#text"];
                  }
                  recommendations.set(s.mbid, {
                    id: s.mbid,
                    name: s.name,
                    type: "Artist",
                    sourceArtist: artist.artistName,
                    tags: sourceTags,
                    score: Math.round((s.match || 0) * 100),
                    image: img,
                  });
                }
              }
            }
          } catch (e) {
            console.warn(
              `Error getting similar artists for ${artist.artistName}: ${e.message}`,
            );
          }
        }),
      );
    } else {
      // Last.fm required for recommendations now
      console.warn("Last.fm API key required for similar artist discovery.");
    }

    const recommendationsArray = Array.from(recommendations.values())
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 100);

    console.log(
      `Generated ${recommendationsArray.length} total recommendations.`,
    );

    const discoveryData = {
      recommendations: recommendationsArray,
      basedOn: recSample.map((a) => ({
        name: a.artistName,
        id: a.foreignArtistId,
      })),
      topTags: discoveryCache.topTags || [],
      topGenres: discoveryCache.topGenres || [],
      globalTop: discoveryCache.globalTop || [],
      lastUpdated: new Date().toISOString(),
    };

    Object.assign(discoveryCache, discoveryData);
    db.data.discovery = discoveryData;
    await db.write();

    const allToHydrate = [
      ...(discoveryCache.globalTop || []),
      ...recommendationsArray,
    ].filter((a) => !a.image);
    console.log(`Hydrating images for ${allToHydrate.length} artists...`);
    
    await Promise.all(
      allToHydrate.map(async (item) => {
        try {
          const res = await getArtistImage(item.id);
          if (res.url) {
            item.image = res.url;
          }
        } catch (e) {}
      }),
    );

    await db.write();

    console.log("Discovery cache updated successfully.");
  } catch (error) {
    console.error("Failed to update discovery cache:", error.message);
  } finally {
    discoveryCache.isUpdating = false;
  }
};

setInterval(updateDiscoveryCache, 24 * 60 * 60 * 1000);

setTimeout(() => {
  const lastUpdated = db.data.discovery?.lastUpdated;
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
  if (!lastUpdated || new Date(lastUpdated).getTime() < twentyFourHoursAgo) {
    updateDiscoveryCache();
  } else {
    console.log(
      `Discovery cache is fresh (last updated ${lastUpdated}). Skipping initial update.`,
    );
  }
}, 5000);

app.post("/api/discover/refresh", (req, res) => {
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

app.post("/api/discover/clear", async (req, res) => {
  db.data = {
    discovery: {
      recommendations: [],
      globalTop: [],
      basedOn: [],
      topTags: [],
      topGenres: [],
      lastUpdated: null,
    },
    images: {},
    requests: db.data.requests || [],
  };
  await db.write();
  discoveryCache = {
    ...db.data.discovery,
    isUpdating: false,
  };
  res.json({ message: "Discovery cache and image cache cleared" });
});

app.get("/api/discover", (req, res) => {
  res.json({
    recommendations: discoveryCache.recommendations,
    globalTop: discoveryCache.globalTop,
    basedOn: discoveryCache.basedOn,
    topTags: discoveryCache.topTags,
    topGenres: discoveryCache.topGenres,
    lastUpdated: discoveryCache.lastUpdated,
    isUpdating: discoveryCache.isUpdating,
  });
});

app.get("/api/discover/related", (req, res) => {
  res.json({
    recommendations: discoveryCache.recommendations,
    basedOn: discoveryCache.basedOn,
    total: discoveryCache.recommendations.length,
  });
});

app.get("/api/discover/similar", (req, res) => {
  res.json({
    topTags: discoveryCache.topTags,
    topGenres: discoveryCache.topGenres,
    basedOn: discoveryCache.basedOn,
    message: "Served from cache",
  });
});

app.get("/api/discover/by-tag", async (req, res) => {
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

    if (recommendations.length === 0) {
      // No fallback
    }

    const lidarrArtists = await lidarrRequest("/artist");
    const existingArtistIds = new Set(
      lidarrArtists.map((a) => a.foreignArtistId),
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

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  const { url, apiKey } = getLidarrConfig();
  console.log(`Lidarr URL (configured): ${url}`);
  console.log(`Lidarr API Key configured: ${!!apiKey}`);

  // Probe Lidarr URL on startup
  if (apiKey) {
    await probeLidarrUrl();
    if (lidarrBasepathDetected) {
      console.log(`Lidarr URL (resolved): ${url}/lidarr`);
    }
  }
});


