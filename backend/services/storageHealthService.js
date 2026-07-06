import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { dbOps } from "../db/helpers/index.js";
import { lidarrClient } from "./lidarrClient.js";
import { slskdClient } from "./slskdClient.js";
import { nzbgetClient } from "./nzbgetClient.js";
import { sabnzbdClient } from "./sabnzbdClient.js";
import { NavidromeClient } from "./navidrome.js";
import { runLidarrLibraryAccessTest } from "./lidarrLibraryAccessTest.js";
import { PLAYLIST_LIBRARY_DIR, resolvePlaylistRoot } from "./playlistPaths.js";
import {
  getPathMappings,
  looksLikeExternalOnlyPath,
  resolveLocalPath,
  resolveRemotePath,
} from "./pathMappings.js";
import {
  getM3uPathMappings,
  getM3uPathMode,
  resolveM3uTrackPath,
  resolveM3uVisiblePath,
} from "./playlistM3uPaths.js";
import { downloadTracker } from "./weeklyFlow/weeklyFlowDownloadTracker.js";
import { pathsShareDevice } from "./weeklyFlow/weeklyFlowFileReuse.js";
import { remapLegacyPath as remapLegacyWeeklyFlowPath, resolvePlaylistRoot as resolveWeeklyFlowRoot } from "./playlistPaths.js";import {
  getFilesystemBrowseRoots,
  resolveEnvDownloadFolder,
  getSuggestedDownloadFolderPath,
} from "./downloadFolderConfig.js";

const MEDIA_EXTENSIONS = new Set([
  ".flac",
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".wav",
  ".ape",
  ".wv",
  ".alac",
]);

const DOWNLOAD_SPACE_WARNING_BYTES = 1024 ** 3;
const DETAIL_LIST_LIMIT = 6;
const STORAGE_HEALTH_CACHE_TTL_MS = Math.max(
  0,
  Math.floor(Number(process.env.AURRAL_STORAGE_HEALTH_CACHE_MS) || 60 * 1000),
);
const PLAYLIST_FILE_HEALTH_SAMPLE_LIMIT = Math.max(
  50,
  Math.floor(Number(process.env.AURRAL_PLAYLIST_FILE_HEALTH_SAMPLE_LIMIT) || 500),
);

let storageHealthCache = null;
let storageHealthCacheExpiresAt = 0;
let storageHealthCacheKey = "";
let storageHealthInflight = null;
let storageHealthInflightKey = "";

