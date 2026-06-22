import axios from 'axios';
import { dbOps } from '../config/db-helpers.js';

const DEFAULT_MUSIC_CATEGORIES: number[] = [3000];
const DEFAULT_MAX_RESULTS = 60;

interface ConnectionCache {
  checkedAt: number;
  result: Record<string, unknown> | null;
}

let connectionCache: ConnectionCache = { checkedAt: 0, result: null };

function normalizeBaseUrl(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '');
}

function normalizeInteger(value: unknown, fallback: number | null = null): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function normalizePositiveInteger(value: unknown, fallback: number | null): number | null {
  const parsed = normalizeInteger(value, null);
  if (parsed == null || parsed <= 0) return fallback;
  return parsed;
}

function normalizeCategoryList(value: unknown): number[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .map((entry) => entry.trim());
  const categories = (raw
    .map((entry) => normalizeInteger(entry, null))
    .filter((entry) => entry != null && entry > 0)) as number[];
  return categories.length > 0 ? [...new Set(categories)] : DEFAULT_MUSIC_CATEGORIES;
}

interface IndexerOverride {
  enabled: boolean;
  priority: number | null;
}

function normalizeIndexerOverrides(value: unknown): Record<string, IndexerOverride> {
  if (Array.isArray(value)) {
    const entries: Array<[string, IndexerOverride]> = [];
    for (const rawEntry of value) {
      const entry = rawEntry as Record<string, unknown> | null;
      const id = normalizeInteger(entry?.id, null);
      if (id == null) continue;
      entries.push([
        String(id),
        {
          enabled: entry?.enabled !== false,
          priority: normalizePositiveInteger(entry?.priority, null),
        },
      ]);
    }
    return Object.fromEntries(entries);
  }
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, IndexerOverride> = {};
  for (const [key, rawEntry] of Object.entries(value)) {
    const entry = rawEntry as Record<string, unknown>;
    const id = normalizeInteger(key, null);
    if (id == null) continue;
    out[String(id)] = {
      enabled: entry?.enabled !== false,
      priority: normalizePositiveInteger(entry?.priority, null),
    };
  }
  return out;
}

interface ProwlarrSettings {
  enabled: boolean;
  url: string;
  apiKey: string;
  categories: number[];
  maxResults: number;
  indexers: Record<string, IndexerOverride>;
}

function getSettings(): ProwlarrSettings {
  const prowlarr = ((dbOps.getSettings() as Record<string, unknown>)?.integrations as Record<string, unknown>)?.prowlarr as Record<string, unknown> || {};
  return {
    enabled: prowlarr.enabled === true,
    url: normalizeBaseUrl(prowlarr.url),
    apiKey: String(prowlarr.apiKey || '').trim(),
    categories: normalizeCategoryList(prowlarr.categories),
    maxResults: normalizePositiveInteger(prowlarr.maxResults, DEFAULT_MAX_RESULTS) ?? DEFAULT_MAX_RESULTS,
    indexers: normalizeIndexerOverrides(prowlarr.indexers),
  };
}

function buildClientFromCredentials(url: string, apiKey: string): ReturnType<typeof axios.create> {
  const trimmedUrl = normalizeBaseUrl(url);
  const trimmedKey = String(apiKey || '').trim();
  if (!trimmedUrl || !trimmedKey) {
    throw new Error('Prowlarr not configured');
  }
  return axios.create({
    baseURL: trimmedUrl,
    timeout: 45000,
    headers: {
      'X-Api-Key': trimmedKey,
      Accept: 'application/json',
    },
    validateStatus: () => true,
  });
}

function buildClient(): ReturnType<typeof axios.create> {
  const { url, apiKey } = getSettings();
  return buildClientFromCredentials(url, apiKey);
}

function normalizeProtocol(value: unknown): string {
  const protocol = String(value || '')
    .trim()
    .toLowerCase();
  return protocol;
}

function readCategoryIds(categories: unknown): number[] {
  if (!Array.isArray(categories)) return [];
  const ids: number[] = [];
  for (const category of (categories as unknown[])) {
    const id = normalizeInteger((category as Record<string, unknown>)?.id ?? category, null);
    if (id != null) ids.push(id);
  }
  return [...new Set(ids)];
}

function hasMusicCategory(indexer: unknown, configuredCategories: number[] = DEFAULT_MUSIC_CATEGORIES): boolean {
  const supported = readCategoryIds(((indexer as unknown as Record<string, unknown>)?.capabilities as unknown as Record<string, unknown>)?.categories);
  if (supported.length === 0) return true;
  return supported.some((id) =>
    configuredCategories.some((category) => {
      if (category % 1000 === 0) {
        return id >= category && id < category + 1000;
      }
      return id === category;
    }),
  );
}

