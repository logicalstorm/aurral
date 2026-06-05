import path from "path";
import fs from "fs/promises";
import { dbOps } from "../config/db-helpers.js";
import { NavidromeClient } from "./navidrome.js";
import { flowPlaylistConfig } from "./weeklyFlowPlaylistConfig.js";
import { downloadTracker } from "./weeklyFlowDownloadTracker.js";
import {
  writePlaylistArtworkSidecar,
  writePlaylistArtworkWebpFromBuffer,
} from "./playlistArtwork.js";

const ARTWORK_FILE_EXTENSIONS = [".webp", ".png"];
const ARTWORK_SUPPRESS_SUFFIX = ".no-artwork";

export class WeeklyFlowPlaylistManager {
  constructor(
    weeklyFlowRoot = process.env.WEEKLY_FLOW_FOLDER || "/app/downloads",
    { triggerEnsureOnInit = process.env.NODE_ENV !== "test" } = {},
  ) {
    this.weeklyFlowRoot = path.isAbsolute(weeklyFlowRoot)
      ? weeklyFlowRoot
      : path.resolve(process.cwd(), weeklyFlowRoot);
    this.libraryRoot = path.join(this.weeklyFlowRoot, "aurral-weekly-flow");
    this.navidromeClient = null;
    this._navidromeConfigKey = "";
    this._ensureInFlight = null;
    this.updateConfig(triggerEnsureOnInit);
  }