function healthStep(id, status, label, extra = {}) {
  return { id, status, label, ...extra };
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "unknown";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const decimals = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatLimitedList(items, limit = DETAIL_LIST_LIMIT) {
  const values = (Array.isArray(items) ? items : [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  if (values.length <= limit) return values.join(", ");
  return `${values.slice(0, limit).join(", ")} (+${values.length - limit} more)`;
}

function normalizePathCompare(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function pathCoversPrefix(parentPath, childPath) {
  const parent = normalizePathCompare(parentPath);
  const child = normalizePathCompare(childPath);
  if (!parent || !child) return false;
  if (child === parent) return true;
  return child.startsWith(`${parent}/`);
}

function isAbsolutePathReference(value) {
  const trimmed = String(value || "").trim();
  return (
    path.isAbsolute(trimmed) ||
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    /^\\\\/.test(trimmed) ||
    trimmed.startsWith("//")
  );
}

function getLikelySharedBrowseRoots(browseRoots) {
  const dedicatedRoots = (Array.isArray(browseRoots) ? browseRoots : []).filter(
    (root) => !isFilesystemRootPath(root),
  );
  if (String(process.env.FILE_BROWSE_ROOTS || "").trim()) {
    return dedicatedRoots;
  }

  const envDownloadFolder = resolveEnvDownloadFolder();
  return dedicatedRoots.filter((root) => {
    if (pathCoversPrefix("/data", root) || pathCoversPrefix(root, "/data")) {
      return true;
    }
    return (
      envDownloadFolder &&
      (pathCoversPrefix(root, envDownloadFolder) || pathCoversPrefix(envDownloadFolder, root))
    );
  });
}

async function realOrResolvedPath(targetPath) {
  const resolved = path.resolve(String(targetPath || ""));
  try {
    return await fs.realpath(resolved);
  } catch {
    return resolved;
  }
}

async function pathIsWithinAnyRoot(targetPath, roots) {
  const candidates = Array.isArray(roots) ? roots : [];
  if (!targetPath || candidates.length === 0) return false;
  const realTarget = await realOrResolvedPath(targetPath);
  for (const root of candidates) {
    const realRoot = await realOrResolvedPath(root);
    if (isFilesystemRootPath(realRoot)) return true;
    const relative = path.relative(realRoot, realTarget);
    if (relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative))) {
      return true;
    }
  }
  return false;
}

async function checkPathReadable(filePath, mappingSource = null) {
  const raw = String(filePath || "").trim();
  if (!raw) return false;
  const mappings = getPathMappings(mappingSource || undefined);
  const candidates = [raw, resolveLocalPath(raw, mappings)];
  const uniqueCandidates = [
    ...new Set(candidates.map((entry) => String(entry || "").trim()).filter(Boolean)),
  ];
  for (const candidate of uniqueCandidates) {
    try {
      const stat = await fs.stat(candidate);
      const accessMode = stat.isDirectory()
        ? fs.constants.R_OK | fs.constants.X_OK
        : fs.constants.R_OK;
      await fs.access(candidate, accessMode);
      return candidate;
    } catch {}
  }
  return false;
}

function formatProbeError(error) {
  const code = error?.code ? `${error.code}: ` : "";
  return `${code}${error?.message || "Filesystem operation failed"}`;
}

async function runDirectoryWriteProbe(dirPath) {
  const root = String(dirPath || "").trim();
  if (!root) {
    return { ok: false, detail: "No directory configured" };
  }
  const probeDir = path.join(
    root,
    `.aurral-health-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`,
  );
  const probeFile = path.join(probeDir, "probe.tmp");
  const renamedFile = path.join(probeDir, "probe-renamed.tmp");
  const contents = "aurral storage health probe\n";
  try {
    await fs.mkdir(probeDir);
    const handle = await fs.open(probeFile, "wx");
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync().catch((err) => { console.warn(err); });
    } finally {
      await handle.close().catch((err) => { console.warn(err); });
    }
    const readBack = await fs.readFile(probeFile, "utf8");
    if (readBack !== contents) {
      throw new Error("Probe file contents changed after write");
    }
    await fs.rename(probeFile, renamedFile);
    await fs.unlink(renamedFile);
    await fs.rmdir(probeDir);
    return {
      ok: true,
      detail: "Created, read, renamed, and removed a probe file",
    };
  } catch (error) {
    return {
      ok: false,
      detail: `${probeDir}: ${formatProbeError(error)}`,
    };
  } finally {
    await fs.rm(probeDir, { recursive: true, force: true }).catch((err) => { console.warn(err); });
  }
}

async function getFilesystemSpace(dirPath) {
  if (typeof fs.statfs !== "function") return null;
  try {
    const stats = await fs.statfs(dirPath);
    const blockSize = Number(stats.bsize || stats.frsize || 0);
    const availableBlocks = Number(stats.bavail ?? stats.bfree ?? 0);
    const totalBlocks = Number(stats.blocks || 0);
    if (!Number.isFinite(blockSize) || blockSize <= 0) return null;
    return {
      availableBytes: availableBlocks * blockSize,
      totalBytes: totalBlocks > 0 ? totalBlocks * blockSize : null,
    };
  } catch {
    return null;
  }
}

async function findSampleMediaFileInDirectory(dirPath, { maxDepth = 4, maxDirs = 80 } = {}) {
  const root = String(dirPath || "").trim();
  if (!root) return null;
  const queue = [{ dir: root, depth: 0 }];
  let dirsVisited = 0;
  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    dirsVisited += 1;
    if (dirsVisited > maxDirs) break;
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (MEDIA_EXTENSIONS.has(ext)) {
        return path.join(dir, entry.name);
      }
    }
    if (depth >= maxDepth) continue;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }
  return null;
}

function formatPathAccessDetail(reportedPath, readablePath) {
  const reported = String(reportedPath || "").trim();
  const readable = String(readablePath || "").trim();
  if (!reported || !readable) return reported || readable;
  if (normalizePathCompare(reported) === normalizePathCompare(readable)) {
    return reported;
  }
  return `${reported} -> ${readable}`;
}

function buildSection(id, title, steps, { skipped = false, skipReason = null } = {}) {
  const status = skipped
    ? "skip"
    : steps.some((entry) => entry.status === "fail")
      ? "fail"
      : steps.some((entry) => entry.status === "warn")
        ? "warn"
        : "pass";
  return {
    id,
    title,
    status,
    steps,
    skipReason,
  };
}

function summarizeResult(sections) {
  const active = sections.filter((entry) => entry.status !== "skip");
  const hasFail = active.some((entry) => entry.status === "fail");
  const hasWarn = active.some((entry) => entry.status === "warn");
  return {
    ok: !hasFail,
    partial: !hasFail && hasWarn,
    sectionCount: sections.length,
    failedCount: active.filter((entry) => entry.status === "fail").length,
    warningCount: active.filter((entry) => entry.status === "warn").length,
  };
}

function getStorageHealthCacheKey() {
  const settings = dbOps.getSettings();
  return JSON.stringify({
    settings,
    downloadTrackerRevision: downloadTracker.getRevision(),
    env: {
      DOWNLOAD_FOLDER: process.env.DOWNLOAD_FOLDER || "",
      FILE_BROWSE_ROOTS: process.env.FILE_BROWSE_ROOTS || "",
      PATH_MAPPINGS: process.env.PATH_MAPPINGS || "",
      AURRAL_DB_PATH: process.env.AURRAL_DB_PATH || "",
    },
  });
}

