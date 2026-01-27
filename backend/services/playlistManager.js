import { NavidromeClient } from './navidrome.js';
import { libraryManager } from './libraryManager.js';
import { slskdClient } from './slskdClient.js';
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
    this.db = db;
    this.musicbrainzRequest = musicbrainzRequest;
    this.lastfmRequest = lastfmRequest;
    
    this.startScheduler();
  }

  getNavidromeClient() {
    const s = this.db.data.settings?.integrations?.navidrome;
    return new NavidromeClient(s?.url, s?.username, s?.password);
  }

  initDb() {
    if (!this.db.data.flows) {
      this.db.data.flows = {
        weekly: {
          enabled: false,
          updatedAt: null,
          items: [], 
          history: []
        }
      };
    }
    if (this.db.data.flows.weekly.enabled === undefined) {
        this.db.data.flows.weekly.enabled = false;
    }
  }

  async setEnabled(enabled) {
      this.initDb();
      
      if (!enabled && this.db.data.flows.weekly.enabled) {
          // When disabling, completely wipe all weekly flow data
          wfLog.log('Disabling weekly flow - wiping all data and files...');
          await this.wipeWeeklyFlowData();
      }
      
      this.db.data.flows.weekly.enabled = !!enabled;
      await this.db.write();
      
      if (enabled) {
          // Always generate fresh when enabling (since we wiped everything if it was disabled)
          wfLog.log('Enabling weekly flow - generating fresh recommendations...');
          await this.generateWeeklyFlow();
          // Sync to Navidrome after generating
          await this.syncToNavidrome();
      }
      return this.db.data.flows.weekly;
  }

  async wipeWeeklyFlowData() {
      this.initDb();
      
      const items = this.db.data.flows.weekly.items || [];
      const weeklyFlowFolder = this.getWeeklyFlowFolder();
      
      wfLog.log(`Wiping ${items.length} weekly flow items...`);
      
      // Delete all weekly flow files
      try {
          // Get all download records for weekly flow
          const weeklyFlowDownloads = (this.db.data.downloads || []).filter(
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
                      // Check if artist is only in weekly flow (not in requests)
                      const isOnlyInFlow = !this.db.data.requests?.find(
                          r => r.mbid === artist.mbid && r.status === 'available'
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
      if (this.db.data.downloads) {
          const beforeCount = this.db.data.downloads.length;
          this.db.data.downloads = this.db.data.downloads.filter(
              d => d.type !== 'weekly-flow'
          );
          const removed = beforeCount - this.db.data.downloads.length;
          wfLog.log(`Removed ${removed} weekly-flow download records`);
      }
      
      // Clear all weekly flow data
      this.db.data.flows.weekly.items = [];
      this.db.data.flows.weekly.history = [];
      this.db.data.flows.weekly.updatedAt = null;
      
      await this.db.write();
      
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
    this.initDb();
    
    await this.cleanupOldItems();

    const recommendations = await this.fetchRecommendations(20);

    const newItems = [];
    
    for (const rec of recommendations) {
      try {
        const result = await this.addToLibrary(rec);
        if (result) {
          newItems.push({
            ...rec,
            ...result,
            isEphemeral: true,
            addedAt: new Date().toISOString()
          });
        }
      } catch (e) {
        wfLog.error(`Failed to process recommendation ${rec.artistName}:`, e.message);
      }
    }

    this.db.data.flows.weekly.items = [
      ...this.db.data.flows.weekly.items,
      ...newItems
    ];
    this.db.data.flows.weekly.updatedAt = new Date().toISOString();
    await this.db.write();

    return newItems;
  }

  async syncToNavidrome() {
    this.initDb();
    const navidrome = this.getNavidromeClient();
    if (!navidrome.isConfigured()) return { success: false, error: 'Navidrome not configured' };

    const items = this.db.data.flows.weekly.items;
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

  async cleanupOldItems() {
    this.initDb();
    const items = this.db.data.flows.weekly.items;
    const keepItems = [];
    const deleteItems = [];

    for (const item of items) {
      if (!item.isEphemeral) {
        keepItems.push(item);
      } else {
        deleteItems.push(item);
      }
    }

    for (const item of deleteItems) {
      // Delete weekly flow track files
      try {
        const downloadRecord = (this.db.data.downloads || []).find(
          d => d.type === 'weekly-flow' && 
               d.artistMbid === item.mbid && 
               d.trackName === item.trackName
        );
        
        if (downloadRecord && downloadRecord.destinationPath) {
          try {
            // Log deletion event before deleting
            if (downloadRecord.events) {
              downloadRecord.events.push({
                timestamp: new Date().toISOString(),
                event: 'deleted',
                reason: 'weekly_flow_cleanup',
                destinationPath: downloadRecord.destinationPath,
              });
            }
            
            await fs.unlink(downloadRecord.destinationPath);
            wfLog.log(`Deleted weekly flow track file: ${downloadRecord.destinationPath}`);
          } catch (e) {
            // File might already be deleted or moved
            wfLog.log(`Could not delete weekly flow file (may already be gone): ${downloadRecord.destinationPath}`);
          }
          
          // Mark as deleted in record before removing
          downloadRecord.status = 'deleted';
          downloadRecord.deletedAt = new Date().toISOString();
          await this.db.write();
          
          // Remove download record after a delay (keep for audit trail, but can be cleaned up later)
          // For now, keep the record but mark it as deleted
          // const downloadIndex = (this.db.data.downloads || []).findIndex(d => d.id === downloadRecord.id);
          // if (downloadIndex > -1) {
          //   this.db.data.downloads.splice(downloadIndex, 1);
          // }
        }
      } catch (e) {
        wfLog.error(`Failed to delete weekly flow track file: ${e.message}`);
      }
      
      if (item.artistId) {
        try {
          const artist = libraryManager.getArtistById(item.artistId);
          if (artist) {
            // Check if artist is still ephemeral (only in weekly flow)
            const isOnlyInFlow = !this.db.data.requests?.find(r => r.mbid === artist.mbid && r.status === 'available');
            
            if (isOnlyInFlow) {
              wfLog.log(`Removing ephemeral artist: ${item.artistName}`);
              await libraryManager.deleteArtist(artist.mbid, true);
            } else {
              wfLog.log(`Skipping deletion of ${item.artistName}: Assumed kept by user.`);
            }
          }
        } catch (e) {
          wfLog.error(`Failed to remove ${item.artistName} from library: ${e.message}`);
        }
      }
    }

    this.db.data.flows.weekly.items = keepItems;
    await this.db.write();
  }

  async fetchRecommendations(limit = 20) {
    const discovery = this.db.data.discovery;
    
    if (!discovery?.recommendations || discovery.recommendations.length === 0) {
        wfLog.warn("No discovery recommendations available. Waiting for cache refresh.");
        return [];
    }

    const candidates = discovery.recommendations;
    const existingLibraryArtists = libraryManager.getAllArtists();
    const existingIds = new Set(existingLibraryArtists.map(a => a.mbid));
    const processedIds = new Set(this.db.data.flows.weekly.history || []);

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

    this.db.data.flows.weekly.history = [...processedIds].slice(-200);
    
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

  async keepItem(mbid) {
    this.initDb();
    const items = this.db.data.flows.weekly.items;
    const item = items.find(i => i.mbid === mbid);
    if (item) {
      item.isEphemeral = false;
      await this.db.write();
      
      // Move track from weekly flow folder to artist folder if it exists
      await this.moveTrackToLibrary(item);
      
      // Find and download the specific album containing this track
      if (item.artistId && item.trackName) {
        try {
          const artist = libraryManager.getArtistById(item.artistId);
          if (artist) {
            // Find the album that contains this track via MusicBrainz
            const albumMbid = await this.findAlbumByTrack(artist.mbid, item.trackName);
            
            if (albumMbid) {
              // Check if album already exists in library
              const albums = libraryManager.getAlbums(artist.id);
              let album = albums.find(a => a.mbid === albumMbid);
              
              if (!album) {
                // Fetch album name from MusicBrainz
                try {
                  const rgData = await this.musicbrainzRequest(`/release-group/${albumMbid}`);
                  const albumName = rgData.title || 'Unknown Album';
                  
                  // Add album to library
                  album = await libraryManager.addAlbum(artist.id, albumMbid, albumName, {});
                  wfLog.log(`Added album "${albumName}" to library for kept track`);
                } catch (e) {
                  wfLog.error(`Failed to fetch album info: ${e.message}`);
                }
              }
              
              if (album) {
                // Download just this specific album
                const { downloadManager } = await import('./downloadManager.js');
                await downloadManager.downloadAlbum(artist.id, album.id);
                wfLog.log(`Queued download for album containing kept track: ${album.albumName}`);
              }
            } else {
              wfLog.log(`Could not find album for track "${item.trackName}" by ${artist.artistName}`);
            }
          }
        } catch (e) {
          wfLog.error(`Failed to download album for kept item: ${e.message}`);
        }
      }
      
      return true;
    }
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
      const { db } = await import('../config/db.js');
      const downloadRecord = (db.data.downloads || []).find(
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
        downloadRecord.destinationPath = destinationPath;
        downloadRecord.status = 'added';
        await db.write();
      } catch (error) {
        if (error.code === 'EXDEV') {
          // Different filesystems - copy instead
          await fs.copyFile(sourcePath, destinationPath);
          await fs.unlink(sourcePath);
          wfLog.log(`Copied kept track from weekly flow to library: ${destinationPath}`);
          
          downloadRecord.destinationPath = destinationPath;
          downloadRecord.status = 'added';
          await db.write();
        } else {
          throw error;
        }
      }
    } catch (e) {
      wfLog.error(`Failed to move track to library: ${e.message}`);
    }
  }
  
  async removeItem(mbid) {
    this.initDb();
    const items = this.db.data.flows.weekly.items;
    const itemIndex = items.findIndex(i => i.mbid === mbid);
    
    if (itemIndex > -1) {
      const item = items[itemIndex];
      items.splice(itemIndex, 1);
      await this.db.write();
      
      if (item.isEphemeral && item.artistId) {
        try {
          const artist = libraryManager.getArtistById(item.artistId);
          if (artist) {
            await libraryManager.deleteArtist(artist.mbid, true);
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
    this.initDb();
    const { downloadManager } = await import('./downloadManager.js');
    const { db } = await import('../config/db.js');
    
    const items = this.db.data.flows.weekly.items || [];
    const slskdDownloadDir = downloadManager.slskdDownloadDir || process.env.SLSKD_COMPLETE_DIR || '/Users/leekelly/Desktop/slskd/data/downloads';
    
    wfLog.log(`Checking ${items.length} weekly-flow items for stuck files in ${slskdDownloadDir}...`);
    
    for (const item of items) {
      // Check if this item already has a file in Weekly Flow folder
      const existingDownload = (db.data.downloads || []).find(
        d => d.type === 'weekly-flow' && 
             d.artistMbid === item.mbid && 
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
        const downloadRecord = (db.data.downloads || []).find(
          d => d.type === 'weekly-flow' && 
               d.artistMbid === item.mbid && 
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
                    downloadRecord.slskdFilePath = apiFilePath;
                    await db.write();
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
          let downloadRecord = (db.data.downloads || []).find(
            d => d.type === 'weekly-flow' && 
                 d.artistMbid === item.mbid && 
                 d.trackName === item.trackName
          );
          
          if (!downloadRecord) {
            // Create a download record for this file
            const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            downloadRecord = {
              id: generateId(),
              type: 'weekly-flow',
              artistId: item.artistId,
              artistMbid: item.mbid,
              artistName: item.artistName,
              trackName: item.trackName,
              status: 'completed',
              startedAt: item.addedAt || new Date().toISOString(),
              completedAt: new Date().toISOString(),
              filename: path.basename(foundFile),
            };
            if (!db.data.downloads) {
              db.data.downloads = [];
            }
            db.data.downloads.push(downloadRecord);
          }
          
          // Move the file
          wfLog.log(`Moving ${item.artistName} - ${item.trackName} to Weekly Flow folder...`);
          const destinationPath = await downloadManager.moveFileToWeeklyFlow(foundFile, downloadRecord);
          downloadRecord.destinationPath = destinationPath;
          downloadRecord.status = 'completed';
          await db.write();
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
      this.initDb();
      if (!this.db.data.flows.weekly.enabled) return;

      // First, try to process any stuck weekly-flow files
      await this.processStuckWeeklyFlowFiles();

      const now = new Date();
      const lastUpdate = this.db.data.flows.weekly.updatedAt;
      const hasItems = this.db.data.flows.weekly.items && this.db.data.flows.weekly.items.length > 0;
      
      // Generate immediately if enabled but no items exist (first time setup)
      if (!lastUpdate && !hasItems) {
          console.log('Generating initial weekly flow...');
          await this.generateWeeklyFlow();
          // Sync to Navidrome after generating
          console.log('Syncing to Navidrome after generation...');
          await this.syncToNavidrome();
          return;
      }
      
      // Otherwise, only generate on Mondays
      if (now.getDay() === 1) { 
          if (!lastUpdate) {
               wfLog.log('Generating initial weekly flow...');
               await this.generateWeeklyFlow();
               // Sync to Navidrome after generating
               wfLog.log('Syncing to Navidrome after generation...');
               await this.syncToNavidrome();
          } else {
              const lastDate = new Date(lastUpdate);
              const isSameDay = lastDate.getDate() === now.getDate() && 
                                lastDate.getMonth() === now.getMonth() &&
                                lastDate.getFullYear() === now.getFullYear();
              
              if (!isSameDay) {
                  wfLog.log('Rotating weekly flow...');
                  // generateWeeklyFlow already calls cleanupOldItems first, then generates new items
                  // So we sync after generation (which happens after cleanup)
                  await this.generateWeeklyFlow();
                  // Sync to Navidrome after cleanup and generation
                  wfLog.log('Syncing to Navidrome after rotation...');
                  await this.syncToNavidrome();
              } else {
                  // Same day, just sync (no cleanup needed)
                  wfLog.log('Running scheduled Navidrome sync...');
                  await this.syncToNavidrome();
              }
          }
      } else {
          // Not Monday, just sync (no cleanup needed)
          wfLog.log('Running scheduled Navidrome sync...');
          await this.syncToNavidrome();
      }
  }
}
