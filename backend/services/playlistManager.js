import { NavidromeClient } from './navidrome.js';
import { libraryManager } from './libraryManager.js';
import { slskdClient } from './slskdClient.js';
import { dbOps } from '../config/db-helpers.js';
import path from 'path';
import fs from 'fs/promises';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Weekly Flow logging utility - prefix all logs for easy filtering
const wfLog = {
  log: (...args) => console.log('[WEEKLY FLOW]', ...args),
  error: (...args) => console.error('[WEEKLY FLOW]', ...args),
  warn: (...args) => console.warn('[WEEKLY FLOW]', ...args),
};

export class PlaylistManager {
  constructor(db, musicbrainzRequest, lastfmRequest) {
    // db parameter kept for compatibility but not used
    this.musicbrainzRequest = musicbrainzRequest;
    this.lastfmRequest = lastfmRequest;
    
    this.startScheduler();
  }

  getNavidromeClient() {
    const settings = dbOps.getSettings();
    const s = settings.integrations?.navidrome;
    return new NavidromeClient(s?.url, s?.username, s?.password);
  }

  isEnabled() {
    const settings = dbOps.getSettings();
    // Check if weekly flow is enabled (stored in settings or default to false)
    // For now, we'll check if there are any weekly flow items as a proxy
    // TODO: Add weeklyFlowEnabled to settings table
    const items = dbOps.getWeeklyFlowItems();
    return items.length > 0; // If there are items, it's enabled
  }

  async setEnabled(enabled) {
      const wasEnabled = this.isEnabled();
      
      if (!enabled && wasEnabled) {
          // When disabling, completely wipe all weekly flow data
          wfLog.log('Disabling weekly flow - wiping all data and files...');
          await this.wipeWeeklyFlowData();
      }
      
      // Store enabled state in settings (we'll add a weeklyFlowEnabled key)
      // For now, enabled state is implicit based on items existing
      
      if (enabled) {
          // Always generate fresh when enabling (since we wiped everything if it was disabled)
          wfLog.log('Enabling weekly flow - generating fresh recommendations...');
          await this.generateWeeklyFlow();
          // Sync to Navidrome after generating
          await this.syncToNavidrome();
      }
      
      return {
        enabled: enabled,
        items: dbOps.getWeeklyFlowItems(),
        updatedAt: dbOps.getWeeklyFlowItems()[0]?.addedAt || null,
      };
  }