function isFilesystemRootPath(value) {
  const normalized = normalizePathCompare(value);
  return normalized === "/" || normalized === "";
}

async function checkSharedVolumeSection() {
  const steps = [];
  const browseRoots = getFilesystemBrowseRoots();
  const sharedRoots = getLikelySharedBrowseRoots(browseRoots);

  if (browseRoots.length === 0) {
    steps.push(
      healthStep("roots", "fail", "Aurral can browse a shared media folder", {
        fix: "Mount your host media folder into the Aurral container at a dedicated path, such as /mnt/user/data:/data. Use the same path in every container, then recreate the container.",
      }),
    );
    return buildSection("volume", "Shared volume", steps);
  }

  steps.push(
    healthStep("roots", "pass", "Browsable storage roots in Aurral", {
      detail: formatLimitedList(browseRoots),
    }),
  );

  if (sharedRoots.length > 0) {
    steps.push(
      healthStep("shared-mount", "pass", "Dedicated shared media folder detected", {
        detail: formatLimitedList(sharedRoots),
        fix: "Use the same container path in Lidarr, slskd, NZBGet, and Navidrome. /data is a common convention but any matching path works.",
      }),
    );
  } else {
    steps.push(
      healthStep("shared-mount", "warn", "No dedicated shared media folder detected", {
        detail: formatLimitedList(browseRoots),
        fix: "Docker users should mount one host media folder at the same dedicated path in every container, such as /data. Native installs can ignore this if Aurral, Lidarr, and players all use the same absolute paths.",
      }),
    );
  }

  return buildSection("volume", "Shared volume", steps);
}

async function checkPathMappingsSection() {
  const mappings = getPathMappings();
  if (mappings.length === 0) {
    return buildSection("path-mappings", "Remote path mappings", [], {
      skipped: true,
      skipReason: "No remote path mappings are configured.",
    });
  }

  const steps = [];
  const relativeRemoteMappings = mappings.filter(
    (mapping) => !isAbsolutePathReference(mapping.remote),
  );
  if (relativeRemoteMappings.length > 0) {
    steps.push(
      healthStep("remote-absolute", "warn", "Remote paths are absolute", {
        detail: formatLimitedList(
          relativeRemoteMappings.map((mapping) => `${mapping.source}: ${mapping.remote}`),
        ),
        fix: "Remote paths should match the absolute path reported by the source app, such as /downloads/complete, N:\\Music, or \\\\server\\share.",
      }),
    );
  } else {
    steps.push(
      healthStep("remote-absolute", "pass", "Remote paths are absolute", {
        detail: `${mappings.length} mapping${mappings.length === 1 ? "" : "s"} configured`,
      }),
    );
  }

  const inaccessibleLocalPaths = [];
  for (const mapping of mappings) {
    try {
      const stat = await fs.stat(mapping.local);
      if (!stat.isDirectory()) {
        inaccessibleLocalPaths.push(`${mapping.source}: ${mapping.local} is not a directory`);
        continue;
      }
      await fs.access(mapping.local, fs.constants.R_OK | fs.constants.X_OK);
    } catch (error) {
      inaccessibleLocalPaths.push(
        `${mapping.source}: ${mapping.remote} -> ${mapping.local} (${formatProbeError(error)})`,
      );
    }
  }

  if (inaccessibleLocalPaths.length > 0) {
    steps.push(
      healthStep("local-readable", "fail", "Mapped local paths are readable directories", {
        detail: formatLimitedList(inaccessibleLocalPaths),
        fix: "Create or mount the local side of each mapping inside the Aurral container. Remove mappings for apps that already share the same container paths.",
      }),
    );
  } else {
    steps.push(
      healthStep("local-readable", "pass", "Mapped local paths are readable directories", {
        detail: formatLimitedList(
          mappings.map((mapping) => `${mapping.source}: ${mapping.remote} -> ${mapping.local}`),
        ),
      }),
    );
  }

  return buildSection("path-mappings", "Remote path mappings", steps);
}