interface NormalizedIndexer {
  id: number | null;
  name: string;
  protocol: string;
  enabledInProwlarr: boolean;
  enabled: boolean;
  supportsSearch: boolean;
  priority: number;
  categories: number[];
  raw: unknown;
}

function normalizeIndexer(indexer: unknown, settings: ProwlarrSettings = getSettings()): NormalizedIndexer {
  const idx = indexer as Record<string, unknown>;
  const id = normalizeInteger(idx?.id, null);
  const override = id != null ? settings.indexers[String(id)] : null;
  const priority = override?.priority ?? normalizePositiveInteger(idx?.priority, 25) ?? 25;
  return {
    id,
    name: String(idx?.name || idx?.definitionName || `Indexer ${id}`).trim(),
    protocol: normalizeProtocol(idx?.protocol),
    enabledInProwlarr: idx?.enable === true,
    enabled: idx?.enable === true && override?.enabled !== false,
    supportsSearch: idx?.supportsSearch !== false,
    priority,
    categories: readCategoryIds((idx?.capabilities as unknown as Record<string, unknown>)?.categories),
    raw: indexer,
  };
}

function resolveProwlarrUrl(value: unknown): string {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  const base = getSettings().url;
  if (!base) return url;
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

interface NormalizedRelease {
  id: string | null;
  guid: string | null;
  title: string;
  size: number;
  files: number | null;
  grabs: number | null;
  indexerId: number | null;
  indexer: string | null;
  publishDate: string | null;
  downloadUrl: string;
  infoUrl: string;
  protocol: string;
  categories: number[];
  raw: unknown;
}

function normalizeRelease(release: unknown): NormalizedRelease {
  const rel = release as Record<string, unknown>;
  const indexerId = normalizeInteger(rel?.indexerId, null);
  const title = String(rel?.title || rel?.sortTitle || '').trim();
  const downloadUrl = resolveProwlarrUrl(rel?.downloadUrl);
  return {
    id: rel?.id as string ?? null,
    guid: String(rel?.guid || rel?.releaseHash || '').trim() || null,
    title,
    size: Number(rel?.size || 0),
    files: normalizeInteger(rel?.files, null),
    grabs: normalizeInteger(rel?.grabs, null),
    indexerId,
    indexer: String(rel?.indexer || '').trim() || null,
    publishDate: rel?.publishDate as string || null,
    downloadUrl,
    infoUrl: resolveProwlarrUrl(rel?.infoUrl),
    protocol: normalizeProtocol(rel?.protocol),
    categories: readCategoryIds(rel?.categories),
    raw: release,
  };
}

function formatHttpErrorBody(data: unknown): string {
  if (!data) return '';
  if (typeof data === 'string') return data.trim().slice(0, 500);
  if (Array.isArray(data)) {
    return data
      .map((entry: unknown) => formatHttpErrorBody(entry))
      .filter(Boolean)
      .join('; ')
      .slice(0, 500);
  }
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const message = obj.message || obj.errorMessage || obj.error || obj.title || obj.detail || obj.description;
    if (message) return String(message).trim().slice(0, 500);
    try {
      return JSON.stringify(data).slice(0, 500);
    } catch {
      return '';
    }
  }
  return String(data).trim().slice(0, 500);
}

interface BuildSearchParamsInput {
  query: string;
  indexerIds?: number[];
  categories?: unknown;
  type?: string;
  limit?: number | null;
  offset?: number | null;
}

function buildSearchParams({ query, indexerIds, categories, type = 'search', limit, offset = 0 }: BuildSearchParamsInput): string {
  const params = new URLSearchParams();
  params.set('query', String(query || '').trim());
  params.set('type', type);
  if (Array.isArray(indexerIds) && indexerIds.length > 0) {
    for (const indexerId of indexerIds) {
      params.append('indexerIds', String(indexerId));
    }
  }
  for (const category of normalizeCategoryList(categories)) {
    params.append('categories', String(category));
  }
  if (limit != null) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  return params.toString();
}

export class ProwlarrClient {
  isConfigured(): boolean {
    const { enabled, url, apiKey } = getSettings();
    return enabled && !!(url && apiKey);
  }

  getStatus(): Record<string, unknown> {
    const settings = getSettings();
    const cached = connectionCache.result;
    return {
      enabled: settings.enabled,
      configured: this.isConfigured(),
      connected: (cached as Record<string, unknown>)?.connected === true,
      indexerCount: (cached as Record<string, unknown>)?.indexerCount || 0,
      usenetIndexerCount: (cached as Record<string, unknown>)?.usenetIndexerCount || 0,
    };
  }

