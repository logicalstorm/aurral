import axios from 'axios';
import http from 'http';
import https from 'https';
import { dbOps } from '../config/db-helpers.js';
import { logger } from './logger.js';

interface LidarrConfig {
  url: string;
  apiKey: string;
  insecure: boolean;
  timeoutMs: number;
  circuitDisabled: boolean;
}

interface CacheEntry<T> {
  data: T;
  at: number;
}

interface ArtistMbidCacheEntry {
  artist: unknown;
  at: number;
}

interface LidarrPreferenceError extends Error {
  statusCode: number;
  field: string;
  code: string;
}

interface RequestOptions {
  bypassCircuit?: boolean;
}

interface ArtistAddOptions {
  rootFolderPath?: string;
  qualityProfileId?: number;
  savedRootFolderPath?: string;
  savedQualityProfileId?: number;
  albumOnly?: boolean;
  monitorOption?: string;
  monitor?: string;
  albumMbid?: string;
  metadataProfileId?: number;
  tagId?: number;
}

interface AddAlbumOptions {
  monitored?: boolean;
  triggerSearch?: boolean;
}

const CIRCUIT_COOLDOWN_MS = 60000;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const LIDARR_MAX_CONCURRENT = 12;
const LIDARR_LIST_CACHE_MS = 30000;
const LIDARR_ARTIST_ALBUM_CACHE_MAX = 10;
const LIDARR_RETRY_ATTEMPTS = 2;
const LIDARR_RETRY_DELAY_MS = 800;
const LIDARR_STATUS_CACHE_MS = 10000;
const LIDARR_ARTIST_INDEX_TTL_MS = 15 * 60 * 1000;
const VALID_MONITOR_OPTIONS = new Set([
  'none',
  'existing',
  'all',
  'future',
  'missing',
  'latest',
  'first',
]);

function normalizeRootFolderPath(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeProfileId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.trunc(parsed);
}

function normalizeMonitorOption(value: unknown): string {
  const option = String(value || 'none').trim();
  return VALID_MONITOR_OPTIONS.has(option) ? option : 'none';
}

function getArtistMonitoringPayload(
  monitorOption: unknown,
  { forceArtistMonitored = true }: { forceArtistMonitored?: boolean } = {},
): { option: string; monitored: boolean; monitor: string; monitorNewItems: string } {
  const option = normalizeMonitorOption(monitorOption);
  const monitored = forceArtistMonitored || option !== 'none';
  const monitorNewItems = option === 'all' || option === 'future' ? 'all' : 'none';

  return {
    option,
    monitored,
    monitor: option,
    monitorNewItems,
  };
}

function mapTags(tags: unknown): Array<{ id: number; label: string }> {
  return Array.isArray(tags)
    ? tags
        .filter(
          (tag: Record<string, unknown>) =>
            normalizeProfileId(tag?.id) !== null &&
            typeof tag?.label === 'string' &&
            (tag.label as string).trim(),
        )
        .map((tag: Record<string, unknown>) => ({
          ...tag,
          id: normalizeProfileId(tag.id) as number,
          label: (tag.label as string).trim(),
        }))
    : [];
}

function createPreferenceError(
  statusCode: number,
  field: string,
  message: string,
  code: string,
): LidarrPreferenceError {
  const error = new Error(message) as LidarrPreferenceError;
  error.statusCode = statusCode;
  error.field = field;
  error.code = code;
  return error;
}

function mapRootFolders(rootFolders: unknown): Array<Record<string, unknown>> {
  return Array.isArray(rootFolders)
    ? rootFolders
        .filter((item: Record<string, unknown>) => normalizeRootFolderPath(item?.path))
        .map((item: Record<string, unknown>) => ({
          ...item,
          path: normalizeRootFolderPath(item.path),
        }))
    : [];
}

function mapQualityProfiles(qualityProfiles: unknown): Array<Record<string, unknown>> {
  return Array.isArray(qualityProfiles)
    ? qualityProfiles
        .filter((profile: Record<string, unknown>) => normalizeProfileId(profile?.id) !== null)
        .map((profile: Record<string, unknown>) => ({
          ...profile,
          id: normalizeProfileId(profile.id),
        }))
    : [];
}

function findRootFolder(
  rootFolders: Array<Record<string, unknown>>,
  rootFolderPath: unknown,
): Record<string, unknown> | null {
  const normalizedPath = normalizeRootFolderPath(rootFolderPath);
  if (!normalizedPath) return null;
  return (
    rootFolders.find((folder: Record<string, unknown>) => normalizeRootFolderPath(folder?.path) === normalizedPath) || null
  );
}

function findQualityProfile(
  qualityProfiles: Array<Record<string, unknown>>,
  qualityProfileId: unknown,
): Record<string, unknown> | null {
  const normalizedId = normalizeProfileId(qualityProfileId);
  if (normalizedId === null) return null;
  return (
    qualityProfiles.find((profile: Record<string, unknown>) => normalizeProfileId(profile?.id) === normalizedId) || null
  );
}

