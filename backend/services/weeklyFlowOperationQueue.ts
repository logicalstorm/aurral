import { enqueueWeeklyFlowOperationJob, getHonkerQueueDepth } from './honkerDb.js';

const DEFAULT_OPERATION_WAIT_MS = 10 * 60 * 1000;

const pendingPayloadResults = new Map();
const completedPayloadResults = new Map();
let workerRunning = false;
let workerCurrentLabel: string | null = null;

function rememberCompletedResult(jobId: any, entry: any) {
  completedPayloadResults.set(jobId, entry);
  setTimeout(() => {
    completedPayloadResults.delete(jobId);
  }, 60 * 1000);
}

class WeeklyFlowOperationQueue {
  pendingPayloadCount = 0;

  async enqueuePayload(payload: any = {}, options: any = {}) {
    const waitForCompletion = options.waitForCompletion !== false;
    const waitTimeoutMs = Math.max(
      1000,
      Number(options.waitTimeoutMs || DEFAULT_OPERATION_WAIT_MS) || DEFAULT_OPERATION_WAIT_MS,
    );
    const jobId = enqueueWeeklyFlowOperationJob(payload, options);
    if (!waitForCompletion) {
      return Promise.resolve({
        queued: true,
        operationId: jobId,
      });
    }
    this.pendingPayloadCount += 1;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingPayloadResults.delete(jobId);
        this.pendingPayloadCount = Math.max(0, this.pendingPayloadCount - 1);
        resolve({
          queued: true,
          operationId: jobId,
          timedOut: true,
        });
      }, waitTimeoutMs);
      pendingPayloadResults.set(jobId, {
        resolve: (value: any) => {
          clearTimeout(timeout);
          this.pendingPayloadCount = Math.max(0, this.pendingPayloadCount - 1);
          resolve(value);
        },
        reject: (error: any) => {
          clearTimeout(timeout);
          this.pendingPayloadCount = Math.max(0, this.pendingPayloadCount - 1);
          reject(error);
        },
      });
      const completed = completedPayloadResults.get(jobId);
      if (completed) {
        completedPayloadResults.delete(jobId);
        if (completed.ok) {
          pendingPayloadResults.get(jobId)?.resolve(completed.result);
        } else {
          pendingPayloadResults.get(jobId)?.reject(completed.error);
        }
      }
    });
  }

  getStatus() {
    let pending = 0;
    try {
      pending = getHonkerQueueDepth('weekly-flow-operation');
    } catch {}
    return {
      processing: workerRunning,
      pending,
      durablePending: this.pendingPayloadCount,
      currentLabel: workerCurrentLabel,
    };
  }
}

export function setWeeklyFlowOperationWorkerState({ running = false, currentLabel = null } = {}) {
  workerRunning = running === true;
  workerCurrentLabel = currentLabel == null ? null : String(currentLabel).trim() || null;
}

export const weeklyFlowOperationQueue = new WeeklyFlowOperationQueue();

export function resolveWeeklyFlowOperationResult(jobId: any, result: any) {
  const waiter = pendingPayloadResults.get(jobId);
  if (!waiter) {
    rememberCompletedResult(jobId, { ok: true, result });
    return false;
  }
  pendingPayloadResults.delete(jobId);
  waiter.resolve(result);
  return true;
}

export function rejectWeeklyFlowOperationResult(jobId: any, error: any) {
  const waiter = pendingPayloadResults.get(jobId);
  if (!waiter) {
    rememberCompletedResult(jobId, { ok: false, error });
    return false;
  }
  pendingPayloadResults.delete(jobId);
  waiter.reject(error);
  return true;
}