  async testConnection({ force = false }: { force?: boolean } = {}): Promise<Record<string, unknown>> {
    const settings = getSettings();
    if (!settings.enabled) {
      return {
        ok: false,
        configured: false,
        connected: false,
        message: 'Prowlarr is disabled',
      };
    }
    if (!settings.url || !settings.apiKey) {
      return {
        ok: false,
        configured: false,
        connected: false,
        message: 'Prowlarr URL and API key are required',
      };
    }
    if (!force && connectionCache.result && Date.now() - connectionCache.checkedAt < 30000) {
      return connectionCache.result;
    }
    const client = buildClient();
    try {
      const [statusRes, indexerRes] = await Promise.all([
        client.get('/api/v1/system/status'),
        client.get('/api/v1/indexer'),
      ]);
      if (statusRes.status !== 200) {
        const result: Record<string, unknown> = {
          ok: false,
          configured: true,
          connected: false,
          message: `Prowlarr returned HTTP ${statusRes.status}`,
        };
        connectionCache = { checkedAt: Date.now(), result };
        return result;
      }
      const indexers = Array.isArray(indexerRes.data) ? indexerRes.data : [];
      const normalized = indexers.map((entry: unknown) => normalizeIndexer(entry, settings));
      const usenet = normalized.filter(
        (entry: NormalizedIndexer) =>
          entry.protocol === 'usenet' &&
          entry.supportsSearch &&
          hasMusicCategory(entry.raw, settings.categories),
      );
      const result: Record<string, unknown> = {
        ok: true,
        configured: true,
        connected: true,
        version: statusRes.data?.version || null,
        appName: statusRes.data?.appName || 'Prowlarr',
        indexerCount: indexers.length,
        usenetIndexerCount: usenet.length,
        enabledUsenetIndexerCount: usenet.filter((entry: NormalizedIndexer) => entry.enabled).length,
        indexers: usenet,
        message: `Prowlarr is connected with ${usenet.length} Usenet indexer(s)`,
      };
      connectionCache = { checkedAt: Date.now(), result };
      return result;
    } catch (error) {
      const result: Record<string, unknown> = {
        ok: false,
        configured: true,
        connected: false,
        message: (error as Error)?.message || 'Failed to reach Prowlarr',
      };
      connectionCache = { checkedAt: Date.now(), result };
      return result;
    }
  }

  async listUsenetIndexers(): Promise<NormalizedIndexer[]> {
    const settings = getSettings();
    if (!this.isConfigured()) return [];
    const response = await buildClient().get('/api/v1/indexer');
    if (response.status !== 200) {
      throw new Error(`Prowlarr indexer list failed: HTTP ${response.status}`);
    }
    return (Array.isArray(response.data) ? response.data : [])
      .map((entry: unknown) => normalizeIndexer(entry, settings))
      .filter(
        (entry: NormalizedIndexer) =>
          entry.id != null &&
          entry.protocol === 'usenet' &&
          entry.supportsSearch &&
          hasMusicCategory(entry.raw, settings.categories),
      )
      .sort((left: NormalizedIndexer, right: NormalizedIndexer) => {
        if (left.priority !== right.priority) return left.priority - right.priority;
        return String(left.name).localeCompare(String(right.name));
      });
  }

  async getEnabledUsenetIndexers(): Promise<NormalizedIndexer[]> {
    const indexers = await this.listUsenetIndexers();
    return indexers.filter((entry: NormalizedIndexer) => entry.enabled);
  }

  async search(query: string, options: Record<string, unknown> = {}): Promise<NormalizedRelease[]> {
    if (!this.isConfigured()) {
      throw new Error('Prowlarr is not configured');
    }
    const settings = getSettings();
    const indexers: NormalizedIndexer[] =
      Array.isArray(options.indexers) && options.indexers.length > 0
        ? options.indexers as NormalizedIndexer[]
        : await this.getEnabledUsenetIndexers();
    if (indexers.length === 0) return [];
    const indexerIds = indexers.map((entry: NormalizedIndexer) => entry.id).filter((id: number | null): id is number => id != null);
    const queryString = buildSearchParams({
      query,
      indexerIds,
      categories: options.categories || settings.categories,
      type: (options.type as string) || 'search',
      limit: normalizePositiveInteger(options.limit, settings.maxResults),
      offset: normalizeInteger(options.offset, 0),
    });
    const response = await buildClient().get(`/api/v1/search?${queryString}`);
    if (response.status !== 200) {
      const detail = formatHttpErrorBody(response.data);
      throw new Error(
        `Prowlarr search failed: HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      );
    }
    return (Array.isArray(response.data) ? response.data : [])
      .map((entry: unknown) => normalizeRelease(entry))
      .filter((release: NormalizedRelease) => release.protocol === 'usenet' && release.downloadUrl && release.title);
  }
}

export const prowlarrClient = new ProwlarrClient();
