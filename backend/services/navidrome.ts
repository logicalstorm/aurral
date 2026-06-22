import axios from 'axios';
import crypto from 'crypto';

const LEGACY_LIBRARY_DIR = 'aurral-weekly-flow';
const PLAYLIST_LIBRARY_NAME = 'Aurral Playlists';
const LEGACY_LIBRARY_NAMES = new Set(['Aurral Weekly Flow']);

function normalizeLibraryPath(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
}

function isLegacyPlaylistLibraryPath(value: unknown): boolean {
  const libraryPath = normalizeLibraryPath(value);
  return libraryPath.endsWith(`/${LEGACY_LIBRARY_DIR}`) || libraryPath === LEGACY_LIBRARY_DIR;
}

export class NavidromeClient {
  url: string | null;
  user: string;
  password: string;

  constructor(url: string, user: string, password: string) {
    this.url = url ? url.replace(/\/+$/, '') : null;
    this.user = user;
    this.password = password;
  }

  isConfigured(): boolean {
    return !!(this.url && this.user && this.password);
  }

  getAuthParams(): Record<string, string> {
    const salt = crypto.randomBytes(6).toString('hex');
    const token = crypto
      .createHash('md5')
      .update(this.password + salt)
      .digest('hex');
    return {
      u: this.user,
      t: token,
      s: salt,
      v: '1.16.1',
      c: 'aurral',
      f: 'json',
    };
  }

  async request(endpoint: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!this.isConfigured()) throw new Error('Navidrome not configured');

