import { randomBytes } from "crypto";
import { dbOps } from "../config/db-helpers.js";
import path from "path";
import fs from "fs/promises";
import { PassThrough } from "stream";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const slskStack = require("slsk-client/lib/stack");

const patchSlskDownloadPeerFile = () => {
  if (globalThis.__aurralSlskDownloadPatchApplied) return;
  const downloadPeerFileModulePath =
    require.resolve("slsk-client/lib/peer/download-peer-file.js");
  const net = require("net");
  const fsNode = require("fs");
  const MessageFactory = require("slsk-client/lib/message-factory.js");
  const getFilePathName = (user, file) => {
    const parts = String(file || "").split("\\");
    return `/tmp/slsk/${user}_${parts[parts.length - 1]}`;
  };
  const patchedDownloadPeerFile = (host, port, token, user, noPierce) => {
    const conn = net.createConnection(
      {
        host,
        port,
      },
      () => {
        if (noPierce) {
          conn.write(
            MessageFactory.to.peer
              .peerInit(slskStack.currentLogin, "F", token)
              .getBuff(),
          );
          setTimeout(() => {
            if (conn.destroyed) return;
            conn.write(Buffer.from("00000000" + "00000000", "hex"));
          }, 1000);
        } else {
          conn.write(MessageFactory.to.peer.pierceFw(token).getBuff());
        }
      },
    );

    let receivedHandshake = false;
    let requestToken = noPierce ? token : undefined;
    let tok = null;
    let down = null;
    let filePath = null;
    let writeStream = null;
    let receivedBytes = 0;
    let streamErrored = false;
    let settled = false;
    const clearStackDownloadState = () => {
      if (requestToken != null) {
        delete slskStack.downloadTokens[requestToken];
      }
      if (tok?.user && tok?.file) {
        delete slskStack.download[`${tok.user}_${tok.file}`];
      }
    };
    const closeReadableStream = () => {
      if (down?.stream) {
        down.stream.push(null);
      }
    };
    const finishWithError = (error) => {
      if (settled) return;
      settled = true;
      clearStackDownloadState();
      closeReadableStream();
      if (writeStream && !writeStream.destroyed) {
        writeStream.destroy();
      }
      if (!down || typeof down.cb !== "function") return;
      down.cb(error);
      down.cb = null;
    };
    const ensureWriteStream = () => {
      if (!tok || !down || writeStream || streamErrored) return;
      filePath = down.path || getFilePathName(tok.user, tok.file);
      const dir = path.dirname(filePath);
      fsNode.mkdirSync(dir, { recursive: true });
      writeStream = fsNode.createWriteStream(filePath);
      writeStream.on("error", (error) => {
        streamErrored = true;
        conn.destroy();
        finishWithError(error);
      });
    };

    conn.on("data", (data) => {
      if (!noPierce && !receivedHandshake) {
        requestToken = data.toString("hex", 0, 4);
        conn.write(Buffer.from("00000000" + "00000000", "hex"));
        receivedHandshake = true;
        return;
      }
      if (!tok) {
        tok = slskStack.downloadTokens[requestToken];
        down = tok ? slskStack.download[tok.user + "_" + tok.file] : null;
      }
      if (!tok || !down) return;

      if (down.stream) {
        down.stream.push(data);
      }
      ensureWriteStream();
      if (!streamErrored && writeStream) {
        const canContinue = writeStream.write(data);
        if (!canContinue) {
          conn.pause();
          writeStream.once("drain", () => {
            if (!conn.destroyed) conn.resume();
          });
        }
      }
      receivedBytes += data.length;
      if (receivedBytes >= Number(tok.size || 0)) {
        conn.end();
      }
    });

    conn.on("close", () => {
      if (settled) return;
      if (!tok || !down) return;
      closeReadableStream();
      if (streamErrored) return;
      const expectedBytes = Number(tok.size || 0);
      if (expectedBytes > 0 && receivedBytes < expectedBytes) {
        finishWithError(
          new Error(
            `Incomplete download (${receivedBytes}/${expectedBytes} bytes)`,
          ),
        );
        return;
      }
      const onComplete = () => {
        if (settled) return;
        settled = true;
        clearStackDownloadState();
        down.path =
          filePath || down.path || getFilePathName(tok.user, tok.file);
        down.bytesReceived = receivedBytes;
        if (typeof down.cb === "function") {
          down.cb(null, down);
          down.cb = null;
        }
      };
      if (writeStream) {
        writeStream.end(onComplete);
      } else {
        onComplete();
      }
    });

    conn.on("error", (error) => {
      if (!conn.destroyed) conn.destroy();
      finishWithError(error);
    });
  };

  require.cache[downloadPeerFileModulePath] = {
    id: downloadPeerFileModulePath,
    filename: downloadPeerFileModulePath,
    loaded: true,
    exports: patchedDownloadPeerFile,
  };
  globalThis.__aurralSlskDownloadPatchApplied = true;
};

