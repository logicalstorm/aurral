import { dbOps } from "../db/helpers/index.js";
import {
  createConnectionCache,
  normalizeBaseUrl,
  normalizeInteger,
  sanitizeNzbName,
} from "./usenetClientCommon.js";
import { httpPost } from "./http.js";

let connectionCache = createConnectionCache();

function getSettings() {
  const nzbget = dbOps.getSettings()?.integrations?.nzbget || {};
  return {
    enabled: nzbget.enabled === true,
    url: normalizeBaseUrl(nzbget.url),
    username: String(nzbget.username || "").trim(),
    password: String(nzbget.password || ""),
    category: String(nzbget.category || "aurral").trim(),
    priority: normalizeInteger(nzbget.priority, 20),
    nzbPriority: normalizeInteger(nzbget.nzbPriority, 0),
    addPaused: nzbget.addPaused === true,
    completedPath: String(nzbget.completedPath || "").trim(),
  };
}

function buildRpcUrl(baseUrl) {
  const url = normalizeBaseUrl(baseUrl);
  if (!url) return "";
  if (/\/jsonrpc$/i.test(url)) return url;
  return `${url}/jsonrpc`;
}

function buildAuthFromCredentials(username, password) {
  if (!username && !password) return undefined;
  return { username, password };
}

function readConfigValue(configEntries, name) {
  const key = String(name || "").toLowerCase();
  const entry = (Array.isArray(configEntries) ? configEntries : []).find(
    (item) => String(item?.Name || item?.name || "").toLowerCase() === key,
  );
  return entry?.Value ?? entry?.value ?? "";
}

export class NzbgetClient {
  isConfigured() {
    const { enabled, url } = getSettings();
    return enabled && !!url;
  }

  getStatus() {
    const settings = getSettings();
    const cached = connectionCache.result;
    return {
      enabled: settings.enabled,
      configured: this.isConfigured(),
      connected: cached?.connected === true,
      downloadPaused: cached?.downloadPaused === true,
      downloadPath: cached?.downloadPath || settings.completedPath || null,
    };
  }

  async rpc(method, params = []) {
    const { url, username, password } = getSettings();
    const rpcUrl = buildRpcUrl(url);
    if (!rpcUrl) throw new Error("NZBGet not configured");
    const response = await httpPost(
      rpcUrl,
      {
        jsonrpc: "2.0",
        method,
        params,
        id: Date.now(),
      },
      {
        timeoutMs: 45000,
        auth: buildAuthFromCredentials(username, password),
        headers: {
          Accept: "application/json",
        },
      },
    );
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
    return this.rpc("version", []);
  }

  async status() {
    return this.rpc("status", []);
  }

  async config() {
    return this.rpc("config", []);
  }

  async listGroups() {
    const result = await this.rpc("listgroups", [0]);
    return Array.isArray(result) ? result : [];
  }

  async history(includeHidden = false) {
    const result = await this.rpc("history", [includeHidden === true]);
    return Array.isArray(result) ? result : [];
  }

  async appendUrl({
    name,
    url,
    category,
    priority,
    addToTop = false,
    addPaused,
    dupeKey = "",
    dupeScore = 0,
    dupeMode = "SCORE",
    autoCategory = false,
    ppParameters = [],
  }) {
    const settings = getSettings();
    const safeUrl = String(url || "").trim();
    if (!safeUrl) throw new Error("NZBGet append requires a URL");
    const nzbName = `${sanitizeNzbName(name)}.nzb`;
    const result = await this.rpc("append", [
      nzbName,
      safeUrl,
      category ?? settings.category,
      normalizeInteger(priority, settings.nzbPriority),
      addToTop === true,
      addPaused ?? settings.addPaused,
      String(dupeKey || ""),
      normalizeInteger(dupeScore, 0),
      String(dupeMode || "SCORE"),
      autoCategory === true,
      Array.isArray(ppParameters) ? ppParameters : [],
    ]);
    const nzbId = normalizeInteger(result, 0);
    if (nzbId <= 0) {
      throw new Error("NZBGet rejected the NZB URL");
    }
    return {
      nzbId,
      nzbName,
    };
  }

  async getQueueItem(nzbId) {
    const id = normalizeInteger(nzbId, null);
    if (id == null) return null;
    const groups = await this.listGroups();
    return groups.find((group) => normalizeInteger(group?.NZBID, null) === id) || null;
  }

  async getHistoryItem(nzbId) {
    const id = normalizeInteger(nzbId, null);
    if (id == null) return null;
    const items = await this.history(false);
    return items.find((item) => normalizeInteger(item?.NZBID ?? item?.ID, null) === id) || null;
  }

  async getDownloadDirectories() {
    const settings = getSettings();
    const config = await this.config().catch(() => []);
    return {
      completedPath: settings.completedPath || "",
      destDir: readConfigValue(config, "DestDir"),
      interDir: readConfigValue(config, "InterDir"),
      mainDir: readConfigValue(config, "MainDir"),
    };
  }

  async testConnection({ force = false } = {}) {
    const settings = getSettings();
    if (!settings.enabled) {
      return {
        ok: false,
        configured: false,
        connected: false,
        message: "NZBGet is disabled",
      };
    }
    if (!settings.url) {
      return {
        ok: false,
        configured: false,
        connected: false,
        message: "NZBGet URL is required",
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
      const result = {
        ok: true,
        configured: true,
        connected: true,
        version,
        downloadPaused: status?.DownloadPaused === true,
        downloadRate: Number(status?.DownloadRateLo ?? status?.DownloadRate ?? 0),
        downloadPath: directories.completedPath || directories.destDir || null,
        directories,
        message: `NZBGet is connected${version ? ` (v${version})` : ""}`,
      };
      connectionCache = { checkedAt: Date.now(), result };
      return result;
    } catch (error) {
      const result = {
        ok: false,
        configured: true,
        connected: false,
        message: error?.message || "Failed to reach NZBGet",
      };
      connectionCache = { checkedAt: Date.now(), result };
      return result;
    }
  }
}

export const nzbgetClient = new NzbgetClient();
