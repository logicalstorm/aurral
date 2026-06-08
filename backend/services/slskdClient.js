import axios from "axios";
import { randomUUID } from "crypto";
import { dbOps } from "../config/db-helpers.js";
import { logger } from "./logger.js";

const DEFAULT_SEARCH_TIMEOUT_MS = 120000;
const DEFAULT_FILE_LIMIT = 1000;
const DEFAULT_RESPONSE_LIMIT = 150;
const DEFAULT_MAX_PEER_QUEUE = 150;
const DEFAULT_MIN_PEER_SPEED = 51200;
const ENQUEUE_MAX_CONCURRENT = 1;
const SEARCH_MAX_CONCURRENT = 1;

let searchSlots = 0;
let enqueueSlots = 0;
let connectionCache = { checkedAt: 0, result: null };

function getSettings() {
  const integrations = dbOps.getSettings()?.integrations || {};
  const slskd = integrations.slskd || {};
  const url = String(slskd.url || "").trim().replace(/\/+$/, "");
  const apiKey = String(slskd.apiKey || "").trim();
  return { url, apiKey, slskd };
}

export function getSlskdSearchFormatOptions() {
  const slskd = getSettings().slskd || {};
  const preferredFormat =
    String(slskd.preferredFormat || "").toLowerCase() === "mp3" ? "mp3" : "flac";
  return {
    preferredFormat,
    strictFormat: slskd.preferredFormatStrict === true,
  };
}

function buildClient() {
  const { url, apiKey } = getSettings();
  if (!url || !apiKey) {
    throw new Error("slskd not configured");
  }
  return axios.create({
    baseURL: url,
    timeout: 60000,
    headers: {
      "X-API-KEY": apiKey,
      Accept: "application/json",
    },
    validateStatus: () => true,
  });
}

async function withSearchLock(fn) {
  while (searchSlots >= SEARCH_MAX_CONCURRENT) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  searchSlots += 1;
  try {
    return await fn();
  } finally {
    searchSlots = Math.max(0, searchSlots - 1);
  }
}

async function withEnqueueLock(fn) {
  while (enqueueSlots >= ENQUEUE_MAX_CONCURRENT) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  enqueueSlots += 1;
  try {
    return await fn();
  } finally {
    enqueueSlots = Math.max(0, enqueueSlots - 1);
  }
}

function calculateQuadraticDelay(progress) {
  const delay = 16 * progress ** 2 - 16 * progress + 5;
  return Math.min(5, Math.max(0.5, delay));
}

function normalizeSearchFile(file, user) {
  const filename = String(file?.filename || file?.file || "").trim();
  const size = Number(file?.size || file?.length || 0);
  return {
    user: String(user || file?.user || "").trim(),
    file: filename,
    size,
    slots: Number(file?.slots ?? file?.freeUploadSlots ?? 0),
    speed: Number(file?.uploadSpeed ?? file?.speed ?? 0),
    bitRate: file?.bitRate ?? null,
    extension: file?.extension ?? null,
  };
}

export class SlskdClient {
  isConfigured() {
    const { url, apiKey } = getSettings();
    return !!(url && apiKey);
  }

