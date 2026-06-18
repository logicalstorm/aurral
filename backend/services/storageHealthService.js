import fs from "fs/promises";
import path from "path";
import { dbOps } from "../config/db-helpers.js";
import { lidarrClient } from "./lidarrClient.js";
import { slskdClient } from "./slskdClient.js";
import { nzbgetClient } from "./nzbgetClient.js";
import { NavidromeClient } from "./navidrome.js";
import { runLidarrLibraryAccessTest } from "./lidarrLibraryAccessTest.js";
import {
  PLAYLIST_LIBRARY_DIR,
  resolvePlaylistRoot,
} from "./playlistPaths.js";
import {
  getPathMappings,
  looksLikeExternalOnlyPath,
  resolveLocalPath,
} from "./pathMappings.js";
import { getM3uPathMode } from "./playlistM3uPaths.js";
import { downloadTracker } from "./weeklyFlowDownloadTracker.js";
import { remapLegacyWeeklyFlowPath, resolveWeeklyFlowRoot } from "./weeklyFlowPaths.js";
import {
  getFilesystemBrowseRoots,
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

function healthStep(id, status, label, extra = {}) {
  return { id, status, label, ...extra };
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

async function checkPathReadable(filePath, mappingSource = null) {
  const raw = String(filePath || "").trim();
  if (!raw) return false;
  const mappings = getPathMappings(mappingSource || undefined);
  const candidates = [raw, resolveLocalPath(raw, mappings)];
  const uniqueCandidates = [
    ...new Set(
      candidates.map((entry) => String(entry || "").trim()).filter(Boolean),
    ),
  ];
  for (const candidate of uniqueCandidates) {
    try {
      await fs.access(candidate, fs.constants.R_OK);
      return candidate;
    } catch {}
  }
  return false;
}

async function checkPathWritable(dirPath) {
  const resolved = String(dirPath || "").trim();
  if (!resolved) return false;
  try {
    await fs.access(resolved, fs.constants.W_OK);
    return resolved;
  } catch {}
  return false;
}

async function findSampleMediaFileInDirectory(
  dirPath,
  { maxDepth = 4, maxDirs = 80 } = {},
) {
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

function isFilesystemRootPath(value) {
  const normalized = normalizePathCompare(value);
  return normalized === "/" || normalized === "";
}

async function checkSharedVolumeSection() {
  const steps = [];
  const browseRoots = getFilesystemBrowseRoots();
  const dedicatedRoots = browseRoots.filter(
    (root) => !isFilesystemRootPath(root),
  );

  if (browseRoots.length === 0) {
    steps.push(
      healthStep("roots", "fail", "Aurral can browse a shared media folder", {
        fix: "Mount your host media folder into the Aurral container at a dedicated path, such as /mnt/user/data:/data. Use the same path in every container. Recreate the container after changing volumes.",
      }),
    );
    return buildSection("volume", "Shared volume", steps);
  }

  steps.push(
    healthStep("roots", "pass", "Browsable storage roots in Aurral", {
      detail: browseRoots.join(", "),
    }),
  );

  if (dedicatedRoots.length > 0) {
    steps.push(
      healthStep(
        "shared-mount",
        "pass",
        "Dedicated shared media folder mounted",
        {
          detail: dedicatedRoots.join(", "),
          fix: "Use the same container path in Lidarr, slskd, NZBGet, and Navidrome. /data is a common convention but any matching path works.",
        },
      ),
    );
  } else {
    steps.push(
      healthStep(
        "shared-mount",
        "warn",
        "No dedicated shared media folder detected",
        {
          detail: browseRoots.join(", "),
          fix: "Mount one host media folder at a dedicated path in every container (for example /data). If Aurral can only browse /, it usually cannot see your library mounts.",
        },
      ),
    );
  }

  return buildSection("volume", "Shared volume", steps);
}

async function checkDownloadsSection() {
  const steps = [];
  const settings = dbOps.getSettings();
  const downloadFolder = String(
    settings.downloadFolderPath || resolvePlaylistRoot() || "",
  ).trim();
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

  const writablePath = await checkPathWritable(downloadFolder);
  if (!writablePath) {
    steps.push(
      healthStep("writable", "fail", "Aurral can write to the downloads folder", {
        detail: downloadFolder,
        fix: "Check container permissions (PUID/PGID) and make sure the folder is on a mounted volume.",
      }),
    );
    return buildSection("downloads", "Aurral downloads", steps);
  }

  steps.push(
    healthStep("writable", "pass", "Aurral can write to the downloads folder", {
      detail: writablePath,
    }),
  );

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

async function checkSlskdSection() {
  const integrations = dbOps.getSettings()?.integrations || {};
  const slskd = integrations.slskd || {};
  if (slskd.enabled === false || !slskdClient.isConfigured()) {
    return buildSection("slskd", "slskd downloads", [], {
      skipped: true,
      skipReason: "slskd is not configured.",
    });
  }

  const steps = [];
  const connection = await slskdClient.testConnection({ force: true });
  if (!connection.ok) {
    steps.push(
      healthStep("api", "fail", "Connected to slskd", {
        detail: connection.message || "Connection failed",
        fix: "Check the slskd URL and API key in Settings → Download Clients. From Docker, use a URL Aurral can reach inside the network.",
      }),
    );
    return buildSection("slskd", "slskd downloads", steps);
  }

  steps.push(
    healthStep("api", "pass", "Connected to slskd", {
      detail: connection.message || "slskd is reachable",
    }),
  );

  if (connection.soulseekConnected === false) {
    steps.push(
      healthStep("soulseek", "warn", "Soulseek network is connected", {
        detail: connection.serverState || "Disconnected",
        fix: "Open slskd, log in, and connect to the Soulseek server before starting downloads.",
      }),
    );
  } else {
    steps.push(
      healthStep("soulseek", "pass", "Soulseek network is connected", {
        detail: connection.serverState || "Connected",
      }),
    );
  }

  const downloadPath = String(connection.downloadPath || "").trim();
  if (!downloadPath) {
    steps.push(
      healthStep("path-reported", "warn", "slskd download folder is reported", {
        fix: "Set a download folder in slskd options, for example /data/downloads/slskd/complete.",
      }),
    );
    return buildSection("slskd", "slskd downloads", steps);
  }

  steps.push(
    healthStep("path-reported", "pass", "slskd download folder is reported", {
      detail: downloadPath,
    }),
  );

  const readablePath = await checkPathReadable(downloadPath, "slskd");
  if (!readablePath) {
    steps.push(
      healthStep("path-readable", "fail", "Aurral can read slskd completed files", {
        detail: downloadPath,
        fix: looksLikeExternalOnlyPath(downloadPath)
          ? "slskd reports a host path Aurral cannot read inside Docker. Mount the shared parent folder into both containers, or add an slskd path mapping under Settings → Storage."
          : `Mount the same host folder into Aurral at the path slskd uses, or add a path mapping for ${downloadPath}.`,
      }),
    );
    return buildSection("slskd", "slskd downloads", steps);
  }

  steps.push(
    healthStep("path-readable", "pass", "Aurral can read slskd completed files", {
      detail: formatPathAccessDetail(downloadPath, readablePath),
    }),
  );

  const sampleFile = await findSampleMediaFileInDirectory(readablePath);
  if (!sampleFile) {
    steps.push(
      healthStep("sample-file", "warn", "Sample slskd completed file on disk", {
        detail: readablePath,
        fix: "Complete at least one slskd download, then run checks again to verify a real file path.",
      }),
    );
  } else {
    steps.push(
      healthStep("sample-file", "pass", "Sample slskd completed file on disk", {
        detail: sampleFile,
      }),
    );
  }

  return buildSection("slskd", "slskd downloads", steps);
}

async function checkNzbgetSection() {
  const integrations = dbOps.getSettings()?.integrations || {};
  const nzbget = integrations.nzbget || {};
  if (nzbget.enabled !== true || !nzbgetClient.isConfigured()) {
    return buildSection("nzbget", "NZBGet downloads", [], {
      skipped: true,
      skipReason: "NZBGet is not enabled.",
    });
  }

  const steps = [];
  const connection = await nzbgetClient.testConnection({ force: true });
  if (!connection.ok) {
    steps.push(
      healthStep("api", "fail", "Connected to NZBGet", {
        detail: connection.message || "Connection failed",
        fix: "Check the NZBGet URL and credentials in Settings → Download Clients.",
      }),
    );
    return buildSection("nzbget", "NZBGet downloads", steps);
  }

  steps.push(
    healthStep("api", "pass", "Connected to NZBGet", {
      detail: connection.message || "NZBGet is reachable",
    }),
  );

  const completedPath = String(
    nzbget.completedPath ||
      connection.downloadPath ||
      connection.directories?.completedPath ||
      "",
  ).trim();

  if (!completedPath) {
    steps.push(
      healthStep("path-reported", "warn", "NZBGet completed folder is configured", {
        fix: "Set the completed download path in Settings → Download Clients → NZBGet.",
      }),
    );
    return buildSection("nzbget", "NZBGet downloads", steps);
  }

  steps.push(
    healthStep("path-reported", "pass", "NZBGet completed folder is configured", {
      detail: completedPath,
    }),
  );

  const readablePath = await checkPathReadable(completedPath, "nzbget");
  if (!readablePath) {
    steps.push(
      healthStep("path-readable", "fail", "Aurral can read NZBGet completed files", {
        detail: completedPath,
        fix: "Mount the same host folder into Aurral and NZBGet, or add an NZBGet path mapping under Settings → Storage.",
      }),
    );
    return buildSection("nzbget", "NZBGet downloads", steps);
  }

  steps.push(
    healthStep("path-readable", "pass", "Aurral can read NZBGet completed files", {
      detail: formatPathAccessDetail(completedPath, readablePath),
    }),
  );

  const sampleFile = await findSampleMediaFileInDirectory(readablePath);
  if (!sampleFile) {
    steps.push(
      healthStep("sample-file", "warn", "Sample NZBGet completed file on disk", {
        detail: readablePath,
        fix: "Complete at least one NZBGet download, then run checks again to verify a real file path.",
      }),
    );
  } else {
    steps.push(
      healthStep("sample-file", "pass", "Sample NZBGet completed file on disk", {
        detail: sampleFile,
      }),
    );
  }

  return buildSection("nzbget", "NZBGet downloads", steps);
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
  const client = new NavidromeClient(
    navidrome.url,
    navidrome.username,
    navidrome.password,
  );

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

  const expectedLibraryPath = path
    .join(resolvePlaylistRoot(), PLAYLIST_LIBRARY_DIR)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");

  let libraries = [];
  try {
    libraries = await client.getLibraries();
  } catch (error) {
    steps.push(
      healthStep("libraries", "warn", "Navidrome music libraries are readable", {
        detail: error?.message || "Could not list libraries",
        fix: "Confirm the Navidrome account can manage libraries and that the API is reachable.",
      }),
    );
  }

  const libraryList = Array.isArray(libraries) ? libraries : [];
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
      healthStep("library-readable", "fail", "Navidrome library paths are readable from Aurral", {
        detail: unreadableLibraries.join(", "),
        fix: "Mount each Navidrome music library into Aurral at the same container path, or add path mappings under Settings → Storage.",
      }),
    );
  } else if (libraryList.length > 0) {
    steps.push(
      healthStep("library-readable", "pass", "Navidrome library paths are readable from Aurral", {
        detail: libraryList
          .map((entry) => String(entry?.path || "").trim())
          .filter(Boolean)
          .join(", "),
      }),
    );
  }

  const playlistLibrary = libraryList.find((entry) =>
    pathCoversPrefix(entry?.path, expectedLibraryPath),
  );

  if (playlistLibrary) {
    steps.push(
      healthStep("aurral-library", "pass", "Navidrome scans the Aurral playlist folder", {
        detail: playlistLibrary.path,
      }),
    );
  } else {
    steps.push(
      healthStep("aurral-library", "warn", "Navidrome scans the Aurral playlist folder", {
        detail: expectedLibraryPath,
        fix: "Save Navidrome settings or run Ensure playlists so Aurral can create the playlist library, then scan it in Navidrome.",
      }),
    );
  }

  const uncoveredRoots = lidarrRootPaths.filter(
    (rootPath) =>
      !libraryList.some((library) => pathCoversPrefix(library?.path, rootPath)),
  );

  if (lidarrRootPaths.length > 0 && uncoveredRoots.length > 0) {
    steps.push(
      healthStep("lidarr-library", "warn", "Navidrome scans Lidarr library folders", {
        detail: uncoveredRoots.join(", "),
        fix: "Reused playlist tracks point at your Lidarr library. Add those folders as Navidrome music libraries, or wait for a future Aurral release that copies reused tracks into the Aurral folder.",
      }),
    );
  } else if (lidarrRootPaths.length > 0) {
    steps.push(
      healthStep("lidarr-library", "pass", "Navidrome scans Lidarr library folders", {
        detail: lidarrRootPaths.join(", "),
      }),
    );
  }

  if (lidarrSample?.path) {
    const samplePath = String(lidarrSample.path || "").trim();
    const readableSample = samplePath ? await checkPathReadable(samplePath, "lidarr") : false;
    const navidromeCoversSample = libraryList.some((library) =>
      pathCoversPrefix(library?.path, samplePath),
    );
    if (!readableSample) {
      steps.push(
        healthStep("lidarr-sample", "fail", "Sample Lidarr track file is readable from Aurral", {
          detail: samplePath,
          fix: "Fix Lidarr mounts or path mappings so Aurral can read a real track file from the library.",
        }),
      );
    } else if (!navidromeCoversSample) {
      steps.push(
        healthStep("lidarr-sample", "warn", "Navidrome scans the sample Lidarr track folder", {
          detail: samplePath,
          fix: "Add the Lidarr library folder that contains this track as a Navidrome music library.",
        }),
      );
    } else {
      steps.push(
        healthStep("lidarr-sample", "pass", "Sample Lidarr track file is readable from Aurral", {
          detail: formatPathAccessDetail(samplePath, readableSample),
        }),
      );
    }
  }

  if (getM3uPathMode() === "remote") {
    steps.push(
      healthStep("m3u-mode", "warn", "Playlist files use local container paths", {
        detail: "Use Navidrome paths in M3U files is enabled.",
        fix: "Turn this off in Settings → Playback when Navidrome and Aurral share the same /data mount. Only enable it for native Windows Navidrome or different container paths.",
      }),
    );
  } else {
    steps.push(
      healthStep("m3u-mode", "pass", "Playlist files use local container paths", {
        detail: "M3U files use the same paths Aurral reads on disk.",
      }),
    );
  }

  return buildSection("navidrome", "Navidrome playback", steps);
}

async function checkPlaylistFilesSection() {
  const steps = [];
  const weeklyFlowRoot = resolveWeeklyFlowRoot();
  const doneJobs = downloadTracker
    .getAll()
    .filter((job) => job?.status === "done" && typeof job?.finalPath === "string");

  if (doneJobs.length === 0) {
    steps.push(
      healthStep("tracked", "warn", "Completed playlist files are accessible", {
        detail: "No completed playlist tracks to verify yet.",
        fix: "Run or import a playlist, then run this check again.",
      }),
    );
    return buildSection("playlists", "Playlist files", steps);
  }

  let totalMissing = 0;
  let sampleMissing = null;
  for (const job of doneJobs) {
    const localPath = path.resolve(
      remapLegacyWeeklyFlowPath(job.finalPath, weeklyFlowRoot),
    );
    try {
      const stat = await fs.stat(localPath);
      if (!stat.isFile()) {
        totalMissing += 1;
        if (!sampleMissing) sampleMissing = localPath;
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
          ? `Example missing path: ${sampleMissing}. Fix mounts or path mappings, then run Ensure playlists.`
          : "Fix mounts or path mappings, then run Ensure playlists.",
      }),
    );
    return buildSection("playlists", "Playlist files", steps);
  }

  steps.push(
    healthStep("tracked", "pass", "Completed playlist files are accessible", {
      detail: `${doneJobs.length} completed track${doneJobs.length === 1 ? "" : "s"} verified`,
    }),
  );

  return buildSection("playlists", "Playlist files", steps);
}

export async function runStorageHealthCheck() {
  const volumeSection = await checkSharedVolumeSection();
  const downloadsSection = await checkDownloadsSection();
  const {
    section: lidarrSection,
    sample: lidarrSample,
    rootPaths: lidarrRootPaths,
  } = await checkLidarrSection();

  const sections = [
    volumeSection,
    downloadsSection,
    lidarrSection,
    await checkSlskdSection(),
    await checkNzbgetSection(),
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
