import { UUID_REGEX } from "../../../config/constants.js";
import { libraryManager } from "../../../services/libraryManager.js";
import { dbOps } from "../../../config/db-helpers.js";
import { cacheMiddleware } from "../../../middleware/cache.js";
import {
  requireAuth,
  requirePermission,
} from "../../../middleware/requirePermission.js";

const monitorArtistAlbums = async (artist, albums, lidarrClient) => {
  if (
    !artist?.monitored ||
    !artist.monitorOption ||
    artist.monitorOption === "none"
  ) {
    return;
  }
  const albumsToMonitor = [];

  const sortedAlbums = [...albums].sort((a, b) => {
    const dateA = a.releaseDate || a.addedAt || "";
    const dateB = b.releaseDate || b.addedAt || "";
    return dateB.localeCompare(dateA);
  });

  switch (artist.monitorOption) {
    case "all":
    case "existing":
      albumsToMonitor.push(...albums.filter((a) => !a.monitored));
      break;
    case "latest":
      if (sortedAlbums.length > 0 && !sortedAlbums[0].monitored) {
        albumsToMonitor.push(sortedAlbums[0]);
      }
      break;
    case "first": {
      const oldestAlbum = sortedAlbums[sortedAlbums.length - 1];
      if (oldestAlbum && !oldestAlbum.monitored) {
        albumsToMonitor.push(oldestAlbum);
      }
      break;
    }
    case "missing":
      albumsToMonitor.push(
        ...albums.filter((a) => {
          const stats = a.statistics || {};
          return !a.monitored && (stats.percentOfTracks || 0) < 100;
        }),
      );
      break;
    case "future": {
      const artistAddedDate = new Date(artist.addedAt);
      albumsToMonitor.push(
        ...albums.filter((a) => {
          if (a.monitored) return false;
          if (!a.releaseDate) return false;
          const releaseDate = new Date(a.releaseDate);
          return releaseDate > artistAddedDate;
        }),
      );
      break;
    }
  }

  if (lidarrClient && lidarrClient.isConfigured()) {
    await Promise.allSettled(
      albumsToMonitor.map(async (album) => {
        try {
          await libraryManager.updateAlbum(album.id, { monitored: true });
          await lidarrClient.request("/command", "POST", {
            name: "AlbumSearch",
            albumIds: [parseInt(album.id, 10)],
          });
        } catch (err) {
          console.error(
            `Failed to monitor/search album ${album.albumName}:`,
            err.message,
          );
        }
      }),
    );
  }
};

