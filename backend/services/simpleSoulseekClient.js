import slsk from "slsk-client";
import { randomBytes } from "crypto";
import { dbOps } from "../config/db-helpers.js";
import path from "path";
import fs from "fs/promises";
import { createWriteStream } from "fs";

export class SimpleSoulseekClient {
  constructor() {
    this.client = null;
    this.connected = false;
    this.config = null;
    this.updateConfig();
  }

  ensureCredentials() {
    const settings = dbOps.getSettings();
    const dbConfig = settings.integrations?.soulseek || {};
    let username = dbConfig.username || process.env.SOULSEEK_USERNAME || "";
    let password = dbConfig.password || process.env.SOULSEEK_PASSWORD || "";

    if (!username || !password) {
      username = username || `aurral_${randomBytes(8).toString("hex")}`;
      password = password || randomBytes(16).toString("hex");
      const current = dbOps.getSettings();
      const integrations = {
        ...(current.integrations || {}),
        soulseek: { username, password },
      };
      dbOps.updateSettings({ ...current, integrations });
    }

    return { username, password };
  }

  updateConfig() {
    const { username, password } = this.ensureCredentials();
    this.config = { username, password };
  }

  isConfigured() {
    this.ensureCredentials();
    this.updateConfig();
    return !!(this.config.username && this.config.password);
  }

  async connect() {
    if (this.connected && this.client) {
      return true;
    }

    if (!this.isConfigured()) {
      throw new Error("Soulseek credentials not configured");
    }

    return new Promise((resolve, reject) => {
      slsk.connect(
        {
          user: this.config.username,
          pass: this.config.password,
        },
        (err, client) => {
          if (err) {
            this.connected = false;
            this.client = null;
            reject(err);
            return;
          }
          this.client = client;
          this.connected = true;
          resolve(true);
        },
      );
    });
  }

  async disconnect() {
    if (this.client && this.connected) {
      try {
        this.client.disconnect();
      } catch (err) {
        console.error("Error disconnecting Soulseek client:", err.message);
      }
      this.client = null;
      this.connected = false;
    }
  }

  isConnected() {
    return this.connected && this.client !== null;
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
          timeout: 10000,
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
    if (!results || results.length === 0) {
      return null;
    }

    const trackNameLower = trackName.toLowerCase();
    const filtered = results.filter((r) => {
      const filename = (r.file || "").toLowerCase();
      return filename.includes(trackNameLower);
    });

    if (filtered.length === 0) {
      return results[0];
    }

    const sorted = filtered.sort((a, b) => {
      const aExt = path.extname(a.file || "").toLowerCase();
      const bExt = path.extname(b.file || "").toLowerCase();

      const qualityOrder = { ".flac": 0, ".mp3": 1, ".m4a": 2, ".ogg": 3 };
      const aQuality = qualityOrder[aExt] ?? 99;
      const bQuality = qualityOrder[bExt] ?? 99;

      if (aQuality !== bQuality) {
        return aQuality - bQuality;
      }

      if (a.slots && !b.slots) return -1;
      if (!a.slots && b.slots) return 1;

      return 0;
    });

    return sorted[0];
  }

  async download(result, destinationPath) {
    if (!this.isConnected()) {
      await this.connect();
    }

    const absPath = path.resolve(destinationPath);
    const dir = path.dirname(absPath);
    await fs.mkdir(dir, { recursive: true });

    const normalizedResult = {
      ...result,
      file: (result.file || "").replace(/\\/g, "/"),
    };

    const DOWNLOAD_TIMEOUT_MS = 120000;

    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn) => (val) => {
        if (settled) return;
        settled = true;
        fn(val);
      };

      const timeoutId = setTimeout(async () => {
        clearTimeout(timeoutId);
        try {
          const stat = await fs.stat(absPath).catch(() => null);
          if (stat && stat.size > 0) {
            settle(resolve)(absPath);
          } else {
            settle(reject)(new Error("Download timeout"));
          }
        } catch (e) {
          settle(reject)(e);
        }
      }, DOWNLOAD_TIMEOUT_MS);

      this.client.downloadStream(
        { file: normalizedResult },
        (err, readStream) => {
          if (err) {
            clearTimeout(timeoutId);
            reject(err);
            return;
          }
          const writeStream = createWriteStream(absPath);
          readStream.pipe(writeStream);
          writeStream.on("finish", () => {
            clearTimeout(timeoutId);
            settle(resolve)(absPath);
          });
          writeStream.on("error", (e) => {
            clearTimeout(timeoutId);
            readStream.destroy();
            settle(reject)(e);
          });
          readStream.on("error", (e) => {
            clearTimeout(timeoutId);
            writeStream.destroy();
            settle(reject)(e);
          });
        },
      );
    });
  }
}

export const soulseekClient = new SimpleSoulseekClient();
