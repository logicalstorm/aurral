import { NavidromeClient } from './navidrome.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export class PlaylistManager {
  constructor(db, lidarrRequest, musicbrainzRequest, lastfmRequest) {
    this.db = db;
    this.lidarrRequest = lidarrRequest;
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
          this.checkSchedule();
      }
      return this.db.data.flows.weekly;
  }

  async getDiscoveryTagId() {
    try {
      const tags = await this.lidarrRequest('/tag');
      const existing = tags.find(t => t.label === 'aurral-discovery');
      if (existing) return existing.id;

      const newTag = await this.lidarrRequest('/tag', 'POST', { label: 'aurral-discovery' });
      return newTag.id;
    } catch (e) {
      console.error("Failed to get/create Lidarr tag:", e.message);
      return null;
    }
  }

  async generateWeeklyFlow() {
    this.initDb();
    
    await this.cleanupOldItems();

    const recommendations = await this.fetchRecommendations(20);

    const tagId = await this.getDiscoveryTagId();
    const newItems = [];
    
    for (const rec of recommendations) {
      try {
        const result = await this.addToLidarr(rec, tagId);
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
      if (item.lidarrArtistId) {
        try {
          const artist = await this.lidarrRequest(`/artist/${item.lidarrArtistId}`);
          const tagId = await this.getDiscoveryTagId();
          const hasTag = artist.tags && artist.tags.includes(tagId);

          if (hasTag) {
            console.log(`Removing ephemeral artist: ${item.artistName}`);
            await this.lidarrRequest(`/artist/${item.lidarrArtistId}?deleteFiles=true`, 'DELETE');
          } else {
            console.log(`Skipping deletion of ${item.artistName}: Tag missing, assumed kept by user.`);
          }
        } catch (e) {
           if (e.response?.status !== 404) {
               console.error(`Failed to remove ${item.artistName} from Lidarr:`, e.message);
           }
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
    const existingLidarrArtists = await this.lidarrRequest('/artist');
    const existingIds = new Set(existingLidarrArtists.map(a => a.foreignArtistId));
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

  async addToLidarr(item, tagId) {
    const rootFolders = await this.lidarrRequest('/rootfolder');
    const qualityProfiles = await this.lidarrRequest('/qualityprofile');
    const metadataProfiles = await this.lidarrRequest('/metadataprofile');
    
    const tags = tagId ? [tagId] : [];

    const artistPayload = {
        foreignArtistId: item.mbid,
        artistName: item.artistName,
        qualityProfileId: qualityProfiles[0].id,
        metadataProfileId: metadataProfiles[0].id,
        rootFolderPath: rootFolders[0].path,
        monitored: false,
        albumFolder: true,
        tags: tags,
        addOptions: { searchForMissingAlbums: false }
    };

    const artist = await this.lidarrRequest('/artist', 'POST', artistPayload);
    
    this.queueAlbumSelection(artist.id, item.trackName);

    return {
        lidarrArtistId: artist.id,
    };
  }
  
  async queueAlbumSelection(artistId, trackName) {
      setTimeout(async () => {
          try {
              const albums = await this.lidarrRequest(`/album?artistId=${artistId}`);
              
              const match = albums.find(a => 
                  a.title.toLowerCase() === trackName.toLowerCase()
              );
              
              let albumToMonitor = match;
              
              if (!albumToMonitor) {
                  albumToMonitor = albums.find(a => a.albumType === 'Album') || albums[0];
              }
              
              if (albumToMonitor) {
                  console.log(`Monitoring Album ${albumToMonitor.title} for Artist ${artistId}`);
                  
                  await this.lidarrRequest(`/album/monitor`, 'PUT', {
                      albumIds: [albumToMonitor.id],
                      monitored: true
                  });
                  
                  await this.lidarrRequest('/command', 'POST', {
                      name: 'AlbumSearch',
                      albumIds: [albumToMonitor.id]
                  });
              }
          } catch (e) {
              console.error(`Background album selection failed: ${e.message}`);
          }
      }, 45000);
  }

  async keepItem(mbid) {
    this.initDb();
    const items = this.db.data.flows.weekly.items;
    const item = items.find(i => i.mbid === mbid);
    if (item) {
      item.isEphemeral = false;
      await this.db.write();
      
      if (item.lidarrArtistId) {
          try {
             const artist = await this.lidarrRequest(`/artist/${item.lidarrArtistId}`);
             
             const tagId = await this.getDiscoveryTagId();
             if (artist.tags && artist.tags.includes(tagId)) {
                 artist.tags = artist.tags.filter(t => t !== tagId);
             }
             
             artist.monitored = true;
             await this.lidarrRequest(`/artist/${item.lidarrArtistId}`, 'PUT', artist);
          } catch(e) { console.error('Failed to update Lidarr artist monitor status'); }
      }
      
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
      
      if (item.isEphemeral && item.lidarrArtistId) {
          try {
              await this.lidarrRequest(`/artist/${item.lidarrArtistId}?deleteFiles=true`, 'DELETE');
          } catch(e) { console.error('Failed to delete from Lidarr'); }
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
      if (now.getDay() === 1) { 
          const lastUpdate = this.db.data.flows.weekly.updatedAt;
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
