import axios from 'axios';
import crypto from 'crypto';

const PLEX_TV = 'https://plex.tv';
const PLEX_AUTH_APP = 'https://app.plex.tv';
const PLEX_PRODUCT = 'Aurral';
const MUSIC_SECTION_TYPE = 'artist';
const MUSIC_AGENT = 'tv.plex.agents.music';
const MUSIC_SCANNER = 'Plex Music';
const TRACK_TYPE = 10;

interface PlexConnection {
  uri: string;
  local: boolean;
  address: string;
  port: number;
}

interface PlexServer {
  name: string;
  clientIdentifier: string;
  owned: boolean;
  connections: PlexConnection[];
}

export class PlexClient {
  url: string | null;
  token: string | null;
  clientId: string | null;
  _machineIdentifier: string | null;

  constructor(url: string | null, token: string | null, clientId: string | null) {
    this.url = url ? url.replace(/\/+$/, '') : null;
    this.token = token || null;
    this.clientId = clientId || null;
    this._machineIdentifier = null;
  }

  isConfigured(): boolean {
    return !!(this.url && this.token);
  }

  static plexHeaders(clientId: string | null, opts?: { token?: string | null }): Record<string, string> {
    const { token } = opts || {};
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Plex-Product': PLEX_PRODUCT,
      'X-Plex-Client-Identifier': clientId || '',
    };
    if (token) headers['X-Plex-Token'] = token;
    return headers;
  }

  static generateClientId(): string {
    return crypto.randomUUID();
  }

  static async generatePin(clientId: string): Promise<{ id: string; code: string }> {
    const { data } = await axios.post(`${PLEX_TV}/api/v2/pins`, null, {
      params: { strong: true },
      headers: PlexClient.plexHeaders(clientId),
    });
    return { id: data.id, code: data.code };
  }

  static buildAuthUrl(clientId: string, code: string, forwardUrl: string | null): string {
    const params = new URLSearchParams({
      clientID: clientId,
      code,
      'context[device][product]': PLEX_PRODUCT,
    });
    if (forwardUrl) params.set('forwardUrl', forwardUrl);
    return `${PLEX_AUTH_APP}/auth#?${params.toString()}`;
  }

  static async checkPin(pinId: number, code: string, clientId: string): Promise<string | null> {
    const { data } = await axios.get(`${PLEX_TV}/api/v2/pins/${pinId}`, {
      params: { code },
      headers: PlexClient.plexHeaders(clientId),
    });
    return data.authToken || null;
  }

  static async validateToken(token: string, clientId: string): Promise<unknown> {
    try {
      const { data } = await axios.get(`${PLEX_TV}/api/v2/user`, {
        headers: PlexClient.plexHeaders(clientId, { token }),
      });
      return data || null;
    } catch {
      return null;
    }
  }

  static async getResources(
    token: string,
    clientId: string,
  ): Promise<{ servers: PlexServer[]; total: number }> {
    const { data } = await axios.get(`${PLEX_TV}/api/v2/resources`, {
      params: { includeHttps: 1, includeRelay: 1 },
      headers: PlexClient.plexHeaders(clientId, { token }),
    });
    let list: unknown[] = [];
    if (Array.isArray(data)) list = data;
    else if (Array.isArray(data?.MediaContainer?.Device)) list = data.MediaContainer.Device;
    else if (data?.MediaContainer?.Device) list = [data.MediaContainer.Device];

    const servers: PlexServer[] = (list as Array<Record<string, unknown>>)
      .filter((r: Record<string, unknown>) => String(r.provides || '').includes('server'))
      .map((r: Record<string, unknown>) => {
        const rawConns = r.connections || r.Connection || [];
        const conns = Array.isArray(rawConns) ? rawConns : [rawConns];
        return {
          name: String(r.name || ''),
          clientIdentifier: String(r.clientIdentifier || ''),
          owned: r.owned === true || r.owned === '1' || r.owned === 1,
          connections: (conns as Array<Record<string, unknown>>).map((c: Record<string, unknown>) => ({
            uri: String(c.uri || ''),
            local: c.local === true || c.local === '1' || c.local === 1,
            address: String(c.address || ''),
            port: Number(c.port) || 0,
          })),
        };
      });
    console.log(
      `[Plex] getResources: ${list.length} device(s) returned, ${servers.length} provide "server"`,
    );
    return { servers, total: list.length };
  }

  async request(
    path: string,
    { params = {}, method = 'GET', data = null }: { params?: Record<string, unknown>; method?: string; data?: unknown } = {},
  ): Promise<unknown> {
    if (!this.isConfigured()) throw new Error('Plex not configured');
    try {
      const response = await axios({
        method,
        url: `${this.url}${path}`,
        params,
        data,
        headers: PlexClient.plexHeaders(this.clientId, { token: this.token }),
      });
      return response.data;
    } catch (err: unknown) {
      const error = err as { response?: { data?: unknown; status?: number }; message?: string };
      const detail = error.response?.data || error.message;
      console.error(
        `Plex Error [${method} ${path}]:`,
        typeof detail === 'string' ? detail : (error as Error).message,
      );
      throw error;
    }
  }

  async ping(): Promise<Record<string, unknown>> {
    const data = (await this.request('/identity')) as { MediaContainer?: { machineIdentifier?: string } };
    const mc = data?.MediaContainer || {};
    if (mc.machineIdentifier) this._machineIdentifier = mc.machineIdentifier;
    return mc;
  }

  async getMachineIdentifier(): Promise<string | null> {
    if (this._machineIdentifier) return this._machineIdentifier;
    await this.ping();
    return this._machineIdentifier;
  }

  async getLibraries(): Promise<Array<Record<string, unknown>>> {
    const data = (await this.request('/library/sections')) as { MediaContainer?: { Directory?: Array<Record<string, unknown>> } };
    return data?.MediaContainer?.Directory || [];
  }

  async ensureWeeklyFlowLibrary(libraryPath: string): Promise<Record<string, unknown> | null> {
    if (!this.isConfigured()) return null;
    const name = 'Aurral';
    const findExisting = (
      libs: Array<Record<string, unknown>>,
    ): Record<string, unknown> | undefined =>
      libs.find(
        (lib: Record<string, unknown>) =>
          lib.title === name ||
          lib.title === 'Aurral Flow' ||
          (Array.isArray(lib.Location) &&
            (lib.Location as Array<Record<string, unknown>>).some(
              (loc: Record<string, unknown>) => loc.path === libraryPath,
            )),
      );

    const existing = findExisting(await this.getLibraries());
    if (existing) {
      const currentLocations = (
        Array.isArray(existing.Location)
          ? (existing.Location as Array<Record<string, unknown>>).map((loc: Record<string, unknown>) => loc.path).filter(Boolean)
          : []
      ) as unknown[];
      const locationOk = currentLocations.length === 1 && currentLocations[0] === libraryPath;
      const nameOk = existing.title === name;
      if (!locationOk || !nameOk) {
        try {
          await this.editLibrary(existing.key as string, { name, locations: [libraryPath] });
          return findExisting(await this.getLibraries()) || existing;
        } catch (err: unknown) {
          const e = err as { response?: { data?: unknown }; message?: string };
          console.warn(
            '[Plex] Could not update Aurral library:',
            e?.response?.data || (err as Error).message,
          );
        }
      }
      return existing;
    }

    try {
      await this.request('/library/sections', {
        method: 'POST',
        params: {
          name,
          type: MUSIC_SECTION_TYPE,
          agent: MUSIC_AGENT,
          scanner: MUSIC_SCANNER,
          language: 'en-US',
          location: libraryPath,
        },
      });
    } catch (err: unknown) {
      const e = err as { response?: { data?: unknown; status?: number }; message?: string };
      const detail = e?.response?.data || (err as Error).message;
      const status = e?.response?.status;
      throw new Error(
        `Plex rejected library creation (${status || 'no status'}) for path "${libraryPath}": ${
          typeof detail === 'string' ? detail : JSON.stringify(detail)
        }`,
      );
    }

    const created = findExisting(await this.getLibraries());
    if (!created) {
      throw new Error(
        `Plex accepted the request but no "Aurral" library appeared. Verify the Plex server can access the path "${libraryPath}".`,
      );
    }
    return created;
  }

  async scanLibrary(sectionId: string | null): Promise<unknown> {
    if (!this.isConfigured() || sectionId == null) return null;
    try {
      return await this.request(`/library/sections/${sectionId}/refresh`);
    } catch (err: unknown) {
      console.warn('[Plex] scanLibrary failed:', (err as Error)?.message);
      return null;
    }
  }

  async editLibrary(
    sectionId: string,
    { name, locations }: { name?: string; locations?: string[] } = {},
  ): Promise<unknown> {
    const qs = new URLSearchParams();
    qs.set('agent', MUSIC_AGENT);
    if (name) qs.set('name', name);
    for (const loc of locations || []) qs.append('location', loc);
    return this.request(`/library/sections/${sectionId}?${qs.toString()}`, {
      method: 'PUT',
    });
  }

  async getTracks(sectionId: string): Promise<Array<{ ratingKey: string; title: string; artist: string; files: unknown[] }>> {
    const pageSize = 200;
    const out: Array<{ ratingKey: string; title: string; artist: string; files: unknown[] }> = [];
    let start = 0;
    for (;;) {
      const data = (await this.request(`/library/sections/${sectionId}/all`, {
        params: {
          type: TRACK_TYPE,
          'X-Plex-Container-Start': start,
          'X-Plex-Container-Size': pageSize,
        },
      })) as { MediaContainer?: { Metadata?: Array<Record<string, unknown>>; totalSize?: number; size?: number } };
      const mc = data?.MediaContainer || {};
      const items = mc.Metadata || [];
      for (const t of items) {
        const files = (Array.isArray(t.Media) ? t.Media : [])
          .flatMap((m: Record<string, unknown>) =>
            (Array.isArray(m.Part) ? m.Part : []).map((p: Record<string, unknown>) => p.file),
          )
          .filter(Boolean);
        out.push({
          ratingKey: String(t.ratingKey || ''),
          title: String(t.title || ''),
          artist: (t.grandparentTitle as string) || (t.originalTitle as string) || '',
          files,
        });
      }
      const total = Number(mc.totalSize ?? mc.size ?? items.length);
      start += items.length;
      if (items.length === 0 || start >= total) break;
    }
    return out;
  }

  async getPlaylists(): Promise<Array<Record<string, unknown>>> {
    const data = (await this.request('/playlists', {
      params: { playlistType: 'audio' },
    })) as { MediaContainer?: { Metadata?: Array<Record<string, unknown>> } };
    return data?.MediaContainer?.Metadata || [];
  }

  async getPlaylistItems(playlistRatingKey: string): Promise<string[]> {
    const data = (await this.request(`/playlists/${playlistRatingKey}/items`)) as {
      MediaContainer?: { Metadata?: Array<Record<string, unknown>> };
    };
    const items = data?.MediaContainer?.Metadata || [];
    return items.map((i: Record<string, unknown>) => i.ratingKey as string).filter(Boolean);
  }

  _metadataUri(machineId: string, ratingKeys: string | string[]): string {
    const keys = (Array.isArray(ratingKeys) ? ratingKeys : [ratingKeys]).join(',');
    return `server://${machineId}/com.plexapp.plugins.library/library/metadata/${keys}`;
  }

  async createPlaylist(
    title: string,
    ratingKeys: string[] | null,
    replace = false,
  ): Promise<Record<string, unknown> | null> {
    const machineId = await this.getMachineIdentifier();
    if (!machineId) throw new Error('Could not resolve Plex machineIdentifier');

    const existing = (await this.getPlaylists()).find(
      (p: Record<string, unknown>) => p.title === title,
    );

    if (existing && replace) {
      const current = await this.getPlaylistItems(String(existing.ratingKey));
      const desiredSet = new Set((ratingKeys || []).map(String));
      const currentSet = new Set(current.map(String));
      const unchanged =
        desiredSet.size === currentSet.size &&
        [...desiredSet].every((k) => currentSet.has(k));
      if (unchanged) return existing;
      await this.deletePlaylist(String(existing.ratingKey));
    } else if (existing && !replace) {
      if (ratingKeys?.length) {
        await this.addToPlaylist(String(existing.ratingKey), ratingKeys);
      }
      return existing;
    }

    if (!ratingKeys?.length) return null;

    const data = (await this.request('/playlists', {
      method: 'POST',
      params: {
        type: 'audio',
        title,
        smart: 0,
        uri: this._metadataUri(machineId, ratingKeys),
      },
    })) as { MediaContainer?: { Metadata?: Array<Record<string, unknown>> } };
    return data?.MediaContainer?.Metadata?.[0] || null;
  }

  async addToPlaylist(playlistRatingKey: string, ratingKeys: string[]): Promise<unknown> {
    const machineId = await this.getMachineIdentifier();
    if (!machineId) throw new Error('Could not resolve Plex machineIdentifier');
    return this.request(`/playlists/${playlistRatingKey}/items`, {
      method: 'PUT',
      params: { uri: this._metadataUri(machineId, ratingKeys) },
    });
  }

  async deletePlaylist(playlistRatingKey: string): Promise<unknown> {
    return this.request(`/playlists/${playlistRatingKey}`, {
      method: 'DELETE',
    });
  }
}
