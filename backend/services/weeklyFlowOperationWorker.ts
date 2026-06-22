import { getWeeklyFlowOperationQueue, getWorkerId } from "./honkerDb.js";
import {
  processWeeklyFlowOperation,
} from "./weeklyFlowOperations.js";
import {
  rejectWeeklyFlowOperationResult,
  resolveWeeklyFlowOperationResult,
  setWeeklyFlowOperationWorkerState,
} from "./weeklyFlowOperationQueue.js";
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
  isFlowHarvestOperation,
  withHeavyWorkBudget,
} from "./resourceBudget.js";
import { withWorkerPerfSpan } from "./workerPerfMetrics.js";

const WORKER_NAME = "weekly-flow-operation";

const PERMANENT_ERROR_CODES = new Set([
  "SHARED_PLAYLIST_NAME_CONFLICT",
  "FLOW_NAME_CONFLICT",
]);

let running = false;
let stopRequested = false;
let loopPromise = null;
let currentLabel = null;
let idleController = null;

function syncWorkerState() {
  setWeeklyFlowOperationWorkerState({
    running,
    currentLabel,
  });
}

async function runLoop() {
  const queue = getWeeklyFlowOperationQueue();
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
      currentLabel = job.payload?.label || job.payload?.kind || null;
      syncWorkerState();
      try {
        const runOperation = () =>
          withWorkerPerfSpan(
            "weekly-flow-operation",
            () => processWeeklyFlowOperation(job.payload),
            currentLabel,
          );
        const result = await withJobHeartbeat(job, queue, () =>
          isFlowHarvestOperation(job.payload)
            ? withHeavyWorkBudget(
                HEAVY_WORK_TYPES.FLOW_HARVEST,
                runOperation,
                currentLabel,
              )
            : runOperation(),
        );
        job.ack();
        resolveWeeklyFlowOperationResult(job.id, result);
      } catch (error) {
        const message = error?.message || String(error);
        const permanent = PERMANENT_ERROR_CODES.has(String(error?.code || ""));
        if (permanent || job.attempts >= 3) {
          job.fail(message);
          rejectWeeklyFlowOperationResult(job.id, error);
        } else {
          job.retry(60, message);
        }
      } finally {
        currentLabel = null;
        syncWorkerState();
      }
      idleController.arm();
    }
  } catch (error) {
    if (!idleController?.idleStopped && !stopRequested) {
      console.error("[weeklyFlowOperationWorker] loop error:", error);
    }
  } finally {
    const idleStopped = idleController?.idleStopped === true;
    idleController?.dispose();
    idleController = null;
    running = false;
    loopPromise = null;
    currentLabel = null;
    syncWorkerState();
    const intentional = stopRequested || idleStopped;
    stopRequested = false;
    markHonkerWorkerLoopEnded(WORKER_NAME, startWeeklyFlowOperationWorker, {
      intentional,
    });
  }
}

export function startWeeklyFlowOperationWorker() {
  if (running || isHonkerShuttingDown()) return;
  running = true;
  stopRequested = false;
  syncWorkerState();
  loopPromise = runLoop();
}

export function stopWeeklyFlowOperationWorker() {
  stopRequested = true;
  running = false;
  idleController?.abort();
  syncWorkerState();
}

export function isWeeklyFlowOperationWorkerRunning() {
  return running;
}

export function getWeeklyFlowOperationWorkerStatus() {
  return {
    running,
    currentLabel,
  };
}

registerHonkerWorker(WORKER_NAME, {
  start: startWeeklyFlowOperationWorker,
  stop: stopWeeklyFlowOperationWorker,
  isRunning: isWeeklyFlowOperationWorkerRunning,
});
