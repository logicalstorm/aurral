import axios from 'axios';
import crypto from 'crypto';

export class NavidromeClient {
  constructor(url, user, password) {
    this.url = url ? url.replace(/\/+$/, '') : null;
    this.user = user;
    this.password = password;
  }

  isConfigured() {
    return !!(this.url && this.user && this.password);
  }

  getAuthParams() {
    const salt = crypto.randomBytes(6).toString('hex');
    const token = crypto.createHash('md5').update(this.password + salt).digest('hex');
    return {
      u: this.user,
      t: token,
      s: salt,
      v: '1.16.1',
      c: 'aurral',
      f: 'json'
    };
  }

  async request(endpoint, params = {}) {
    if (!this.isConfigured()) throw new Error("Navidrome not configured");
    
    try {
      const response = await axios.get(`${this.url}/rest/${endpoint}`, {
        params: {
          ...this.getAuthParams(),
          ...params
        }
      });

      if (response.data['subsonic-response']?.status === 'failed') {
        throw new Error(response.data['subsonic-response'].error?.message || 'Navidrome request failed');
      }

      return response.data['subsonic-response'];
    } catch (error) {
      console.error(`Navidrome Error [${endpoint}]:`, error.message);
      throw error;
    }
  }

  async ping() {
    return this.request('ping');
  }

  async findSong(title, artist) {
    const data = await this.request('search3', {
      query: `${artist} ${title}`,
      songCount: 5,
      artistCount: 0,
      albumCount: 0
    });

    const songs = data.searchResult3?.song || [];
    const match = songs.find(s => 
      s.title.toLowerCase() === title.toLowerCase() && 
      s.artist.toLowerCase() === artist.toLowerCase()
    );

    return match || null;
  }

  async searchSongsByArtist(artistName, limit = 5) {
    const data = await this.request('search3', {
      query: artistName,
      songCount: limit,
      artistCount: 0,
      albumCount: 0
    });
    const songs = data.searchResult3?.song || [];
    const list = Array.isArray(songs) ? songs : [songs];
    return list
      .filter((s) => s.artist && s.artist.toLowerCase() === artistName.toLowerCase())
      .slice(0, limit)
      .map((s) => ({
        id: s.id,
        title: s.title,
        album: s.album,
        duration: s.duration ?? 0
      }));
  }

  getStreamUrl(songId) {
    if (!this.isConfigured()) throw new Error("Navidrome not configured");
    const params = new URLSearchParams(this.getAuthParams());
    params.delete('f');
    return `${this.url}/rest/stream?id=${encodeURIComponent(songId)}&${params.toString()}`;
  }
  
  async getPlaylists() {
    const data = await this.request('getPlaylists');
    return data.playlists?.playlist || [];
  }

  async createPlaylist(name, songIds, replace = false) {
    if (!songIds || songIds.length === 0) {
      // If no songs and replace is true, delete the playlist
      if (replace) {
        const playlists = await this.getPlaylists();
        const existing = playlists.find(p => p.name === name);
        if (existing) {
          await this.deletePlaylist(existing.id);
        }
      }
      return null;
    }

    const playlists = await this.getPlaylists();
    const existing = playlists.find(p => p.name === name);

    if (existing) {
      if (replace) {
        // Delete and recreate to ensure clean state
        await this.deletePlaylist(existing.id);
      } else {
        // Update existing playlist
        const data = await this.request('updatePlaylist', {
          playlistId: existing.id,
          songIdToAdd: songIds
        });
        return data.playlist || existing;
      }
    }

    const data = await this.request('createPlaylist', {
      name,
      songId: songIds
    });
    
    return data.playlist;
  }

  async deletePlaylist(id) {
    return this.request('deletePlaylist', { id });
  }
  
  async addToPlaylist(playlistId, songId) {
    // Add a single song to an existing playlist
    return this.request('updatePlaylist', {
      playlistId,
      songIdToAdd: songId
    });
  }
  
  async removeFromPlaylist(playlistId, songId) {
    // Remove a single song from a playlist
    // Navidrome/Subsonic API uses songIndexToRemove (position-based)
    // We need to get the playlist first to find the song's index
    try {
      const playlistData = await this.request('getPlaylist', { id: playlistId });
      const playlist = playlistData.playlist;
      
      if (!playlist || !playlist.entry) {
        throw new Error('Playlist not found or empty');
      }
      
      const entries = Array.isArray(playlist.entry) ? playlist.entry : [playlist.entry];
      const songIndex = entries.findIndex(entry => entry.id === songId);
      
      if (songIndex === -1) {
        throw new Error('Song not found in playlist');
      }
      
      // Remove by index
      await this.request('updatePlaylist', {
        playlistId,
        songIndexToRemove: songIndex
      });
      
      return { success: true };
    } catch (error) {
      throw new Error(`Failed to remove song from playlist: ${error.message}`);
    }
  }
}