  async testConnection({ force = false } = {}) {
    if (!this.isConfigured()) {
      return {
        ok: false,
        configured: false,
        connected: false,
        message: "slskd URL and API key are required",
      };
    }
    if (
      !force &&
      connectionCache.result &&
      Date.now() - connectionCache.checkedAt < 30000
    ) {
      return connectionCache.result;
    }
    const client = buildClient();
    try {
      const [appRes, optionsRes] = await Promise.all([
        client.get("/api/v0/application"),
        client.get("/api/v0/options"),
      ]);
      if (appRes.status !== 200) {
        const result = {
          ok: false,
          configured: true,
          connected: false,
          message: `slskd returned HTTP ${appRes.status}`,
        };
        connectionCache = { checkedAt: Date.now(), result };
        return result;
      }
      const server = appRes.data?.server || {};
      const serverState = String(server.state || "");
      const soulseekConnected =
        server.isConnected === true || serverState.includes("Connected");
      const downloadPath =
        optionsRes.data?.directories?.downloads ||
        optionsRes.data?.directories?.download ||
        null;
      const result = {
        ok: true,
        configured: true,
        connected: soulseekConnected,
        soulseekConnected,
        warning: !soulseekConnected,
        serverState,
        downloadPath,
        message: soulseekConnected
          ? "slskd is connected"
          : `Aurral reached slskd, but Soulseek is ${serverState || "disconnected"}. Open slskd, log in, and connect to the Soulseek server.`,
      };
      connectionCache = { checkedAt: Date.now(), result };
      return result;
    } catch (error) {
      const result = {
        ok: false,
        configured: true,
        connected: false,
        message: error?.message || "Failed to reach slskd",
      };
      connectionCache = { checkedAt: Date.now(), result };
      return result;
    }
  }

  getStatus() {
    const configured = this.isConfigured();
    const cached = connectionCache.result;
    return {
      configured,
      connected: configured && cached?.connected === true,
      downloadPath: cached?.downloadPath || null,
      serverState: cached?.serverState || null,
    };
  }

  async getDownloadDirectory({ force = false } = {}) {
    const status = await this.testConnection({ force });
    const downloadPath = String(status?.downloadPath || "").trim();
    return downloadPath || null;
  }

  async createSearch(searchText, options = {}) {
    return withSearchLock(async () => {
      const client = buildClient();
      const id = String(options.id || randomUUID());
      const body = {
        id,
        searchText: String(searchText || "").trim(),
        fileLimit: Number(options.fileLimit || DEFAULT_FILE_LIMIT),
        filterResponses: options.filterResponses !== false,
        maximumPeerQueueLength: Number(
          options.maximumPeerQueueLength || DEFAULT_MAX_PEER_QUEUE,
        ),
        minimumPeerUploadSpeed: Number(
          options.minimumPeerUploadSpeed || DEFAULT_MIN_PEER_SPEED,
        ),
        minimumResponseFileCount: Number(options.minimumResponseFileCount || 1),
        responseLimit: Number(options.responseLimit || DEFAULT_RESPONSE_LIMIT),
        searchTimeout: Number(
          options.searchTimeoutMs || DEFAULT_SEARCH_TIMEOUT_MS,
        ),
      };
      let retryCount = 0;
      let delaySeconds = 30;
      while (retryCount <= 3) {
        const response = await client.post("/api/v0/searches", body);
        if (response.status === 201 || response.status === 200) {
          return { id, searchText: body.searchText };
        }
        if (response.status === 429 && retryCount < 3) {
          await new Promise((resolve) =>
            setTimeout(resolve, delaySeconds * 1000),
          );
          retryCount += 1;
          delaySeconds *= 2;
          continue;
        }
        if (response.status === 409) {
          throw new Error("slskd Soulseek connection unavailable (409)");
        }
        throw new Error(
          `slskd search failed: HTTP ${response.status} ${String(response.data || "")}`,
        );
      }
      throw new Error("slskd search busy after retries");
    });
  }

  async getSearch(searchId) {
    const client = buildClient();
    const response = await client.get(`/api/v0/searches/${searchId}`, {
      params: { includeResponses: true },
    });
    if (response.status !== 200) {
      throw new Error(`slskd search status failed: HTTP ${response.status}`);
    }
    return response.data;
  }

