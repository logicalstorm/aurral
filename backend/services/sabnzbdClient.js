import axios from "axios";
import { dbOps } from "../db/helpers/index.js";

let connectionCache = { checkedAt: 0, result: null };

function normalizeBaseUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

function normalizeInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function getSettings() {
  const sabnzbd = dbOps.getSettings()?.integrations?.sabnzbd || {};
  return {
    enabled: sabnzbd.enabled === true,
    url: normalizeBaseUrl(sabnzbd.url),
    apiKey: String(sabnzbd.apiKey || "").trim(),
    category: String(sabnzbd.category || "aurral").trim(),
    priority: normalizeInteger(sabnzbd.priority, 20),
    addPaused: sabnzbd.addPaused === true,
  };
}

function buildUrl(url, apiKey) {
  const base = normalizeBaseUrl(url);
  if (!base) return "";
  return `${base}/api?apikey=${encodeURIComponent(apiKey)}&output=json`;
}

function sanitizeNzbName(value) {
  const raw = String(value || "aurral-download");
  const cleaned = Array.from(raw)
    .map((ch) => {
      const code = ch.codePointAt(0);
      if (code < 0x20) return "_";
      if ('<>:"/\\|?*'.includes(ch)) return "_";
      return ch;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return cleaned || "aurral-download";
}

function mapPriority(addPaused) {
  if (addPaused) return -2;
  return 0;
}

function readConfigValue(entries, name) {
  const key = String(name || "").toLowerCase();
  const entry = (Array.isArray(entries) ? entries : []).find(
    (item) => String(item?.name || "").toLowerCase() === key,
  );
  return entry?.value ?? "";
}

export class SabnzbdClient {
  isConfigured() {
    const { enabled, url, apiKey } = getSettings();
    return enabled && !!url && !!apiKey;
  }

  getStatus() {
    const settings = getSettings();
    const cached = connectionCache.result;
    return {
      enabled: settings.enabled,
      configured: this.isConfigured(),
      connected: cached?.connected === true,
      downloadPaused: cached?.downloadPaused === true,
    };
  }

  async api(mode, params = {}) {
    const settings = getSettings();
    const base = buildUrl(settings.url, settings.apiKey);
    const query = Object.entries({ mode, ...params })
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    const response = await axios.get(`${base}&${query}`, {
      timeout: 45000,
      validateStatus: () => true,
    });
    if (response.status !== 200) {
      throw new Error(`SABnzbd ${mode} failed: HTTP ${response.status}`);
    }
    return response.data;
  }

  async appendUrl({
    name,
    url,
    category,
    priority,
    addPaused,
  }) {
    const settings = getSettings();
    const safeUrl = String(url || "").trim();
    if (!safeUrl) throw new Error("SABnzbd append requires a URL");
    const nzbName = `${sanitizeNzbName(name)}.nzb`;
    const pp = mapPriority(addPaused ?? settings.addPaused);
    const result = await this.api("addurl", {
      name: safeUrl,
      nzbname: nzbName,
      cat: category ?? settings.category,
      priority: normalizeInteger(priority, pp),
      pp: 3,
    });
    if (!result?.nzo_ids || result.nzo_ids.length === 0) {
      throw new Error("SABnzbd rejected the NZB URL");
    }
    return {
      nzbId: String(result.nzo_ids[0]),
      nzbName,
    };
  }

  async getQueueItem(nzoId) {
    const id = String(nzoId || "").trim();
    if (!id) return null;
    const result = await this.api("queue", { nzo_ids: id });
    const slots = result?.queue?.slots || [];
    return slots.find((s) => String(s.nzo_id) === id) || null;
  }

  async getHistoryItem(nzoId) {
    const id = String(nzoId || "").trim();
    if (!id) return null;
    const result = await this.api("history", { nzo_ids: id });
    const slots = result?.history?.slots || [];
    return slots.find((s) => String(s.nzo_id) === id) || null;
  }

  async getDownloadDirectories() {
    const settings = getSettings();
    const result = await this.api("get_config", { section: "misc" }).catch(() => null);
    const entries = result?.config?.misc || [];
    return {
      completedPath: "",
      destDir: readConfigValue(entries, "completed_dir"),
      interDir: "",
      mainDir: "",
    };
  }

  async testConnection({ force = false } = {}) {
    const settings = getSettings();
    if (!settings.enabled) {
      return {
        ok: false,
        configured: false,
        connected: false,
        message: "SABnzbd is disabled",
      };
    }
    if (!settings.url || !settings.apiKey) {
      return {
        ok: false,
        configured: false,
        connected: false,
        message: "SABnzbd URL and API key are required",
      };
    }
    if (!force && connectionCache.result && Date.now() - connectionCache.checkedAt < 30000) {
      return connectionCache.result;
    }
    try {
      const apiUrl = buildUrl(settings.url, settings.apiKey);
      const [versionRes, statsRes] = await Promise.all([
        axios.get(`${apiUrl}&mode=version`, { timeout: 15000, validateStatus: () => true }),
        axios.get(`${apiUrl}&mode=server_stats`, { timeout: 15000, validateStatus: () => true }),
      ]);
      const version = versionRes.data?.version || null;
      const paused = statsRes.data?.paused === true;
      const rate = parseFloat(statsRes.data?.kbpersec || 0);
      const result = {
        ok: true,
        configured: true,
        connected: true,
        version,
        downloadPaused: paused,
        downloadRate: rate,
        message: `SABnzbd is connected${version ? ` (v${version})` : ""}`,
      };
      connectionCache = { checkedAt: Date.now(), result };
      return result;
    } catch (error) {
      const result = {
        ok: false,
        configured: true,
        connected: false,
        message: error?.message || "Failed to reach SABnzbd",
      };
      connectionCache = { checkedAt: Date.now(), result };
      return result;
    }
  }
}

export const sabnzbdClient = new SabnzbdClient();