  async wipeWeeklyFlowData() {
      const items = dbOps.getWeeklyFlowItems();
      const weeklyFlowFolder = this.getWeeklyFlowFolder();
      
      wfLog.log(`Wiping ${items.length} weekly flow items...`);
      
      // Delete all weekly flow files
      try {
          // Get all download records for weekly flow
          const weeklyFlowDownloads = dbOps.getDownloads().filter(
              d => d.type === 'weekly-flow'
          );
          
          for (const downloadRecord of weeklyFlowDownloads) {
              // Delete file if it exists
              if (downloadRecord.destinationPath) {
                  try {
                      await fs.unlink(downloadRecord.destinationPath);
                      wfLog.log(`Deleted weekly flow file: ${downloadRecord.destinationPath}`);
                  } catch (e) {
                      // File might already be deleted
                      wfLog.log(`File already gone: ${downloadRecord.destinationPath}`);
                  }
              }
          }
          
          // Try to delete the entire Weekly Flow folder
          try {
              await fs.rm(weeklyFlowFolder, { recursive: true, force: true });
              wfLog.log(`Deleted Weekly Flow folder: ${weeklyFlowFolder}`);
          } catch (e) {
              // Folder might not exist or might have files, try to delete individual files
              try {
                  const files = await fs.readdir(weeklyFlowFolder);
                  for (const file of files) {
                      const filePath = path.join(weeklyFlowFolder, file);
                      try {
                          const stats = await fs.stat(filePath);
                          if (stats.isFile()) {
                              await fs.unlink(filePath);
                          } else if (stats.isDirectory()) {
                              await fs.rm(filePath, { recursive: true, force: true });
                          }
                      } catch (fileErr) {
                          wfLog.log(`Could not delete ${filePath}: ${fileErr.message}`);
                      }
                  }
              } catch (readErr) {
                  // Folder might not exist, that's okay
                  wfLog.log(`Weekly Flow folder does not exist or is empty`);
              }
          }
      } catch (e) {
          wfLog.error(`Error deleting weekly flow files: ${e.message}`);
      }
      
      // Delete all artists that are only in weekly flow
      for (const item of items) {
          if (item.artistId) {
              try {
                  const artist = libraryManager.getArtistById(item.artistId);
                  if (artist) {
                      // Check if artist is only in weekly flow (not in album requests)
                      const albumRequests = dbOps.getAlbumRequests();
                      const isOnlyInFlow = !albumRequests.find(
                          r => r.artistMbid === artist.mbid && r.status === 'available'
                      );
                      
                      if (isOnlyInFlow) {
                          wfLog.log(`Deleting weekly flow artist: ${artist.artistName}`);
                          await libraryManager.deleteArtist(artist.mbid, true);
                      }
                  }
              } catch (e) {
                  wfLog.error(`Failed to delete artist ${item.artistName}: ${e.message}`);
              }
          }
      }
      
      // Remove all weekly-flow download records
      const weeklyFlowDownloads = dbOps.getDownloads().filter(d => d.type === 'weekly-flow');
      for (const download of weeklyFlowDownloads) {
        dbOps.deleteDownload(download.id);
      }
      wfLog.log(`Removed ${weeklyFlowDownloads.length} weekly-flow download records`);
      
      // Clear all weekly flow data
      dbOps.clearWeeklyFlowItems();
      // History is kept in separate table, no need to clear
      
      // Clear Navidrome playlist
      try {
          const navidrome = this.getNavidromeClient();
          if (navidrome.isConfigured()) {
              const playlists = await navidrome.getPlaylists();
              const existing = playlists.find(p => p.name === 'Aurral Weekly Discovery');
              if (existing) {
                  await navidrome.deletePlaylist(existing.id);
                  wfLog.log('Deleted Navidrome weekly flow playlist');
              }
          }
      } catch (e) {
          wfLog.error(`Failed to delete Navidrome playlist: ${e.message}`);
      }
      
      wfLog.log('Weekly flow data completely wiped');
  }

  // No longer need tags - we track ephemeral items in the flow data

  async generateWeeklyFlow() {
    // initDb() no longer needed - using SQLite directly
    
    const existingItems = dbOps.getWeeklyFlowItems();
    const isFirstRun = existingItems.length === 0;
    
    // First run: seed with 40 tracks
    // Weekly: remove 10 oldest, add 10 new
    const tracksToAdd = isFirstRun ? 40 : 10;
    
    if (!isFirstRun) {
      // Remove 10 oldest items (sorted by addedAt)
      const sortedItems = [...existingItems].sort((a, b) => {
        const dateA = new Date(a.addedAt || 0);
        const dateB = new Date(b.addedAt || 0);
        return dateA - dateB;
      });
      
      const itemsToRemove = sortedItems.slice(0, 10);
      wfLog.log(`Removing ${itemsToRemove.length} oldest items from weekly flow...`);
      
      // Delete files and artists for removed items
      for (const item of itemsToRemove) {
        await this.deleteItemFiles(item);
      }
      
      // Keep the remaining items - delete removed items from database
      const remainingIds = new Set(itemsToRemove.map(i => i.id));
      for (const item of itemsToRemove) {
        dbOps.deleteWeeklyFlowItem(item.id);
        dbOps.addWeeklyFlowHistory({
          artistMbid: item.artistMbid,
          artistName: item.artistName,
          trackName: item.trackName,
          addedAt: item.addedAt,
          removedAt: new Date().toISOString(),
        });
      }
    }

    const recommendations = await this.fetchRecommendations(tracksToAdd);

    const newItems = [];
    
    for (const rec of recommendations) {
      try {
        const result = await this.addToLibrary(rec);
        if (result) {
          const newItem = {
            ...rec,
            ...result,
            addedAt: new Date().toISOString()
          };
          newItems.push(newItem);
          
          // Add to items immediately
          dbOps.insertWeeklyFlowItem(newItem);
          
          // Incrementally update Navidrome playlist as items are added
          await this.addToNavidromePlaylist(newItem);
        }
      } catch (e) {
        wfLog.error(`Failed to process recommendation ${rec.artistName}:`, e.message);
      }
    }

    // UpdatedAt is tracked by the latest item's addedAt
    const totalItems = dbOps.getWeeklyFlowItems().length;
    wfLog.log(`${isFirstRun ? 'Seeded' : 'Added'} ${newItems.length} tracks to weekly flow (total: ${totalItems})`);
    return newItems;
  }
  