export default function registerArtists(router) {
  router.get("/artists", cacheMiddleware(120), async (req, res) => {
    try {
      const artists = await libraryManager.getAllArtists();
      const formatted = artists.map((artist) => ({
        ...artist,
        foreignArtistId: artist.foreignArtistId || artist.mbid,
        added: artist.addedAt,
      }));
      res.json(formatted);
    } catch (error) {
      res.status(500).json({
        error: "Failed to fetch artists",
        message: error.message,
      });
    }
  });

  router.get("/artists/:mbid", cacheMiddleware(120), async (req, res) => {
    try {
      const { mbid } = req.params;
      if (!UUID_REGEX.test(mbid)) {
        return res.status(400).json({ error: "Invalid MBID format" });
      }

      const artist = await libraryManager.getArtist(mbid);
      if (!artist) {
        return res.status(404).json({ error: "Artist not found" });
      }

      const formatted = {
        ...artist,
        foreignArtistId: artist.foreignArtistId || artist.mbid,
        added: artist.addedAt,
      };
      res.json(formatted);
    } catch (error) {
      res.status(500).json({
        error: "Failed to fetch artist",
        message: error.message,
      });
    }
  });

  router.post(
    "/artists",
    requireAuth,
    requirePermission("addArtist"),
    async (req, res) => {
      try {
        const { foreignArtistId: mbid, artistName, quality } = req.body;

        if (!mbid || !artistName) {
          return res.status(400).json({
            error: "foreignArtistId and artistName are required",
          });
        }

        if (!UUID_REGEX.test(mbid)) {
          return res.status(400).json({ error: "Invalid MBID format" });
        }

        const settings = dbOps.getSettings();
        const artist = await libraryManager.addArtist(mbid, artistName, {
          quality: quality || settings.quality || "standard",
        });
        if (artist?.error) {
          return res.status(503).json({ error: artist.error });
        }
        res.status(201).json(artist);
      } catch (error) {
        res.status(500).json({
          error: "Failed to add artist",
          message: error.message,
        });
      }
    },
  );

  router.put(
    "/artists/:mbid",
    requireAuth,
    requirePermission("changeMonitoring"),
    async (req, res) => {
      try {
        const { mbid } = req.params;
        if (!UUID_REGEX.test(mbid)) {
          return res.status(400).json({ error: "Invalid MBID format" });
        }

        const artist = await libraryManager.updateArtist(mbid, req.body);
        if (artist?.error) {
          return res.status(503).json({ error: artist.error });
        }
        const { lidarrClient } =
          await import("../../../services/lidarrClient.js");
        if (lidarrClient && lidarrClient.isConfigured()) {
          let albums = await libraryManager.getAlbums(artist.id);
          if (artist.monitorOption && artist.monitorOption !== "none") {
            if (!albums.length) {
              await libraryManager.fetchArtistAlbums(artist.id, mbid);
              albums = await libraryManager.getAlbums(artist.id);
            }
            await monitorArtistAlbums(artist, albums, lidarrClient);
          }
        }
        res.json(artist);
      } catch (error) {
        res.status(500).json({
          error: "Failed to update artist",
          message: error.message,
        });
      }
    },
  );

  router.delete(
    "/artists/:mbid",
    requireAuth,
    requirePermission("deleteArtist"),
    async (req, res) => {
      try {
        const { mbid } = req.params;
        const { deleteFiles = false } = req.query;

        if (!UUID_REGEX.test(mbid)) {
          return res.status(400).json({ error: "Invalid MBID format" });
        }

        const result = await libraryManager.deleteArtist(
          mbid,
          deleteFiles === "true",
        );
        if (!result?.success) {
          return res
            .status(503)
            .json({ error: result?.error || "Failed to delete artist" });
        }
        res.json({ success: true, message: "Artist deleted successfully" });
      } catch (error) {
        res.status(500).json({
          error: "Failed to delete artist",
          message: error.message,
        });
      }
    },
  );

  router.post("/artists/:mbid/refresh", async (req, res) => {
    try {
      const { mbid } = req.params;
      if (!UUID_REGEX.test(mbid)) {
        return res.status(400).json({ error: "Invalid MBID format" });
      }

      const artist = await libraryManager.getArtist(mbid);
      if (!artist) {
        return res.status(404).json({ error: "Artist not found" });
      }

      const { lidarrClient } =
        await import("../../../services/lidarrClient.js");
      if (lidarrClient && lidarrClient.isConfigured()) {
        const lidarrArtist = await lidarrClient.getArtist(artist.id);
        if (
          lidarrArtist &&
          lidarrArtist.monitor !== "none" &&
          lidarrArtist.monitored
        ) {
          await libraryManager.fetchArtistAlbums(artist.id, mbid);
        }
      }

      const albums = await libraryManager.getAlbums(artist.id);

      await Promise.allSettled(
        albums.map((album) =>
          libraryManager.updateAlbumStatistics(album.id).catch((err) => {
            console.error(
              `Failed to update statistics for album ${album.albumName}:`,
              err.message,
            );
          }),
        ),
      );

      await libraryManager.updateArtistStatistics(artist.id);

      await monitorArtistAlbums(artist, albums, lidarrClient);

      res.json({
        success: true,
        message: "Artist refreshed successfully",
        albums: albums.length,
      });
    } catch (error) {
      res.status(500).json({
        error: "Failed to refresh artist",
        message: error.message,
      });
    }
  });
}
