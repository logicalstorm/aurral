import { getDiscoveryRefreshQueue, getWorkerId } from "./honkerDb.js";
import {
  clearDiscoveryUpdateProgress,
  getDiscoveryCache,
  recordDiscoveryUpdateProgress,
  updateDiscoveryCache,
} from "./discoveryService.js";
import {
  discoveryNeedsRefresh,
  isDiscoveryRefreshConfigured,
  markDiscoveryRefreshDequeued,
  scheduleNextDiscoveryRefresh,
} from "./discoveryRefreshScheduler.js";
import {
  createIdleAbortController,
  getWorkerIdleStopMs,
  isHonkerShuttingDown,
  markHonkerWorkerLoopEnded,
  registerHonkerWorker,
  withJobHeartbeat,
} from "./honkerWorkerRuntime.js";
import {
  HEAVY_WORK_TYPES,
  withHeavyWorkBudget,
} from "./resourceBudget.js";
import { withWorkerPerfSpan } from "./workerPerfMetrics.js";

const WORKER_NAME = "discovery-refresh";

let running = false;
let stopRequested = false;
let loopPromise = null;
let idleController = null;

async function runDiscoveryRefresh(payload) {
  if (!(await isDiscoveryRefreshConfigured())) {
    getDiscoveryCache().isUpdating = false;
    clearDiscoveryUpdateProgress();
    return;
  }

  if (payload?.scheduleOnly === true && !discoveryNeedsRefresh()) {
    return;
  }

  const cache = getDiscoveryCache();
  if (!cache.isUpdating) {
    cache.isUpdating = true;
    recordDiscoveryUpdateProgress(
      "starting",
      "Starting discovery refresh",
      2,
      { reason: payload?.reason || "scheduled" },
    );
  }

  await updateDiscoveryCache();
}

async function runLoop() {
  const queue = getDiscoveryRefreshQueue();
  const workerId = getWorkerId();
  idleController = createIdleAbortController({
    idleStopMs: getWorkerIdleStopMs(),
  });
  idleController.arm();
  try {
    for await (const job of queue.claim(workerId, {
      idlePollS: 5,
      signal: idleController.signal,
    })) {
      idleController.disarm();
      if (!running || stopRequested) break;
      markDiscoveryRefreshDequeued();
      try {
        await withJobHeartbeat(job, queue, () =>
          withHeavyWorkBudget(
            HEAVY_WORK_TYPES.DISCOVERY_REFRESH,
            () =>
              withWorkerPerfSpan(
                "discovery-refresh",
                () => runDiscoveryRefresh(job.payload),
                job.payload?.reason || "scheduled",
              ),
            job.payload?.reason || "discovery-refresh",
          ),
        );
        job.ack();
        scheduleNextDiscoveryRefresh();
      } catch (error) {
        const message = error?.message || String(error);
        getDiscoveryCache().isUpdating = false;
        clearDiscoveryUpdateProgress();
        if (job.attempts >= 3) {
          job.fail(message);
        } else {
          job.retry(300, message);
        }
      }
      idleController.arm();
    }
  } catch (error) {
    if (!idleController?.idleStopped && !stopRequested) {
      console.error("[discoveryRefreshWorker] loop error:", error);
    }
  } finally {
    const idleStopped = idleController?.idleStopped === true;
    idleController?.dispose();
    idleController = null;
    running = false;
    loopPromise = null;
    const intentional = stopRequested || idleStopped;
    stopRequested = false;
    markHonkerWorkerLoopEnded(WORKER_NAME, startDiscoveryRefreshWorker, {
      intentional,
    });
  }
}

export function startDiscoveryRefreshWorker() {
  if (running || isHonkerShuttingDown()) return;
  running = true;
  stopRequested = false;
  loopPromise = runLoop();
}

export function stopDiscoveryRefreshWorker() {
  stopRequested = true;
  running = false;
  idleController?.abort();
}

export function isDiscoveryRefreshWorkerRunning() {
  return running;
}

registerHonkerWorker(WORKER_NAME, {
  start: startDiscoveryRefreshWorker,
  stop: stopDiscoveryRefreshWorker,
  isRunning: isDiscoveryRefreshWorkerRunning,
});
