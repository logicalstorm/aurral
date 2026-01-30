import path from "path";
import fs from "fs/promises";
import NodeID3 from "node-id3";
import { dbOps } from "../config/db-helpers.js";
import { downloadTracker } from "./weeklyFlowDownloadTracker.js";
import { NavidromeClient } from "./navidrome.js";
import { flowPlaylistConfig } from "./weeklyFlowPlaylistConfig.js";

const PLAYLIST_GENRE = {
  discover: "Aurral Discover",
  mix: "Aurral Mix",
  trending: "Aurral Trending",
};
const WEEKLY_FLOW_NAVIDROME_DIR = "aurral-weekly-flow";

export class WeeklyFlowPlaylistManager {
  constructor(weeklyFlowRoot = process.env.WEEKLY_FLOW_FOLDER || "./weekly-flow") {
    this.weeklyFlowRoot = path.isAbsolute(weeklyFlowRoot)
      ? weeklyFlowRoot
      : path.resolve(process.cwd(), weeklyFlowRoot);
    this.navidromeClient = null;
    this.navidromeMusicFolder = null;
    this.updateConfig();
  }

  updateConfig() {
    const settings = dbOps.getSettings();
    const navidromeConfig = settings.integrations?.navidrome || {};
    this.navidromeMusicFolder =
      settings.integrations?.navidrome?.musicFolder ||
      process.env.NAVIDROME_MUSIC_FOLDER ||
      "/app/navidrome-music";

    if (
      navidromeConfig.url &&
      navidromeConfig.username &&
      navidromeConfig.password
    ) {
      this.navidromeClient = new NavidromeClient(
        navidromeConfig.url,
        navidromeConfig.username,
        navidromeConfig.password,
      );
    } else {
      this.navidromeClient = null;
    }
    if (this.navidromeMusicFolder) {
      this.ensureSmartPlaylists().catch((err) =>
        console.warn(
          "[WeeklyFlowPlaylistManager] ensureSmartPlaylists on config:",
          err?.message,
        ),
      );
    }
  }

