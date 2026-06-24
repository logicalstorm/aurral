import createHonkerWorker from "./honkerWorkerFactory.js";
import { getDiscoveryUserRefreshQueue } from "./honkerDb.js";
import { updateUserDiscoveryCache } from "./discoveryService.js";
import { getListenHistoryCacheNamespace } from "./listeningHistory.js";
import { dbOps } from "../config/db-helpers.js";

function wasRefreshedSince(profile, requestedAt) {
  const cacheNamespace = getListenHistoryCacheNamespace(profile);
  if (!cacheNamespace || !Number.isFinite(requestedAt) || requestedAt <= 0) {
    return false;
  }
  const lastUpdated = Date.parse(
    dbOps.getDiscoveryCache(cacheNamespace)?.lastUpdated || "",
  );
  return Number.isFinite(lastUpdated) && lastUpdated >= requestedAt;
}

async function processDiscoveryUserRefresh(payload = {}) {
  const profile = payload?.listenHistoryProfile || null;
  if (!profile) {
    return { skipped: true };
  }
  if (wasRefreshedSince(profile, Number(payload?.requestedAt))) {
    return { skipped: true, reason: "already_refreshed" };
  }
  await updateUserDiscoveryCache(profile, {
    feedbackUserId: payload?.feedbackUserId || null,
  });
  return { refreshed: true };
}

const {
  start: startDiscoveryUserRefreshWorker,
  stop: stopDiscoveryUserRefreshWorker,
  isRunning: isDiscoveryUserRefreshWorkerRunning,
} = createHonkerWorker({
  name: "discovery-user-refresh",
  getQueue: getDiscoveryUserRefreshQueue,
  processJob: processDiscoveryUserRefresh,
  idlePollS: 10,
  retryDelayS: 300,
  maxAttempts: 4,
});

export {
  startDiscoveryUserRefreshWorker,
  stopDiscoveryUserRefreshWorker,
  isDiscoveryUserRefreshWorkerRunning,
};