  async deleteItemFiles(item) {
    try {
      const downloadRecord = dbOps.getDownloads().find(
        d => d.type === 'weekly-flow' && 
             d.artistMbid === item.mbid && 
             d.trackName === item.trackName
      );
      
      if (downloadRecord && downloadRecord.destinationPath) {
        try {
          // Log deletion event
          if (downloadRecord.events) {
            downloadRecord.events.push({
              timestamp: new Date().toISOString(),
              event: 'deleted',
              reason: 'weekly_flow_rotation',
              destinationPath: downloadRecord.destinationPath,
            });
          }
          
          await fs.unlink(downloadRecord.destinationPath);
          wfLog.log(`Deleted weekly flow track file: ${downloadRecord.destinationPath}`);
        } catch (e) {
          wfLog.log(`Could not delete weekly flow file (may already be gone): ${downloadRecord.destinationPath}`);
        }
        
        // Mark as deleted
        downloadRecord.status = 'deleted';
        downloadRecord.deletedAt = new Date().toISOString();
          dbOps.updateDownload(downloadRecord.id, downloadRecord);
      }
      
      // Remove artist if only in weekly flow
      if (item.artistId) {
        try {
          const artist = libraryManager.getArtistById(item.artistId);
          if (artist) {
            const albumRequests = dbOps.getAlbumRequests();
            const isOnlyInFlow = !albumRequests.find(
              r => r.mbid === artist.mbid && r.status === 'available'
            );
            
            if (isOnlyInFlow) {
              wfLog.log(`Removing artist: ${item.artistName}`);
              await libraryManager.deleteArtist(artist.mbid, true);
            }
          }
        } catch (e) {
          wfLog.error(`Failed to remove ${item.artistName} from library: ${e.message}`);
        }
      }
    } catch (e) {
      wfLog.error(`Failed to delete item files: ${e.message}`);
    }
  }

  async syncToNavidrome() {
    // initDb() no longer needed - using SQLite directly
    const navidrome = this.getNavidromeClient();
    if (!navidrome.isConfigured()) return { success: false, error: 'Navidrome not configured' };

    const items = dbOps.getWeeklyFlowItems();
    const songIds = [];

    for (const item of items) {
      try {
        const song = await navidrome.findSong(item.trackName, item.artistName);
        if (song) {
          songIds.push(song.id);
        }
      } catch (e) {
        wfLog.warn(`Navidrome lookup failed for ${item.artistName} - ${item.trackName}`);
      }
    }

    if (songIds.length > 0) {
      // Clear existing playlist and create new one with current songs
      await navidrome.createPlaylist('Aurral Weekly Discovery', songIds, true);
      return { success: true, count: songIds.length };
    }

    return { success: false, error: 'No songs found in Navidrome yet' };
  }
  
  /**
   * Incrementally add a single track to the Navidrome playlist
   * Called when a track is added to weekly flow or when a download completes
   */
  async addToNavidromePlaylist(item) {
    const navidrome = this.getNavidromeClient();
    if (!navidrome.isConfigured()) {
      return { success: false, error: 'Navidrome not configured' };
    }

    try {
      // Find the playlist
      const playlists = await navidrome.getPlaylists();
      let playlist = playlists.find(p => p.name === 'Aurral Weekly Discovery');
      
      // Create playlist if it doesn't exist
      if (!playlist) {
        playlist = await navidrome.createPlaylist('Aurral Weekly Discovery', [], false);
        wfLog.log('Created Navidrome playlist: Aurral Weekly Discovery');
      }
      
      // Find the song in Navidrome
      const song = await navidrome.findSong(item.trackName, item.artistName);
      if (song) {
        // Add song to playlist (Navidrome will handle duplicates)
        await navidrome.addToPlaylist(playlist.id, song.id);
        wfLog.log(`Added to Navidrome playlist: ${item.artistName} - ${item.trackName}`);
        return { success: true, songId: song.id };
      } else {
        wfLog.log(`Song not found in Navidrome yet: ${item.artistName} - ${item.trackName} (will retry on next sync)`);
        return { success: false, error: 'Song not found in Navidrome yet' };
      }
    } catch (e) {
      wfLog.error(`Failed to add to Navidrome playlist: ${e.message}`);
      return { success: false, error: e.message };
    }
  }
  
