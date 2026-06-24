import { enqueueWeeklyFlowOperationJob, getHonkerQueueDepth } from "../honkerDb.js";

let workerRunning = false;
let workerCurrentLabel = null;

class WeeklyFlowOperationQueue {
  async enqueuePayload(payload = {}, options = {}) {
    const jobId = enqueueWeeklyFlowOperationJob(payload, options);
    return { queued: true, operationId: jobId };
  }

  getStatus() {
    let pending = 0;
    try {
      pending = getHonkerQueueDepth("weekly-flow-operation");
    } catch {}
    return {
      processing: workerRunning,
      pending,
      durablePending: 0,
      currentLabel: workerCurrentLabel,
    };
  }
}

export function setWeeklyFlowOperationWorkerState({
  running = false,
  currentLabel = null,
} = {}) {
  workerRunning = running === true;
  workerCurrentLabel =
    currentLabel == null ? null : String(currentLabel).trim() || null;
}

export const weeklyFlowOperationQueue = new WeeklyFlowOperationQueue();
