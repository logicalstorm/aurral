import axios from 'axios';
import { dbOps } from '../config/db-helpers.js';

let connectionCache: { checkedAt: number; result: Record<string, unknown> | null } = { checkedAt: 0, result: null };

function normalizeBaseUrl(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '');
}

function normalizeInteger(value: unknown, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function getSettings() {
  const settings = dbOps.getSettings() as Record<string, unknown>;
  const nzbget = (settings.integrations as Record<string, unknown>)?.nzbget as Record<string, unknown> || {};
  return {
    enabled: nzbget.enabled === true,
    url: normalizeBaseUrl(nzbget.url),
    username: String(nzbget.username || '').trim(),
    password: String(nzbget.password || ''),
    category: String(nzbget.category || 'aurral').trim(),
    priority: normalizeInteger(nzbget.priority, 20),
    nzbPriority: normalizeInteger(nzbget.nzbPriority, 0),
    addPaused: nzbget.addPaused === true,
    completedPath: String(nzbget.completedPath || '').trim(),
  };
}

function buildRpcUrl(baseUrl: unknown) {
  const url = normalizeBaseUrl(baseUrl);
  if (!url) return '';
  if (/\/jsonrpc$/i.test(url)) return url;
  return `${url}/jsonrpc`;
}

function buildClientFromCredentials(url: unknown, username: unknown, password: unknown) {
  const rpcUrl = buildRpcUrl(url);
  if (!rpcUrl) throw new Error('NZBGet not configured');
  return axios.create({
    baseURL: rpcUrl,
    timeout: 45000,
    auth:
      username || password
        ? {
            username: String(username),
            password: String(password),
          }
        : undefined,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    validateStatus: () => true,
  });
}

function buildClient() {
  const { url, username, password } = getSettings();
  return buildClientFromCredentials(url, username, password);
}

function sanitizeNzbName(value: unknown) {
  const cleaned = String(value || 'aurral-download')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return cleaned || 'aurral-download';
}

function readConfigValue(configEntries: unknown[], name: unknown) {
  const key = String(name || '').toLowerCase();
  const entry = (Array.isArray(configEntries) ? configEntries as Record<string, unknown>[] : []).find(
    (item: Record<string, unknown>) => String(item?.Name || item?.name || '').toLowerCase() === key,
  ) as Record<string, unknown> | undefined;
  return entry?.Value ?? entry?.value ?? '';
}

export class NzbgetClient {
  isConfigured() {
    const { enabled, url } = getSettings();
    return enabled && !!url;
  }

  getStatus() {
    const settings = getSettings();
    const result = connectionCache.result as Record<string, unknown> | null;
    return {
      enabled: settings.enabled,
      configured: this.isConfigured(),
      connected: result?.connected === true,
      downloadPaused: result?.downloadPaused === true,
      downloadPath: result?.downloadPath || settings.completedPath || null,
    };
  }

  async rpc(method: string, params: unknown[] = []) {
    const response = await buildClient().post('', {
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now(),
    });
    if (response.status !== 200) {
      throw new Error(`NZBGet ${method} failed: HTTP ${response.status}`);
    }
    if (response.data?.error) {
      const message =
        response.data.error.message ||
        response.data.error.Message ||
        JSON.stringify(response.data.error);
      throw new Error(`NZBGet ${method} failed: ${message}`);
    }
    return response.data?.result;
  }

  async version() {
    return this.rpc('version', []);
  }

  async status() {
    return this.rpc('status', []);
  }

  async config() {
    return this.rpc('config', []);
  }

  async listGroups() {
    const result = await this.rpc('listgroups', [0]);
    return Array.isArray(result) ? result : [];
  }

  async history(includeHidden = false) {
    const result = await this.rpc('history', [includeHidden === true]);
    return Array.isArray(result) ? result : [];
  }

  async appendUrl({
    name,
    url,
    category,
    priority,
    addToTop = false,
    addPaused,
    dupeKey = '',
    dupeScore = 0,
    dupeMode = 'SCORE',
    autoCategory = false,
    ppParameters = [],
  }: {
    name?: unknown;
    url?: unknown;
    category?: unknown;
    priority?: unknown;
    addToTop?: boolean;
    addPaused?: unknown;
    dupeKey?: string;
    dupeScore?: number;
    dupeMode?: string;
    autoCategory?: boolean;
    ppParameters?: unknown[];
  }) {
    const settings = getSettings();
    const safeUrl = String(url || '').trim();
    if (!safeUrl) throw new Error('NZBGet append requires a URL');
    const nzbName = `${sanitizeNzbName(name)}.nzb`;
    const result = await this.rpc('append', [
      nzbName,
      safeUrl,
      category ?? settings.category,
      normalizeInteger(priority, settings.nzbPriority),
      addToTop === true,
      addPaused ?? settings.addPaused,
      String(dupeKey || ''),
      normalizeInteger(dupeScore, 0),
      String(dupeMode || 'SCORE'),
      autoCategory === true,
      Array.isArray(ppParameters) ? ppParameters : [],
    ]);
    const nzbId = normalizeInteger(result, 0);
    if (nzbId <= 0) {
      throw new Error('NZBGet rejected the NZB URL');
    }
    return {
      nzbId,
      nzbName,
    };
  }

  async getQueueItem(nzbId: unknown) {
    const id = normalizeInteger(nzbId, undefined);
    if (id == null) return null;
    const groups = await this.listGroups();
    return (groups as Record<string, unknown>[]).find((group: Record<string, unknown>) => normalizeInteger(group?.NZBID, undefined) === id) || null;
  }

  async getHistoryItem(nzbId: unknown) {
    const id = normalizeInteger(nzbId, undefined);
    if (id == null) return null;
    const items = await this.history(false);
    return (items as Record<string, unknown>[]).find((item: Record<string, unknown>) => normalizeInteger(item?.NZBID ?? item?.ID, undefined) === id) || null;
  }

  async getDownloadDirectories() {
    const settings = getSettings();
    const config = await this.config().catch(() => []);
    return {
      completedPath: settings.completedPath || '',
      destDir: readConfigValue(config, 'DestDir'),
      interDir: readConfigValue(config, 'InterDir'),
      mainDir: readConfigValue(config, 'MainDir'),
    };
  }

  async testConnection({ force = false } = {}) {
    const settings = getSettings();
    if (!settings.enabled) {
      return {
        ok: false,
        configured: false,
        connected: false,
        message: 'NZBGet is disabled',
      };
    }
    if (!settings.url) {
      return {
        ok: false,
        configured: false,
        connected: false,
        message: 'NZBGet URL is required',
      };
    }
    if (!force && connectionCache.result && Date.now() - connectionCache.checkedAt < 30000) {
      return connectionCache.result;
    }
    try {
      const [version, status, directories] = await Promise.all([
        this.version(),
        this.status(),
        this.getDownloadDirectories(),
      ]);
      const result: Record<string, unknown> = {
        ok: true,
        configured: true,
        connected: true,
        version,
        downloadPaused: (status as Record<string, unknown>)?.DownloadPaused === true,
        downloadRate: Number((status as Record<string, unknown>)?.DownloadRateLo ?? (status as Record<string, unknown>)?.DownloadRate ?? 0),
        downloadPath: directories.completedPath || directories.destDir || null,
        directories,
        message: `NZBGet is connected${version ? ` (v${version})` : ''}`,
      };
      connectionCache = { checkedAt: Date.now(), result };
      return result;
    } catch (error: unknown) {
      const err = error as Record<string, unknown>;
      const result: Record<string, unknown> = {
        ok: false,
        configured: true,
        connected: false,
        message: err?.message || 'Failed to reach NZBGet',
      };
      connectionCache = { checkedAt: Date.now(), result };
      return result;
    }
  }
}

export const nzbgetClient = new NzbgetClient();
