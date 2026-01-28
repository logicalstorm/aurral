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
    const { downloadManager } = await import("../services/downloadManager.js");
    const { fileScanner } = await import("../services/fileScanner.js");
    
    const updatedAlbumRequests = await Promise.all(
      albumRequests.map(async (req) => {
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
        const tracks = libraryManager.getTracks(album.id);
        const tracksWithFiles = tracks.filter(t => t.hasFile && t.path);
        
        // Check if files actually exist in album folder (even if tracks aren't matched)
        let filesExistInFolder = false;
        let audioFileCount = 0;
        let audioFiles = [];
        if (album.path) {
          try {
            const fs = await import('fs/promises');
            const path = await import('path');
            const files = await fs.readdir(album.path).catch(() => []);
            audioFiles = files.filter(f => /\.(flac|mp3|m4a|ogg|wav)$/i.test(f));
            audioFileCount = audioFiles.length;
            filesExistInFolder = audioFiles.length > 0;
            
            // If files exist but tracks aren't matched, try direct matching
            if (filesExistInFolder && tracksWithFiles.length < audioFiles.length) {
              console.log(`[Requests] Found ${audioFiles.length} files in "${album.albumName}" but only ${tracksWithFiles.length} tracks matched - attempting direct match`);
              
              for (const fileName of audioFiles) {
                const filePath = path.join(album.path, fileName);
                try {
                  const stats = await fs.stat(filePath);
                  
                  // Try direct matching by filename
                  const fileNameBase = path.basename(fileName, path.extname(fileName)).toLowerCase();
                  let matched = false;
                  
                  for (const track of tracks) {
                    if (track.hasFile && track.path === filePath) {
                      matched = true;
                      break;
                    }
                    
                    const trackNameBase = (track.trackName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                    const fileBase = fileNameBase.replace(/[^a-z0-9]/g, '');
                    
                    // Try to match by track number + name pattern (e.g., "01 - Track Name" or "01 Track Name")
                    const trackNumMatch = fileNameBase.match(/^(\d+)\s*[-.]?\s*(.+)$/);
                    if (trackNumMatch) {
                      const fileTrackNum = parseInt(trackNumMatch[1]);
                      const fileTrackName = trackNumMatch[2].replace(/[^a-z0-9]/g, '');
                      if (track.trackNumber === fileTrackNum && 
                          (fileTrackName.includes(trackNameBase) || trackNameBase.includes(fileTrackName))) {
                        await libraryManager.updateTrack(track.id, {
                          path: filePath,
                          hasFile: true,
                          size: stats.size,
                        });
                        matched = true;
                        console.log(`✓ Directly matched "${fileName}" to track "${track.trackName}"`);
                        break;
                      }
                    }
                    
                    // Fallback: match by name similarity
                    const similarity = fileScanner.calculateSimilarity(track.trackName, fileNameBase);
                    if (!matched && (fileBase.includes(trackNameBase) || trackNameBase.includes(fileBase) || similarity >= 70)) {
                      await libraryManager.updateTrack(track.id, {
                        path: filePath,
                        hasFile: true,
                        size: stats.size,
                      });
                      matched = true;
                      console.log(`✓ Directly matched "${fileName}" to track "${track.trackName}" by name`);
                      break;
                    }
                  }
                  
                  // If no direct match, try fileScanner
                  if (!matched) {
                    const artists = libraryManager.getAllArtists();
                    await fileScanner.matchFileToTrack(
                      {
                        path: filePath,
                        name: fileName,
                        size: stats.size,
                      },
                      artists
                    );
                  }
                } catch (error) {
                  console.warn(`Failed to match file ${fileName}:`, error.message);
                }
              }
              
              // Force statistics update after matching
              await libraryManager.updateAlbumStatistics(album.id);
            }
          } catch (error) {
            // Folder doesn't exist or can't be read
          }
        }
        
        // Refresh tracks after potential updates to get latest state
        const refreshedTracks = libraryManager.getTracks(album.id);
        const refreshedTracksWithFiles = refreshedTracks.filter(t => t.hasFile && t.path);
        
        const hasFiles = refreshedTracksWithFiles.length > 0 || filesExistInFolder;
        
        // Check if album is complete (all tracks have files)
        const isComplete = refreshedTracks.length > 0 && refreshedTracksWithFiles.length === refreshedTracks.length;
        const newStatus = isComplete ? "available" : (hasFiles ? "processing" : "processing");

        // If album is complete, also update download records to "added" status
        if (isComplete) {
          // Update all download records for this album to "added" since files are in library
          downloadManager.updateDownloadStatus(req.albumId, 'added', {
            reason: 'Album complete in library, syncing download status',
          });
        }

        if (newStatus !== req.status) {
          changed = true;
          dbOps.updateAlbumRequest(req.albumId, { status: newStatus });
          return { ...req, status: newStatus };
        }
        return req;
      })
    );
    
    const filteredRequests = updatedAlbumRequests.filter(Boolean); // Remove null entries (deleted albums/artists)

    // Format for frontend - include album and artist info
    const formattedRequests = filteredRequests.map(req => {
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
