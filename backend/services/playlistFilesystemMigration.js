import fs from "fs";
import path from "path";
import {
  PLAYLIST_LIBRARY_DIR,
  resolvePlaylistRoot,
} from "./playlistPaths.js";

const LEGACY_LIBRARY_DIR = "aurral-weekly-flow";
const PLAYLIST_SIDECAR_EXT = new Set([".m3u", ".nsp", ".webp", ".png"]);

function mergeDirectoryContents(sourceDir, targetDir) {
  let moved = 0;
  if (!fs.existsSync(sourceDir)) return moved;
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir)) {
    const from = path.join(sourceDir, entry);
    const to = path.join(targetDir, entry);
    const stat = fs.statSync(from);
    if (stat.isDirectory()) {
      moved += mergeDirectoryContents(from, to);
      continue;
    }
    if (fs.existsSync(to)) continue;
    fs.renameSync(from, to);
    moved += 1;
  }
  return moved;
}

function relocatePlaylistSidecars(playlistRoot) {
  const playlistsDir = path.join(playlistRoot, "_playlists");
  fs.mkdirSync(playlistsDir, { recursive: true });
  let moved = 0;
  if (!fs.existsSync(playlistRoot)) return moved;
  for (const entry of fs.readdirSync(playlistRoot)) {
    if (entry === "_playlists") continue;
    const full = path.join(playlistRoot, entry);
    if (!fs.statSync(full).isFile()) continue;
    const ext = path.extname(entry).toLowerCase();
    if (!PLAYLIST_SIDECAR_EXT.has(ext)) continue;
    const dest = path.join(playlistsDir, entry);
    if (fs.existsSync(dest)) {
      fs.rmSync(full, { force: true });
    } else {
      fs.renameSync(full, dest);
    }
    moved += 1;
  }
  return moved;
}

export function ensurePlaylistFilesystemLayout(options = {}) {
  const logger = options.logger || console;
  const root = resolvePlaylistRoot(options.root);
  const legacyDir = path.join(root, LEGACY_LIBRARY_DIR);
  const playlistRoot = path.join(root, PLAYLIST_LIBRARY_DIR);
  let renamed = false;
  let merged = 0;

  if (fs.existsSync(legacyDir)) {
    if (!fs.existsSync(playlistRoot)) {
      fs.renameSync(legacyDir, playlistRoot);
      renamed = true;
      logger.info?.(
        `[migrate:v2] Renamed ${legacyDir} -> ${playlistRoot}`,
      );
    } else {
      for (const entry of fs.readdirSync(legacyDir)) {
        const from = path.join(legacyDir, entry);
        const to = path.join(playlistRoot, entry);
        if (fs.statSync(from).isDirectory()) {
          merged += mergeDirectoryContents(from, to);
        } else if (!fs.existsSync(to)) {
          fs.renameSync(from, to);
          merged += 1;
        }
      }
      fs.rmSync(legacyDir, { recursive: true, force: true });
      if (merged > 0) {
        logger.info?.(
          `[migrate:v2] Merged ${merged} legacy playlist files into ${playlistRoot}`,
        );
      }
    }
  }

  if (!fs.existsSync(playlistRoot)) {
    fs.mkdirSync(playlistRoot, { recursive: true });
  }

  const sidecarsMoved = relocatePlaylistSidecars(playlistRoot);
  return { renamed, merged, sidecarsMoved, playlistRoot, root };
}