  async waitForSearch(searchId, timeoutMs = DEFAULT_SEARCH_TIMEOUT_MS) {
    const start = Date.now();
    let grace = false;
    let graceUntil = 0;
    let totalFiles = 0;
    while (true) {
      const data = await this.getSearch(searchId);
      const state = String(data?.state || "InProgress");
      const fileCount = Number(data?.fileCount || 0);
      totalFiles = Math.max(totalFiles, fileCount);
      if (state !== "InProgress") {
        return data;
      }
      const elapsed = Date.now() - start;
      if (elapsed > timeoutMs && !grace) {
        grace = true;
        graceUntil = Date.now() + 20000;
      } else if (grace && Date.now() > graceUntil) {
        return data;
      }
      const progress = Math.min(1, totalFiles / DEFAULT_FILE_LIMIT);
      const waitSeconds = grace
        ? 1
        : calculateQuadraticDelay(progress);
      await new Promise((resolve) =>
        setTimeout(resolve, waitSeconds * 1000),
      );
    }
  }

  flattenSearchResults(searchData) {
    const results = [];
    const responses = Array.isArray(searchData?.responses)
      ? searchData.responses
      : [];
    for (const response of responses) {
      const user = String(response?.username || "").trim();
      const files = Array.isArray(response?.files) ? response.files : [];
      for (const file of files) {
        const normalized = normalizeSearchFile(file, user);
        if (!normalized.user || !normalized.file) continue;
        results.push(normalized);
      }
    }
    return results;
  }

  async searchQuery(searchText, options = {}) {
    const created = await this.createSearch(searchText, options);
    const completed = await this.waitForSearch(
      created.id,
      Number(options.timeoutMs || DEFAULT_SEARCH_TIMEOUT_MS),
    );
    return this.flattenSearchResults(completed);
  }

  async enqueueBatch({ username, files, options = {} }) {
    return withEnqueueLock(async () => {
      const client = buildClient();
      const body = {
        id: options.batchId || randomUUID(),
        username: String(username || "").trim(),
        files: (Array.isArray(files) ? files : []).map((file) => ({
          filename: String(file.filename || file.file || "").trim(),
          size: Number(file.size || 0),
        })),
        options: {
          destination: options.destination || null,
          externalId: options.externalId || null,
        },
      };
      let retryCount = 0;
      let delaySeconds = 30;
      while (retryCount <= 3) {
        const response = await client.post(
          "/api/v0/transfers/downloads/batches",
          body,
        );
        if ([200, 201, 207].includes(response.status)) {
          return {
            batchId: response.data?.batch?.id || body.id,
            response: response.data,
          };
        }
        if (response.status === 429 && retryCount < 3) {
          await new Promise((resolve) =>
            setTimeout(resolve, delaySeconds * 1000),
          );
          retryCount += 1;
          delaySeconds *= 2;
          continue;
        }
        throw new Error(
          `slskd batch enqueue failed: HTTP ${response.status}`,
        );
      }
      throw new Error("slskd batch enqueue busy after retries");
    });
  }

  async getBatch(batchId) {
    const client = buildClient();
    const response = await client.get(
      `/api/v0/transfers/downloads/batches/${batchId}`,
    );
    if (response.status !== 200) {
      return null;
    }
    return response.data;
  }

  async getTransfer(username, id) {
    const client = buildClient();
    const response = await client.get(
      `/api/v0/transfers/downloads/${encodeURIComponent(username)}/${id}`,
    );
    if (response.status !== 200) return null;
    return response.data;
  }

  async listDownloads() {
    const client = buildClient();
    const response = await client.get("/api/v0/transfers/downloads");
    if (response.status !== 200) return [];
    return Array.isArray(response.data) ? response.data : [];
  }

  async getEvents(offset = 0, limit = 50) {
    const client = buildClient();
    const response = await client.get("/api/v0/events", {
      params: { offset, limit },
    });
    if (response.status !== 200) {
      return { events: [], totalCount: 0 };
    }
    const totalCount = Number(response.headers["x-total-count"] || 0);
    return {
      events: Array.isArray(response.data) ? response.data : [],
      totalCount,
    };
  }
}

export const slskdClient = new SlskdClient();