  updateConfig(triggerEnsurePlaylists = true) {
    const settings = dbOps.getSettings();
    const navidromeConfig = settings.integrations?.navidrome || {};
    const nextConfigKey = JSON.stringify({
      url: navidromeConfig.url || "",
      username: navidromeConfig.username || "",
      password: navidromeConfig.password || "",
    });
    const configChanged = this._navidromeConfigKey !== nextConfigKey;
    this._navidromeConfigKey = nextConfigKey;

    if (
      navidromeConfig.url &&
      navidromeConfig.username &&
      navidromeConfig.password
    ) {
      if (!this.navidromeClient || configChanged) {
        this.navidromeClient = new NavidromeClient(
          navidromeConfig.url,
          navidromeConfig.username,
          navidromeConfig.password,
        );
      }
    } else {
      this.navidromeClient = null;
    }

    if (triggerEnsurePlaylists) {
      this.ensureSmartPlaylists().catch((err) =>
        console.warn(
          "[WeeklyFlowPlaylistManager] ensureSmartPlaylists on config:",
          err?.message,
        ),
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

  _getPlaylistBaseName(playlistName) {
    return this._sanitize(playlistName);
  }

  _getFlowPlaylistNames(flowName) {
    const name = String(flowName || "").trim();
    return {
      current: `[A] ${name}`,
      legacy: [`Aurral ${name}`],
    };
  }

  _getSharedPlaylistNames(playlistName) {
    const name = String(playlistName || "").trim();
    return {
      current: `[AS] ${name}`,
      legacy: [`Aurral Shared ${name}`],
    };
  }

  _getPlaylistNameSet(playlistType) {
    const flow = flowPlaylistConfig.getFlow(playlistType);
    if (flow) {
      const names = this._getFlowPlaylistNames(flow.name);
      return [names.current, ...names.legacy];
    }
    const sharedPlaylist = flowPlaylistConfig.getSharedPlaylist(playlistType);
    if (sharedPlaylist) {
      const names = this._getSharedPlaylistNames(sharedPlaylist.name);
      return [names.current, ...names.legacy];
    }
    return [`[A] ${playlistType}`, `Aurral ${playlistType}`];
  }

  async ensureSmartPlaylists() {
    if (this._ensureInFlight) {
      return this._ensureInFlight;
    }
    this._ensureInFlight = this._ensureSmartPlaylistsInternal();
    try {
      return await this._ensureInFlight;
    } finally {
      this._ensureInFlight = null;
    }
  }

  async _ensureSmartPlaylistsInternal() {
    const flows = flowPlaylistConfig.getFlows();
    const sharedPlaylists = flowPlaylistConfig.getSharedPlaylists();
    let libraryId = null;
    let playlists = null;
    if (this.navidromeClient?.isConfigured()) {
      try {
        const hostPath = this._getWeeklyFlowLibraryHostPath();
        const library =
          await this.navidromeClient.ensureWeeklyFlowLibrary(hostPath);
        if (
          library != null &&
          library.id !== undefined &&
          library.id !== null
        ) {
          libraryId = library.id;
        } else if (library != null) {
          console.warn(
            "[WeeklyFlowPlaylistManager] Aurral library has no id; smart playlists will not be scoped by library.",
          );
        }
      } catch (err) {
        console.warn(
          "[WeeklyFlowPlaylistManager] ensureWeeklyFlowLibrary failed:",
          err?.message,
        );
      }
      try {
        const raw = await this.navidromeClient.getPlaylists();
        playlists = Array.isArray(raw) ? raw : raw ? [raw] : [];
      } catch (err) {
        console.warn(
          "[WeeklyFlowPlaylistManager] getPlaylists failed:",
          err?.message,
        );
      }
    }

    try {
      await fs.mkdir(this.libraryRoot, { recursive: true });
      const existingFiles = await fs.readdir(this.libraryRoot).catch(() => []);
      const expectedFiles = new Set();
      const trackExpectedFiles = (baseName) => {
        expectedFiles.add(`${baseName}.nsp`);
        expectedFiles.add(`${baseName}.webp`);
      };
      const playlistArtworkExists = async (baseName) => {
        for (const extension of ARTWORK_FILE_EXTENSIONS) {
          try {
            await fs.access(
              path.join(this.libraryRoot, `${baseName}${extension}`),
            );
            return true;
          } catch {}
        }
        return false;
      };
      const deleteNavidromePlaylistByName = async (playlistName) => {
        if (!playlists?.length) return;
        const existing = playlists.find(
          (playlist) => playlist.name === playlistName,
        );
        if (!existing) return;
        try {
          await this.navidromeClient.deletePlaylist(existing.id);
        } catch (err) {
          console.warn(
            `[WeeklyFlowPlaylistManager] Failed to delete playlist "${playlistName}" from Navidrome:`,
            err?.message,
          );
        }
      };
      const deleteNavidromePlaylistsByNames = async (playlistNames) => {
        const uniqueNames = [...new Set((playlistNames || []).filter(Boolean))];
        for (const playlistName of uniqueNames) {
          await deleteNavidromePlaylistByName(playlistName);
        }
      };
      const deletePlaylistAssetsByNames = async (playlistNames) => {
        const uniqueNames = [...new Set((playlistNames || []).filter(Boolean))];
        for (const playlistName of uniqueNames) {
          const baseName = this._getPlaylistBaseName(playlistName);
          for (const extension of [
            ".nsp",
            ...ARTWORK_FILE_EXTENSIONS,
            ARTWORK_SUPPRESS_SUFFIX,
          ]) {
            try {
              await fs.unlink(
                path.join(this.libraryRoot, `${baseName}${extension}`),
              );
            } catch {}
          }
        }
      };
      const writePlaylistFile = async (
        playlistName,
        playlistType,
        artworkKind,
      ) => {
        const baseName = this._getPlaylistBaseName(playlistName);
        const nspPath = path.join(this.libraryRoot, `${baseName}.nsp`);
        const artworkPath = path.join(this.libraryRoot, `${baseName}.webp`);
        trackExpectedFiles(baseName);
        const pathCondition = { contains: { filepath: playlistType } };
        const all =
          libraryId != null
            ? [{ is: { library_id: libraryId } }, pathCondition]
            : [pathCondition];
        const payload = {
          all,
          // Keep playlist order stable as tracks are added over time.
          sort: "filepath",
          limit: 1000,
        };
        await fs.writeFile(nspPath, JSON.stringify(payload), "utf8");
        const safeRoot = path.resolve(this.libraryRoot);
        const suppressed = await this._isArtworkGenerationSuppressed(
          safeRoot,
          baseName,
        );
        if (!(await playlistArtworkExists(baseName)) && !suppressed) {
          await writePlaylistArtworkSidecar({
            playlistName,
            kind: artworkKind,
            outputPath: artworkPath,
          });
        }
      };
      for (const flow of flows) {
        const { current, legacy } = this._getFlowPlaylistNames(flow.name);
        const playlistName = current;
        if (flow.enabled) {
          await writePlaylistFile(playlistName, flow.id, "Flow");
          await deleteNavidromePlaylistsByNames(legacy);
          await deletePlaylistAssetsByNames(legacy);
        } else {
          await deleteNavidromePlaylistsByNames([playlistName, ...legacy]);
          await deletePlaylistAssetsByNames([playlistName, ...legacy]);
        }
      }
      for (const playlist of sharedPlaylists) {
        const { current, legacy } = this._getSharedPlaylistNames(playlist.name);
        await writePlaylistFile(current, playlist.id, "Playlist");
        await deleteNavidromePlaylistsByNames(legacy);
        await deletePlaylistAssetsByNames(legacy);
      }
      const toRemove = existingFiles.filter(
        (file) =>
          (file.endsWith(".nsp") ||
            file.endsWith(".png") ||
            file.endsWith(".webp")) &&
          !expectedFiles.has(file),
      );
      for (const file of toRemove) {
        if (file.endsWith(".nsp")) {
          await deleteNavidromePlaylistByName(path.basename(file, ".nsp"));
        }
        try {
          await fs.unlink(path.join(this.libraryRoot, file));
        } catch {}
      }
    } catch (err) {
      console.warn(
        "[WeeklyFlowPlaylistManager] Failed to write smart playlists:",
        err?.message,
      );
    }
  }

  async scanLibrary() {
    if (!this.navidromeClient?.isConfigured()) return null;
    return this.navidromeClient.scanLibrary();
  }

  async weeklyReset(playlistTypes = null) {
    const targets =
      playlistTypes && playlistTypes.length
        ? playlistTypes
        : flowPlaylistConfig.getFlows().map((flow) => flow.id);
    const fallbackDir = path.join(this.weeklyFlowRoot, "_fallback");
    try {
      await fs.rm(fallbackDir, { recursive: true, force: true });
    } catch {}

    for (const playlistType of targets) {
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
    return this._getPlaylistNameSet(playlistType)[0];
  }

  getArtworkKindForPlaylistId(playlistId) {
    if (flowPlaylistConfig.getFlow(playlistId)) return "Flow";
    return "Playlist";
  }

  _resolveArtworkBase(playlistId) {
    const playlistName = this.getPlaylistName(playlistId);
    if (!playlistName) return null;
    const baseName = this._getPlaylistBaseName(playlistName);
    const safeRoot = path.resolve(this.libraryRoot);
    return { safeRoot, baseName, playlistName };
  }

  _artworkSuppressPath(safeRoot, baseName) {
    const safePath = path.resolve(safeRoot, `${baseName}${ARTWORK_SUPPRESS_SUFFIX}`);
    if (path.dirname(safePath) !== safeRoot) return null;
    return safePath;
  }

  async _isArtworkGenerationSuppressed(safeRoot, baseName) {
    const suppressPath = this._artworkSuppressPath(safeRoot, baseName);
    if (!suppressPath) return false;
    try {
      const stat = await fs.stat(suppressPath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async _setArtworkGenerationSuppressed(safeRoot, baseName, suppressed) {
    const suppressPath = this._artworkSuppressPath(safeRoot, baseName);
    if (!suppressPath) return;
    if (suppressed) {
      await fs.writeFile(suppressPath, "", "utf8");
      return;
    }
    try {
      await fs.unlink(suppressPath);
    } catch {}
  }

  async resolveArtworkFile(playlistId) {
    const resolved = this._resolveArtworkBase(playlistId);
    if (!resolved) return null;
    for (const extension of ARTWORK_FILE_EXTENSIONS) {
      const safePath = path.resolve(
        resolved.safeRoot,
        `${resolved.baseName}${extension}`,
      );
      if (path.dirname(safePath) !== resolved.safeRoot) continue;
      try {
        const stat = await fs.stat(safePath);
        if (stat.isFile()) {
          return { ...resolved, safePath, extension };
        }
      } catch {}
    }
    return null;
  }

  async saveArtworkUpload(playlistId, buffer) {
    const resolved = this._resolveArtworkBase(playlistId);
    if (!resolved) {
      throw new Error("Playlist not found");
    }
    await fs.mkdir(resolved.safeRoot, { recursive: true });
    const webpPath = path.join(resolved.safeRoot, `${resolved.baseName}.webp`);
    if (path.dirname(webpPath) !== resolved.safeRoot) {
      throw new Error("Invalid artwork path");
    }
    await writePlaylistArtworkWebpFromBuffer(buffer, webpPath);
    const legacyPng = path.join(resolved.safeRoot, `${resolved.baseName}.png`);
    try {
      await fs.unlink(legacyPng);
    } catch {}
    await this._setArtworkGenerationSuppressed(
      resolved.safeRoot,
      resolved.baseName,
      false,
    );
    return webpPath;
  }

  async removeArtwork(playlistId) {
    const resolved = this._resolveArtworkBase(playlistId);
    if (!resolved) {
      throw new Error("Playlist not found");
    }
    let removed = false;
    for (const extension of ARTWORK_FILE_EXTENSIONS) {
      const safePath = path.join(
        resolved.safeRoot,
        `${resolved.baseName}${extension}`,
      );
      if (path.dirname(safePath) !== resolved.safeRoot) continue;
      try {
        await fs.unlink(safePath);
        removed = true;
      } catch {}
    }
    await this._setArtworkGenerationSuppressed(
      resolved.safeRoot,
      resolved.baseName,
      true,
    );
    return removed;
  }

  async generateArtwork(playlistId) {
    const resolved = this._resolveArtworkBase(playlistId);
    if (!resolved) {
      throw new Error("Playlist not found");
    }
    await fs.mkdir(resolved.safeRoot, { recursive: true });
    const webpPath = path.join(resolved.safeRoot, `${resolved.baseName}.webp`);
    if (path.dirname(webpPath) !== resolved.safeRoot) {
      throw new Error("Invalid artwork path");
    }
    const kind = this.getArtworkKindForPlaylistId(playlistId);
    await writePlaylistArtworkSidecar({
      playlistName: resolved.playlistName,
      kind,
      outputPath: webpPath,
    });
    const legacyPng = path.join(resolved.safeRoot, `${resolved.baseName}.png`);
    try {
      await fs.unlink(legacyPng);
    } catch {}
    await this._setArtworkGenerationSuppressed(
      resolved.safeRoot,
      resolved.baseName,
      false,
    );
    return webpPath;
  }
}

export const playlistManager = new WeeklyFlowPlaylistManager();