export class LidarrClient {
  private config: LidarrConfig = {
    url: 'http://localhost:8686',
    apiKey: '',
    insecure: false,
    timeoutMs: 30000,
    circuitDisabled: false,
  };
  private apiPath: string = '/api/v1';
  private _circuitOpen: boolean = false;
  private _circuitOpenedAt: number = 0;
  private _circuitFailures: number = 0;
  private _lastCircuitFailureAt: number = 0;
  private _concurrent: number = 0;
  private _waitQueue: Array<(value?: unknown) => void> = [];
  private _artistListCache: CacheEntry<unknown[]> | null = null;
  private _artistByMbidCache: Map<string, ArtistMbidCacheEntry> = new Map();
  private _artistByMbidInflight: Map<string, Promise<unknown>> = new Map();
  private _albumCache: Map<string, CacheEntry<unknown>> = new Map();
  private _statusCache: Map<string, CacheEntry<unknown>> = new Map();
  private _httpAgent: http.Agent = new http.Agent({
    keepAlive: true,
    maxSockets: LIDARR_MAX_CONCURRENT,
    maxFreeSockets: 2,
    timeout: 60000,
  });
  private _httpsAgent: https.Agent = new https.Agent({
    keepAlive: true,
    maxSockets: LIDARR_MAX_CONCURRENT,
    maxFreeSockets: 2,
    timeout: 60000,
  });
  private _httpsInsecureAgent: https.Agent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
    maxSockets: LIDARR_MAX_CONCURRENT,
    maxFreeSockets: 2,
    timeout: 60000,
  });
  public _holdConfig?: boolean;

  constructor() {
    this.updateConfig();
  }

  _setArtistByMbidCacheEntry(mbid: unknown, artist: unknown): void {
    const normalizedMbid = String(mbid || '').trim();
    if (!normalizedMbid) return;
    this._artistByMbidCache.set(normalizedMbid, {
      artist: artist || null,
      at: Date.now(),
    });
  }

  _getArtistByMbidCacheEntry(mbid: unknown): unknown | undefined {
    const normalizedMbid = String(mbid || '').trim();
    if (!normalizedMbid) return undefined;
    const cached = this._artistByMbidCache.get(normalizedMbid);
    if (!cached) return undefined;
    if (Date.now() - cached.at >= LIDARR_ARTIST_INDEX_TTL_MS) {
      this._artistByMbidCache.delete(normalizedMbid);
      return undefined;
    }
    return cached.artist;
  }

  _populateArtistIndexes(artists: unknown): Set<string> {
    const list = Array.isArray(artists) ? artists : [];
    const seenMbids: Set<string> = new Set();
    for (const artist of list) {
      const mbid = String(artist?.foreignArtistId || '').trim();
      if (!mbid) continue;
      seenMbids.add(mbid);
      this._setArtistByMbidCacheEntry(mbid, artist);
    }
    return seenMbids;
  }

  _invalidateArtistIndexes() {
    this._artistByMbidCache.clear();
    this._artistByMbidInflight.clear();
  }

  _acquireSlot() {
    if (this._concurrent < LIDARR_MAX_CONCURRENT) {
      this._concurrent++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this._waitQueue.push(resolve);
    });
  }

  _releaseSlot() {
    this._concurrent--;
    if (this._waitQueue.length > 0) {
      this._concurrent++;
      const next = this._waitQueue.shift();
      if (next) next();
    }
  }

  _registerCircuitFailure() {
    const now = Date.now();
    if (this._lastCircuitFailureAt && now - this._lastCircuitFailureAt > CIRCUIT_COOLDOWN_MS) {
      this._circuitFailures = 0;
    }
    this._lastCircuitFailureAt = now;
    this._circuitFailures += 1;
    if (this._circuitFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      this._circuitOpen = true;
      this._circuitOpenedAt = now;
    }
  }

  _resetCircuitState() {
    this._circuitFailures = 0;
    this._lastCircuitFailureAt = 0;
    this._circuitOpen = false;
    this._circuitOpenedAt = 0;
  }

  updateConfig() {
    if (this._holdConfig) {
      return;
    }
    const previousConfig = this.config;
    const settings = dbOps.getSettings() as Record<string, unknown>;
    const dbConfig = ((settings.integrations as Record<string, unknown> | undefined)?.lidarr as Record<string, unknown>) || {};
    const urlRaw: unknown = dbConfig.url || process.env.LIDARR_URL || 'http://localhost:8686';
    const url: string = String(urlRaw).replace(/\/+$/, '');

    const insecure =
      dbConfig.insecure === true ||
      process.env.LIDARR_INSECURE === 'true' ||
      process.env.LIDARR_INSECURE === '1';

    const envTimeoutMs = Number(process.env.LIDARR_TIMEOUT_MS);
    const timeoutMs: number = Number.isFinite(envTimeoutMs) && envTimeoutMs > 0 ? envTimeoutMs : 30000;

    const circuitDisabled =
      process.env.LIDARR_CIRCUIT_DISABLED === 'true' || process.env.LIDARR_CIRCUIT_DISABLED === '1';

    const newConfig: LidarrConfig = {
      url: url,
      apiKey: String(dbConfig.apiKey || process.env.LIDARR_API_KEY || '').trim(),
      insecure: !!insecure,
      timeoutMs,
      circuitDisabled,
    };

    const didConfigChange =
      !previousConfig ||
      previousConfig.url !== newConfig.url ||
      previousConfig.apiKey !== newConfig.apiKey ||
      previousConfig.insecure !== newConfig.insecure ||
      previousConfig.timeoutMs !== newConfig.timeoutMs ||
      previousConfig.circuitDisabled !== newConfig.circuitDisabled;

    this.config = newConfig;
    if (didConfigChange) {
      this._artistListCache = null;
      this._invalidateArtistIndexes();
      this._albumCache = new Map();
      this._statusCache.clear();
    }
  }

  getConfig() {
    this.updateConfig();
    return this.config;
  }

  isConfigured(skipConfigUpdate = false) {
    if (!skipConfigUpdate) {
      this.updateConfig();
    }
    return !!this.config?.apiKey?.trim();
  }

  getAuthHeaders() {
    if (!this.config.apiKey) {
      return {};
    }
    return {
      'X-Api-Key': this.config.apiKey.trim(),
    };
  }

  async request(
    endpoint: string,
    method = 'GET',
    data: unknown = null,
    skipConfigUpdate = false,
    options: RequestOptions = {},
  ): Promise<unknown> {
    if (!skipConfigUpdate) {
      this.updateConfig();
    }

    if (!this.isConfigured(skipConfigUpdate)) {
      throw new Error('Lidarr API key not configured');
    }

    const now = Date.now();
    if (method === 'GET' && endpoint === '/artist') {
      if (this._artistListCache && now - this._artistListCache.at < LIDARR_LIST_CACHE_MS) {
        return this._artistListCache.data;
      }
    }
    if (method === 'GET' && (endpoint === '/album' || endpoint.startsWith('/album?'))) {
      const cached = this._albumCache.get(endpoint);
      if (cached && now - cached.at < LIDARR_LIST_CACHE_MS) {
        return cached.data;
      }
    }

    const isStatusRequest =
      method === 'GET' &&
      (endpoint === '/queue' || endpoint === '/command' || endpoint.startsWith('/history'));
    if (isStatusRequest) {
      const cached = this._statusCache.get(endpoint);
      if (cached && now - cached.at < LIDARR_STATUS_CACHE_MS) {
        return cached.data;
      }
      if (cached) {
        this._statusCache.delete(endpoint);
      }
    }

    const bypassCircuit = options?.bypassCircuit === true;
    if (!this.config.circuitDisabled && this._circuitOpen && !bypassCircuit) {
      if (now - this._circuitOpenedAt < CIRCUIT_COOLDOWN_MS) {
        throw new Error('Lidarr unavailable (circuit open). Will retry after cooldown.');
      }
      this._resetCircuitState();
    }
    if (this.config.circuitDisabled && this._circuitOpen) {
      this._resetCircuitState();
    }

    const authHeaders = this.getAuthHeaders();

    if (
      method !== 'GET' &&
      (endpoint === '/artist' ||
        endpoint.startsWith('/artist/') ||
        endpoint === '/album' ||
        endpoint.startsWith('/album/'))
    ) {
      this._artistListCache = null;
      this._invalidateArtistIndexes();
      this._albumCache = new Map();
    }
    if (method !== 'GET' && endpoint.startsWith('/command')) {
      this._statusCache.delete('/command');
    }

    for (let attempt = 1; attempt <= LIDARR_RETRY_ATTEMPTS; attempt++) {
      try {
        await this._acquireSlot();
        try {
          const fullUrl = `${this.config.url}${this.apiPath}${endpoint}`;

          const isHttps = fullUrl.startsWith('https:') || fullUrl.startsWith('HTTPS:');

          const requestConfig: Record<string, unknown> = {
            method,
            url: fullUrl,
            headers: {
              ...authHeaders,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            timeout: this.config.timeoutMs,
            httpAgent: this._httpAgent,
            httpsAgent:
              isHttps && this.config.insecure ? this._httpsInsecureAgent : this._httpsAgent,
            validateStatus: function (status: number) {
              return status < 500;
            },
          };

          if (data !== null && data !== undefined) {
            requestConfig.data = data;
          }

          const response = await axios(requestConfig as Record<string, unknown>);

          if (response.status >= 400) {
            throw {
              response: {
                status: response.status,
                statusText: response.statusText,
                data: response.data,
                headers: response.headers,
              },
            };
          }

          if (method === 'GET' && endpoint === '/artist') {
            this._artistListCache = { data: response.data, at: Date.now() };
            this._populateArtistIndexes(response.data);
          }
          if (method === 'GET' && (endpoint === '/album' || endpoint.startsWith('/album?'))) {
            if (this._albumCache.size >= LIDARR_ARTIST_ALBUM_CACHE_MAX) {
              const oldestKey = this._albumCache.keys().next().value;
              if (oldestKey !== undefined) {
                this._albumCache.delete(oldestKey);
              }
            }
            this._albumCache.set(endpoint, { data: response.data, at: Date.now() });
          }
          if (isStatusRequest) {
            this._statusCache.set(endpoint, {
              data: response.data,
              at: Date.now(),
            });
          }

          this._resetCircuitState();
          return response.data;
        } finally {
          this._releaseSlot();
        }
      } catch (raw: unknown) {
        const error = (raw as Record<string, unknown> | null) ?? {};
        const errorResponse = error.response as Record<string, unknown> | undefined;
        const status = errorResponse?.status as number | undefined;
        const msg = error.message != null ? String(error.message) : String(raw);
        const isTimeout = error.code === 'ECONNABORTED' || msg.toLowerCase().includes('timeout');
        const isNoResponse = !errorResponse && ((error.request as unknown) || isTimeout);
        const isTransientStatus = typeof status === 'number' && status >= 500;

        if (attempt < LIDARR_RETRY_ATTEMPTS && (isNoResponse || isTransientStatus)) {
          await new Promise((resolve) => setTimeout(resolve, LIDARR_RETRY_DELAY_MS));
          continue;
        }

        if (!this.config.circuitDisabled && (isNoResponse || isTransientStatus)) {
          this._registerCircuitFailure();
        }

        if (errorResponse) {
          const statusText = errorResponse.statusText as string | undefined;
          const responseData = errorResponse.data as unknown;

          const isAlbum404 = status === 404 && endpoint.includes('/album/');
          if (!isAlbum404) {
            console.error(`Lidarr API error (${status}):`, {
              url: `${this.config.url}${this.apiPath}${endpoint}`,
              method: method,
              status: status,
              statusText: statusText,
              responseData: responseData,
              responseHeaders: errorResponse.headers,
            });
          }

          let errorMsg: string = (statusText as string) || 'Unknown error';
          let errorDetails = '';

          if (typeof responseData === 'string') {
            errorMsg = responseData;
            errorDetails = responseData;
          } else if (responseData) {
            errorMsg =
              (responseData as Record<string, unknown>).message as string ||
              (responseData as Record<string, unknown>).error as string ||
              (responseData as Record<string, unknown>).title as string ||
              (responseData as Record<string, unknown>).detail as string ||
              (typeof responseData === 'object'
                ? JSON.stringify(responseData)
                : String(responseData));
            errorDetails = JSON.stringify(responseData, null, 2);
          }

          const responseText = typeof responseData === 'string' ? responseData : errorMsg;
          const responseTextLower = responseText?.toLowerCase?.();
          const isLidarrSkyhookRefused =
            typeof status === 'number' &&
            status >= 500 &&
            responseTextLower &&
            responseTextLower.includes('api.lidarr.audio') &&
            (responseTextLower.includes('connection refused') ||
              responseTextLower.includes('connect') ||
              responseTextLower.includes('econnrefused'));
          if (isLidarrSkyhookRefused) {
            throw new Error(
              'Lidarr cannot reach api.lidarr.audio from its container. Check Lidarr outbound internet/DNS or proxy settings.',
            );
          }
          if (status === 400) {
            throw new Error(
              `Lidarr API returned 400 Bad Request: ${errorMsg}${
                errorDetails ? `\n\nFull Response: ${errorDetails}` : ''
              }`,
            );
          }
          if (status === 401) {
            throw new Error(`Lidarr API authentication failed. Check your API key.`);
          }
          if (status === 404) {
            const isAlbumEndpoint = endpoint.includes('/album/');
            if (isAlbumEndpoint) {
              return null;
            }
            throw new Error(
              `Lidarr endpoint not found: ${endpoint}. Check if Lidarr is running and the API version is correct.`,
            );
          }
          throw new Error(
            `Lidarr API error: ${status} - ${
              (responseData as Record<string, unknown>)?.message || (responseData as Record<string, unknown>)?.error || statusText || 'Unknown error'
            }`,
          );
        } else if (error.request) {
          console.error('Lidarr API request failed - no response:', msg);
          throw new Error(
            `Cannot connect to Lidarr at ${this.config.url}. Check if Lidarr is running and the URL is correct.`,
          );
        } else {
          console.error('Lidarr API error:', msg);
          throw raw instanceof Error ? raw : new Error(msg);
        }
      }
    }
  }

  async testConnection(skipConfigUpdate = false) {
    if (!skipConfigUpdate) {
      this.updateConfig();
    }

    if (!this.isConfigured(skipConfigUpdate)) {
      return { connected: false, error: 'Lidarr not configured' };
    }

    const apiPaths = ['/api/v1', '/api'];

    for (const apiPath of apiPaths) {
      this.apiPath = apiPath;

      try {
        try {
          const rootFolders = await this.request('/rootFolder', 'GET', null, skipConfigUpdate, {
            bypassCircuit: true,
          });
          return {
            connected: true,
            version: 'connected',
            instanceName: 'Lidarr',
            rootFoldersCount: Array.isArray(rootFolders) ? rootFolders.length : 0,
            apiPath: apiPath,
          };
        } catch (rootFolderError: unknown) {
          const rootErr = rootFolderError as Error;
          if (rootErr.message.includes('404') || rootErr.message.includes('400')) {
            try {
              const statusResult = await this.request('/system/status', 'GET', null, skipConfigUpdate, {
                bypassCircuit: true,
              }) as Record<string, unknown>;
              return {
                connected: true,
                version: statusResult.version || 'unknown',
                instanceName: statusResult.instanceName || 'Lidarr',
                apiPath: apiPath,
              };
            } catch {
              if (apiPath === '/api/v1' && apiPaths.length > 1) {
                continue;
              }
              throw rootFolderError;
            }
          }
          if (apiPath === '/api/v1' && apiPaths.length > 1) {
            continue;
          }
          throw rootFolderError;
        }
      } catch (error: unknown) {
        if (apiPath === apiPaths[apiPaths.length - 1]) {
          const err = error as Record<string, unknown>;
          const errorMessage = (err.message as string) || 'Unknown error';
          const errResponse = err.response as Record<string, unknown> | undefined;
          const errorDetails = errResponse?.data
            ? typeof errResponse.data === 'string'
              ? errResponse.data
              : JSON.stringify(errResponse.data, null, 2)
            : '';

          const fullUrl = `${this.config.url}${apiPath}/rootFolder`;

          return {
            connected: false,
            error: errorMessage,
            details: errorDetails,
            url: this.config.url,
            fullUrl: fullUrl,
            statusCode: errResponse?.status,
            apiPath: apiPath,
            responseHeaders: errResponse?.headers,
          };
        }
        continue;
      }
    }

    return {
      connected: false,
      error: 'Failed to connect with any API path',
      url: this.config.url,
    };
  }

  async getRootFolders() {
    return this.request('/rootFolder');
  }

  async getTags(skipConfigUpdate = false) {
    return this.request('/tag', 'GET', null, skipConfigUpdate);
  }

  getArtistAddFallbacks({
    rootFolders,
    qualityProfiles,
    settings,
  }: {
    rootFolders?: unknown[];
    qualityProfiles?: unknown[];
    settings?: Record<string, unknown>;
  } = {}) {
    const safeRootFolders = mapRootFolders(rootFolders);
    const safeQualityProfiles = mapQualityProfiles(qualityProfiles);
    const currentSettings = (settings || dbOps.getSettings()) as Record<string, unknown>;

    const legacyRootFolderPath = normalizeRootFolderPath(currentSettings.rootFolderPath);
    const lidarrSettings = ((currentSettings.integrations as Record<string, unknown> | undefined)?.lidarr) as Record<string, unknown> | undefined;
    const legacyQualityProfileId = normalizeProfileId(lidarrSettings?.qualityProfileId);

    const fallbackRootFolder =
      findRootFolder(safeRootFolders, legacyRootFolderPath) || safeRootFolders[0];
    const fallbackQualityProfile =
      findQualityProfile(safeQualityProfiles, legacyQualityProfileId) || safeQualityProfiles[0];

    return {
      rootFolderPath: fallbackRootFolder?.path || null,
      qualityProfileId: fallbackQualityProfile?.id ?? null,
    };
  }

  async getArtistAddPreferenceSummary(user: Record<string, unknown> | null = null) {
    const settings = dbOps.getSettings() as Record<string, unknown>;
    const savedTagId = normalizeProfileId(
      ((settings.integrations as Record<string, unknown> | undefined)?.lidarr as Record<string, unknown> | undefined)?.tagId,
    );

    if (!this.isConfigured()) {
      return {
        configured: false,
        rootFolders: [],
        qualityProfiles: [],
        tags: [],
        savedDefaults: {
          rootFolderPath: normalizeRootFolderPath(user?.lidarrRootFolderPath),
          qualityProfileId: normalizeProfileId(user?.lidarrQualityProfileId),
          tagId: savedTagId,
        },
        fallbacks: {
          rootFolderPath: null,
          qualityProfileId: null,
          tagId: savedTagId,
        },
      };
    }

    const [rootFoldersRaw, qualityProfilesRaw, tagsRaw] = await Promise.all([
      this.getRootFolders(),
      this.getQualityProfiles(),
      this.getTags(),
    ]);
    const rootFolders = mapRootFolders(rootFoldersRaw);
    const qualityProfiles = mapQualityProfiles(qualityProfilesRaw);
    const tags = mapTags(tagsRaw);

    return {
      configured: true,
      rootFolders: rootFolders.map((folder) => ({ path: folder.path })),
      qualityProfiles: qualityProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name || `Profile ${profile.id}`,
      })),
      tags: tags.map((tag) => ({
        id: tag.id,
        label: tag.label,
      })),
      savedDefaults: {
        rootFolderPath: normalizeRootFolderPath(user?.lidarrRootFolderPath),
        qualityProfileId: normalizeProfileId(user?.lidarrQualityProfileId),
        tagId: savedTagId,
      },
      fallbacks: {
        ...this.getArtistAddFallbacks({
          rootFolders,
          qualityProfiles,
        }),
        tagId: savedTagId,
      },
    };
  }

  async resolveArtistAddConfiguration(options: Record<string, unknown> = {}) {
    const rootFolders = mapRootFolders(options.rootFolders || (await this.getRootFolders()));
    if (rootFolders.length === 0) {
      throw new Error('No root folders configured in Lidarr');
    }

    const qualityProfiles = mapQualityProfiles(
      options.qualityProfiles || (await this.getQualityProfiles()),
    );
    if (qualityProfiles.length === 0) {
      throw new Error('No quality profiles configured in Lidarr');
    }

    const fallbacks = this.getArtistAddFallbacks({
      rootFolders,
      qualityProfiles,
      settings: options.settings as Record<string, unknown>,
    });

    const requestedRootFolderPath = normalizeRootFolderPath(options.requestRootFolderPath);
    const requestedQualityProfileId = normalizeProfileId(options.requestQualityProfileId);
    const savedRootFolderPath = normalizeRootFolderPath(options.savedRootFolderPath);
    const savedQualityProfileId = normalizeProfileId(options.savedQualityProfileId);

    let resolvedRootFolderPath = fallbacks.rootFolderPath;
    let resolvedQualityProfileId = fallbacks.qualityProfileId;

    if (requestedRootFolderPath) {
      const requestRootFolder = findRootFolder(rootFolders, requestedRootFolderPath);
      if (!requestRootFolder) {
        throw createPreferenceError(
          400,
          'rootFolderPath',
          `Unknown Lidarr root folder: ${requestedRootFolderPath}`,
          'INVALID_ROOT_FOLDER_PATH',
        );
      }
      resolvedRootFolderPath = requestRootFolder.path as string;
    } else if (savedRootFolderPath) {
      const savedRootFolder = findRootFolder(rootFolders, savedRootFolderPath);
      if (!savedRootFolder) {
        throw createPreferenceError(
          409,
          'rootFolderPath',
          `Your saved Lidarr root folder no longer exists: ${savedRootFolderPath}. Update your Library Defaults or use Customize.`,
          'STALE_ROOT_FOLDER_PATH',
        );
      }
      resolvedRootFolderPath = savedRootFolder.path as string;
    }

    if (requestedQualityProfileId !== null) {
      const requestQualityProfile = findQualityProfile(qualityProfiles, requestedQualityProfileId);
      if (!requestQualityProfile) {
        throw createPreferenceError(
          400,
          'qualityProfileId',
          `Unknown Lidarr quality profile: ${requestedQualityProfileId}`,
          'INVALID_QUALITY_PROFILE_ID',
        );
      }
      resolvedQualityProfileId = requestQualityProfile.id as number;
    } else if (savedQualityProfileId !== null) {
      const savedQualityProfile = findQualityProfile(qualityProfiles, savedQualityProfileId);
      if (!savedQualityProfile) {
        throw createPreferenceError(
          409,
          'qualityProfileId',
          `Your saved Lidarr quality profile no longer exists: ${savedQualityProfileId}. Update your Library Defaults or use Customize.`,
          'STALE_QUALITY_PROFILE_ID',
        );
      }
      resolvedQualityProfileId = savedQualityProfile.id as number;
    }

    return {
      rootFolders,
      qualityProfiles,
      fallbacks,
      resolved: {
        rootFolderPath: resolvedRootFolderPath,
        qualityProfileId: resolvedQualityProfileId,
      },
    };
  }

  async addArtist(mbid: string, artistName: string, options: ArtistAddOptions = {}) {
    const settings = dbOps.getSettings() as Record<string, unknown>;
    const { resolved } = await this.resolveArtistAddConfiguration({
      requestRootFolderPath: options.rootFolderPath,
      requestQualityProfileId: options.qualityProfileId,
      savedRootFolderPath: options.savedRootFolderPath,
      savedQualityProfileId: options.savedQualityProfileId,
      settings,
    });

    const albumOnly = options.albumOnly === true;
    const requestedMonitorOption = normalizeMonitorOption(
      options.monitorOption || options.monitor || 'none',
    );
    const monitoring = getArtistMonitoringPayload(requestedMonitorOption);
    const lidarrIntegrations = (settings.integrations as Record<string, unknown> | undefined)?.lidarr as Record<string, unknown> | undefined;
    const searchOnAdd = (lidarrIntegrations?.searchOnAdd as boolean) ?? false;
    const albumMbid = String(options.albumMbid || '').trim();
    const albumsToMonitor = albumOnly && albumMbid ? [albumMbid] : [];

    const qualityProfileId = resolved.qualityProfileId;
    const defaultMetadataProfileId = lidarrIntegrations?.metadataProfileId as number | undefined;
    let metadataProfileId: unknown = (options.metadataProfileId || defaultMetadataProfileId || null) as unknown;
    if (!metadataProfileId) {
      try {
        const metadataProfiles = await this.getMetadataProfiles();
        if (Array.isArray(metadataProfiles) && metadataProfiles.length > 0) {
          metadataProfileId = (metadataProfiles[0] as Record<string, unknown>).id;
        }
      } catch {}
    }
    if (!metadataProfileId) metadataProfileId = 1;

    const configuredTagId = normalizeProfileId(
      options.tagId ?? lidarrIntegrations?.tagId,
    );
    const tags: number[] = configuredTagId !== null ? [configuredTagId] : [];

    const lidarrArtist: Record<string, unknown> = {
      artistName: artistName,
      foreignArtistId: mbid,
      rootFolderPath: resolved.rootFolderPath,
      qualityProfileId: qualityProfileId,
      metadataProfileId: metadataProfileId,
      monitored: monitoring.monitored,
      monitor: monitoring.monitor,
      monitorNewItems: monitoring.monitorNewItems,
      tags: tags,
      addOptions: {
        monitor: monitoring.monitor,
        searchForMissingAlbums: albumOnly ? false : searchOnAdd,
        ...(albumsToMonitor.length > 0 ? { albumsToMonitor } : {}),
      },
    };

    const ensureArtistMonitored = async (artist: Record<string, unknown>): Promise<unknown> => {
      if (!artist?.id || artist.monitored === true) {
        return artist;
      }
      return this.updateArtistMonitoring(artist.id, monitoring.option);
    };

    try {
      const result = await this.request('/artist', 'POST', lidarrArtist);
      return ensureArtistMonitored(result as Record<string, unknown>);
    } catch (error: unknown) {
      if (requestedMonitorOption !== 'all') {
        throw error;
      }
      const fallbackArtist: Record<string, unknown> = {
        ...lidarrArtist,
        monitor: 'existing',
        addOptions: {
          ...(lidarrArtist.addOptions as Record<string, unknown>),
          monitor: 'existing',
        },
      };
      const result = await this.request('/artist', 'POST', fallbackArtist);
      return ensureArtistMonitored(result as Record<string, unknown>);
    }
  }

  async getArtist(artistId: unknown) {
    return this.request(`/artist/${artistId}`);
  }

  async getArtistByMbid(mbid: unknown): Promise<unknown | null> {
    const normalizedMbid = String(mbid || '').trim();
    if (!normalizedMbid) return null;

    const cachedArtist = this._getArtistByMbidCacheEntry(normalizedMbid);
    if (cachedArtist !== undefined) {
      return cachedArtist;
    }

    if (this._artistListCache && Date.now() - this._artistListCache.at < LIDARR_LIST_CACHE_MS) {
      const artists = Array.isArray(this._artistListCache.data) ? this._artistListCache.data : [];
      this._populateArtistIndexes(artists);
      const artist = artists.find((entry: unknown) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).foreignArtistId === normalizedMbid) || null;
      this._setArtistByMbidCacheEntry(normalizedMbid, artist);
      return artist;
    }

    const inflight = this._artistByMbidInflight.get(normalizedMbid);
    if (inflight) {
      return inflight;
    }

    const startedAt = Date.now();
    const requestPromise = this.request('/artist')
      .then((artists) => {
        const list = Array.isArray(artists) ? artists : [];
        this._populateArtistIndexes(list);
        const artist = list.find((entry) => entry?.foreignArtistId === normalizedMbid) || null;
        this._setArtistByMbidCacheEntry(normalizedMbid, artist);
        return artist;
      })
      .finally(() => {
        this._artistByMbidInflight.delete(normalizedMbid);
        const durationMs = Date.now() - startedAt;
        logger.debug('api', 'Lidarr getArtistByMbid completed', {
          mbid: normalizedMbid,
          durationMs,
        });
      });

    this._artistByMbidInflight.set(normalizedMbid, requestPromise);
    return requestPromise;
  }

  async updateArtist(artistId: unknown, updates: Record<string, unknown>) {
    const artist = (await this.getArtist(artistId)) as Record<string, unknown>;

    const updated: Record<string, unknown> = {
      ...artist,
      ...updates,
    };

    return this.request(`/artist/${artistId}`, 'PUT', updated);
  }

  async updateArtistMonitoring(artistId: unknown, monitorOption: unknown) {
    const artist = (await this.getArtist(artistId)) as Record<string, unknown>;
    const monitoring = getArtistMonitoringPayload(monitorOption);

    const updated: Record<string, unknown> = {
      ...artist,
      monitored: monitoring.monitored,
      monitor: monitoring.monitor,
      monitorNewItems: monitoring.monitorNewItems,
      addOptions: {
        ...((artist.addOptions as Record<string, unknown>) || {}),
        monitor: monitoring.monitor,
      },
    };

    try {
      return await this.request(`/artist/${artistId}`, 'PUT', updated);
    } catch (error: unknown) {
      if (monitoring.option !== 'all') {
        throw error;
      }
      const fallbackUpdated: Record<string, unknown> = {
        ...updated,
        monitor: 'existing',
        addOptions: {
          ...((updated.addOptions as Record<string, unknown>) || {}),
          monitor: 'existing',
        },
      };
      return this.request(`/artist/${artistId}`, 'PUT', fallbackUpdated);
    }
  }

  async addAlbum(artistId: unknown, albumMbid: string, albumName: string, options: AddAlbumOptions = {}) {
    const artist = (await this.getArtist(artistId)) as Record<string, unknown>;
    if (!artist) {
      throw new Error(`Artist with ID ${artistId} not found in Lidarr`);
    }

    const effectiveArtist =
      artist.monitored === true
        ? artist
        : await this.updateArtistMonitoring(
            artistId,
            (artist.monitor as string) || ((artist.addOptions as Record<string, unknown>)?.monitor as string) || 'none',
          );

    const lidarrAlbum: Record<string, unknown> = {
      title: albumName,
      foreignAlbumId: albumMbid,
      artistId: artistId,
      artist: effectiveArtist,
      monitored: options.monitored !== false,
      anyReleaseOk: true,
      images: [],
    };

    let result = (await this.request('/album', 'POST', lidarrAlbum)) as Record<string, unknown>;

    if (options.monitored !== false && result?.id && result.monitored !== true) {
      result = (await this.monitorAlbum(result.id, true)) as Record<string, unknown>;
    }

    if (options.triggerSearch === true) {
      await this.triggerAlbumSearch(result.id);
    }

    return result;
  }

  async getAlbum(albumId: unknown) {
    return this.request(`/album/${albumId}`);
  }

  async getTracksByAlbumId(albumId: unknown) {
    try {
      const result = await this.request(`/track?albumId=${albumId}`);
      if (Array.isArray(result)) return result;
      const resultObj = result as Record<string, unknown>;
      if (resultObj?.records && Array.isArray(resultObj.records)) return resultObj.records;
      return [];
    } catch {
      return [];
    }
  }

  async getTrackFilesByAlbumId(albumId: unknown) {
    try {
      const result = await this.request(`/trackfile?albumId=${albumId}`);
      if (Array.isArray(result)) return result;
      const resultObj = result as Record<string, unknown>;
      if (resultObj?.records && Array.isArray(resultObj.records)) return resultObj.records;
      return [];
    } catch {
      return [];
    }
  }

  async getAllTracks() {
    try {
      const result = await this.request('/track');
      if (Array.isArray(result)) return result;
      const resultObj = result as Record<string, unknown>;
      if (resultObj?.records && Array.isArray(resultObj.records)) return resultObj.records;
      return [];
    } catch {
      return [];
    }
  }

  async getAllTrackFiles() {
    try {
      const result = await this.request('/trackfile');
      if (Array.isArray(result)) return result;
      const resultObj = result as Record<string, unknown>;
      if (resultObj?.records && Array.isArray(resultObj.records)) return resultObj.records;
      return [];
    } catch {
      return [];
    }
  }

  async getAlbumByMbid(albumMbid: string) {
    const albums = (await this.request('/album')) as unknown[];
    return albums.find((a: unknown) => a && typeof a === 'object' && (a as Record<string, unknown>).foreignAlbumId === albumMbid) || null;
  }

  async updateAlbum(albumId: unknown, updates: Record<string, unknown>) {
    const album = (await this.getAlbum(albumId)) as Record<string, unknown>;

    const updated: Record<string, unknown> = {
      ...album,
      ...updates,
    };

    return this.request(`/album/${albumId}`, 'PUT', updated);
  }

  async monitorAlbum(albumId: unknown, monitored = true) {
    return this.updateAlbum(albumId, { monitored });
  }

  async triggerAlbumSearch(albumId: unknown) {
    return this.request('/command', 'POST', {
      name: 'AlbumSearch',
      albumIds: [albumId],
    });
  }

  async triggerArtistSearch(artistId: unknown) {
    return this.request('/command', 'POST', {
      name: 'ArtistSearch',
      artistIds: [artistId],
    });
  }

  async getQueue() {
    const response = await this.request('/queue');
    if (response && Array.isArray(response)) {
      return response;
    }
    return (response as Record<string, unknown>).records || response || [];
  }

  async getQueueItem(queueId: unknown) {
    return this.request(`/queue/${queueId}`);
  }

  async getHistory(page = 1, pageSize = 20, sortKey = 'date', sortDirection = 'descending') {
    const params = new URLSearchParams({
      page: page.toString(),
      pageSize: pageSize.toString(),
      sortKey,
      sortDirection,
    });
    return this.request(`/history?${params.toString()}`);
  }

  async getHistoryForAlbum(albumId: unknown) {
    const history = (await this.getHistory(1, 100)) as Record<string, unknown>;
    return (history.records as unknown[])?.filter((h: unknown) => h && typeof h === 'object' && (h as Record<string, unknown>).albumId === albumId) || [];
  }

  async getHistoryForArtist(artistId: unknown) {
    const history = (await this.getHistory(1, 100)) as Record<string, unknown>;
    return (history.records as unknown[])?.filter((h: unknown) => h && typeof h === 'object' && (h as Record<string, unknown>).artistId === artistId) || [];
  }

  async deleteArtist(artistId: unknown, deleteFiles = false) {
    const params = new URLSearchParams();
    if (deleteFiles) {
      params.append('deleteFiles', 'true');
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    const result = await this.request(`/artist/${artistId}${query}`, 'DELETE');
    this._artistListCache = null;
    this._invalidateArtistIndexes();
    this._albumCache.clear();
    return result;
  }

  async deleteAlbum(albumId: unknown, deleteFiles = false) {
    const params = new URLSearchParams();
    if (deleteFiles) {
      params.append('deleteFiles', 'true');
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/album/${albumId}${query}`, 'DELETE');
  }

  async getQualityProfiles(skipConfigUpdate = false) {
    return this.request('/qualityprofile', 'GET', null, skipConfigUpdate);
  }

  async getMetadataProfiles(skipConfigUpdate = false) {
    return this.request('/metadataprofile', 'GET', null, skipConfigUpdate);
  }

  async createMetadataProfile(profileData: Record<string, unknown>, skipConfigUpdate = false) {
    return this.request('/metadataprofile', 'POST', profileData, skipConfigUpdate);
  }

  async updateMetadataProfile(profileId: unknown, profileData: Record<string, unknown>, skipConfigUpdate = false) {
    return this.request(`/metadataprofile/${profileId}`, 'PUT', profileData, skipConfigUpdate);
  }

  async getQualityProfile(profileId: unknown, skipConfigUpdate = false) {
    return this.request(`/qualityprofile/${profileId}`, 'GET', null, skipConfigUpdate);
  }

  async createQualityProfile(profileData: Record<string, unknown>, skipConfigUpdate = false) {
    return this.request('/qualityprofile', 'POST', profileData, skipConfigUpdate);
  }

  async updateQualityProfile(profileId: unknown, profileData: Record<string, unknown>, skipConfigUpdate = false) {
    return this.request(`/qualityprofile/${profileId}`, 'PUT', profileData, skipConfigUpdate);
  }

  async getCustomFormats(skipConfigUpdate = false) {
    return this.request('/customformat', 'GET', null, skipConfigUpdate);
  }

  async createCustomFormat(formatData: Record<string, unknown>, skipConfigUpdate = false) {
    return this.request('/customformat', 'POST', formatData, skipConfigUpdate);
  }

  async getNamingConfig(skipConfigUpdate = false) {
    return this.request('/config/naming', 'GET', null, skipConfigUpdate);
  }

  async updateNamingConfig(configData: Record<string, unknown>, skipConfigUpdate = false) {
    return this.request('/config/naming', 'PUT', configData, skipConfigUpdate);
  }

  async getReleaseProfiles(skipConfigUpdate = false) {
    return this.request('/releaseprofile', 'GET', null, skipConfigUpdate);
  }

  async createReleaseProfile(profileData: Record<string, unknown>, skipConfigUpdate = false) {
    return this.request('/releaseprofile', 'POST', profileData, skipConfigUpdate);
  }

  async updateReleaseProfile(profileId: unknown, profileData: Record<string, unknown>, skipConfigUpdate = false) {
    return this.request(`/releaseprofile/${profileId}`, 'PUT', profileData, skipConfigUpdate);
  }

  async getQualityDefinitions(skipConfigUpdate = false) {
    return this.request('/qualitydefinition', 'GET', null, skipConfigUpdate);
  }

  async updateQualityDefinition(id: unknown, data: Record<string, unknown>, skipConfigUpdate = false) {
    return this.request(`/qualitydefinition/${id}`, 'PUT', data, skipConfigUpdate);
  }
}

export const lidarrClient = new LidarrClient();
