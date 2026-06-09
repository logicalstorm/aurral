import { dbOps } from "../config/db-helpers.js";
import { getDiscoveryUserRefreshQueue, getWorkerId } from "./honkerDb.js";
import { updateUserDiscoveryCache } from "./discoveryService.js";
import { getListenHistoryCacheNamespace } from "./listeningHistory.js";

let running = false;
let loopPromise = null;

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

async function runLoop() {
  const queue = getDiscoveryUserRefreshQueue();
  const workerId = getWorkerId();
  try {
    for await (const job of queue.claim(workerId, { idlePollS: 10 })) {
      if (!running) break;
      try {
        const profile = job.payload?.listenHistoryProfile || null;
        if (!profile) {
          job.ack();
          continue;
        }
        if (wasRefreshedSince(profile, Number(job.payload?.requestedAt))) {
          job.ack();
          continue;
        }
        await updateUserDiscoveryCache(profile);
        job.ack();
      } catch (error) {
        const message = error?.message || String(error);
        if (job.attempts >= 4) {
          job.fail(message);
        } else {
          job.retry(300, message);
        }
      }
    }
  } catch (error) {
    console.error("[discoveryUserRefreshWorker] loop error:", error);
  } finally {
    running = false;
    loopPromise = null;
  }
}

export function startDiscoveryUserRefreshWorker() {
  if (running) return;
  running = true;
  loopPromise = runLoop();
}

export function stopDiscoveryUserRefreshWorker() {
  running = false;
}

export function isDiscoveryUserRefreshWorkerRunning() {
  return running;
}