async function checkDownloadsSection() {
  const steps = [];
  const settings = dbOps.getSettings();
  const downloadFolder = String(settings.downloadFolderPath || resolvePlaylistRoot() || "").trim();
  const suggested = getSuggestedDownloadFolderPath();

  if (!downloadFolder) {
    steps.push(
      healthStep("configured", "fail", "Downloads folder is configured", {
        fix: `Choose a downloads folder under your shared mount, for example ${suggested}.`,
      }),
    );
    return buildSection("downloads", "Aurral downloads", steps);
  }

  steps.push(
    healthStep("configured", "pass", "Downloads folder is configured", {
      detail: downloadFolder,
    }),
  );

  let exists = false;
  try {
    const stat = await fs.stat(downloadFolder);
    exists = stat.isDirectory();
  } catch {}

  if (!exists) {
    steps.push(
      healthStep("exists", "fail", "Downloads folder exists in the container", {
        detail: downloadFolder,
        fix: "Create the folder or pick a path that already exists inside the mounted volume.",
      }),
    );
    return buildSection("downloads", "Aurral downloads", steps);
  }

  steps.push(
    healthStep("exists", "pass", "Downloads folder exists in the container", {
      detail: downloadFolder,
    }),
  );

  const browseRoots = getFilesystemBrowseRoots();
  const sharedRoots = getLikelySharedBrowseRoots(browseRoots);
  if (sharedRoots.length > 0) {
    const insideSharedRoot = await pathIsWithinAnyRoot(downloadFolder, sharedRoots);
    steps.push(
      healthStep(
        "shared-root",
        insideSharedRoot ? "pass" : "warn",
        "Downloads folder is under shared storage",
        {
          detail: downloadFolder,
          fix: insideSharedRoot
            ? "Keep Lidarr, slskd, NZBGet, Navidrome, and Aurral using this same shared root where possible."
            : "Move Aurral downloads under the shared media mount, or add FILE_BROWSE_ROOTS so Aurral can distinguish app data from media storage.",
        },
      ),
    );
  } else {
    steps.push(
      healthStep("shared-root", "warn", "Downloads folder is under shared storage", {
        detail: downloadFolder,
        fix: "Set FILE_BROWSE_ROOTS or mount a shared folder such as /data, then choose a downloads folder under that shared root.",
      }),
    );
  }

  const writeProbe = await runDirectoryWriteProbe(downloadFolder);
  if (!writeProbe.ok) {
    steps.push(
      healthStep("writable", "fail", "Aurral can create and move files", {
        detail: writeProbe.detail,
        fix: "Check container permissions (PUID/PGID), read-only mounts, ACLs, and filesystem permissions for the configured downloads folder.",
      }),
    );
    return buildSection("downloads", "Aurral downloads", steps);
  }

  steps.push(
    healthStep("writable", "pass", "Aurral can create and move files", {
      detail: writeProbe.detail,
    }),
  );

  const space = await getFilesystemSpace(downloadFolder);
  if (space) {
    const detail = space.totalBytes
      ? `${formatBytes(space.availableBytes)} available of ${formatBytes(space.totalBytes)}`
      : `${formatBytes(space.availableBytes)} available`;
    steps.push(
      healthStep(
        "space",
        space.availableBytes < DOWNLOAD_SPACE_WARNING_BYTES ? "warn" : "pass",
        "Downloads filesystem has free space",
        {
          detail,
          fix:
            space.availableBytes < DOWNLOAD_SPACE_WARNING_BYTES
              ? "Free at least 1 GiB before starting large playlist or album downloads."
              : "Large lossless playlists can still need substantially more free space.",
        },
      ),
    );
  }

  const playlistLibraryRoot = path.join(downloadFolder, PLAYLIST_LIBRARY_DIR);
  try {
    await fs.mkdir(playlistLibraryRoot, { recursive: true });
    steps.push(
      healthStep("playlist-root", "pass", "Playlist library folder is ready", {
        detail: playlistLibraryRoot,
      }),
    );
  } catch (error) {
    steps.push(
      healthStep("playlist-root", "fail", "Playlist library folder is ready", {
        detail: playlistLibraryRoot,
        fix: error?.message || "Could not create the Aurral playlist library folder.",
      }),
    );
  }

  return buildSection("downloads", "Aurral downloads", steps);
}

async function checkLidarrSection() {
  lidarrClient.updateConfig();
  if (!lidarrClient.isConfigured()) {
    return {
      section: buildSection("lidarr", "Lidarr library", [], {
        skipped: true,
        skipReason: "Lidarr is not configured.",
      }),
      sample: null,
      rootPaths: [],
    };
  }

  const result = await runLidarrLibraryAccessTest(lidarrClient);
  const rootStep = (result.steps || []).find((entry) => entry.id === "root");
  const rootPaths = rootStep?.detail
    ? String(rootStep.detail)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];

  return {
    section: buildSection("lidarr", "Lidarr library", result.steps || []),
    sample: result.sample || null,
    rootPaths,
  };
}

