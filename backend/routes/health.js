import express from "express";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  getLastfmApiKey,
  getTicketmasterApiKey,
  getMetadataProviderHealthSnapshot,
} from "../services/apiClients.js";
import { getSearchBaseUrl } from "../services/aurralSearchClient.js";
import { APP_VERSION } from "../config/constants.js";
import {
  resolveRequestUser,
  getAuthUser,
  isAuthRequiredByConfig,
  issueStreamToken,
  getLocalNetworkBypassStatus,
} from "../middleware/auth.js";
import {
  getDiscoveryCache,
  getDiscoveryUpdateStatus,
} from "../services/discoveryService.js";
import { getCachedArtistCount } from "../services/libraryManager.js";
import { lidarrClient } from "../services/lidarrClient.js";
import { PLAYLIST_LIBRARY_DIR, resolvePlaylistRoot } from "../services/playlistPaths.js";
import { getFilesystemBrowseRoots } from "../services/downloadFolderConfig.js";
import { dbOps } from "../config/db-helpers.js";
import { db } from "../config/db-sqlite.js";
import { resolveAurralDataDir } from "../config/data-dir.js";
import { websocketService } from "../services/websocketService.js";
import { noCache } from "../middleware/cache.js";
import { requireAuth } from "../middleware/requirePermission.js";
import { getImageProxyCacheSizeBytes } from "../services/imageProxyService.js";
import { getDownloadSourceStatus } from "../services/downloadSourceService.js";
import {
  DISCOVERY_PROVIDER_LASTFM,
  DISCOVERY_PROVIDER_LISTENBRAINZ_FALLBACK,
  getDiscoveryCapabilities,
} from "../services/listenbrainzDiscoveryFallback.js";

const router = express.Router();
const STARTED_AT = Date.now();

function formatRuntimeMode() {
  return process.env.NODE_ENV || "production";
}

async function isRunningInDocker() {
  try {
    await fs.access("/.dockerenv");
    return true;
  } catch {}
  try {
    const cgroup = await fs.readFile("/proc/1/cgroup", "utf8");
    return /docker|kubepods|containerd|podman/i.test(cgroup);
  } catch {
    return false;
  }
}

function resolveDatabasePath() {
  const dataDir = resolveAurralDataDir();
  return process.env.AURRAL_DB_PATH
    ? path.resolve(process.env.AURRAL_DB_PATH)
    : path.join(dataDir, "aurral.db");
}

async function resolveExistingFilesystemPath(targetPath) {
  let current = path.resolve(String(targetPath || ""));
  while (current && current !== path.dirname(current)) {
    try {
      await fs.stat(current);
      return current;
    } catch {
      current = path.dirname(current);
    }
  }
  try {
    await fs.stat(current || path.sep);
    return current || path.sep;
  } catch {
    return null;
  }
}

async function getDiskSpaceEntry(location, role = null) {
  const displayLocation = String(location || "").trim();
  if (!displayLocation) return null;
  const statTarget = await resolveExistingFilesystemPath(displayLocation);
  if (!statTarget || typeof fs.statfs !== "function") {
    return {
      location: displayLocation,
      role,
      available: false,
      error: "Disk stats unavailable",
    };
  }

  try {
    const stats = await fs.statfs(statTarget);
    const blockSize = Number(stats.bsize || stats.frsize || 0);
    const availableBlocks = Number(stats.bavail ?? stats.bfree ?? 0);
    const totalBlocks = Number(stats.blocks || 0);
    if (!Number.isFinite(blockSize) || blockSize <= 0 || totalBlocks <= 0) {
      throw new Error("Filesystem did not report usable block counts");
    }
    const freeBytes = availableBlocks * blockSize;
    const totalBytes = totalBlocks * blockSize;
    return {
      location: displayLocation,
      role,
      statTarget,
      available: true,
      freeBytes,
      totalBytes,
      usedPercent: Math.min(
        100,
        Math.max(0, Math.round(((totalBytes - freeBytes) / totalBytes) * 100)),
      ),
    };
  } catch (error) {
    return {
      location: displayLocation,
      role,
      statTarget,
      available: false,
      error: error?.message || "Disk stats unavailable",
    };
  }
}

async function buildDiskSpacePayload(settings) {
  const dataDir = resolveAurralDataDir();
  const dbPath = resolveDatabasePath();
  const downloadRoot = resolvePlaylistRoot();
  const candidates = [
    { location: dataDir, role: "App data" },
    { location: path.dirname(dbPath), role: "Database" },
    { location: downloadRoot, role: "Downloads" },
    {
      location: path.join(downloadRoot, PLAYLIST_LIBRARY_DIR),
      role: "Playlist library",
    },
    ...getFilesystemBrowseRoots().map((location) => ({
      location,
      role: "Browse root",
    })),
    ...(settings.rootFolderPath && path.isAbsolute(settings.rootFolderPath)
      ? [{ location: settings.rootFolderPath, role: "Lidarr root" }]
      : []),
    ...(Array.isArray(settings.pathMappings)
      ? settings.pathMappings.map((mapping) => ({
          location: mapping.local,
          role: `${mapping.source || "Path"} mapping`,
        }))
      : []),
  ];

  const seen = new Set();
  const unique = [];
  for (const candidate of candidates) {
    const location = String(candidate.location || "").trim();
    if (!location) continue;
    const key = path.resolve(location).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }

  return (await Promise.all(
    unique.map((candidate) =>
      getDiskSpaceEntry(candidate.location, candidate.role),
    ),
  )).filter(Boolean);
}