  /**
   * Remove a track from the Navidrome playlist
   * Called when a track is removed from weekly flow
   */
  async removeFromNavidromePlaylist(item) {
    const navidrome = this.getNavidromeClient();
    if (!navidrome.isConfigured()) {
      return { success: false, error: 'Navidrome not configured' };
    }

    try {
      const playlists = await navidrome.getPlaylists();
      const playlist = playlists.find(p => p.name === 'Aurral Weekly Discovery');
      
      if (!playlist) {
        return { success: false, error: 'Playlist not found' };
      }
      
      const song = await navidrome.findSong(item.trackName, item.artistName);
      if (song) {
        await navidrome.removeFromPlaylist(playlist.id, song.id);
        wfLog.log(`Removed from Navidrome playlist: ${item.artistName} - ${item.trackName}`);
        return { success: true };
      }
      
      return { success: false, error: 'Song not found in Navidrome' };
    } catch (e) {
      wfLog.error(`Failed to remove from Navidrome playlist: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

  // cleanupOldItems is no longer needed - rotation is handled in generateWeeklyFlow
  // Keeping this method for backwards compatibility but it's now a no-op
  async cleanupOldItems() {
    // Rotation is now handled in generateWeeklyFlow()
    // This method is kept for backwards compatibility
    return;
  }

  async fetchRecommendations(limit = 20) {
    const discovery = dbOps.getDiscoveryCache();
    
    if (!discovery?.recommendations || discovery.recommendations.length === 0) {
        wfLog.warn("No discovery recommendations available. Waiting for cache refresh.");
        return [];
    }

    const candidates = discovery.recommendations;
    const existingLibraryArtists = libraryManager.getAllArtists();
    const existingIds = new Set(existingLibraryArtists.map(a => a.mbid));
    const history = dbOps.getWeeklyFlowHistory(200);
    const processedIds = new Set(history.map(h => `${h.artistMbid}-${h.trackName}`));

    const selected = [];
    
    const shuffled = [...candidates].sort(() => 0.5 - Math.random());
    
    for (const rec of shuffled) {
      if (selected.length >= limit) break;
      if (existingIds.has(rec.id)) continue;
      if (processedIds.has(rec.id)) continue;

      let topTrack = null;
      try {
        if (this.lastfmRequest) {
            const data = await this.lastfmRequest('artist.getTopTracks', { mbid: rec.id, limit: 1 });
            const tracks = data?.toptracks?.track;
            const track = Array.isArray(tracks) ? tracks[0] : tracks;
            if (track) {
                topTrack = { name: track.name };
            }
        }
        
        if (!topTrack) {
            continue; 
        }

        selected.push({
            mbid: rec.id,
            artistName: rec.name,
            trackName: topTrack.name
        });
        
        processedIds.add(rec.id);

      } catch (e) {
        wfLog.warn(`Failed to get top track for ${rec.name}`);
      }
    }

    // History is managed in database, no need to update here
    // (already limited to 200 in getWeeklyFlowHistory)
    
    return selected;
  }

  async addToLibrary(item) {
    try {
      const artist = await libraryManager.addArtist(item.mbid, item.artistName, {
        monitored: false,
        albumFolders: true,
      });
      
      // Queue track download with mbid for tracking
      this.queueTrackDownload(artist.id, item.trackName, item.mbid);

      return {
        artistId: artist.id,
      };
    } catch (error) {
      wfLog.error(`Failed to add artist ${item.artistName} to library:`, error.message);
      throw error;
    }
  }
  
  getWeeklyFlowFolder() {
    const rootFolder = libraryManager.getRootFolder(); // Always /data
    return path.join(rootFolder, 'Weekly Flow');
  }

  async queueTrackDownload(artistId, trackName, mbid) {
    try {
      const { downloadManager } = await import('./downloadManager.js');
      const artist = libraryManager.getArtistById(artistId);
      if (!artist) {
        wfLog.warn(`Artist not found for track download: ${trackName}`);
        return;
      }

      wfLog.log(`Queueing weekly flow track: ${artist.artistName} - ${trackName}`);
      
      // Use the global queue system (automatically handles prioritization and rate limiting)
      const downloadRecord = await downloadManager.queueWeeklyFlowTrack(artistId, trackName, mbid);
      
      wfLog.log(`✓ Added to download queue: ${artist.artistName} - ${trackName} (ID: ${downloadRecord.id})`);
      
      return downloadRecord;
    } catch (e) {
      wfLog.error(`Failed to queue track download: ${artist?.artistName || 'Unknown'} - ${trackName}: ${e.message}`);
      throw e; // Re-throw so caller knows it failed
    }
  }

  // keepItem is no longer used - all tracks are ephemeral
  // Users can manually add artists they like through the discovery/library pages
  async keepItem(mbid) {
    wfLog.warn('keepItem is deprecated - all weekly flow tracks are ephemeral. Users can add artists manually.');
    return false;
  }

  async findAlbumByTrack(artistMbid, trackName) {
    try {
      // Search for recordings by track name and artist
      const searchResult = await this.musicbrainzRequest('/recording', {
        query: `recording:"${trackName}" AND arid:${artistMbid}`,
        limit: 5
      });
      
      if (searchResult.recordings && searchResult.recordings.length > 0) {
        // Get the first matching recording
        const recording = searchResult.recordings[0];
        
        // Find releases that contain this recording
        const releaseResult = await this.musicbrainzRequest('/release', {
          query: `rid:${recording.id} AND arid:${artistMbid}`,
          limit: 1
        });
        
        if (releaseResult.releases && releaseResult.releases.length > 0) {
          const release = releaseResult.releases[0];
          
          // Get release details to find the release-group
          const releaseDetails = await this.musicbrainzRequest(`/release/${release.id}`, {
            inc: 'release-groups'
          });
          
          if (releaseDetails['release-group'] && releaseDetails['release-group'].length > 0) {
            return releaseDetails['release-group'][0].id;
          }
        }
      }
    } catch (e) {
      wfLog.error(`Failed to find album for track "${trackName}": ${e.message}`);
    }
    
    return null;
  }

  async moveTrackToLibrary(item) {
    try {
      const weeklyFlowFolder = this.getWeeklyFlowFolder();
      const artist = libraryManager.getArtistById(item.artistId);
      if (!artist) return;

      // Find the download record for this track
      const downloadRecord = dbOps.getDownloads().find(
        d => d.type === 'weekly-flow' && 
             d.artistMbid === item.mbid && 
             d.trackName === item.trackName &&
             d.status === 'completed'
      );

      if (!downloadRecord || !downloadRecord.destinationPath) {
        wfLog.log(`No completed download found for track: ${item.trackName}`);
        return;
      }

      const sourcePath = downloadRecord.destinationPath;
      
      // Check if file still exists
      try {
        await fs.access(sourcePath);
      } catch {
        wfLog.log(`Source file no longer exists: ${sourcePath}`);
        return;
      }

      // Create artist folder structure
      const artistPath = artist.path;
      const trackFileName = path.basename(sourcePath);
      const destinationPath = path.join(artistPath, trackFileName);

      // Create artist directory
      await fs.mkdir(artistPath, { recursive: true });

      // Move file
      try {
        await fs.rename(sourcePath, destinationPath);
        wfLog.log(`Moved kept track from weekly flow to library: ${destinationPath}`);
        
        // Update download record
        dbOps.updateDownload(downloadRecord.id, {
          destinationPath: destinationPath,
          status: 'added',
        });
      } catch (error) {
        if (error.code === 'EXDEV') {
          // Different filesystems - copy instead
          await fs.copyFile(sourcePath, destinationPath);
          await fs.unlink(sourcePath);
          wfLog.log(`Copied kept track from weekly flow to library: ${destinationPath}`);
          
          dbOps.updateDownload(downloadRecord.id, {
            destinationPath: destinationPath,
            status: 'added',
          });
        } else {
          throw error;
        }
      }
    } catch (e) {
      wfLog.error(`Failed to move track to library: ${e.message}`);
    }
  }
  
  async removeItem(mbid) {
    const items = dbOps.getWeeklyFlowItems();
    const item = items.find(i => i.mbid === mbid);
    
    if (item) {
      dbOps.deleteWeeklyFlowItem(item.id);
      dbOps.addWeeklyFlowHistory({
        artistMbid: item.artistMbid,
        artistName: item.artistName,
        trackName: item.trackName,
        addedAt: item.addedAt,
        removedAt: new Date().toISOString(),
      });
      
      // Delete files and remove from Navidrome playlist
      await this.deleteItemFiles(item);
      await this.removeFromNavidromePlaylist(item);
      
      if (item.artistId) {
        try {
          const artist = libraryManager.getArtistById(item.artistId);
          if (artist) {
            // Only delete if artist is only in weekly flow
            const albumRequests = dbOps.getAlbumRequests();
            const isOnlyInFlow = !albumRequests.find(
              r => r.mbid === artist.mbid && r.status === 'available'
            );
            
            if (isOnlyInFlow) {
              await libraryManager.deleteArtist(artist.mbid, true);
            }
          }
        } catch(e) { 
          wfLog.error('Failed to delete from library:', e.message); 
        }
      }
      return true;
    }
    return false;
  }

  startScheduler() {
      setInterval(() => {
          this.checkSchedule();
      }, 60 * 60 * 1000); 

      setTimeout(() => this.checkSchedule(), 60000);
  }

  async processStuckWeeklyFlowFiles() {
    // Check for weekly-flow items that don't have files moved yet
    // initDb() no longer needed - using SQLite directly
    const { downloadManager } = await import('./downloadManager.js');
    
    const items = dbOps.getWeeklyFlowItems();
    const slskdDownloadDir = downloadManager.slskdDownloadDir || process.env.SLSKD_COMPLETE_DIR || '/Users/leekelly/Desktop/slskd/data/downloads';
    
    wfLog.log(`Checking ${items.length} weekly-flow items for stuck files in ${slskdDownloadDir}...`);
    
    for (const item of items) {
      // Check if this item already has a file in Weekly Flow folder
      const existingDownload = dbOps.getDownloads().find(
        d => d.type === 'weekly-flow' && 
             d.artistMbid === item.artistMbid && 
             d.trackName === item.trackName &&
             d.destinationPath
      );
      
      if (existingDownload && existingDownload.destinationPath) {
        // File already moved, check if it still exists
        try {
          await fs.access(existingDownload.destinationPath);
          continue; // File exists, skip
        } catch {
          // File doesn't exist, need to find it again
          wfLog.log(`File missing for ${item.artistName} - ${item.trackName}, searching...`);
        }
      }
      
        // Try to find the file - first check if we have the path from slskd API
        try {
          const downloadRecord = dbOps.getDownloads().find(
            d => d.type === 'weekly-flow' && 
                 d.artistMbid === item.artistMbid && 
                 d.trackName === item.trackName
          );
        
        let foundFile = null;
        
        // FIRST: Try to get the file path directly from slskd API if we have a download ID
        if (downloadRecord && downloadRecord.slskdDownloadId) {
          try {
            const { slskdClient } = await import('./slskdClient.js');
            const detailedDownload = await slskdClient.getDownload(downloadRecord.slskdDownloadId);
            
            if (detailedDownload) {
              // Get file path from slskd API response
              const apiFilePath = detailedDownload.filePath || 
                                  detailedDownload.destinationPath || 
                                  detailedDownload.path || 
                                  detailedDownload.file || 
                                  detailedDownload.localPath || 
                                  detailedDownload.completedPath ||
                                  detailedDownload.completedFilePath;
              
              if (apiFilePath) {
                // Check if file exists at this path
                try {
                  await fs.access(apiFilePath);
                  foundFile = apiFilePath;
                  wfLog.log(`✓ Got file path from slskd API: ${apiFilePath}`);
                  
                  // Update download record with the path from API
                  if (downloadRecord) {
                    dbOps.updateDownload(downloadRecord.id, {
                      slskdFilePath: apiFilePath,
                    });
                  }
                } catch {
                  wfLog.log(`File from slskd API doesn't exist at: ${apiFilePath}, will search...`);
                }
              }
            }
          } catch (e) {
            wfLog.log(`Could not get download details from slskd API: ${e.message}`);
          }
        }
        
        // SECOND: If we stored the path earlier, try that
        if (!foundFile && downloadRecord && downloadRecord.slskdFilePath) {
          try {
            await fs.access(downloadRecord.slskdFilePath);
            foundFile = downloadRecord.slskdFilePath;
            wfLog.log(`✓ Using stored slskd file path: ${foundFile}`);
          } catch {
            wfLog.log(`Stored path doesn't exist: ${downloadRecord.slskdFilePath}, will search...`);
          }
        }
        
        // THIRD: Fall back to recursive search if API didn't give us a path
        if (!foundFile) {
          const searchNames = [
            item.trackName, // Just track name
            `${item.artistName} - ${item.trackName}`, // Artist - Track
            path.basename(item.trackName), // In case trackName has path
          ];
          
          if (downloadRecord && downloadRecord.filename) {
            searchNames.push(path.basename(downloadRecord.filename));
          }
          
          for (const searchName of searchNames) {
            if (!searchName) continue;
            
            foundFile = await downloadManager.findFileRecursively(slskdDownloadDir, searchName);
            if (foundFile) {
              wfLog.log(`Found file via recursive search for ${item.artistName} - ${item.trackName}: ${foundFile}`);
              break;
            }
          }
        }
        
        if (foundFile) {
          // Create or update download record
          let downloadRecord = dbOps.getDownloads().find(
            d => d.type === 'weekly-flow' && 
                 d.artistMbid === item.artistMbid && 
                 d.trackName === item.trackName
          );
          
          if (!downloadRecord) {
            // Create a download record for this file
            const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            downloadRecord = {
              id: generateId(),
              type: 'weekly-flow',
              artistId: item.artistId,
              artistMbid: item.artistMbid,
              artistName: item.artistName,
              trackName: item.trackName,
              status: 'completed',
              requestedAt: item.addedAt || new Date().toISOString(),
              startedAt: item.addedAt || new Date().toISOString(),
              completedAt: new Date().toISOString(),
              filename: path.basename(foundFile),
              events: [],
            };
            dbOps.insertDownload(downloadRecord);
          }
          
          // Move the file
          wfLog.log(`Moving ${item.artistName} - ${item.trackName} to Weekly Flow folder...`);
          const destinationPath = await downloadManager.moveFileToWeeklyFlow(foundFile, downloadRecord);
          dbOps.updateDownload(downloadRecord.id, {
            destinationPath: destinationPath,
            status: 'completed',
          });
          wfLog.log(`✓ Moved to: ${destinationPath}`);
        } else {
          wfLog.log(`Could not find file for ${item.artistName} - ${item.trackName} (may not have downloaded yet)`);
        }
      } catch (e) {
        wfLog.error(`Failed to process file for ${item.artistName} - ${item.trackName}: ${e.message}`);
      }
    }
  }

  async checkSchedule() {
      // initDb() no longer needed - using SQLite directly
      if (!this.isEnabled()) return;

      // First, try to process any stuck weekly-flow files
      await this.processStuckWeeklyFlowFiles();

      const now = new Date();
      const items = dbOps.getWeeklyFlowItems();
      const lastUpdate = items.length > 0 ? items[0].addedAt : null;
      const hasItems = items.length > 0;
      
      // Generate immediately if enabled but no items exist (first time setup)
      if (!lastUpdate && !hasItems) {
          wfLog.log('Generating initial weekly flow (seeding with 40 tracks)...');
          await this.generateWeeklyFlow();
          // Full sync to Navidrome after initial generation
          wfLog.log('Syncing to Navidrome after initial generation...');
          await this.syncToNavidrome();
          return;
      }
      
      // Otherwise, only generate on Mondays
      if (now.getDay() === 1) { 
          if (!lastUpdate) {
               wfLog.log('Generating initial weekly flow (seeding with 40 tracks)...');
               await this.generateWeeklyFlow();
               // Full sync to Navidrome after initial generation
               wfLog.log('Syncing to Navidrome after initial generation...');
               await this.syncToNavidrome();
          } else {
              const lastDate = new Date(lastUpdate);
              const isSameDay = lastDate.getDate() === now.getDate() && 
                                lastDate.getMonth() === now.getMonth() &&
                                lastDate.getFullYear() === now.getFullYear();
              
              if (!isSameDay) {
                  wfLog.log('Rotating weekly flow (removing 10 oldest, adding 10 new)...');
                  // generateWeeklyFlow handles rotation (removes 10 oldest, adds 10 new)
                  // Items are added incrementally to Navidrome as they're generated
                  await this.generateWeeklyFlow();
                  // Full sync to ensure playlist is up to date
                  wfLog.log('Syncing to Navidrome after rotation...');
                  await this.syncToNavidrome();
              } else {
                  // Same day, just sync (no rotation needed)
                  wfLog.log('Running scheduled Navidrome sync...');
                  await this.syncToNavidrome();
              }
          }
      } else {
          // Not Monday, just sync (no rotation needed)
          wfLog.log('Running scheduled Navidrome sync...');
          await this.syncToNavidrome();
      }
  }
}
