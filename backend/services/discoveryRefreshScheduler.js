import { dbOps } from "../config/db-helpers.js";
import { getLastfmApiKey } from "./apiClients.js";
import { libraryManager } from "./libraryManager.js";
import { enqueueDiscoveryRefreshJob } from "./honkerDb.js";
import {
  getDiscoveryAutoRefreshHours,
  getDiscoveryCache,
  recordDiscoveryUpdateProgress,
} from "./discoveryService.js";

let refreshPending = false;

export function isDiscoveryRefreshPending() {
  return refreshPending;
}

export function markDiscoveryRefreshDequeued() {
  refreshPending = false;
}

export async function isDiscoveryRefreshConfigured() {
  const hasLastfm = !!getLastfmApiKey();
  if (hasLastfm) return true;
  const libraryArtists = await libraryManager.getAllArtists();
  return libraryArtists.length > 0;
}

export function discoveryNeedsRefresh(cache = getDiscoveryCache()) {
  const lastUpdated = cache?.lastUpdated;
  const hasRecommendations =
    Array.isArray(cache?.recommendations) && cache.recommendations.length > 0;
  const hasGenres =
    Array.isArray(cache?.topGenres) && cache.topGenres.length > 0;
  const refreshHours = getDiscoveryAutoRefreshHours();
  const staleCutoff = Date.now() - refreshHours * 60 * 60 * 1000;
  return (
    !lastUpdated ||
    new Date(lastUpdated).getTime() < staleCutoff ||
    !hasRecommendations ||
    !hasGenres
  );
}

function emitDiscoveryQueued(reason) {
  recordDiscoveryUpdateProgress(
    "queued",
    "Discovery refresh queued",
    1,
    { reason },
  );
}

export function enqueueDiscoveryRefresh(options = {}) {
  const {
    force = false,
    reason = "manual",
    runAt = null,
    delaySeconds = null,
    scheduleOnly = false,
  } = options;
  const cache = getDiscoveryCache();

  if (!scheduleOnly) {
    if (cache.isUpdating) {
      if (force) {
        return { enqueued: true, reason: "already_updating" };
      }
      return { enqueued: false, reason: "updating" };
    }
    if (!force && refreshPending) {
      return { enqueued: false, reason: "queued" };
    }
    refreshPending = true;
    if (!cache.isUpdating) {
      cache.isUpdating = true;
      emitDiscoveryQueued(reason);
    }
  }

  enqueueDiscoveryRefreshJob(
    {
      reason,
      requestedAt: Date.now(),
      scheduleOnly: scheduleOnly === true,
    },
    { runAt, delaySeconds },
  );
  return { enqueued: true, reason };
}

export function scheduleNextDiscoveryRefresh() {
  const cache = getDiscoveryCache();
  const refreshMs = getDiscoveryAutoRefreshHours() * 60 * 60 * 1000;
  const base = cache.lastUpdated
    ? new Date(cache.lastUpdated).getTime()
    : Date.now();
  const runAtMs = base + refreshMs;
  if (runAtMs <= Date.now()) {
    return enqueueDiscoveryRefresh({ reason: "scheduled" });
  }
  return enqueueDiscoveryRefresh({
    reason: "scheduled",
    runAt: runAtMs,
    scheduleOnly: true,
  });
}

export async function enqueueDiscoveryRefreshIfNeeded(options = {}) {
  if (!(await isDiscoveryRefreshConfigured())) {
    return { enqueued: false, reason: "not_configured" };
  }
  if (!options.force && !discoveryNeedsRefresh()) {
    return { enqueued: false, reason: "fresh" };
  }
  return enqueueDiscoveryRefresh(options);
}

export async function bootstrapDiscoveryRefresh() {
  if (!(await isDiscoveryRefreshConfigured())) {
    console.log(
      "Discovery not configured (no Last.fm key and no artists). Clearing cache.",
    );
    try {
      dbOps.updateDiscoveryCache({
        recommendations: [],
        globalTop: [],
        basedOn: [],
        topTags: [],
        topGenres: [],
        lastUpdated: null,
      });
      Object.assign(getDiscoveryCache(), {
        recommendations: [],
        globalTop: [],
        basedOn: [],
        topTags: [],
        topGenres: [],
        lastUpdated: null,
        isUpdating: false,
      });
    } catch (error) {
      console.error("Failed to clear discovery cache:", error.message);
    }
    return;
  }

  const result = await enqueueDiscoveryRefreshIfNeeded({ reason: "startup" });
  if (result.reason === "fresh") {
    console.log(
      `Discovery cache is fresh (last updated ${getDiscoveryCache().lastUpdated}). Scheduling next refresh.`,
    );
    scheduleNextDiscoveryRefresh();
    return;
  }
  if (result.enqueued) {
    console.log("Discovery cache needs update. Queued refresh.");
  }
}

export function requestDiscoveryRefresh(options = {}) {
  return enqueueDiscoveryRefresh({
    ...options,
    reason: options.reason || "manual",
    force: options.force === true,
  });
}
