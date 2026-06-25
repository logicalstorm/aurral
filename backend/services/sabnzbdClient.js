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

function buildClient() {
  const { url, apiKey } = getSettings();
  const apiUrl = buildUrl(url, apiKey);
  if (!apiUrl) throw new Error("SABnzbd not configured");
  return axios.create({
    baseURL: normalizeBaseUrl(url),
    timeout: 45000,
    headers: {
      Accept: "application/json",
    },
    validateStatus: () => true,
  });
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
