import path from "path";
import fs from "fs/promises";
import { dbOps } from "../config/db-helpers.js";
import { downloadTracker } from "./weeklyFlowDownloadTracker.js";
import { NavidromeClient } from "./navidrome.js";
import { flowPlaylistConfig } from "./weeklyFlowPlaylistConfig.js";
import { lidarrClient } from "./lidarrClient.js";

const WEEKLY_FLOW_NAVIDROME_DIR = "aurral-weekly-flow";

export class WeeklyFlowPlaylistManager {
  constructor(weeklyFlowRoot = process.env.WEEKLY_FLOW_FOLDER || "./downloads") {
    this.weeklyFlowRoot = path.isAbsolute(weeklyFlowRoot)
      ? weeklyFlowRoot
      : path.resolve(process.cwd(), weeklyFlowRoot);
    this.navidromeClient = null;
    this.navidromeMusicFolder = null;
    this.weeklyFlowSymlinkRoot = null;
    this.updateConfig();
  }

  updateConfig() {
    const settings = dbOps.getSettings();
    const navidromeConfig = settings.integrations?.navidrome || {};
    this.navidromeMusicFolder =
      settings.integrations?.navidrome?.musicFolder ||
      process.env.NAVIDROME_MUSIC_FOLDER ||
      null;
    this.weeklyFlowSymlinkRoot =
      process.env.WEEKLY_FLOW_SYMLINK_ROOT ||
      (this.navidromeMusicFolder
        ? path.join(path.dirname(this.navidromeMusicFolder), WEEKLY_FLOW_NAVIDROME_DIR)
        : null);

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

    if (this.navidromeMusicFolder && this.weeklyFlowSymlinkRoot) {
      this.ensureSmartPlaylists().catch((err) =>
        console.warn(
          "[WeeklyFlowPlaylistManager] ensureSmartPlaylists on config:",
          err?.message,
        ),
      );
    } else if (!this.navidromeMusicFolder && lidarrClient.isConfigured()) {
      lidarrClient.getRootFolders().then((folders) => {
        const pathFromLidarr = folders?.[0]?.path;
        if (pathFromLidarr && !this.navidromeMusicFolder) {
          this.navidromeMusicFolder = pathFromLidarr;
          if (!this.weeklyFlowSymlinkRoot) {
            this.weeklyFlowSymlinkRoot = path.join(
              path.dirname(this.navidromeMusicFolder),
              WEEKLY_FLOW_NAVIDROME_DIR,
            );
          }
          this.ensureSmartPlaylists().catch((err) =>
            console.warn(
              "[WeeklyFlowPlaylistManager] ensureSmartPlaylists (from Lidarr):",
              err?.message,
            ),
          );
        }
      }).catch(() => {});
    }
  }

  _sanitize(str) {
    return String(str || "").replace(/[<>:"/\\|?*]/g, "_").trim();
  }

  async ensureSmartPlaylists() {
    if (!this.weeklyFlowSymlinkRoot) return;
    const dir = this.weeklyFlowSymlinkRoot;
    const allPlaylists = [
      { type: "discover", name: "Aurral Discover" },
      { type: "mix", name: "Aurral Mix" },
      { type: "trending", name: "Aurral Trending" },
    ];
    const config = flowPlaylistConfig.getPlaylists();
    try {
      await fs.mkdir(dir, { recursive: true });
      for (const { type, name } of allPlaylists) {
        const nspPath = path.join(dir, `${name}.nsp`);
        const isEnabled = config[type]?.enabled;
        if (isEnabled) {
          const payload = {
            all: [
              { contains: { filepath: path.basename(this.weeklyFlowSymlinkRoot) } },
              { contains: { filepath: type } },
            ],
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
    if (!this.weeklyFlowSymlinkRoot) {
      return null;
    }
    try {
      await fs.access(path.dirname(this.weeklyFlowSymlinkRoot));
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
        this.weeklyFlowSymlinkRoot,
        playlistType,
        relativePath,
      );

      const symlinkDir = path.dirname(symlinkPath);
      await fs.mkdir(symlinkDir, { recursive: true });

      try {
        await fs.access(symlinkPath);
        await fs.unlink(symlinkPath);
      } catch {}

      const symlinkTarget = process.env.SYMLINK_PATH
        ? path.join(process.env.SYMLINK_PATH, relativePathFull)
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
    if (!this.weeklyFlowSymlinkRoot) return;
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
        this.weeklyFlowSymlinkRoot,
        "discover",
        relativePath,
      );
      try {
        await fs.unlink(symlinkPath);
      } catch {}
    }
  }

  async weeklyReset(playlistTypes = ["discover", "mix", "trending"]) {
    if (this.weeklyFlowSymlinkRoot) {
      for (const playlistType of playlistTypes) {
        const symlinkDir = path.join(
          this.weeklyFlowSymlinkRoot,
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