  _sanitize(str) {
    return String(str || "").replace(/[<>:"/\\|?*]/g, "_").trim();
  }

  async _tagFlacGenre(filePath, genre) {
    const buf = await fs.readFile(filePath);
    if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "fLaC") return;
    let offset = 4;
    let blockStart = 4;
    let blockType = -1;
    let blockLen = 0;
    let lastBlock = false;
    while (offset < buf.length && !lastBlock) {
      blockStart = offset;
      lastBlock = (buf[offset] & 0x80) !== 0;
      blockType = buf[offset] & 0x7f;
      blockLen = buf.readUInt32BE(offset + 1) & 0xffffff;
      offset += 4 + blockLen;
      if (blockType !== 4) continue;
      const data = buf.subarray(blockStart + 4, blockStart + 4 + blockLen);
      const vendorLen = data.readUInt32LE(0);
      let pos = 4 + vendorLen;
      if (pos + 4 > data.length) return;
      const vendor = data.toString("utf8", 4, 4 + vendorLen);
      const numComments = data.readUInt32LE(pos);
      pos += 4;
      const comments = [];
      for (let i = 0; i < numComments; i++) {
        if (pos + 4 > data.length) break;
        const len = data.readUInt32LE(pos);
        pos += 4;
        if (pos + len > data.length) break;
        const kv = data.toString("utf8", pos, pos + len);
        pos += len;
        if (!/^GENRE=/i.test(kv)) comments.push(kv);
      }
      comments.push(`GENRE=${genre}`);
      const vendorBuf = Buffer.from(vendor, "utf8");
      const commentBufs = comments.map((c) => Buffer.from(c, "utf8"));
      let newLen = 4 + vendorBuf.length + 4;
      for (const b of commentBufs) newLen += 4 + b.length;
      const newData = Buffer.alloc(newLen);
      let w = 0;
      newData.writeUInt32LE(vendorBuf.length, w); w += 4;
      vendorBuf.copy(newData, w); w += vendorBuf.length;
      newData.writeUInt32LE(commentBufs.length, w); w += 4;
      for (const b of commentBufs) {
        newData.writeUInt32LE(b.length, w); w += 4;
        b.copy(newData, w); w += b.length;
      }
      const newBlockHeader = Buffer.alloc(4);
      newBlockHeader[0] = (lastBlock ? 0x80 : 0) | 4;
      newBlockHeader[1] = (newLen >> 16) & 0xff;
      newBlockHeader[2] = (newLen >> 8) & 0xff;
      newBlockHeader[3] = newLen & 0xff;
      const before = buf.subarray(0, blockStart);
      const after = buf.subarray(blockStart + 4 + blockLen);
      await fs.writeFile(filePath, Buffer.concat([before, newBlockHeader, newData, after]));
      return;
    }
  }

  async tagFileWithPlaylistType(filePath, playlistType) {
    const genre = PLAYLIST_GENRE[playlistType];
    if (!genre) return;
    const ext = path.extname(filePath).toLowerCase();
    try {
      if (ext === ".mp3") {
        NodeID3.update({ genre }, filePath);
      } else if (ext === ".flac") {
        await this._tagFlacGenre(filePath, genre);
      }
    } catch (err) {
      console.warn(
        `[WeeklyFlowPlaylistManager] Failed to tag ${filePath}:`,
        err?.message,
      );
    }
  }

  async ensureSmartPlaylists() {
    if (!this.navidromeMusicFolder) return;
    const dir = path.join(this.navidromeMusicFolder, WEEKLY_FLOW_NAVIDROME_DIR);
    const allPlaylists = [
      { type: "discover", name: "Aurral Discover", genre: "Aurral Discover" },
      { type: "mix", name: "Aurral Mix", genre: "Aurral Mix" },
      { type: "trending", name: "Aurral Trending", genre: "Aurral Trending" },
    ];
    const config = flowPlaylistConfig.getPlaylists();
    try {
      await fs.mkdir(dir, { recursive: true });
      for (const { type, name, genre } of allPlaylists) {
        const nspPath = path.join(dir, `${name}.nsp`);
        const isEnabled = config[type]?.enabled;
        if (isEnabled) {
          const payload = {
            all: [{ is: { genre } }],
            sort: "title",
            order: "asc",
            limit: 1000,
          };
          await fs.writeFile(nspPath, JSON.stringify(payload), "utf8");
        } else {
          try {
            await fs.unlink(nspPath);
          } catch {}
        }
      }
    } catch (err) {
      console.warn(
        "[WeeklyFlowPlaylistManager] Failed to write smart playlists:",
        err?.message,
      );
    }
  }

  async _tagDirRecursive(dirPath, playlistType) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = path.join(dirPath, e.name);
      if (e.isDirectory()) {
        await this._tagDirRecursive(full, playlistType);
      } else {
        const ext = path.extname(e.name).toLowerCase();
        if (ext === ".mp3" || ext === ".flac") {
          await this.tagFileWithPlaylistType(full, playlistType);
        }
      }
    }
  }

  async retagExistingForEnabledTypes() {
    const config = flowPlaylistConfig.getPlaylists();
    for (const type of ["discover", "mix", "trending"]) {
      if (!config[type]?.enabled) continue;
      const flowDir = path.join(this.weeklyFlowRoot, type);
      try {
        const entries = await fs.readdir(flowDir, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          await this._tagDirRecursive(path.join(flowDir, e.name), type);
        }
      } catch {}
    }
  }

  async createSymlink(sourcePath, playlistType) {
    if (!this.navidromeMusicFolder) {
      return null;
    }
    await this.tagFileWithPlaylistType(sourcePath, playlistType);
    try {
      await fs.access(path.dirname(this.navidromeMusicFolder));
    } catch {
      return null;
    }

    try {
      const relativePathFull = path.relative(this.weeklyFlowRoot, sourcePath);
      let relativePath = relativePathFull;
      const prefix = playlistType + path.sep;
      if (relativePath.startsWith(prefix)) {
        relativePath = relativePath.slice(prefix.length);
      }
      const symlinkPath = path.join(
        this.navidromeMusicFolder,
        WEEKLY_FLOW_NAVIDROME_DIR,
        playlistType,
        relativePath,
      );

      const symlinkDir = path.dirname(symlinkPath);
      await fs.mkdir(symlinkDir, { recursive: true });

      try {
        await fs.access(symlinkPath);
        await fs.unlink(symlinkPath);
      } catch {}

      const symlinkTarget = process.env.WEEKLY_FLOW_HOST_PATH
        ? path.join(process.env.WEEKLY_FLOW_HOST_PATH, relativePathFull)
        : path.resolve(sourcePath);
      await fs.symlink(symlinkTarget, symlinkPath);

      return symlinkPath;
    } catch (error) {
      console.error(
        `[WeeklyFlowPlaylistManager] Failed to create symlink for ${sourcePath}:`,
        error.message,
      );
      return null;
    }
  }

  async removeDiscoverSymlinksForAlbum(artistName, albumName) {
    if (!this.navidromeMusicFolder) return;
    const sanitizedArtist = this._sanitize(artistName);
    const sanitizedAlbum = this._sanitize(albumName);
    const jobs = downloadTracker.getByPlaylistType("discover");
    for (const job of jobs) {
      if (job.status !== "done" || !job.finalPath) continue;
      let relativePath = path.relative(this.weeklyFlowRoot, job.finalPath);
      const prefix = "discover" + path.sep;
      if (relativePath.startsWith(prefix)) {
        relativePath = relativePath.slice(prefix.length);
      }
      const parts = relativePath.split(path.sep).filter(Boolean);
      if (parts.length < 3) continue;
      const artistDir = parts[0];
      const albumDir = parts[1];
      if (artistDir !== sanitizedArtist || albumDir !== sanitizedAlbum) continue;
      const symlinkPath = path.join(
        this.navidromeMusicFolder,
        WEEKLY_FLOW_NAVIDROME_DIR,
        "discover",
        relativePath,
      );
      try {
        await fs.unlink(symlinkPath);
      } catch {}
    }
  }

  async createPlaylist(playlistType, playlistName) {
    if (!this.navidromeClient || !this.navidromeClient.isConfigured()) {
      console.warn(
        "[WeeklyFlowPlaylistManager] Navidrome not configured, skipping playlist creation",
      );
      return null;
    }

    const jobs = downloadTracker.getByPlaylistType(playlistType);
    const completedJobs = jobs.filter(
      (j) => j.status === "done" && j.finalPath,
    );

    if (completedJobs.length === 0) {
      console.warn(
        `[WeeklyFlowPlaylistManager] No completed downloads for ${playlistType}`,
      );
      return null;
    }

    const songIds = [];

    for (const job of completedJobs) {
      try {
        const song = await this.navidromeClient.findSong(
          job.trackName,
          job.artistName,
        );
        if (song && song.id) {
          songIds.push(song.id);
        } else {
          console.warn(
            `[WeeklyFlowPlaylistManager] Song not found in Navidrome: ${job.artistName} - ${job.trackName}`,
          );
        }
      } catch (error) {
        console.warn(
          `[WeeklyFlowPlaylistManager] Error finding song ${job.artistName} - ${job.trackName}:`,
          error.message,
        );
      }
    }

    if (songIds.length === 0) {
      console.warn(
        `[WeeklyFlowPlaylistManager] No songs found in Navidrome for ${playlistType}`,
      );
      return null;
    }

    try {
      const playlist = await this.navidromeClient.createPlaylist(
        playlistName,
        songIds,
        true,
      );
      console.log(
        `[WeeklyFlowPlaylistManager] Created playlist "${playlistName}" with ${songIds.length} songs`,
      );
      return playlist;
    } catch (error) {
      console.error(
        `[WeeklyFlowPlaylistManager] Failed to create playlist:`,
        error.message,
      );
      throw error;
    }
  }

  async triggerNavidromeScan() {
    if (!this.navidromeClient || !this.navidromeClient.isConfigured()) {
      return;
    }

    try {
      await this.navidromeClient.request("startScan");
      console.log("[WeeklyFlowPlaylistManager] Triggered Navidrome scan");
    } catch (error) {
      console.warn(
        "[WeeklyFlowPlaylistManager] Failed to trigger Navidrome scan:",
        error.message,
      );
    }
  }

  async weeklyReset(playlistTypes = ["discover", "mix", "trending"]) {
    if (!this.navidromeClient || !this.navidromeClient.isConfigured()) {
      console.warn(
        "[WeeklyFlowPlaylistManager] Navidrome not configured, skipping playlist deletion",
      );
    } else {
      const playlistNames = {
        discover: "Aurral Discover",
        mix: "Aurral Mix",
        trending: "Aurral Trending",
      };

      for (const playlistType of playlistTypes) {
        const playlistName =
          playlistNames[playlistType] || `Aurral ${playlistType}`;
        try {
          const playlists = await this.navidromeClient.getPlaylists();
          const playlist = playlists.find((p) => p.name === playlistName);
          if (playlist) {
            await this.navidromeClient.deletePlaylist(playlist.id);
            console.log(
              `[WeeklyFlowPlaylistManager] Deleted playlist: ${playlistName}`,
            );
          }
        } catch (error) {
          console.warn(
            `[WeeklyFlowPlaylistManager] Failed to delete playlist ${playlistName}:`,
            error.message,
          );
        }
      }
    }

    if (this.navidromeMusicFolder) {
      for (const playlistType of playlistTypes) {
        const symlinkDir = path.join(
          this.navidromeMusicFolder,
          WEEKLY_FLOW_NAVIDROME_DIR,
          playlistType,
        );
        try {
          await fs.rm(symlinkDir, { recursive: true, force: true });
          console.log(
            `[WeeklyFlowPlaylistManager] Deleted symlinks for ${playlistType}`,
          );
        } catch (error) {
          console.warn(
            `[WeeklyFlowPlaylistManager] Failed to delete symlinks for ${playlistType}:`,
            error.message,
          );
        }
      }
    }

    const fallbackDir = path.join(this.weeklyFlowRoot, "_fallback");
    try {
      await fs.rm(fallbackDir, { recursive: true, force: true });
    } catch {}

    for (const playlistType of playlistTypes) {
      const jobs = downloadTracker.getByPlaylistType(playlistType);
      for (const job of jobs) {
        const stagingDir = path.join(this.weeklyFlowRoot, "_staging", job.id);
        try {
          await fs.rm(stagingDir, { recursive: true, force: true });
        } catch {}
      }
      const playlistDir = path.join(this.weeklyFlowRoot, playlistType);
      try {
        await fs.rm(playlistDir, { recursive: true, force: true });
        console.log(
          `[WeeklyFlowPlaylistManager] Deleted files for ${playlistType}`,
        );
      } catch (error) {
        console.warn(
          `[WeeklyFlowPlaylistManager] Failed to delete files for ${playlistType}:`,
          error.message,
        );
      }
      if (playlistType === "discover") {
        try {
          await fs.rm(path.join(this.weeklyFlowRoot, "recommended"), {
            recursive: true,
            force: true,
          });
        } catch {}
      }
      downloadTracker.clearByPlaylistType(playlistType);
    }

    await this.triggerNavidromeScan();
  }

  getPlaylistName(playlistType) {
    const names = {
      discover: "Aurral Discover",
      mix: "Aurral Mix",
      trending: "Aurral Trending",
    };
    return names[playlistType] || `Aurral ${playlistType}`;
  }
}

export const playlistManager = new WeeklyFlowPlaylistManager();
