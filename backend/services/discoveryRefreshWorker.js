import { getDiscoveryRefreshQueue, getWorkerId } from "./honkerDb.js";
import { updateDiscoveryCache, getDiscoveryCache } from "./discoveryService.js";
import {
  isDiscoveryRefreshConfigured,
  markDiscoveryRefreshDequeued,
  scheduleNextDiscoveryRefresh,
} from "./discoveryRefreshScheduler.js";
import { websocketService } from "./websocketService.js";

let running = false;
let loopPromise = null;

async function runDiscoveryRefresh(payload) {
  if (!(await isDiscoveryRefreshConfigured())) {
    getDiscoveryCache().isUpdating = false;
    websocketService.emitDiscoveryUpdate({
      isUpdating: false,
      configured: false,
    });
    return;
  }

  const cache = getDiscoveryCache();
  if (!cache.isUpdating) {
    cache.isUpdating = true;
    websocketService.emitDiscoveryUpdate({
      isUpdating: true,
      configured: true,
      phase: "starting",
      progress: 2,
      progressMessage: "Starting discovery refresh",
      reason: payload?.reason || "scheduled",
    });
  }

  await updateDiscoveryCache({ skipBusyGuard: true });
}

async function runLoop() {
  const queue = getDiscoveryRefreshQueue();
  const workerId = getWorkerId();
  try {
    for await (const job of queue.claim(workerId, { idlePollS: 5 })) {
      if (!running) break;
      markDiscoveryRefreshDequeued();
      try {
        await runDiscoveryRefresh(job.payload);
        job.ack();
        scheduleNextDiscoveryRefresh();
      } catch (error) {
        const message = error?.message || String(error);
        getDiscoveryCache().isUpdating = false;
        if (job.attempts >= 3) {
          job.fail(message);
        } else {
          job.retry(300, message);
        }
      }
    }
  } catch (error) {
    console.error("[discoveryRefreshWorker] loop error:", error);
  } finally {
    running = false;
    loopPromise = null;
  }
}

export function startDiscoveryRefreshWorker() {
  if (running) return;
  running = true;
  loopPromise = runLoop();
}

export function stopDiscoveryRefreshWorker() {
  running = false;
}

export function isDiscoveryRefreshWorkerRunning() {
  return running;
}