async function checkDownloadClientSection({
  client,
  key,
  title,
  isEnabled,
  skipReason,
  resolveCompletedPath,
  pathFix,
  extraSteps = null,
}) {
  const integrations = dbOps.getSettings()?.integrations || {};
  const config = integrations[key] || {};

  if (!isEnabled(config) || !client.isConfigured()) {
    return buildSection(key, title, [], {
      skipped: true,
      skipReason,
    });
  }

  const steps = [];
  const connection = await client.testConnection({ force: true });
  if (!connection.ok) {
    steps.push(
      healthStep("api", "fail", `Connected to ${title}`, {
        detail: connection.message || "Connection failed",
        fix: `Check the ${key} URL and credentials in Settings → Download Clients.`,
      }),
    );
    return buildSection(key, title, steps);
  }

  steps.push(
    healthStep("api", "pass", `Connected to ${title}`, {
      detail: connection.message || `${key} is reachable`,
    }),
  );

  if (extraSteps) {
    const extra = extraSteps(connection);
    steps.push(...extra);
    if (extra.some((s) => s.status === "fail")) {
      return buildSection(key, title, steps);
    }
  }

  const completedPath = resolveCompletedPath(config, connection);  if (!completedPath) {
    steps.push(
      healthStep("path-reported", "warn", `${title} completed folder is configured`, {
        fix: `Set the completed download path in Settings → Download Clients → ${key}.`,
      }),
    );
    return buildSection(key, title, steps);
  }

  steps.push(
    healthStep("path-reported", "pass", `${title} completed folder is configured`, {
      detail: completedPath,
    }),
  );

  const readablePath = await checkPathReadable(completedPath, key);
  if (!readablePath) {
    steps.push(
      healthStep("path-readable", "fail", `Aurral can read ${title} completed files`, {
        detail: completedPath,
        fix: pathFix(completedPath),
      }),
    );
    return buildSection(key, title, steps);
  }

  steps.push(
    healthStep("path-readable", "pass", `Aurral can read ${title} completed files`, {
      detail: formatPathAccessDetail(completedPath, readablePath),
    }),
  );

  const sharesPlaylistFilesystem = await pathsShareDevice(readablePath, resolvePlaylistRoot());
  steps.push(
    healthStep(
      "same-filesystem",
      sharesPlaylistFilesystem ? "pass" : "warn",
      `${key} and Aurral downloads share a filesystem`,
      {
        detail: `${readablePath} -> ${resolvePlaylistRoot()}`,
        fix: sharesPlaylistFilesystem
          ? "Completed files can usually be moved into the Aurral playlist folder without a cross-device copy."
          : "Aurral can copy across filesystems, but same-filesystem mounts are faster and avoid failures from low space, permissions, or partial copy cleanup.",
      },
    ),
  );

  const sampleFile = await findSampleMediaFileInDirectory(readablePath);
  if (!sampleFile) {
    steps.push(
      healthStep("sample-file", "warn", `Sample ${title} completed file on disk`, {
        detail: readablePath,
        fix: `Complete at least one ${key} download, then run checks again to verify a real file path.`,
      }),
    );
  } else {
    steps.push(
      healthStep("sample-file", "pass", `Sample ${title} completed file on disk`, {
        detail: sampleFile,
      }),
    );
  }

  return buildSection(key, title, steps);
}

async function checkSlskdSection() {
  return checkDownloadClientSection({
    client: slskdClient,
    key: "slskd",
    title: "slskd downloads",
    isEnabled: (config) => config.enabled !== false,
    skipReason: "slskd is not configured.",
    resolveCompletedPath: (_, connection) =>
      String(connection.downloadPath || "").trim(),
    pathFix: (downloadPath) =>
      looksLikeExternalOnlyPath(downloadPath)
        ? "slskd reports a host path Aurral cannot read inside Docker. Mount the shared parent folder into both containers, or add an slskd mapping under Settings → Download Clients → Remote Path Mappings."
        : `Mount the same host folder into Aurral at the path slskd uses, or add an slskd mapping for ${downloadPath} under Settings → Download Clients → Remote Path Mappings.`,
    extraSteps: (connection) => {
      if (connection.soulseekConnected === false) {
        return [
          healthStep("soulseek", "warn", "Soulseek network is connected", {
            detail: connection.serverState || "Disconnected",
            fix: "Open slskd, log in, and connect to the Soulseek server before starting downloads.",
          }),
        ];
      }
      return [
        healthStep("soulseek", "pass", "Soulseek network is connected", {
          detail: connection.serverState || "Connected",
        }),
      ];
    },
  });
}

async function checkNzbgetSection() {
  return checkDownloadClientSection({
    client: nzbgetClient,
    key: "nzbget",
    title: "NZBGet downloads",
    isEnabled: (config) => config.enabled === true,
    skipReason: "NZBGet is not enabled.",
    resolveCompletedPath: (config, connection) =>
      String(
        config.completedPath ||
          connection.downloadPath ||
          connection.directories?.completedPath ||
          "",
      ).trim(),
    pathFix: (completedPath) =>
      "Mount the same host folder into Aurral and NZBGet, or add an NZBGet mapping under Settings → Download Clients → Remote Path Mappings.",
  });
}

async function checkSabnzbdSection() {
  return checkDownloadClientSection({
    client: sabnzbdClient,
    key: "sabnzbd",
    title: "SABnzbd downloads",
    isEnabled: (config) => config.enabled === true,
    skipReason: "SABnzbd is not enabled.",
    resolveCompletedPath: (_config, connection) =>
      String(connection.downloadPath || connection.directories?.destDir || "").trim(),
    pathFix: (completedPath) =>
      "Mount the same host folder into Aurral and SABnzbd, or add a SABnzbd mapping under Settings → Download Clients → Remote Path Mappings.",
  });
}

