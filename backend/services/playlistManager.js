import { NavidromeClient } from './navidrome.js';
import { libraryManager } from './libraryManager.js';
import { slskdClient } from './slskdClient.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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
      this.db.data.flows.weekly.enabled = !!enabled;
      await this.db.write();
      
      if (enabled) {
          // Generate immediately if no items exist (first time setup)
          const hasItems = this.db.data.flows.weekly.items && this.db.data.flows.weekly.items.length > 0;
          const lastUpdate = this.db.data.flows.weekly.updatedAt;
          if (!lastUpdate && !hasItems) {
              console.log('Generating initial weekly flow on enable...');
              await this.generateWeeklyFlow();
          } else {
              this.checkSchedule();
          }
      }
      return this.db.data.flows.weekly;
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
        console.error(`Failed to process recommendation ${rec.artistName}:`, e.message);
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
        console.warn(`Navidrome lookup failed for ${item.artistName} - ${item.trackName}`);
      }
    }

    if (songIds.length > 0) {
      await navidrome.createPlaylist('Aurral Weekly Discovery', songIds);
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
      if (item.artistId) {
        try {
          const artist = libraryManager.getArtistById(item.artistId);
          if (artist) {
            // Check if artist is still ephemeral (only in weekly flow)
            const isOnlyInFlow = !this.db.data.requests?.find(r => r.mbid === artist.mbid && r.status === 'available');
            
            if (isOnlyInFlow) {
              console.log(`Removing ephemeral artist: ${item.artistName}`);
              await libraryManager.deleteArtist(artist.mbid, true);
            } else {
              console.log(`Skipping deletion of ${item.artistName}: Assumed kept by user.`);
            }
          }
        } catch (e) {
          console.error(`Failed to remove ${item.artistName} from library:`, e.message);
        }
      }
    }

    this.db.data.flows.weekly.items = keepItems;
    await this.db.write();
  }

  async fetchRecommendations(limit = 20) {
    const discovery = this.db.data.discovery;
    
    if (!discovery?.recommendations || discovery.recommendations.length === 0) {
        console.warn("No discovery recommendations available. Waiting for cache refresh.");
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
        console.warn(`Failed to get top track for ${rec.name}`);
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
      
      // Queue track download
      this.queueTrackDownload(artist.id, item.trackName);

      return {
        artistId: artist.id,
      };
    } catch (error) {
      console.error(`Failed to add artist ${item.artistName} to library:`, error.message);
      throw error;
    }
  }
  
  async queueTrackDownload(artistId, trackName) {
    setTimeout(async () => {
      try {
        const { downloadManager } = await import('./downloadManager.js');
        const artist = libraryManager.getArtistById(artistId);
        if (!artist) return;

        // Find or create a track entry for this
        // For now, just trigger the download - we'll handle track creation later
        const { slskdClient } = await import('./slskdClient.js');
        if (!slskdClient.isConfigured()) {
          console.warn('slskd not configured, skipping track download');
          return;
        }

        await slskdClient.downloadTrack(artist.artistName, trackName);
        console.log(`Queued track download: ${artist.artistName} - ${trackName}`);
      } catch (e) {
        console.error(`Background track download failed: ${e.message}`);
      }
    }, 5000);
  }

  async keepItem(mbid) {
    this.initDb();
    const items = this.db.data.flows.weekly.items;
    const item = items.find(i => i.mbid === mbid);
    if (item) {
      item.isEphemeral = false;
      await this.db.write();
      
      // Artist is already in library, no need to update anything
      // User can manage monitoring settings through the library interface
      
      return true;
    }
    return false;
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
          console.error('Failed to delete from library:', e.message); 
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

  async checkSchedule() {
      this.initDb();
      if (!this.db.data.flows.weekly.enabled) return;

      console.log('Running scheduled Navidrome sync...');
      await this.syncToNavidrome();

      const now = new Date();
      const lastUpdate = this.db.data.flows.weekly.updatedAt;
      const hasItems = this.db.data.flows.weekly.items && this.db.data.flows.weekly.items.length > 0;
      
      // Generate immediately if enabled but no items exist (first time setup)
      if (!lastUpdate && !hasItems) {
          console.log('Generating initial weekly flow...');
          await this.generateWeeklyFlow();
          return;
      }
      
      // Otherwise, only generate on Mondays
      if (now.getDay() === 1) { 
          if (!lastUpdate) {
               console.log('Generating initial weekly flow...');
               await this.generateWeeklyFlow();
          } else {
              const lastDate = new Date(lastUpdate);
              const isSameDay = lastDate.getDate() === now.getDate() && 
                                lastDate.getMonth() === now.getMonth() &&
                                lastDate.getFullYear() === now.getFullYear();
              
              if (!isSameDay) {
                  console.log('Rotating weekly flow...');
                  await this.generateWeeklyFlow();
              }
          }
      }
  }
}
