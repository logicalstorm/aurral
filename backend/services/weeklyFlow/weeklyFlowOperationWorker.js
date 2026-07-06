import createHonkerWorker from "../honkerWorkerFactory.js";
import { getWeeklyFlowOperationQueue } from "../honkerDb.js";
import { processWeeklyFlowOperation } from "./weeklyFlowOperations.js";
import { setWeeklyFlowOperationWorkerState } from "./weeklyFlowOperationQueue.js";

const PERMANENT_ERROR_CODES = new Set(["SHARED_PLAYLIST_NAME_CONFLICT", "FLOW_NAME_CONFLICT"]);

let currentLabel = null;

function syncWorkerState(running) {
  setWeeklyFlowOperationWorkerState({
    running,
    currentLabel,
  });
}

const worker = createHonkerWorker({
  name: "weekly-flow-operation",
  getQueue: getWeeklyFlowOperationQueue,
  processJob: processWeeklyFlowOperation,
  idlePollS: 5,
  retryDelayS: 60,
  maxAttempts: 3,
  onJobDequeue(payload) {
    currentLabel = payload?.label || payload?.kind || null;
    syncWorkerState(true);
  },
  onJobSuccess() {
    currentLabel = null;
    syncWorkerState(worker.isRunning());
  },
  onJobError() {
    currentLabel = null;
    syncWorkerState(worker.isRunning());
  },
  resolveRetry(error, job) {
    const message = error?.message || String(error);
    const permanent = PERMANENT_ERROR_CODES.has(String(error?.code || ""));
    if (permanent || job.attempts >= 3) {
      return { action: "fail", message };
    }
    return { action: "retry", delayS: 60, message };
  },
});

export const {
  start: startWeeklyFlowOperationWorker,
  stop: stopWeeklyFlowOperationWorker,
  isRunning: isWeeklyFlowOperationWorkerRunning,
} = worker;

export function getWeeklyFlowOperationWorkerStatus() {
  return {
    running: worker.isRunning(),
    currentLabel,
  };
}