function readSqliteVersion() {
  try {
    return db.prepare("SELECT sqlite_version() AS version").get()?.version || null;
  } catch {
    return null;
  }
}

async function buildSystemPayload(settings) {
  const dataDir = resolveAurralDataDir();
  const dbPath = resolveDatabasePath();
  const sqliteVersion = readSqliteVersion();
  return {
    startedAt: new Date(STARTED_AT).toISOString(),
    uptimeSeconds: Math.max(0, Math.floor((Date.now() - STARTED_AT) / 1000)),
    version: APP_VERSION,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    mode: formatRuntimeMode(),
    docker: await isRunningInDocker(),
    dataDir,
    databasePath: dbPath,
    startupDirectory: process.cwd(),
    hostname: os.hostname(),
    database: {
      engine: "SQLite",
      version: sqliteVersion,
      label: sqliteVersion ? `SQLite ${sqliteVersion}` : "SQLite",
    },
    diskSpace: await buildDiskSpacePayload(settings),
    links: [
      { label: "Home page", value: "aurral.org", url: "https://aurral.org" },
      { label: "Documentation", value: "docs.aurral.org", url: "https://docs.aurral.org/" },
      { label: "Source", value: "github.com/lklynet/Aurral", url: "https://github.com/lklynet/Aurral" },
      { label: "Issues", value: "github.com/lklynet/Aurral/issues", url: "https://github.com/lklynet/Aurral/issues" },
    ],
  };
}

function buildBootstrapPayload(req) {
  lidarrClient.updateConfig();
  const settings = dbOps.getSettings();
  const onboardingDone = settings.onboardingComplete;
  const authRequired = isAuthRequiredByConfig();
  const authUser = getAuthUser();
  const currentUser = resolveRequestUser(req);
  const localNetworkBypass = getLocalNetworkBypassStatus(req);
  const lidarrConfigured = lidarrClient.isConfigured();
  const downloadSources = getDownloadSourceStatus();

  const payload = {
    status: "ok",
    authRequired,
    authUser: currentUser ? currentUser.username : authUser,
    onboardingRequired: !onboardingDone,
    timestamp: new Date().toISOString(),
    appVersion: APP_VERSION,
    rootFolderConfigured: lidarrConfigured,
    lidarrConfigured,
    lastfmConfigured: !!getLastfmApiKey(),
    ticketmasterConfigured: !!getTicketmasterApiKey(),
    musicbrainzConfigured: !!settings.integrations?.metadata?.baseUrl,
    metadataConfigured: !!settings.integrations?.metadata?.baseUrl,
    searchConfigured: !!getSearchBaseUrl(),
    slskdConfigured: downloadSources.slskd.configured,
    prowlarrConfigured: downloadSources.usenet.prowlarrConfigured,
    nzbgetConfigured: downloadSources.usenet.nzbgetConfigured,
    usenetConfigured: downloadSources.usenet.configured,
    downloadSources,
    metadataProviders: getMetadataProviderHealthSnapshot(),
    localNetworkBypass,
  };

  if (currentUser) {
    payload.user = {
      id: currentUser.id,
      username: currentUser.username,
      role: currentUser.role,
      permissions: currentUser.permissions,
    };
  }

  return payload;
}

router.get("/live", noCache, (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/bootstrap", noCache, (req, res) => {
  try {
    res.json(buildBootstrapPayload(req));
  } catch (error) {
    console.error("Bootstrap check error:", error);
    res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.post("/stream-token", noCache, (req, res) => {
  const user = resolveRequestUser(req);
  if (!user) {
    return res
      .status(401)
      .json({ error: "Unauthorized", message: "Authentication required" });
  }
  const token = issueStreamToken(user);
  return res.json({ token, expiresIn: 120 });
});

router.get("/", noCache, async (req, res) => {
  try {
    const settings = dbOps.getSettings();
    const currentUser = resolveRequestUser(req);
    const payload = buildBootstrapPayload(req);
    if (currentUser) {
      const discoveryCache = getDiscoveryCache();
      const wsStats = websocketService.getStats();
      const artistCount = getCachedArtistCount();
      payload.library = {
        artistCount: typeof artistCount === "number" ? artistCount : 0,
        lastScan: null,
      };
      const discoveryUpdateStatus = getDiscoveryUpdateStatus();
      payload.discovery = {
        provider: getLastfmApiKey()
          ? DISCOVERY_PROVIDER_LASTFM
          : DISCOVERY_PROVIDER_LISTENBRAINZ_FALLBACK,
        capabilities: getDiscoveryCapabilities(!!getLastfmApiKey()),
        lastUpdated: discoveryCache?.lastUpdated || null,
        isUpdating: !!discoveryCache?.isUpdating,
        ...discoveryUpdateStatus,
        recommendationsCount: discoveryCache?.recommendations?.length || 0,
        globalTopCount: discoveryCache?.globalTop?.length || 0,
        cachedImagesCount: dbOps.countImages(),
        cachedImagesSizeBytes: getImageProxyCacheSizeBytes(),
      };
      payload.websocket = {
        clients: wsStats.totalClients,
        channels: wsStats.channels,
      };
      payload.system = await buildSystemPayload(settings);
    }
    res.json(payload);
  } catch (error) {
    console.error("Health check error:", error);
    res.status(500).json({
      error: "Internal server error",
    });
  }
});

router.get("/ws", requireAuth, noCache, (req, res) => {
  try {
    const stats = websocketService.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({
      error: "Failed to get WebSocket stats",
    });
  }
});

export default router;
