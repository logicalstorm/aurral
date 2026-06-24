import fs from "fs/promises";
import {
  buildTrackFileIndex,
  enrichLidarrTrackWithFiles,
} from "./libraryManager.js";
import {
  getPathMappings,
  looksLikeExternalOnlyPath,
  resolveLocalPath,
} from "./pathMappings.js";
import { pathsShareDevice } from "./weeklyFlow/weeklyFlowFileReuse.js";
import { resolveWeeklyFlowRoot } from "./weeklyFlow/weeklyFlowPaths.js";
function step(id, status, label, extra = {}) {
  return { id, status, label, ...extra };
}

async function pathIsReadable(filePath, mappings = getPathMappings("lidarr")) {
  if (!filePath) return false;
  const candidates = [filePath, resolveLocalPath(filePath, mappings)];
  const uniqueCandidates = [
    ...new Set(candidates.map((entry) => String(entry || "").trim()).filter(Boolean)),
  ];
  for (const candidate of uniqueCandidates) {
    try {
      await fs.access(candidate, fs.constants.R_OK);
      return candidate;
    } catch {}
  }
  return false;
}

function normalizeForDisplayCompare(filePath) {
  return String(filePath || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
}

function formatPathAccessDetail(reportedPath, readablePath) {
  const reported = String(reportedPath || "").trim();
  const readable = String(readablePath || "").trim();
  if (!reported || !readable) return reported || readable;
  if (normalizeForDisplayCompare(reported) === normalizeForDisplayCompare(readable)) {
    return reported;
  }
  return `${reported} -> ${readable}`;
}

function pathHasPrefix(candidate, prefix) {
  const normalizedCandidate = normalizeForDisplayCompare(candidate);
  const normalizedPrefix = normalizeForDisplayCompare(prefix);
  if (!normalizedCandidate || !normalizedPrefix) return false;
  return (
    normalizedCandidate.toLowerCase() === normalizedPrefix.toLowerCase() ||
    normalizedCandidate.toLowerCase().startsWith(`${normalizedPrefix.toLowerCase()}/`)
  );
}

export async function findSampleTrackFile(lidarrClient) {
  let artists = [];
  try {
    artists = await lidarrClient.request("/artist");
  } catch {
    return null;
  }
  if (!Array.isArray(artists)) return null;

  for (const artist of artists) {
    if (!artist?.id) continue;
    let albums = [];
    try {
      albums = await lidarrClient.request(`/album?artistId=${artist.id}`);
    } catch {
      continue;
    }
    if (!Array.isArray(albums)) continue;

    const album = albums.find((entry) => (entry?.statistics?.sizeOnDisk ?? 0) > 0);
    if (!album?.id) continue;

    const [tracks, trackFiles] = await Promise.all([
      lidarrClient.getTracksByAlbumId(album.id),
      lidarrClient.getTrackFilesByAlbumId(album.id),
    ]);
    if (!Array.isArray(tracks) || tracks.length === 0) continue;

    const trackFileById = buildTrackFileIndex(trackFiles);
    for (const track of tracks) {
      if (track?.hasFile !== true && !track?.trackFileId) continue;
      const enriched = enrichLidarrTrackWithFiles(track, trackFileById);
      const filePath =
        enriched.path || enriched.trackFile?.path || track.path || track.trackFile?.path || null;
      if (!filePath) continue;
      return {
        path: filePath,
        artistName: artist.artistName || artist.name || "Unknown artist",
        albumTitle: album.title || album.albumTitle || "Unknown album",
        trackTitle: track.title || track.trackTitle || "Unknown track",
      };
    }
  }

  return null;
}

export async function runLidarrLibraryAccessTest(lidarrClient, options = {}) {
  const shareDevice = options.pathsShareDevice || pathsShareDevice;
  const steps = [];

  const connection = await lidarrClient.testConnection(true);
  if (!connection.connected) {
    steps.push(
      step("api", "fail", "Connected to Lidarr", {
        detail: connection.error || "Connection failed",
        fix: "Check the server URL and API key. From Docker, use a URL Aurral can reach (for example http://lidarr:8686), not only the address you use in a browser.",
      }),
    );
    return { ok: false, steps, sample: null };
  }

  const instanceLabel = connection.instanceName || "Lidarr";
  const versionLabel = connection.version ? ` (${connection.version})` : "";
  steps.push(
    step("api", "pass", "Connected to Lidarr", {
      detail: `${instanceLabel}${versionLabel}`,
    }),
  );

  let rootFolders = [];
  try {
    rootFolders = await lidarrClient.getRootFolders();
  } catch (error) {
    steps.push(
      step("root", "fail", "Root folder in Lidarr", {
        detail: error.message,
        fix: "Confirm Lidarr is running and your API key can read library settings.",
      }),
    );
    return { ok: false, steps, sample: null };
  }

  const rootPaths = (Array.isArray(rootFolders) ? rootFolders : [])
    .map((folder) => String(folder?.path || "").trim())
    .filter(Boolean);

  if (rootPaths.length === 0) {
    steps.push(
      step("root", "fail", "Root folder in Lidarr", {
        fix: "Add a root folder in Lidarr under Settings → Media Management → Root Folders.",
      }),
    );
    return { ok: false, steps, sample: null };
  }

  steps.push(
    step("root", "pass", "Root folder in Lidarr", {
      detail: rootPaths.join(", "),
    }),
  );

  const unreadableRoots = [];
  for (const rootPath of rootPaths) {
    if (!(await pathIsReadable(rootPath))) {
      unreadableRoots.push(rootPath);
    }
  }

  const sample = await findSampleTrackFile(lidarrClient);

  if (unreadableRoots.length > 0) {
    const missingPath = unreadableRoots[0];
    const usesHostPaths = looksLikeExternalOnlyPath(missingPath);
    steps.push(
      step("mount", "fail", "Aurral can see that folder in the container", {
        detail: missingPath,
        fix: usesHostPaths
          ? `Lidarr reports ${missingPath}, but Aurral cannot read that path inside Docker. Mount the shared parent folder into Aurral, then add a manual Lidarr path mapping if the container paths differ.`
          : `Lidarr stores files at ${missingPath}, but Aurral cannot read that path. Recommended fix: mount the same host root into Aurral and Lidarr at the same container path, such as /data.`,
      }),
    );
    return { ok: false, steps, sample };
  }

  steps.push(
    step("mount", "pass", "Aurral can see that folder in the container", {
      detail:
        rootPaths.length === 1
          ? formatPathAccessDetail(rootPaths[0], await pathIsReadable(rootPaths[0]))
          : (
              await Promise.all(
                rootPaths.map(async (rootPath) =>
                  formatPathAccessDetail(rootPath, await pathIsReadable(rootPath)),
                ),
              )
            ).join(", "),
    }),
  );

  if (!sample) {
    steps.push(
      step("file", "warn", "Downloaded track available to verify", {
        detail: "No albums with files on disk were found in Lidarr.",
        fix: "After you import at least one album, run this check again to verify playback and reuse.",
      }),
    );
    return {
      ok: true,
      steps,
      sample: null,
      partial: true,
    };
  }

  const readableSamplePath = await pathIsReadable(sample.path);
  if (!readableSamplePath) {
    steps.push(
      step("file", "fail", "Sample Lidarr track file is readable from Aurral", {
        detail: sample.path,
        fix: looksLikeExternalOnlyPath(sample.path)
          ? "Lidarr reports a host path Aurral cannot read inside Docker. Mount the parent folder into Aurral, then add a manual Lidarr path mapping under Settings → System → Storage."
          : "Lidarr reports this file path, but Aurral cannot read it. Check Docker mounts and folder permissions (PUID/PGID). If Lidarr and Aurral intentionally use different container paths, add a manual Lidarr path mapping.",
      }),
    );
    return { ok: false, steps, sample };
  }

  const resolvedSamplePath = readableSamplePath || (await pathIsReadable(sample.path));
  steps.push(
    step("file", "pass", "Sample Lidarr track file is readable from Aurral", {
      detail: resolvedSamplePath || sample.path,
    }),
  );

  if (!rootPaths.some((rootPath) => pathHasPrefix(sample.path, rootPath))) {
    steps.push(
      step("track-path", "warn", "Lidarr track path differs from root folder", {
        detail: `${rootPaths.join(", ")} -> ${sample.path}`,
        fix: "Aurral reuses the actual track file path Lidarr reports. If that path is readable, reuse can still work, but matching container paths are easier to support.",
      }),
    );
  }

  const flowLibraryRoot = resolveWeeklyFlowRoot();
  const sharedFilesystem = await shareDevice(resolvedSamplePath || sample.path, flowLibraryRoot);
  if (sharedFilesystem) {
    steps.push(
      step("hardlink", "pass", "Lidarr and Aurral downloads share a filesystem", {
        detail:
          "File moves stay on one filesystem. Navidrome still needs to scan every folder referenced by generated playlist files.",
      }),
    );
  } else {
    steps.push(
      step("hardlink", "warn", "Lidarr and Aurral downloads are on different filesystems", {
        detail: `Lidarr files are under ${resolvedSamplePath || sample.path}, but Aurral writes downloads under ${flowLibraryRoot}.`,
        fix: "Mount the same shared root into Aurral, slskd, and Navidrome, then choose that shared downloads path in Settings (for example /data/downloads/aurral).",
      }),
    );
  }

  steps.push(
    step("ready", "pass", "Ready for library playback and playlist reuse", {
      detail: `${sample.artistName} — ${sample.trackTitle}`,
    }),
  );

  return {
    ok: true,
    steps,
    sample: {
      ...sample,
      path: resolvedSamplePath || sample.path,
    },
    partial: !sharedFilesystem,
  };
}