patchSlskDownloadPeerFile();
const slsk = require("slsk-client");

export class SimpleSoulseekClient {
  constructor() {
    this.client = null;
    this.connected = false;
    this.connectPromise = null;
    this.config = null;
    this.metrics = {
      connectCalls: 0,
      connectSuccesses: 0,
      disconnectCalls: 0,
      downloadStarts: 0,
      downloadSuccesses: 0,
      downloadFailures: 0,
      lastConnectAt: null,
      lastDisconnectAt: null,
    };
    this.updateConfig();
  }

  ensureCredentials() {
    const settings = dbOps.getSettings();
    const dbConfig = settings.integrations?.soulseek || {};
    const envUsername = process.env.SOULSEEK_USERNAME || "";
    const envPassword = process.env.SOULSEEK_PASSWORD || "";
    const hasEnv = !!(envUsername || envPassword);
    let username = envUsername || dbConfig.username || "";
    let password = envPassword || dbConfig.password || "";
    const looksAuto =
      typeof dbConfig.username === "string" &&
      dbConfig.username.startsWith("aurral_");
    let autoGenerated =
      !hasEnv && (dbConfig.autoGenerated === true || looksAuto);

    if (!username || !password) {
      username = username || `aurral_${randomBytes(8).toString("hex")}`;
      password = password || randomBytes(16).toString("hex");
      autoGenerated = true;
      const current = dbOps.getSettings();
      const integrations = {
        ...(current.integrations || {}),
        soulseek: { username, password, autoGenerated: true },
      };
      dbOps.updateSettings({ ...current, integrations });
    }

    return { username, password, autoGenerated };
  }

  updateConfig() {
    const { username, password, autoGenerated } = this.ensureCredentials();
    this.config = { username, password, autoGenerated };
  }

  isConfigured() {
    this.updateConfig();
    return !!(this.config.username && this.config.password);
  }

