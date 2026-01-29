import path from "path";
import fs from "fs/promises";
import { dbOps } from "../config/db-helpers.js";
import { downloadTracker } from "./weeklyFlowDownloadTracker.js";
import { NavidromeClient } from "./navidrome.js";

export class WeeklyFlowPlaylistManager {
  constructor(weeklyFlowRoot = "./weekly-flow") {
    this.weeklyFlowRoot = weeklyFlowRoot;
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
  }

  async createSymlink(sourcePath, playlistType) {
    if (!this.navidromeMusicFolder) {
      console.warn(
        "[WeeklyFlowPlaylistManager] Navidrome music folder not configured, skipping symlink",
      );
      return null;
    }

    try {
      const relativePath = path.relative(this.weeklyFlowRoot, sourcePath);
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

      const absoluteSource = path.resolve(sourcePath);
      await fs.symlink(absoluteSource, symlinkPath);

      return symlinkPath;
    } catch (error) {
      console.error(
        `[WeeklyFlowPlaylistManager] Failed to create symlink for ${sourcePath}:`,
        error.message,
      );
      return null;
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

  async weeklyReset(playlistTypes = ["discover", "recommended"]) {
    if (!this.navidromeClient || !this.navidromeClient.isConfigured()) {
      console.warn(
        "[WeeklyFlowPlaylistManager] Navidrome not configured, skipping playlist deletion",
      );
    } else {
      const playlistNames = {
        discover: "Aurral Discover",
        recommended: "Aurral Recommended",
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

    for (const playlistType of playlistTypes) {
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
    }

    downloadTracker.clearAll();

    await this.triggerNavidromeScan();
  }

  getPlaylistName(playlistType) {
    const names = {
      discover: "Aurral Discover",
      recommended: "Aurral Recommended",
    };
    return names[playlistType] || `Aurral ${playlistType}`;
  }
}

export const playlistManager = new WeeklyFlowPlaylistManager();
