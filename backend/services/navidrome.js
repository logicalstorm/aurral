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
    // Navidrome/Subsonic search is sometimes fuzzy, we need to be careful
    const data = await this.request('search3', {
      query: `${artist} ${title}`,
      songCount: 5,
      artistCount: 0,
      albumCount: 0
    });

    const songs = data.searchResult3?.song || [];
    // Strict filtering
    const match = songs.find(s => 
      s.title.toLowerCase() === title.toLowerCase() && 
      s.artist.toLowerCase() === artist.toLowerCase()
    );

    return match || null;
  }
  
  async getPlaylists() {
    const data = await this.request('getPlaylists');
    return data.playlists?.playlist || [];
  }

  async createPlaylist(name, songIds) {
    if (!songIds || songIds.length === 0) return null;

    // Check if exists first to update instead of duplicate
    const playlists = await this.getPlaylists();
    const existing = playlists.find(p => p.name === name);

    if (existing) {
      // Update existing: We usually want to replace contents for "Weekly" lists
      // Subsonic doesn't have a "replace" easily, so we usually delete and recreate
      // OR we can clear it. Let's delete and recreate to be safe and clean.
      await this.deletePlaylist(existing.id);
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
}
