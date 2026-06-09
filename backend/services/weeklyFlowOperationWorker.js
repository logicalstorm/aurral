import { getWeeklyFlowOperationQueue, getWorkerId } from "./honkerDb.js";
import {
  processWeeklyFlowOperation,
} from "./weeklyFlowOperations.js";
import {
  rejectWeeklyFlowOperationResult,
  resolveWeeklyFlowOperationResult,
} from "./weeklyFlowOperationQueue.js";

const PERMANENT_ERROR_CODES = new Set([
  "SHARED_PLAYLIST_NAME_CONFLICT",
  "FLOW_NAME_CONFLICT",
]);

let running = false;
let loopPromise = null;
let currentLabel = null;

async function runLoop() {
  const queue = getWeeklyFlowOperationQueue();
  const workerId = getWorkerId();
  try {
    for await (const job of queue.claim(workerId, { idlePollS: 5 })) {
      if (!running) break;
      currentLabel = job.payload?.label || job.payload?.kind || null;
      try {
        const result = await processWeeklyFlowOperation(job.payload);
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
      }
    }
  } catch (error) {
    console.error("[weeklyFlowOperationWorker] loop error:", error);
  } finally {
    running = false;
    loopPromise = null;
    currentLabel = null;
  }
}

export function startWeeklyFlowOperationWorker() {
  if (running) return;
  running = true;
  loopPromise = runLoop();
}

export function stopWeeklyFlowOperationWorker() {
  running = false;
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
