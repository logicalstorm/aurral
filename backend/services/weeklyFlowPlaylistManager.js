import path from "path";
import fs from "fs/promises";
import NodeID3 from "node-id3";
import { dbOps } from "../config/db-helpers.js";
import { downloadTracker } from "./weeklyFlowDownloadTracker.js";
import { NavidromeClient } from "./navidrome.js";

const PLAYLIST_GENRE = {
  discover: "Aurral Discover",
  mix: "Aurral Mix",
  trending: "Aurral Trending",
};

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

  tagFileWithPlaylistType(filePath, playlistType) {
    const genre = PLAYLIST_GENRE[playlistType];
    if (!genre) return;
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== ".mp3") return;
    try {
      NodeID3.update({ genre }, filePath);
    } catch (err) {
      console.warn(
        `[WeeklyFlowPlaylistManager] Failed to tag ${filePath}:`,
        err?.message,
      );
    }
  }

  async ensureSmartPlaylists() {
    if (!this.navidromeMusicFolder) return;
    const dir = path.join(this.navidromeMusicFolder, ".aurral-weekly-flow");
    const playlists = [
      { name: "Aurral Discover", genre: "Aurral Discover" },
      { name: "Aurral Mix", genre: "Aurral Mix" },
      { name: "Aurral Trending", genre: "Aurral Trending" },
    ];
    try {
      await fs.mkdir(dir, { recursive: true });
      for (const { name, genre } of playlists) {
        const nspPath = path.join(dir, `${name}.nsp`);
        const payload = {
          all: [{ is: { genre } }],
          sort: "title",
          order: "asc",
          limit: 1000,
        };
        await fs.writeFile(nspPath, JSON.stringify(payload), "utf8");
      }
    } catch (err) {
      console.warn(
        "[WeeklyFlowPlaylistManager] Failed to write smart playlists:",
        err?.message,
      );
    }
  }

  async createSymlink(sourcePath, playlistType) {
    if (!this.navidromeMusicFolder) {
      return null;
    }
    this.tagFileWithPlaylistType(sourcePath, playlistType);
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
        ".aurral-weekly-flow",
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
        ".aurral-weekly-flow",
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
          ".aurral-weekly-flow",
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
