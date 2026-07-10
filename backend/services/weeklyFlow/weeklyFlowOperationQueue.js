import { enqueueWeeklyFlowOperationJob, getHonkerQueueDepth } from "../honkerDb.js";

let workerCurrentLabel = null;

async function enqueuePayload(payload = {}, options = {}) {
  const jobId = enqueueWeeklyFlowOperationJob(payload, options);
  return { queued: true, operationId: jobId };
}

function getStatus() {
  let pending = 0;
  try {
    pending = getHonkerQueueDepth("weekly-flow-operation");
  } catch {}
  return {
    processing: Boolean(workerCurrentLabel) || pending > 0,
    pending,
    currentLabel: workerCurrentLabel,
  };
}

export function setWeeklyFlowOperationWorkerState({
  currentLabel = null,
} = {}) {
  workerCurrentLabel =
    currentLabel == null ? null : String(currentLabel).trim() || null;
}

export const weeklyFlowOperationQueue = {
  enqueuePayload,
  getStatus,
};