function uniqueVisiblePathCandidates(paths) {
  const seen = new Set();
  const result = [];
  for (const entry of paths) {
    const value = String(entry || "").trim();
    if (!value) continue;
    const key = normalizePathCompare(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function resolveNavidromeVisiblePath(localPath, mode, mappings) {
  const local = String(localPath || "").trim();
  if (!local || mode !== "remote") return local;
  const mapped = resolveM3uVisiblePath(local, mappings);
  if (mapped) return mapped;
  if (mappings.length === 0) {
    const fallback = resolveRemotePath(local);
    if (normalizePathCompare(fallback) !== normalizePathCompare(local)) {
      return fallback;
    }
  }
  return null;
}

function getNavidromePathCandidates(localPath, mode, mappings) {
  const local = String(localPath || "").trim();
  const visible = resolveNavidromeVisiblePath(local, mode, mappings);
  return uniqueVisiblePathCandidates([local, visible]);
}

function libraryCoversAnyPath(libraryList, candidates) {
  return (Array.isArray(libraryList) ? libraryList : []).find((library) =>
    candidates.some((candidate) => pathCoversPrefix(library?.path, candidate)),
  );
}

async function checkNavidromeSection({ lidarrRootPaths = [], lidarrSample = null } = {}) {
  const integrations = dbOps.getSettings()?.integrations || {};
  const navidrome = integrations.navidrome || {};
  if (!navidrome.url || !navidrome.username || !navidrome.password) {
    return buildSection("navidrome", "Navidrome playback", [], {
      skipped: true,
      skipReason: "Navidrome is not configured.",
    });
  }

  const steps = [];
  const client = new NavidromeClient(navidrome.url, navidrome.username, navidrome.password);

  try {
    await client.ping();
    steps.push(
      healthStep("api", "pass", "Connected to Navidrome", {
        detail: navidrome.url,
      }),
    );
  } catch (error) {
    steps.push(
      healthStep("api", "fail", "Connected to Navidrome", {
        detail: error?.message || "Connection failed",
        fix: "Check the Navidrome URL, username, and password in Settings → Playback.",
      }),
    );
    return buildSection("navidrome", "Navidrome playback", steps);
  }

  const m3uMode = getM3uPathMode();
  const m3uMappings = getM3uPathMappings();
  const expectedLibraryPath = path
    .join(resolvePlaylistRoot(), PLAYLIST_LIBRARY_DIR)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const expectedLibraryCandidates = getNavidromePathCandidates(
    expectedLibraryPath,
    m3uMode,
    m3uMappings,
  );

  let libraries = [];
  let librariesListed = true;
  try {
    libraries = await client.getLibraries();
  } catch (error) {
    librariesListed = false;
    steps.push(
      healthStep("libraries", "warn", "Navidrome music libraries are readable", {
        detail: error?.message || "Could not list libraries",
        fix: "Confirm the Navidrome account can manage libraries and that the API is reachable.",
      }),
    );
  }

  const libraryList = Array.isArray(libraries) ? libraries : [];
  if (librariesListed && libraryList.length === 0) {
    steps.push(
      healthStep("libraries", "warn", "Navidrome music libraries are configured", {
        fix: "Add the Aurral playlist folder and any reused Lidarr library folders as Navidrome music libraries, then scan them.",
      }),
    );
  } else if (libraryList.length > 0) {
    steps.push(
      healthStep("libraries", "pass", "Navidrome music libraries are configured", {
        detail: formatLimitedList(
          libraryList.map((entry) => String(entry?.path || "").trim()).filter(Boolean),
        ),
      }),
    );
  }

  const unreadableLibraries = [];
  for (const library of libraryList) {
    const libraryPath = String(library?.path || "").trim();
    if (!libraryPath) continue;
    const readablePath = await checkPathReadable(libraryPath);
    if (!readablePath) {
      unreadableLibraries.push(libraryPath);
    }
  }

  if (libraryList.length > 0 && unreadableLibraries.length > 0) {
    steps.push(
      healthStep(
        "library-readable",
        m3uMode === "remote" ? "pass" : "fail",
        m3uMode === "remote"
          ? "Navidrome library paths use a separate filesystem view"
          : "Navidrome library paths are readable from Aurral",
        {
          detail: formatLimitedList(unreadableLibraries),
          fix:
            m3uMode === "remote"
              ? "This is expected when Navidrome runs on Windows or uses different mounts. The M3U path checks below verify that generated playlists use Navidrome-visible paths."
              : "Mount each Navidrome music library into Aurral at the same path, or enable Settings → Playback → Navidrome Playlist Paths → Use Navidrome paths in M3U files and add Navidrome path mappings.",
        },
      ),
    );
  } else if (libraryList.length > 0) {
    steps.push(
      healthStep("library-readable", "pass", "Navidrome library paths are readable from Aurral", {
        detail: formatLimitedList(
          libraryList.map((entry) => String(entry?.path || "").trim()).filter(Boolean),
        ),
      }),
    );
  }

  const playlistLibrary = libraryCoversAnyPath(libraryList, expectedLibraryCandidates);

  if (playlistLibrary) {
    steps.push(
      healthStep("aurral-library", "pass", "Navidrome scans the Aurral playlist folder", {
        detail: playlistLibrary.path,
      }),
    );
  } else {
    steps.push(
      healthStep("aurral-library", "warn", "Navidrome scans the Aurral playlist folder", {
        detail: formatLimitedList(expectedLibraryCandidates),
        fix: "Save Navidrome settings, then create or update a playlist or flow so Aurral can create the playlist library. Add that folder as a music library in Navidrome and scan it.",
      }),
    );
  }

  const uncoveredRoots = lidarrRootPaths.filter(
    (rootPath) =>
      !libraryCoversAnyPath(
        libraryList,
        getNavidromePathCandidates(rootPath, m3uMode, m3uMappings),
      ),
  );

  if (lidarrRootPaths.length > 0 && uncoveredRoots.length > 0) {
    steps.push(
      healthStep("lidarr-library", "warn", "Navidrome scans Lidarr library folders", {
        detail: formatLimitedList(uncoveredRoots),
        fix: "Reused playlist tracks point at your Lidarr library. Add those folders as Navidrome music libraries, or use Settings → Playback → Navidrome Playlist Paths when Navidrome sees them at different paths.",
      }),
    );
  } else if (lidarrRootPaths.length > 0) {
    steps.push(
      healthStep("lidarr-library", "pass", "Navidrome scans Lidarr library folders", {
        detail: formatLimitedList(lidarrRootPaths),
      }),
    );
  }

  if (lidarrSample?.path) {
    const samplePath = String(lidarrSample.path || "").trim();
    const navidromeCoversSample = libraryCoversAnyPath(
      libraryList,
      getNavidromePathCandidates(samplePath, m3uMode, m3uMappings),
    );
    if (!navidromeCoversSample) {
      steps.push(
        healthStep("lidarr-sample", "warn", "Navidrome scans the sample Lidarr track folder", {
          detail: samplePath,
          fix: "Add the Lidarr library folder that contains this track as a Navidrome music library.",
        }),
      );
    } else {
      steps.push(
        healthStep("lidarr-sample", "pass", "Navidrome scans the sample Lidarr track folder", {
          detail: samplePath,
        }),
      );
    }
  }

  return buildSection("navidrome", "Navidrome playback", steps);
}

async function checkPlaylistFilesSection() {
  const steps = [];
  const weeklyFlowRoot = resolveWeeklyFlowRoot();
  const m3uMode = getM3uPathMode();
  const m3uMappings = getM3uPathMappings();
  const totalDoneJobs = Number(downloadTracker.getStats()?.done || 0);
  const doneJobs = downloadTracker.getDoneWithFinalPath(PLAYLIST_FILE_HEALTH_SAMPLE_LIMIT);

  if (m3uMode === "remote") {
    let sampleResolved = null;
    for (const job of doneJobs) {
      const localPath = path.resolve(remapLegacyWeeklyFlowPath(job.finalPath, weeklyFlowRoot));
      const resolved = resolveM3uTrackPath(job, localPath, m3uMode, m3uMappings);
      if (resolved && normalizePathCompare(resolved) !== normalizePathCompare(localPath)) {
        sampleResolved = `${localPath} -> ${resolved}`;
        break;
      }
    }

    if (doneJobs.length === 0) {
      steps.push(
        healthStep("m3u-mode", "warn", "Generated M3U paths resolve for playlist consumers", {
          detail: "No completed playlist tracks to verify yet.",
          fix: "Create or import a playlist, or run a flow, then run this check again.",
        }),
      );
    } else {
      steps.push(
        healthStep("m3u-mode", "pass", "Generated M3U paths resolve for playlist consumers", {
          detail: sampleResolved
            ? `${doneJobs.length} sampled track${doneJobs.length === 1 ? "" : "s"} resolved via path mappings (e.g. ${sampleResolved})`
            : `${doneJobs.length} sampled track${doneJobs.length === 1 ? "" : "s"} use local container paths`,
        }),
      );
    }
  } else {
    steps.push(
      healthStep("m3u-mode", "pass", "Playlist files use local container paths", {
        detail: "M3U files use the same paths Aurral reads on disk.",
      }),
    );
  }

  if (doneJobs.length === 0) {
    steps.push(
      healthStep("tracked", "warn", "Completed playlist files are accessible", {
        detail: "No completed playlist tracks to verify yet.",
        fix: "Create or import a playlist, or run a flow, then run this check again.",
      }),
    );
    return buildSection("playlists", "Playlist files", steps);
  }

  let totalMissing = 0;
  let totalUnreadable = 0;
  let totalEmpty = 0;
  let sampleMissing = null;
  let sampleUnreadable = null;
  let sampleEmpty = null;
  for (const job of doneJobs) {
    const localPath = path.resolve(remapLegacyWeeklyFlowPath(job.finalPath, weeklyFlowRoot));
    try {
      const stat = await fs.stat(localPath);
      if (!stat.isFile()) {
        totalMissing += 1;
        if (!sampleMissing) sampleMissing = localPath;
        continue;
      }
      if (stat.size <= 0) {
        totalEmpty += 1;
        if (!sampleEmpty) sampleEmpty = localPath;
      }
      try {
        await fs.access(localPath, fs.constants.R_OK);
      } catch {
        totalUnreadable += 1;
        if (!sampleUnreadable) sampleUnreadable = localPath;
      }
    } catch {
      totalMissing += 1;
      if (!sampleMissing) sampleMissing = localPath;
    }
  }

  if (totalMissing > 0) {
    steps.push(
      healthStep("tracked", "fail", "Completed playlist files are accessible", {
        detail: `${totalMissing} of ${doneJobs.length} completed tracks are missing on disk`,
        fix: sampleMissing
          ? `Example missing path: ${sampleMissing}. Restore the missing file or fix the mount that should contain it, then update the affected playlist or flow so Aurral rewrites its playlist files.`
          : "Restore the missing files or fix the mount that should contain them, then update the affected playlist or flow so Aurral rewrites its playlist files.",
      }),
    );
    return buildSection("playlists", "Playlist files", steps);
  }

  if (totalUnreadable > 0) {
    steps.push(
      healthStep("tracked-readable", "fail", "Completed playlist files are readable", {
        detail: `${totalUnreadable} of ${doneJobs.length} completed tracks cannot be read`,
        fix: sampleUnreadable
          ? `Example unreadable path: ${sampleUnreadable}. Check ownership, ACLs, and read permissions for the mounted folder.`
          : "Check ownership, ACLs, and read permissions for the mounted folder.",
      }),
    );
    return buildSection("playlists", "Playlist files", steps);
  }

  if (totalEmpty > 0) {
    steps.push(
      healthStep("tracked-nonempty", "warn", "Completed playlist files are non-empty", {
        detail: `${totalEmpty} of ${doneJobs.length} completed tracks are zero bytes`,
        fix: sampleEmpty
          ? `Example empty path: ${sampleEmpty}. Re-run the affected flow, or remove and add the track again in the affected playlist, so Aurral replaces the empty file.`
          : "Re-run the affected flow, or remove and add the tracks again in the affected playlist, so Aurral replaces empty files.",
      }),
    );
  }

  steps.push(
    healthStep("tracked", "pass", "Completed playlist files are accessible", {
      detail:
        totalDoneJobs > doneJobs.length
          ? `${doneJobs.length} of ${totalDoneJobs} completed tracks sampled`
          : `${doneJobs.length} completed track${doneJobs.length === 1 ? "" : "s"} verified`,
    }),
  );

  return buildSection("playlists", "Playlist files", steps);
}

async function buildStorageHealthCheck() {
  const volumeSection = await checkSharedVolumeSection();
  const downloadsSection = await checkDownloadsSection();
  const {
    section: lidarrSection,
    sample: lidarrSample,
    rootPaths: lidarrRootPaths,
  } = await checkLidarrSection();

  const sections = [
    volumeSection,
    await checkPathMappingsSection(),
    downloadsSection,
    lidarrSection,
    await checkSlskdSection(),
    await checkNzbgetSection(),
    await checkSabnzbdSection(),
    await checkNavidromeSection({ lidarrRootPaths, lidarrSample }),
    await checkPlaylistFilesSection(),
  ];

  const summary = summarizeResult(sections);
  return {
    checkedAt: new Date().toISOString(),
    ...summary,
    sections,
  };
}

export async function runStorageHealthCheck({ force = false } = {}) {
  const now = Date.now();
  const cacheKey = getStorageHealthCacheKey();
  if (
    !force &&
    storageHealthCache &&
    storageHealthCacheKey === cacheKey &&
    STORAGE_HEALTH_CACHE_TTL_MS > 0 &&
    now < storageHealthCacheExpiresAt
  ) {
    return {
      ...storageHealthCache,
      cached: true,
    };
  }

  if (!force && storageHealthInflight && storageHealthInflightKey === cacheKey) {
    return storageHealthInflight;
  }

  storageHealthInflightKey = cacheKey;
  storageHealthInflight = buildStorageHealthCheck()
    .then((result) => {
      storageHealthCache = result;
      storageHealthCacheKey = cacheKey;
      storageHealthCacheExpiresAt = Date.now() + STORAGE_HEALTH_CACHE_TTL_MS;
      return result;
    })
    .finally(() => {
      storageHealthInflight = null;
      storageHealthInflightKey = "";
    });

  return storageHealthInflight;
}
