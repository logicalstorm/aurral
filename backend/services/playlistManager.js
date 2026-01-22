import { NavidromeClient } from './navidrome.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export class PlaylistManager {
  constructor(db, lidarrRequest, lastfmRequest) {
    this.db = db;
    this.lidarrRequest = lidarrRequest;
    this.lastfmRequest = lastfmRequest;
    
    // Start scheduler
    this.startScheduler();
  }

  getNavidromeClient() {
    const s = this.db.data.settings?.integrations?.navidrome;
    return new NavidromeClient(s?.url, s?.username, s?.password);
  }

  // Helper to ensure 'flows' structure exists in DB
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
    // Ensure enabled key exists for existing dbs
    if (this.db.data.flows.weekly.enabled === undefined) {
        this.db.data.flows.weekly.enabled = false;
    }
  }

  async setEnabled(enabled) {
      this.initDb();
      this.db.data.flows.weekly.enabled = !!enabled;
      await this.db.write();
      
      // If enabling, run a check immediately
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
    
    // 1. Cleanup old ephemeral items
    await this.cleanupOldItems();

    // 2. Get Recommendations
    const recommendations = await this.fetchRecommendations(20);

    // 3. Process each recommendation
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

    // 4. Update DB
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
        // Try to find the song in Navidrome
        // Note: This relies on Lidarr having downloaded and imported it, 
        // and Navidrome having scanned it.
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

    // Separate items
    for (const item of items) {
      if (!item.isEphemeral) {
        keepItems.push(item);
      } else {
        deleteItems.push(item);
      }
    }

    // Remove from Lidarr (SAFEGUARDED)
    for (const item of deleteItems) {
      if (item.lidarrArtistId) {
        try {
          // SAFETY CHECK: Does the artist have the 'aurral-discovery' tag?
          // If the user removed the tag in Lidarr, they claimed ownership -> DO NOT DELETE.
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
           // If 404, it's already gone, so just ignore
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
    // Strategy:
    // 1. Get existing artists from Lidarr to base recommendations on.
    //    We prioritize recently added or highly rated if possible, but random sample is good for variety.
    // 2. Use Last.fm or MusicBrainz to find similar artists.
    // 3. Filter out what is already in Lidarr.
    
    // Use the existing discovery cache logic which does exactly this (Lidarr -> Similar)
    const discovery = this.db.data.discovery;
    
    // If cache is empty or stale, we might rely on it being refreshed by the main server loop.
    // But let's check if we have recommendations ready.
    if (!discovery?.recommendations || discovery.recommendations.length === 0) {
        console.warn("No discovery recommendations available. Waiting for cache refresh.");
        return [];
    }

    const candidates = discovery.recommendations;
    const existingLidarrArtists = await this.lidarrRequest('/artist');
    const existingIds = new Set(existingLidarrArtists.map(a => a.foreignArtistId));
    const processedIds = new Set(this.db.data.flows.weekly.history || []);

    const selected = [];
    
    // Shuffle candidates to not always pick the top scored ones if the cache is static
    const shuffled = [...candidates].sort(() => 0.5 - Math.random());
    
    for (const rec of shuffled) {
      if (selected.length >= limit) break;
      if (existingIds.has(rec.id)) continue;
      if (processedIds.has(rec.id)) continue; // Don't recommend again immediately

      // We need a specific TRACK for the playlist.
      // Fetch top track for this artist.
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
            // Fallback: If no top track info (no Last.fm), we can still add the artist.
            // But for the playlist feature we really want a track name to verify the download against.
            // Without a track name, we can't ensure the "single" or correct album is grabbed easily.
            // However, we can try to grab the "most popular release" later.
            // Let's skip for now to ensure quality.
            continue; 
        }

        selected.push({
            mbid: rec.id,
            artistName: rec.name,
            trackName: topTrack.name
        });
        
        // Add to history
        processedIds.add(rec.id);

      } catch (e) {
        console.warn(`Failed to get top track for ${rec.name}`);
      }
    }

    // Update history (keep last 200)
    this.db.data.flows.weekly.history = [...processedIds].slice(-200);
    
    return selected;
  }

  async addToLidarr(item, tagId) {
    // 1. Add Artist (Monitored: false, so we don't grab everything)
    const rootFolders = await this.lidarrRequest('/rootfolder');
    const qualityProfiles = await this.lidarrRequest('/qualityprofile');
    const metadataProfiles = await this.lidarrRequest('/metadataprofile');
    
    // Use tag if provided
    const tags = tagId ? [tagId] : [];

    const artistPayload = {
        foreignArtistId: item.mbid,
        artistName: item.artistName,
        qualityProfileId: qualityProfiles[0].id,
        metadataProfileId: metadataProfiles[0].id,
        rootFolderPath: rootFolders[0].path,
        monitored: false, // Important! We will manually select the album
        albumFolder: true,
        tags: tags,
        addOptions: { searchForMissingAlbums: false }
    };

    const artist = await this.lidarrRequest('/artist', 'POST', artistPayload);
    
    // Step 2: Find the album for the track
    // HACK: We will queue a background check to monitor the album once metadata is there.
    this.queueAlbumSelection(artist.id, item.trackName);

    return {
        lidarrArtistId: artist.id,
        // lidarrAlbumId: null // Unknown yet
    };
  }
  
  async queueAlbumSelection(artistId, trackName) {
      // This would ideally be a job queue. 
      // We will just set a timeout for demonstration purposes or check on next "tick"
      // Realistically, Lidarr needs 10-30s to fetch metadata.
      setTimeout(async () => {
          try {
              const albums = await this.lidarrRequest(`/album?artistId=${artistId}`);
              
              // Let's look for a Single with the track name
              const match = albums.find(a => 
                  a.title.toLowerCase() === trackName.toLowerCase()
              );
              
              let albumToMonitor = match;
              
              if (!albumToMonitor) {
                  // Fallback: Pick the most popular/rated album or just the first one
                  // that is a Studio Album.
                  albumToMonitor = albums.find(a => a.albumType === 'Album') || albums[0];
              }
              
              if (albumToMonitor) {
                  console.log(`Monitoring Album ${albumToMonitor.title} for Artist ${artistId}`);
                  
                  // Monitor the album
                  await this.lidarrRequest(`/album/monitor`, 'PUT', {
                      albumIds: [albumToMonitor.id],
                      monitored: true
                  });
                  
                  // Trigger search
                  await this.lidarrRequest('/command', 'POST', {
                      name: 'AlbumSearch',
                      albumIds: [albumToMonitor.id]
                  });
              }
          } catch (e) {
              console.error(`Background album selection failed: ${e.message}`);
          }
      }, 45000); // Wait 45s for metadata
  }

  // User Actions
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
             
             // Remove the discovery tag so we don't delete it later
             const tagId = await this.getDiscoveryTagId();
             if (artist.tags && artist.tags.includes(tagId)) {
                 artist.tags = artist.tags.filter(t => t !== tagId);
             }
             
             artist.monitored = true; // Start monitoring permanently
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
              // Ensure we only delete if tagged (extra safety, though explicit user action overrides)
              // Actually for explicit "remove", we just do it.
              await this.lidarrRequest(`/artist/${item.lidarrArtistId}?deleteFiles=true`, 'DELETE');
          } catch(e) { console.error('Failed to delete from Lidarr'); }
      }
      return true;
    }
    return false;
  }

  // Automation
  startScheduler() {
      // Check every hour
      setInterval(() => {
          this.checkSchedule();
      }, 60 * 60 * 1000); 

      // Initial check after 1 min
      setTimeout(() => this.checkSchedule(), 60000);
  }

  async checkSchedule() {
      this.initDb();
      if (!this.db.data.flows.weekly.enabled) return;

      // 1. Sync to Navidrome (Hourly)
      console.log('Running scheduled Navidrome sync...');
      await this.syncToNavidrome();

      // 2. Weekly Rotation (Mondays)
      const now = new Date();
      // 1 = Monday
      if (now.getDay() === 1) { 
          const lastUpdate = this.db.data.flows.weekly.updatedAt;
          if (!lastUpdate) {
               // Never run before? Run it.
               console.log('Generating initial weekly flow...');
               await this.generateWeeklyFlow();
          } else {
              const lastDate = new Date(lastUpdate);
              const isSameDay = lastDate.getDate() === now.getDate() && 
                                lastDate.getMonth() === now.getMonth() &&
                                lastDate.getFullYear() === now.getFullYear();
              
              // If not updated today, update it
              if (!isSameDay) {
                  console.log('Rotating weekly flow...');
                  await this.generateWeeklyFlow();
              }
          }
      }
  }
}
