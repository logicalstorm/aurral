import express from "express";
import axios from "axios";
import { UUID_REGEX } from "../config/constants.js";
import { lidarrRequest, getLidarrConfig, getLidarrBasepathDetected } from "../services/apiClients.js";
import { getCachedLidarrArtists, invalidateLidarrCache } from "../services/lidarrCache.js";
import { db } from "../config/db.js";
import { defaultData } from "../config/constants.js";
import { applyOptimalLidarrSettings } from "../services/lidarrOptimizer.js";

const router = express.Router();

router.get("/artists", async (req, res) => {
  try {
    const artists = await getCachedLidarrArtists();
    
    const artistsWithImages = artists.map(artist => {
      const artistCopy = { ...artist };
      
      if (artist.images && artist.images.length > 0) {
        const posterImage = artist.images.find(
          img => img.coverType === "poster" || img.coverType === "fanart"
        ) || artist.images[0];
        
        if (posterImage && artist.id) {
          const coverType = posterImage.coverType || "poster";
          artistCopy.imageUrl = `/api/lidarr/mediacover/${artist.id}/${coverType}.jpg`;
        }
      }
      
      if (artist.foreignArtistId && db.data.images && db.data.images[artist.foreignArtistId] && db.data.images[artist.foreignArtistId] !== "NOT_FOUND") {
        artistCopy.imageUrl = db.data.images[artist.foreignArtistId];
      }
      
      return artistCopy;
    });
    
    res.set("Cache-Control", "public, max-age=300");
    res.json(artistsWithImages);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch Lidarr artists",
      message: error.message,
    });
  }
});

router.get("/mediacover/:artistId/:filename", async (req, res) => {
  try {
    const { artistId, filename } = req.params;
    const { url, apiKey } = getLidarrConfig();
    let finalUrl = url;
    if (getLidarrBasepathDetected() && !finalUrl.endsWith('/lidarr')) finalUrl += '/lidarr';

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
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.set("ETag", `"${req.params.artistId}-${req.params.filename}"`);
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

router.get("/artists/:id", async (req, res) => {
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

router.put("/artists/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await lidarrRequest(`/artist/${id}`, "PUT", req.body);
    invalidateLidarrCache();
    res.json(result);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: "Failed to update artist in Lidarr",
      message: error.message,
    });
  }
});

router.get("/lookup/:mbid", async (req, res) => {
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

router.post("/lookup/batch", async (req, res) => {
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

router.post("/artists", async (req, res) => {
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

    invalidateLidarrCache();
    res.status(201).json(result);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: "Failed to add artist to Lidarr",
      message: error.response?.data?.message || error.message,
      details: error.response?.data,
    });
  }
});

router.get("/recent", async (req, res) => {
  try {
    const artists = await getCachedLidarrArtists();
    const recent = [...artists]
      .sort((a, b) => new Date(b.added) - new Date(a.added))
      .slice(0, 20)
      .map(artist => {
        const artistCopy = { ...artist };
        
        if (artist.images && artist.images.length > 0) {
          const posterImage = artist.images.find(
            img => img.coverType === "poster" || img.coverType === "fanart"
          ) || artist.images[0];
          
          if (posterImage && artist.id) {
            const coverType = posterImage.coverType || "poster";
            artistCopy.imageUrl = `/api/lidarr/mediacover/${artist.id}/${coverType}.jpg`;
          }
        }
        
        if (artist.foreignArtistId && db.data.images && db.data.images[artist.foreignArtistId] && db.data.images[artist.foreignArtistId] !== "NOT_FOUND") {
          artistCopy.imageUrl = db.data.images[artist.foreignArtistId];
        }
        
        return artistCopy;
      });
    
    res.set("Cache-Control", "public, max-age=300");
    res.json(recent);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to fetch recent artists from Lidarr" });
  }
});

router.get("/rootfolder", async (req, res) => {
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

router.get("/qualityprofile", async (req, res) => {
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

router.get("/metadataprofile", async (req, res) => {
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

router.put("/albums/monitor", async (req, res) => {
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

router.get("/albums", async (req, res) => {
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

router.get("/tracks", async (req, res) => {
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

router.put("/albums/:id", async (req, res) => {
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

router.post("/command/albumsearch", async (req, res) => {
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

router.post("/command/refreshartist", async (req, res) => {
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

router.delete("/artists/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { deleteFiles = false } = req.query;

    await lidarrRequest(`/artist/${id}?deleteFiles=${deleteFiles}`, "DELETE");
    invalidateLidarrCache();

    res.json({ success: true, message: "Artist deleted successfully" });
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: "Failed to delete artist from Lidarr",
      message: error.message,
    });
  }
});

router.delete("/albums/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { deleteFiles = false } = req.query;

    await lidarrRequest(`/album/${id}?deleteFiles=${deleteFiles}`, "DELETE");
    invalidateLidarrCache();

    res.json({ success: true, message: "Album deleted successfully" });
  } catch (error) {
    res.status(error.response?.status || 500).json({
      error: "Failed to delete album from Lidarr",
      message: error.message,
    });
  }
});

router.post("/optimize", async (req, res) => {
  try {
    const { enableMetadataProfile, releaseTypes } = req.body;
    const result = await applyOptimalLidarrSettings(lidarrRequest, {
      enableMetadataProfile,
      releaseTypes
    });

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

export default router;
