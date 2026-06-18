import { dbOps } from "../config/db-helpers.js";
import { getLastfmApiKey } from "./apiClients.js";
import { libraryManager } from "./libraryManager.js";
import {
  enqueueDiscoveryRefreshJob,
  getHonkerDb,
  isDiscoveryRefreshQueueLocked,
  isHonkerLockHeld,
  tryAcquireDiscoveryRefreshQueueLock,
  releaseDiscoveryRefreshQueueLock,
} from "./honkerDb.js";
import {
  clearDiscoveryUpdateProgress,
  getDiscoveryAutoRefreshHours,
  getDiscoveryCache,
  recordDiscoveryUpdateProgress,
} from "./discoveryService.js";

const DISCOVERY_GLOBAL_REFRESH_LOCK = "discovery-global-refresh";

function parseQueuedPayload(payload) {
  try {
    return JSON.parse(String(payload || "{}"));
  } catch {
    return {};
  }
}

function getPendingScheduledDiscoveryRefresh(targetRunAtMs = null) {
  try {
    const targetRunAtS =
      targetRunAtMs != null ? Math.floor(Number(targetRunAtMs) / 1000) : null;
    const rows = getHonkerDb().query(
      `
        SELECT id, payload, run_at
        FROM _honker_live
        WHERE queue = 'discovery-refresh'
          AND state = 'pending'
          AND run_at > ?
        ORDER BY run_at ASC, id ASC
      `,
      [Math.floor(Date.now() / 1000)],
    );
    return rows.find((row) => {
      const payload = parseQueuedPayload(row.payload);
      if (payload?.scheduleOnly !== true) return false;
      if (String(payload?.reason || "") !== "scheduled") return false;
      if (targetRunAtS == null) return true;
      return Number(row.run_at || 0) <= targetRunAtS + 60;
    }) || null;
  } catch {
    return null;
  }
}

export function isDiscoveryRefreshPending() {
  return isDiscoveryRefreshQueueLocked();
}

export function markDiscoveryRefreshDequeued() {
  releaseDiscoveryRefreshQueueLock();
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
    if (isHonkerLockHeld(DISCOVERY_GLOBAL_REFRESH_LOCK)) {
      if (force) {
        return { enqueued: true, reason: "already_updating" };
      }
      return { enqueued: false, reason: "updating" };
    }
    if (!force && isDiscoveryRefreshQueueLocked()) {
      return { enqueued: false, reason: "queued" };
    }
    if (!tryAcquireDiscoveryRefreshQueueLock()) {
      return { enqueued: false, reason: "queued" };
    }
    if (!cache.isUpdating) {
      cache.isUpdating = true;
      emitDiscoveryQueued(reason);
    }
  }

  try {
    if (
      scheduleOnly &&
      reason === "scheduled" &&
      getPendingScheduledDiscoveryRefresh(runAt)
    ) {
      return { enqueued: false, reason: "already_scheduled" };
    }
    enqueueDiscoveryRefreshJob(
      {
        reason,
        requestedAt: Date.now(),
        scheduleOnly: scheduleOnly === true,
      },
      { runAt, delaySeconds },
    );
  } catch (error) {
    if (!scheduleOnly) {
      releaseDiscoveryRefreshQueueLock();
      cache.isUpdating = false;
    }
    throw error;
  }
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
  const cache = getDiscoveryCache();
  if (
    !isHonkerLockHeld("discovery-global-refresh") &&
    !isDiscoveryRefreshQueueLocked()
  ) {
    cache.isUpdating = false;
    clearDiscoveryUpdateProgress();
  }

  if (!(await isDiscoveryRefreshConfigured())) {
    console.log(
      "Discovery not configured (no Last.fm API key and no artists). Clearing cache.",
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
    const latest = getDiscoveryCache();
    if (
      (!latest.recommendations?.length && !latest.globalTop?.length) ||
      !latest.topGenres?.length
    ) {
      const retry = enqueueDiscoveryRefresh({ reason: "startup_incomplete" });
      if (retry.enqueued) {
        console.log(
          "Discovery cache timestamp exists but data is incomplete. Re-queued refresh.",
        );
      }
      return;
    }
    console.log(
      `Discovery cache is fresh (last updated ${latest.lastUpdated}). Scheduling next refresh.`,
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
