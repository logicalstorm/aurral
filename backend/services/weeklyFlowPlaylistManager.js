import path from "path";
import fs from "fs/promises";
import { dbOps } from "../config/db-helpers.js";
import { NavidromeClient } from "./navidrome.js";
import { flowPlaylistConfig } from "./weeklyFlowPlaylistConfig.js";
import { downloadTracker } from "./weeklyFlowDownloadTracker.js";

export const WEEKLY_FLOW_LIBRARY_SUBFOLDER = "aurral-weekly-flow";

export class WeeklyFlowPlaylistManager {
  constructor(weeklyFlowRoot = process.env.WEEKLY_FLOW_FOLDER || "./weekly-flow") {
    this.weeklyFlowRoot = path.isAbsolute(weeklyFlowRoot)
      ? weeklyFlowRoot
      : path.resolve(process.cwd(), weeklyFlowRoot);
    this.libraryRoot = path.join(this.weeklyFlowRoot, WEEKLY_FLOW_LIBRARY_SUBFOLDER);
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

    this.ensureSmartPlaylists().catch((err) =>
      console.warn(
        "[WeeklyFlowPlaylistManager] ensureSmartPlaylists on config:",
        err?.message,
      ),
    );
  }

  _sanitize(str) {
    return String(str || "").replace(/[<>:"/\\|?*]/g, "_").trim();
  }

  _getWeeklyFlowLibraryHostPath() {
    const base =
      process.env.WEEKLY_FLOW_DOWNLOADS || "/data/downloads/tmp";
    return `${base.replace(/\\/g, "/").replace(/\/+$/, "")}/${WEEKLY_FLOW_LIBRARY_SUBFOLDER}`;
  }

  async ensureSmartPlaylists() {
    const allPlaylists = [
      { type: "discover", name: "Aurral Discover" },
      { type: "mix", name: "Aurral Mix" },
      { type: "trending", name: "Aurral Trending" },
    ];
    const config = flowPlaylistConfig.getPlaylists();
    try {
      if (this.navidromeClient?.isConfigured()) {
        const hostPath = this._getWeeklyFlowLibraryHostPath();
        await this.navidromeClient.ensureWeeklyFlowLibrary(hostPath);
      }
      await fs.mkdir(this.libraryRoot, { recursive: true });
      for (const { type, name } of allPlaylists) {
        const nspPath = path.join(this.libraryRoot, `${name}.nsp`);
        const isEnabled = config[type]?.enabled;
        if (isEnabled) {
          const payload = {
            all: [{ contains: { filepath: type } }],
            sort: "random",
            limit: 1000,
          };
          await fs.writeFile(nspPath, JSON.stringify(payload), "utf8");
        } else {
          if (this.navidromeClient?.isConfigured()) {
            try {
              const playlists = await this.navidromeClient.getPlaylists();
              const existing = playlists.find((p) => p.name === name);
              if (existing) {
                await this.navidromeClient.deletePlaylist(existing.id);
              }
            } catch (err) {
              console.warn(
                `[WeeklyFlowPlaylistManager] Failed to delete playlist "${name}" from Navidrome:`,
                err?.message,
              );
            }
          }
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

  async createSymlink(sourcePath, playlistType) {
    return null;
  }

  async removeDiscoverSymlinksForAlbum(artistName, albumName) {}

  async weeklyReset(playlistTypes = ["discover", "mix", "trending"]) {
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
      const playlistDir = path.join(this.libraryRoot, playlistType);
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
      downloadTracker.clearByPlaylistType(playlistType);
    }
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
