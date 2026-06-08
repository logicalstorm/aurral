import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

export const PLAYLIST_LIBRARY_DIR = "aurral-playlists";
const LEGACY_LIBRARY_DIR = "aurral-weekly-flow";
const LEGACY_DOCKER_PLAYLIST_ROOT = "/app/downloads";
const DEFAULT_DATA_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
);

function defaultPlaylistRoot() {
  const dataDir = process.env.AURRAL_DATA_DIR
    ? path.resolve(process.env.AURRAL_DATA_DIR)
    : path.resolve(DEFAULT_DATA_DIR);
  return path.resolve(dataDir, "..", "downloads");
}

export function resolvePlaylistRoot(explicitRoot) {
  const override = String(explicitRoot ?? "").trim();
  if (override) {
    return path.isAbsolute(override)
      ? override
      : path.resolve(process.cwd(), override);
  }

  const playlistFolder = String(process.env.PLAYLIST_FOLDER || "").trim();
  if (playlistFolder) {
    return path.isAbsolute(playlistFolder)
      ? playlistFolder
      : path.resolve(process.cwd(), playlistFolder);
  }

  const weeklyFlowFolder = String(process.env.WEEKLY_FLOW_FOLDER || "").trim();
  if (weeklyFlowFolder) {
    return path.isAbsolute(weeklyFlowFolder)
      ? weeklyFlowFolder
      : path.resolve(process.cwd(), weeklyFlowFolder);
  }

  const downloadFolder = String(process.env.DOWNLOAD_FOLDER || "").trim();
  if (downloadFolder) {
    return path.isAbsolute(downloadFolder)
      ? downloadFolder
      : path.resolve(process.cwd(), downloadFolder);
  }

  return defaultPlaylistRoot();
}

export function remapLegacyPath(finalPath, playlistRoot = resolvePlaylistRoot()) {
  let resolved = path.resolve(String(finalPath || "").trim());
  const root = path.resolve(playlistRoot);
  if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) {
    return resolved;
  }
  const legacyRoot = path.resolve(LEGACY_DOCKER_PLAYLIST_ROOT);
  if (
    resolved === legacyRoot ||
    resolved.startsWith(`${legacyRoot}${path.sep}`)
  ) {
    resolved = path.resolve(root, path.relative(legacyRoot, resolved));
  }
  if (resolved.includes(LEGACY_LIBRARY_DIR)) {
    resolved = path.resolve(
      root,
      path.relative(root, resolved).replaceAll(LEGACY_LIBRARY_DIR, PLAYLIST_LIBRARY_DIR),
    );
  }
  return resolved;
}

export function buildPlaylistDestination(playlistId, artistDir, albumDir) {
  return path.posix.join(
    PLAYLIST_LIBRARY_DIR,
    String(playlistId || "").trim(),
    String(artistDir || "Unknown Artist"),
    String(albumDir || "Unknown Album"),
  );
}

export async function resolveExistingTrackPath(
  finalPath,
  playlistRoot = resolvePlaylistRoot(),
) {
  const direct = path.resolve(String(finalPath || "").trim());
  const root = path.resolve(playlistRoot);
  const candidates = [...new Set([direct, remapLegacyPath(direct, root)])];

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        return {
          path: candidate,
          migratedFrom: candidate !== direct ? direct : null,
        };
      }
    } catch {}
  }
  return null;
}

export async function migrateLegacyPaths(playlistRoot = resolvePlaylistRoot(), tracker) {
  if (!tracker?.getAll || !tracker?.setDone) {
    return { scanned: 0, migrated: 0 };
  }

  const jobs = tracker.getAll();
  let migrated = 0;
  for (const job of jobs) {
    if (!job?.finalPath || job.status !== "done") continue;
    const resolved = await resolveExistingTrackPath(job.finalPath, playlistRoot);
    if (!resolved?.migratedFrom) continue;
    tracker.setDone(job.id, resolved.path, job.albumName || null);
    migrated += 1;
  }
  return { scanned: jobs.length, migrated };
}

export const resolveWeeklyFlowRoot = resolvePlaylistRoot;
export const remapLegacyWeeklyFlowPath = remapLegacyPath;
export const resolveExistingWeeklyFlowTrackPath = resolveExistingTrackPath;
export const migrateLegacyWeeklyFlowPaths = migrateLegacyPaths;