  async connect(retryInvalidPass = true) {
    if (this.connected && this.client) {
      return true;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    this.metrics.connectCalls += 1;

    if (!this.isConfigured()) {
      throw new Error("Soulseek credentials not configured");
    }

    this.connectPromise = new Promise((resolve, reject) => {
      slsk.connect(
        {
          user: this.config.username,
          pass: this.config.password,
        },
        async (err, client) => {
          if (err) {
            this.connected = false;
            this.client = null;
            if (
              retryInvalidPass &&
              this.config?.autoGenerated &&
              this.isInvalidPass(err)
            ) {
              try {
                await this.regenerateCredentials();
                this.connectPromise = null;
                const ok = await this.connect(false);
                resolve(ok);
                return;
              } catch {
                reject(err);
                return;
              }
            }
            reject(err);
            return;
          }
          this.client = client;
          this.connected = true;
          this.metrics.connectSuccesses += 1;
          this.metrics.lastConnectAt = Date.now();
          resolve(true);
        },
      );
    });
    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  isInvalidPass(error) {
    const message = error?.message || "";
    return String(message).includes("INVALIDPASS");
  }

  async regenerateCredentials() {
    const username = `aurral_${randomBytes(8).toString("hex")}`;
    const password = randomBytes(16).toString("hex");
    const current = dbOps.getSettings();
    const integrations = {
      ...(current.integrations || {}),
      soulseek: { username, password, autoGenerated: true },
    };
    dbOps.updateSettings({ ...current, integrations });
    this.config = { username, password, autoGenerated: true };
    return { username, password };
  }

  async disconnect() {
    this.connectPromise = null;
    this.metrics.disconnectCalls += 1;
    this.metrics.lastDisconnectAt = Date.now();
    if (this.client && this.connected) {
      try {
        this.client.destroy();
      } catch (err) {}
      try {
        slsk.disconnect();
      } catch (err) {}
      this.client = null;
      this.connected = false;
    }
    try {
      const { default: stack } = await import("slsk-client/lib/stack.js");
      stack.search = {};
      stack.download = {};
      stack.downloadTokens = {};
      stack.peerSearchMatches = {};
      stack.peerSearchRequests = [];
      stack.login = undefined;
      stack.currentLogin = undefined;
    } catch (err) {}
  }

  isConnected() {
    return this.connected && this.client !== null;
  }

  _getSearchTimeoutMs() {
    const raw = Number(process.env.SOULSEEK_SEARCH_TIMEOUT_MS);
    if (Number.isFinite(raw) && raw >= 1000) return raw;
    return 10000;
  }

  _getDownloadTimeoutMs() {
    const raw = Number(process.env.SOULSEEK_DOWNLOAD_TIMEOUT_MS);
    if (Number.isFinite(raw) && raw >= 15000) return raw;
    return 120000;
  }

  _getDownloadStartupTimeoutMs() {
    const raw = Number(process.env.SOULSEEK_DOWNLOAD_START_TIMEOUT_MS);
    if (Number.isFinite(raw) && raw >= 3000) return raw;
    return 12000;
  }

  _getDownloadStallTimeoutMs() {
    const raw = Number(process.env.SOULSEEK_DOWNLOAD_STALL_TIMEOUT_MS);
    if (Number.isFinite(raw) && raw >= 5000) return raw;
    return 15000;
  }

  _getMatchScanLimit() {
    const raw = Number(process.env.SOULSEEK_MATCH_SCAN_LIMIT);
    if (Number.isFinite(raw) && raw >= 20) {
      return Math.min(Math.floor(raw), 1000);
    }
    return 40;
  }

  async search(artistName, trackName) {
    if (!this.isConnected()) {
      await this.connect();
    }

    const query = `${artistName} ${trackName}`;

    return new Promise((resolve, reject) => {
      this.client.search(
        {
          req: query,
          timeout: this._getSearchTimeoutMs(),
        },
        (err, results) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(results || []);
        },
      );
    });
  }

  pickBestMatch(results, trackName) {
    const matches = this.pickBestMatches(results, trackName, 1);
    return matches[0] || null;
  }

  pickBestMatches(results, trackName, limit = 5) {
    if (!Array.isArray(results) || results.length === 0) {
      return [];
    }
    const max = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 5;
    const scanLimit = this._getMatchScanLimit();
    const source =
      results.length > scanLimit ? results.slice(0, scanLimit) : results;
    const trackNameLower = String(trackName || "")
      .toLowerCase()
      .trim();
    const qualityOrder = { ".flac": 0, ".mp3": 1, ".m4a": 2, ".ogg": 3 };
    const score = (item) => {
      const file = String(item?.file || "").toLowerCase();
      const ext = path.extname(file).toLowerCase();
      const quality = qualityOrder[ext] ?? 99;
      const hasTrack = trackNameLower ? file.includes(trackNameLower) : false;
      const hasSlots = item?.slots ? 0 : 1;
      const fileSize = Number(item?.size || 0);
      const sizePenalty =
        fileSize > 0 ? Math.max(0, 500000 - fileSize) : 500000;
      return {
        hasTrack: hasTrack ? 0 : 1,
        quality,
        hasSlots,
        sizePenalty,
      };
    };
    const compareScore = (sa, sb) => {
      if (sa.hasTrack !== sb.hasTrack) return sa.hasTrack - sb.hasTrack;
      if (sa.quality !== sb.quality) return sa.quality - sb.quality;
      if (sa.hasSlots !== sb.hasSlots) return sa.hasSlots - sb.hasSlots;
      if (sa.sizePenalty !== sb.sizePenalty)
        return sa.sizePenalty - sb.sizePenalty;
      return 0;
    };
    const top = [];
    const topScores = [];
    for (const item of source) {
      const itemScore = score(item);
      let insertAt = top.length;
      for (let i = 0; i < top.length; i += 1) {
        if (compareScore(itemScore, topScores[i]) < 0) {
          insertAt = i;
          break;
        }
      }
      if (insertAt >= max && top.length >= max) continue;
      top.splice(insertAt, 0, item);
      topScores.splice(insertAt, 0, itemScore);
      if (top.length > max) {
        top.pop();
        topScores.pop();
      }
    }
    return top;
  }

  async download(result, destinationPath, onProgress = null) {
    this.metrics.downloadStarts += 1;
    await this.connect();

    const absPath = path.resolve(destinationPath);
    const dir = path.dirname(absPath);
    await fs.mkdir(dir, { recursive: true });

    const DOWNLOAD_TIMEOUT_MS = this._getDownloadTimeoutMs();
    const DOWNLOAD_STARTUP_TIMEOUT_MS = this._getDownloadStartupTimeoutMs();
    const DOWNLOAD_STALL_TIMEOUT_MS = this._getDownloadStallTimeoutMs();
    const expectedBytes = Number(result?.size || 0);
    const progressEnabled =
      typeof onProgress === "function" && expectedBytes > 0;
    const streamMonitorEnabled = expectedBytes > 0;

    try {
      const filePath = await new Promise((resolve, reject) => {
        let settled = false;
        let timeoutId = null;
        let startupTimeoutId = null;
        let stallTimeoutId = null;
        let lastProgress = -1;
        let downloadedBytes = 0;
        let lastProgressEmitAt = 0;
        const progressStream = streamMonitorEnabled ? new PassThrough() : null;
        let onData = null;
        let cleanedUp = false;
        let sawFirstByte = false;
        const emitProgress = (value) => {
          if (!progressEnabled) return;
          const next = Math.max(
            0,
            Math.min(100, Math.floor(Number(value) || 0)),
          );
          if (next <= lastProgress) return;
          lastProgress = next;
          onProgress(next);
        };
        if (progressStream) {
          const armStallTimer = () => {
            if (stallTimeoutId) clearTimeout(stallTimeoutId);
            stallTimeoutId = setTimeout(() => {
              if (settled) return;
              this.disconnect().catch(() => {});
              settle(reject)(new Error("Download stalled (no progress)"));
            }, DOWNLOAD_STALL_TIMEOUT_MS);
          };
          onData = (chunk) => {
            const size = Buffer.isBuffer(chunk)
              ? chunk.length
              : Number(chunk?.length || 0);
            if (!Number.isFinite(size) || size <= 0) return;
            if (!sawFirstByte) {
              sawFirstByte = true;
              if (startupTimeoutId) {
                clearTimeout(startupTimeoutId);
                startupTimeoutId = null;
              }
            }
            armStallTimer();
            downloadedBytes += size;
            const now = Date.now();
            const pct = Math.floor((downloadedBytes / expectedBytes) * 100);
            const bounded = Math.max(0, Math.min(99, pct));
            if (bounded > lastProgress && now - lastProgressEmitAt >= 750) {
              lastProgressEmitAt = now;
              emitProgress(bounded);
            }
          };
          progressStream.on("data", onData);
        }

        const cleanup = () => {
          if (cleanedUp) return;
          cleanedUp = true;
          if (progressStream && onData) {
            progressStream.off("data", onData);
          }
          if (progressStream) {
            progressStream.destroy();
          }
        };

        const settle = (fn) => (val) => {
          if (settled) return;
          settled = true;
          if (timeoutId) clearTimeout(timeoutId);
          if (startupTimeoutId) clearTimeout(startupTimeoutId);
          if (stallTimeoutId) clearTimeout(stallTimeoutId);
          cleanup();
          fn(val);
        };

        timeoutId = setTimeout(async () => {
          if (settled) return;
          this.disconnect().catch(() => {});
          settle(reject)(new Error("Download timeout"));
        }, DOWNLOAD_TIMEOUT_MS);
        if (progressStream) {
          startupTimeoutId = setTimeout(() => {
            if (settled) return;
            this.disconnect().catch(() => {});
            settle(reject)(new Error("Download stalled (no bytes received)"));
          }, DOWNLOAD_STARTUP_TIMEOUT_MS);
        }

        this.client.download(
          { file: result, path: absPath },
          (err, down) => {
            if (err) {
              settle(reject)(err);
              return;
            }
            const bytesReceived = Number(down?.bytesReceived || 0);
            if (
              expectedBytes > 0 &&
              bytesReceived > 0 &&
              bytesReceived < expectedBytes
            ) {
              settle(reject)(
                new Error(
                  `Incomplete download (${bytesReceived}/${expectedBytes} bytes)`,
                ),
              );
              return;
            }
            emitProgress(100);
            const resolvedPath =
              typeof down?.path === "string" && down.path.trim()
                ? path.resolve(down.path)
                : absPath;
            settle(resolve)(resolvedPath);
          },
          progressStream || undefined,
        );
      });
      const stat = await fs.stat(filePath).catch(() => null);
      const actualBytes = Number(stat?.size || 0);
      if (actualBytes <= 0) {
        await fs.rm(filePath, { force: true }).catch(() => {});
        throw new Error("Downloaded file is empty");
      }
      this.metrics.downloadSuccesses += 1;
      return filePath;
    } catch (err) {
      this.metrics.downloadFailures += 1;
      throw err;
    }
  }

  getStatus() {
    return {
      connected: this.isConnected(),
      metrics: {
        connectCalls: this.metrics.connectCalls,
        connectSuccesses: this.metrics.connectSuccesses,
        disconnectCalls: this.metrics.disconnectCalls,
        downloadStarts: this.metrics.downloadStarts,
        downloadSuccesses: this.metrics.downloadSuccesses,
        downloadFailures: this.metrics.downloadFailures,
        lastConnectAt: this.metrics.lastConnectAt,
        lastDisconnectAt: this.metrics.lastDisconnectAt,
      },
    };
  }
}

export const soulseekClient = new SimpleSoulseekClient();
