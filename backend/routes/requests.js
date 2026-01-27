import express from "express";
import { UUID_REGEX } from "../config/constants.js";
import { libraryManager } from "../services/libraryManager.js";
import { dbOps } from "../config/db-helpers.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    // Get album-based requests (new system)
    let albumRequests = dbOps.getAlbumRequests();
    const libraryArtists = libraryManager.getAllArtists();

    let changed = false;
    const updatedAlbumRequests = albumRequests
      .map((req) => {
        const album = libraryManager.getAlbumById(req.albumId);
        if (!album) {
          // Album not in library anymore - remove request
          return null;
        }

        const artist = libraryManager.getArtistById(req.artistId);
        if (!artist) {
          // Artist not in library anymore - remove request
          return null;
        }

        // Check if album has files on disk
        let hasFiles = false;
        const tracks = libraryManager.getTracks(album.id);
        const tracksWithFiles = tracks.filter(t => t.hasFile && t.path);
        
        if (tracksWithFiles.length > 0) {
          hasFiles = true;
        }
        
        // Check if album is complete (all tracks have files)
        const isComplete = tracks.length > 0 && tracksWithFiles.length === tracks.length;
        const newStatus = isComplete ? "available" : (hasFiles ? "processing" : "processing");

        if (newStatus !== req.status) {
          changed = true;
          dbOps.updateAlbumRequest(req.albumId, { status: newStatus });
          return { ...req, status: newStatus };
        }
        return req;
      })
      .filter(Boolean); // Remove null entries (deleted albums/artists)

    // Format for frontend - include album and artist info
    const formattedRequests = updatedAlbumRequests.map(req => {
      const album = libraryManager.getAlbumById(req.albumId);
      const artist = libraryManager.getArtistById(req.artistId);
      
      return {
        id: req.id,
        type: 'album',
        albumId: req.albumId,
        albumMbid: req.albumMbid,
        albumName: req.albumName || album?.albumName,
        artistId: req.artistId,
        artistMbid: req.artistMbid,
        artistName: req.artistName || artist?.artistName,
        status: req.status,
        requestedAt: req.requestedAt,
        // For backward compatibility with frontend
        mbid: req.artistMbid, // Use artist MBID for image lookup
        name: req.albumName || album?.albumName, // Show album name
        image: null, // Will be fetched by frontend
      };
    });

    const sortedRequests = [...formattedRequests].sort(
      (a, b) => new Date(b.requestedAt) - new Date(a.requestedAt),
    );

    res.json(sortedRequests);
  } catch (error) {
    console.error("Error in /api/requests:", error);
    res.status(500).json({ error: "Failed to fetch requests" });
  }
});

// Delete request by album ID (new album-based system)
router.delete("/album/:albumId", async (req, res) => {
  const { albumId } = req.params;

  if (!albumId) {
    return res.status(400).json({ error: "albumId is required" });
  }

  dbOps.deleteAlbumRequest(albumId);
  res.json({ success: true });
});

// Delete request by MBID (legacy artist-based system)
router.delete("/:mbid", async (req, res) => {
  const { mbid } = req.params;

  if (!UUID_REGEX.test(mbid)) {
    return res.status(400).json({ error: "Invalid MBID format" });
  }

  // Remove from album requests if it matches artist MBID
  const albumRequests = dbOps.getAlbumRequests();
  const toDelete = albumRequests.filter(r => r.artistMbid === mbid);
  for (const req of toDelete) {
    dbOps.deleteAlbumRequest(req.albumId);
  }
  
  res.json({ success: true });
});

export default router;