    try {
      const response = await axios.get(`${this.url}/rest/${endpoint}`, {
        params: {
          ...this.getAuthParams(),
          ...params,
        },
      });

      if (response.data['subsonic-response']?.status === 'failed') {
        throw new Error(
          response.data['subsonic-response'].error?.message || 'Navidrome request failed',
        );
      }

      return response.data['subsonic-response'];
    } catch (error) {
      console.error(`Navidrome Error [${endpoint}]:`, (error as Error).message);
      throw error;
    }
  }

  async ping(): Promise<Record<string, unknown>> {
    return this.request('ping');
  }

  async findSong(title: string, artist: string): Promise<Record<string, unknown> | null> {
    const data = await this.request('search3', {
      query: `${artist} ${title}`,
      songCount: 5,
      artistCount: 0,
      albumCount: 0,
    });

    const songs = (((data.searchResult3 as Record<string, unknown>)?.song as unknown) || []) as unknown[];
    const match = songs.find(
      (s: unknown): boolean =>
        String((s as Record<string, unknown>).title || '').toLowerCase() === title.toLowerCase() &&
        String((s as Record<string, unknown>).artist || '').toLowerCase() === artist.toLowerCase(),
    );

    return (match as Record<string, unknown>) || null;
  }

  async searchSongsByArtist(artistName: string, limit: number = 5): Promise<Array<{ id: string; title: string; album: string; duration: number }>> {
    const data = await this.request('search3', {
      query: artistName,
      songCount: limit,
      artistCount: 0,
      albumCount: 0,
    });
    const songs = (((data.searchResult3 as Record<string, unknown>)?.song as unknown) || []) as unknown[];
    const list = Array.isArray(songs) ? songs : [songs];
    return list
      .filter((s: unknown): boolean => {
        const rec = s as Record<string, unknown>;
        return Boolean(rec.artist && String(rec.artist).toLowerCase() === artistName.toLowerCase());
      })
      .slice(0, limit)
      .map((s: unknown): { id: string; title: string; album: string; duration: number } => {
        const rec = s as Record<string, unknown>;
        return {
          id: String(rec.id || ''),
          title: String(rec.title || ''),
          album: String(rec.album || ''),
          duration: rec.duration != null ? Number(rec.duration) : 0,
        };
      });
  }

  getStreamUrl(songId: string): string {
    if (!this.isConfigured()) throw new Error('Navidrome not configured');
    const params = new URLSearchParams(this.getAuthParams());
    params.delete('f');
    return `${this.url}/rest/stream?id=${encodeURIComponent(songId)}&${params.toString()}`;
  }

  async getPlaylists(): Promise<unknown[]> {
    const data = await this.request('getPlaylists');
    return ((data.playlists as Record<string, unknown>)?.playlist as unknown[]) || [];
  }

  async createPlaylist(name: string, songIds: string[], replace: boolean = false): Promise<Record<string, unknown> | null> {
    if (!songIds || songIds.length === 0) {
      if (replace) {
        const playlists = await this.getPlaylists();
        const existing = (playlists as Array<Record<string, unknown>>).find((p: Record<string, unknown>) => p.name === name);
        if (existing) {
          await this.deletePlaylist(String(existing.id));
        }
      }
      return null;
    }

    const playlists = await this.getPlaylists();
    const existing = (playlists as Array<Record<string, unknown>>).find((p: Record<string, unknown>) => p.name === name);

    if (existing) {
      if (replace) {
        await this.deletePlaylist(String(existing.id));
      } else {
        const data = await this.request('updatePlaylist', {
          playlistId: existing.id,
          songIdToAdd: songIds,
        });
        return data.playlist as Record<string, unknown> || existing;
      }
    }

    const data = await this.request('createPlaylist', {
      name,
      songId: songIds,
    });

    return data.playlist as Record<string, unknown>;
  }

  async deletePlaylist(id: string): Promise<Record<string, unknown>> {
    return this.request('deletePlaylist', { id });
  }

  async addToPlaylist(playlistId: string, songId: string): Promise<Record<string, unknown>> {
    return this.request('updatePlaylist', {
      playlistId,
      songIdToAdd: songId,
    });
  }

  async removeFromPlaylist(playlistId: string, songId: string): Promise<{ success: boolean }> {
    try {
      const playlistData = await this.request('getPlaylist', {
        id: playlistId,
      });
      const playlist = playlistData.playlist as Record<string, unknown>;

      if (!playlist || !playlist.entry) {
        throw new Error('Playlist not found or empty');
      }

      const entries = (Array.isArray(playlist.entry) ? playlist.entry : [playlist.entry]) as Array<Record<string, unknown>>;
      const songIndex = entries.findIndex((entry: Record<string, unknown>) => entry.id === songId);

      if (songIndex === -1) {
        throw new Error('Song not found in playlist');
      }

      await this.request('updatePlaylist', {
        playlistId,
        songIndexToRemove: songIndex,
      });

      return { success: true };
    } catch (error) {
      throw new Error(`Failed to remove song from playlist: ${(error as Error).message}`);
    }
  }

  async _nativeLogin(): Promise<string> {
    if (!this.isConfigured()) throw new Error('Navidrome not configured');
    const { data } = await axios.post(
      `${this.url}/auth/login`,
      { username: this.user, password: this.password },
      { headers: { 'Content-Type': 'application/json' } },
    );
    const token = data.token || data.Token;
    if (!token) throw new Error('No token in login response');
    return token;
  }

  async _nativeRequest(method: string, path: string, body: unknown = undefined): Promise<unknown> {
    let token = await this._nativeLogin();
    const base = this.url;
    const url = path.startsWith('/') ? `${base}${path}` : `${base}/api/${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-ND-Authorization': `Bearer ${token}`,
    };
    let response;
    if (method === 'GET') {
      response = await axios.get(url, { headers });
    } else if (method === 'POST') {
      response = await axios.post(url, body, { headers });
    } else if (method === 'PUT') {
      response = await axios.put(url, body, { headers });
    } else {
      throw new Error(`Unsupported method: ${method}`);
    }
    const newToken = response.headers['x-nd-authorization'];
    if (newToken) token = newToken;
    return response.data;
  }

  async getLibraries(): Promise<unknown> {
    return this._nativeRequest('GET', '/api/library');
  }

  async createLibrary(name: string, path: string): Promise<unknown> {
    return this._nativeRequest('POST', '/api/library', { name, path });
  }

  async updateLibrary(id: string, payload: Record<string, unknown>): Promise<unknown> {
    return this._nativeRequest('PUT', `/api/library/${id}`, payload);
  }

  async scanLibrary(): Promise<Record<string, unknown> | null> {
    if (!this.isConfigured()) return null;
    try {
      return await this.request('startScan');
    } catch (err) {
      console.warn('[Navidrome] scanLibrary failed:', (err as Error)?.message);
      return null;
    }
  }

  async ensureWeeklyFlowLibrary(libraryPath: string): Promise<Record<string, unknown> | null> {
    if (!this.isConfigured()) return null;
    const name = PLAYLIST_LIBRARY_NAME;
    const normalizedPath = normalizeLibraryPath(libraryPath);
    try {
      const libs = await this.getLibraries();
      const list = Array.isArray(libs) ? libs : [];
      const byPath = list.find((lib: Record<string, unknown>) => normalizeLibraryPath(lib.path as string) === normalizedPath) as Record<string, unknown> | undefined;
      if (byPath) {
        if (byPath.name !== name) {
          return this.updateLibrary(String(byPath.id), {
            ...byPath,
            name,
            path: normalizedPath,
          }) as Promise<Record<string, unknown>>;
        }
        return byPath;
      }

      const byName = list.find((lib: Record<string, unknown>) => lib.name === name || LEGACY_LIBRARY_NAMES.has(lib.name as string)) as Record<string, unknown> | undefined;
      if (byName) {
        if (normalizeLibraryPath(byName.path as string) !== normalizedPath) {
          return this.updateLibrary(String(byName.id), {
            ...byName,
            name,
            path: normalizedPath,
          }) as Promise<Record<string, unknown>>;
        }
        return byName;
      }

      const legacy = list.find((lib: Record<string, unknown>) => isLegacyPlaylistLibraryPath(lib.path as string)) as Record<string, unknown> | undefined;
      if (legacy) {
        return this.updateLibrary(String(legacy.id), {
          ...legacy,
          name,
          path: normalizedPath,
        }) as Promise<Record<string, unknown>>;
      }

      return this.createLibrary(name, normalizedPath) as Promise<Record<string, unknown>>;
    } catch (err) {
      console.warn(
        '[Navidrome] ensureWeeklyFlowLibrary failed:',
         
        (err as any)?.response?.data?.error || (err as Error).message,
      );
      return null;
    }
  }
}
