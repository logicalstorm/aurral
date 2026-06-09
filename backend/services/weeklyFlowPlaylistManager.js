import path from "path";
import fs from "fs/promises";
import { dbOps } from "../config/db-helpers.js";
import { NavidromeClient } from "./navidrome.js";
import { flowPlaylistConfig } from "./weeklyFlowPlaylistConfig.js";
import { downloadTracker } from "./weeklyFlowDownloadTracker.js";
import { writePlaylistArtworkWebpFromBuffer } from "./playlistArtwork.js";
import {
  getArtworkExtensionForStyle,
  getPlaylistArtworkStyle,
  writeGeneratedPlaylistArtwork,
} from "./playlistArtworkGenerator.js";
import {
  PLAYLIST_LIBRARY_DIR,
  resolvePlaylistRoot,
} from "./playlistPaths.js";
import { buildM3uContent, collectPlaylistM3uEntries } from "./playlistM3u.js";

const ARTWORK_FILE_EXTENSIONS = [".webp", ".jpg", ".png"];
const ARTWORK_SUPPRESS_SUFFIX = ".no-artwork";
const PLAYLIST_FILE_EXTENSIONS = [".m3u", ".nsp"];
const SCAN_DEBOUNCE_MS = 30000;

export class WeeklyFlowPlaylistManager {
  constructor(
    weeklyFlowRoot = resolvePlaylistRoot(),
    { triggerEnsureOnInit = process.env.NODE_ENV !== "test" } = {},
  ) {
    this.weeklyFlowRoot = resolvePlaylistRoot(weeklyFlowRoot);
    this.playlistLibraryRoot = path.join(
      this.weeklyFlowRoot,
      PLAYLIST_LIBRARY_DIR,
    );
    this.libraryRoot = path.join(this.playlistLibraryRoot, "_playlists");
    this.navidromeClient = null;
    this._navidromeConfigKey = "";
    this._ensureInFlight = null;
    this._refreshInFlight = new Map();
    this._scanTimer = null;
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
      this.ensurePlaylists().catch((err) =>
        console.warn(
          "[WeeklyFlowPlaylistManager] ensurePlaylists on config:",
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

  _getPlaylistLibraryHostPath() {
    return this.playlistLibraryRoot.replace(/\\/g, "/").replace(/\/+$/, "");
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

  async ensurePlaylists() {
    if (this._ensureInFlight) {
      return this._ensureInFlight;
    }
    this._ensureInFlight = this._ensurePlaylistsInternal();
    try {
      return await this._ensureInFlight;
    } finally {
      this._ensureInFlight = null;
    }
  }

  async ensureSmartPlaylists() {
    return this.ensurePlaylists();
  }

  async refreshPlaylist(playlistType) {
    const key = String(playlistType || "");
    if (this._refreshInFlight.has(key)) {
      return this._refreshInFlight.get(key);
    }
    const task = this._refreshPlaylistInternal(playlistType).finally(() => {
      this._refreshInFlight.delete(key);
    });
    this._refreshInFlight.set(key, task);
    return task;
  }

  async _refreshPlaylistInternal(playlistType) {
    const flow = flowPlaylistConfig.getFlow(playlistType);
    if (flow) {
      if (!flow.enabled) return null;
      const { current } = this._getFlowPlaylistNames(flow.name);
      return this._writePlaylistFile(current, playlistType, "Flow");
    }
    const sharedPlaylist = flowPlaylistConfig.getSharedPlaylist(playlistType);
    if (!sharedPlaylist) return null;
    const { current } = this._getSharedPlaylistNames(sharedPlaylist.name);
    return this._writePlaylistFile(current, playlistType, "Playlist");
  }

  scheduleScanLibrary(force = false) {
    if (force) {
      if (this._scanTimer) {
        clearTimeout(this._scanTimer);
        this._scanTimer = null;
      }
      return this.scanLibrary();
    }
    if (this._scanTimer) {
      return null;
    }
    this._scanTimer = setTimeout(() => {
      this._scanTimer = null;
      this.scanLibrary().catch((error) => {
        console.warn(
          "[WeeklyFlowPlaylistManager] scanLibrary failed:",
          error?.message,
        );
      });
    }, SCAN_DEBOUNCE_MS);
    return null;
  }

  async _ensureFlowArtwork(playlistType, playlistName, artworkKind) {
    await fs.mkdir(this.libraryRoot, { recursive: true });
    const baseName = this._getPlaylistBaseName(playlistName);
    const artworkExtension = getArtworkExtensionForStyle(getPlaylistArtworkStyle());
    const artworkPath = path.join(
      this.libraryRoot,
      `${baseName}${artworkExtension}`,
    );
    const safeRoot = path.resolve(this.libraryRoot);
    const suppressed = await this._isArtworkGenerationSuppressed(
      safeRoot,
      baseName,
    );
    if (!(await this._playlistArtworkExists(baseName)) && !suppressed) {
      const artworkContext = this.getArtworkContextForPlaylistId(playlistType);
      await writeGeneratedPlaylistArtwork({
        outputPath: artworkPath,
        title: artworkContext?.title || playlistName,
        kind: artworkContext?.kind || artworkKind,
        signature: artworkContext?.signature || playlistType,
        relatedArtists: artworkContext?.relatedArtists || [],
      });
    }
  }

  async _writePlaylistFile(playlistName, playlistType, artworkKind) {
    await fs.mkdir(this.libraryRoot, { recursive: true });
    const baseName = this._getPlaylistBaseName(playlistName);
    const m3uPath = path.join(this.libraryRoot, `${baseName}.m3u`);
    const entries = await collectPlaylistM3uEntries(playlistType, {
      weeklyFlowRoot: this.weeklyFlowRoot,
    });
    await fs.writeFile(m3uPath, buildM3uContent(entries), "utf8");
    await this._ensureFlowArtwork(playlistType, playlistName, artworkKind);
    return m3uPath;
  }

  async _ensurePlaylistsInternal() {
    const flows = flowPlaylistConfig.getFlows();
    const sharedPlaylists = flowPlaylistConfig.getSharedPlaylists();
    let playlists = null;
    if (this.navidromeClient?.isConfigured()) {
      try {
        const hostPath = this._getPlaylistLibraryHostPath();
        await this.navidromeClient.ensureWeeklyFlowLibrary(hostPath);
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
      const trackExpectedArtworkFiles = (baseName) => {
        for (const extension of ARTWORK_FILE_EXTENSIONS) {
          expectedFiles.add(`${baseName}${extension}`);
        }
      };
      const trackExpectedPlaylistFiles = (baseName) => {
        expectedFiles.add(`${baseName}.m3u`);
        trackExpectedArtworkFiles(baseName);
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
      const deletePlaylistM3uByNames = async (playlistNames) => {
        const uniqueNames = [...new Set((playlistNames || []).filter(Boolean))];
        for (const playlistName of uniqueNames) {
          const baseName = this._getPlaylistBaseName(playlistName);
          for (const extension of PLAYLIST_FILE_EXTENSIONS) {
            try {
              await fs.unlink(
                path.join(this.libraryRoot, `${baseName}${extension}`),
              );
            } catch {}
          }
        }
      };
      const deletePlaylistAssetsByNames = async (playlistNames) => {
        const uniqueNames = [...new Set((playlistNames || []).filter(Boolean))];
        for (const playlistName of uniqueNames) {
          const baseName = this._getPlaylistBaseName(playlistName);
          for (const extension of [
            ...PLAYLIST_FILE_EXTENSIONS,
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
        trackExpectedPlaylistFiles(this._getPlaylistBaseName(playlistName));
        await this._writePlaylistFile(playlistName, playlistType, artworkKind);
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
          await deletePlaylistM3uByNames([playlistName]);
          await deletePlaylistAssetsByNames(legacy);
          trackExpectedArtworkFiles(this._getPlaylistBaseName(playlistName));
          await this._ensureFlowArtwork(flow.id, playlistName, "Flow");
        }
      }
      for (const playlist of sharedPlaylists) {
        const { current, legacy } = this._getSharedPlaylistNames(playlist.name);
        await writePlaylistFile(current, playlist.id, "Playlist");
        await deleteNavidromePlaylistsByNames(legacy);
        await deletePlaylistAssetsByNames(legacy);
      }
      const toRemove = existingFiles.filter((file) => {
        const extension = path.extname(file).toLowerCase();
        if (
          ARTWORK_FILE_EXTENSIONS.includes(extension) ||
          PLAYLIST_FILE_EXTENSIONS.includes(extension)
        ) {
          return !expectedFiles.has(file);
        }
        return false;
      });
      for (const file of toRemove) {
        const extension = path.extname(file).toLowerCase();
        if (PLAYLIST_FILE_EXTENSIONS.includes(extension)) {
          await deleteNavidromePlaylistByName(path.basename(file, extension));
        }
        try {
          await fs.unlink(path.join(this.libraryRoot, file));
        } catch {}
      }
    } catch (err) {
      console.warn(
        "[WeeklyFlowPlaylistManager] Failed to write playlists:",
        err?.message,
      );
    }
  }

  async _playlistArtworkExists(baseName) {
    for (const extension of ARTWORK_FILE_EXTENSIONS) {
      try {
        await fs.access(
          path.join(this.libraryRoot, `${baseName}${extension}`),
        );
        return true;
      } catch {}
    }
    return false;
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
      const playlistDir = path.join(this.playlistLibraryRoot, playlistType);
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

  getArtworkContextForPlaylistId(playlistId) {
    const flow = flowPlaylistConfig.getFlow(playlistId);
    if (flow) {
      return {
        kind: "Flow",
        title: flow.name,
        signature: flow.discoverPresetId || flow.id || flow.name,
        relatedArtists: Array.isArray(flow.relatedArtists)
          ? flow.relatedArtists
          : [],
      };
    }
    const playlist = flowPlaylistConfig.getSharedPlaylist(playlistId);
    if (playlist) {
      return {
        kind: "Playlist",
        title: playlist.name,
        signature: playlist.id || playlist.name,
        relatedArtists: [],
      };
    }
    return null;
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
    const artworkExtension = getArtworkExtensionForStyle(getPlaylistArtworkStyle());
    const artworkPath = path.join(
      resolved.safeRoot,
      `${resolved.baseName}${artworkExtension}`,
    );
    if (path.dirname(artworkPath) !== resolved.safeRoot) {
      throw new Error("Invalid artwork path");
    }
    const artworkContext = this.getArtworkContextForPlaylistId(playlistId);
    const outputPath = await writeGeneratedPlaylistArtwork({
      outputPath: artworkPath,
      title: artworkContext?.title || resolved.playlistName,
      kind: artworkContext?.kind || this.getArtworkKindForPlaylistId(playlistId),
      signature: artworkContext?.signature || playlistId,
      relatedArtists: artworkContext?.relatedArtists || [],
      rotateSourceImage: true,
    });
    await this._setArtworkGenerationSuppressed(
      resolved.safeRoot,
      resolved.baseName,
      false,
    );
    return outputPath;
  }
}

export const playlistManager = new WeeklyFlowPlaylistManager();
