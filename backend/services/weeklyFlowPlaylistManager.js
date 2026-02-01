import path from "path";
import fs from "fs/promises";
import { dbOps } from "../config/db-helpers.js";
import { NavidromeClient } from "./navidrome.js";
import { flowPlaylistConfig } from "./weeklyFlowPlaylistConfig.js";
import { downloadTracker } from "./weeklyFlowDownloadTracker.js";

export class WeeklyFlowPlaylistManager {
  constructor(
    weeklyFlowRoot = process.env.WEEKLY_FLOW_FOLDER || "/app/downloads"
  ) {
    this.weeklyFlowRoot = path.isAbsolute(weeklyFlowRoot)
      ? weeklyFlowRoot
      : path.resolve(process.cwd(), weeklyFlowRoot);
    this.libraryRoot = path.join(this.weeklyFlowRoot, "aurral-weekly-flow");
    this.navidromeClient = null;
    this.updateConfig();
  }

  updateConfig(triggerEnsurePlaylists = true) {
    const settings = dbOps.getSettings();
    const navidromeConfig = settings.integrations?.navidrome || {};

    if (
      navidromeConfig.url &&
      navidromeConfig.username &&
      navidromeConfig.password
    ) {
      this.navidromeClient = new NavidromeClient(
        navidromeConfig.url,
        navidromeConfig.username,
        navidromeConfig.password
      );
    } else {
      this.navidromeClient = null;
    }

    if (triggerEnsurePlaylists) {
      this.ensureSmartPlaylists().catch((err) =>
        console.warn(
          "[WeeklyFlowPlaylistManager] ensureSmartPlaylists on config:",
          err?.message
        )
      );
    }
  }

  _sanitize(str) {
    return String(str || "")
      .replace(/[<>:"/\\|?*]/g, "_")
      .trim();
  }

  _getWeeklyFlowLibraryHostPath() {
    const base = process.env.DOWNLOAD_FOLDER || "/data/downloads/tmp";
    return `${base.replace(/\\/g, "/").replace(/\/+$/, "")}/aurral-weekly-flow`;
  }

  async ensureSmartPlaylists() {
    const allPlaylists = [
      { type: "discover", name: "Aurral Discover" },
      { type: "mix", name: "Aurral Mix" },
      { type: "trending", name: "Aurral Trending" },
    ];
    const config = flowPlaylistConfig.getPlaylists();
    let libraryId = null;
    try {
      if (this.navidromeClient?.isConfigured()) {
        const hostPath = this._getWeeklyFlowLibraryHostPath();
        const library = await this.navidromeClient.ensureWeeklyFlowLibrary(hostPath);
        if (library != null && (library.id !== undefined && library.id !== null)) {
          libraryId = library.id;
        } else if (library != null) {
          console.warn(
            "[WeeklyFlowPlaylistManager] Aurral library has no id; smart playlists will not be scoped by library."
          );
        }
      }
      await fs.mkdir(this.libraryRoot, { recursive: true });
      let playlists = null;
      if (this.navidromeClient?.isConfigured()) {
        try {
          const raw = await this.navidromeClient.getPlaylists();
          playlists = Array.isArray(raw) ? raw : raw ? [raw] : [];
        } catch (err) {
          console.warn(
            "[WeeklyFlowPlaylistManager] getPlaylists failed:",
            err?.message
          );
        }
      }
      for (const { type, name } of allPlaylists) {
        const nspPath = path.join(this.libraryRoot, `${name}.nsp`);
        const isEnabled = config[type]?.enabled;
        if (isEnabled) {
          const pathCondition = { contains: { filepath: type } };
          const all =
            libraryId != null
              ? [{ is: { library_id: libraryId } }, pathCondition]
              : [pathCondition];
          const payload = {
            all,
            sort: "random",
            limit: 1000,
          };
          await fs.writeFile(nspPath, JSON.stringify(payload), "utf8");
        } else {
          if (playlists?.length) {
            const existing = playlists.find((p) => p.name === name);
            if (existing) {
              try {
                await this.navidromeClient.deletePlaylist(existing.id);
              } catch (err) {
                console.warn(
                  `[WeeklyFlowPlaylistManager] Failed to delete playlist "${name}" from Navidrome:`,
                  err?.message
                );
              }
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
        err?.message
      );
    }
  }

  async scanLibrary() {
    if (!this.navidromeClient?.isConfigured()) return null;
    return this.navidromeClient.scanLibrary();
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
          `[WeeklyFlowPlaylistManager] Deleted files for ${playlistType}`
        );
      } catch (error) {
        console.warn(
          `[WeeklyFlowPlaylistManager] Failed to delete files for ${playlistType}:`,
          error.message
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
