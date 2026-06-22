import { getWeeklyFlowOperationQueue, getWorkerId } from './honkerDb.js';
import { processWeeklyFlowOperation } from './weeklyFlowOperations.js';
import {
  rejectWeeklyFlowOperationResult,
  resolveWeeklyFlowOperationResult,
  setWeeklyFlowOperationWorkerState,
} from './weeklyFlowOperationQueue.js';
import {
  createIdleAbortController,
  getWorkerIdleStopMs,
  isHonkerShuttingDown,
  markHonkerWorkerLoopEnded,
  registerHonkerWorker,
  withJobHeartbeat,
} from './honkerWorkerRuntime.js';
import { HEAVY_WORK_TYPES, isFlowHarvestOperation, withHeavyWorkBudget } from './resourceBudget.js';
import { withWorkerPerfSpan } from './workerPerfMetrics.js';

const WORKER_NAME = 'weekly-flow-operation';

const PERMANENT_ERROR_CODES = new Set(['SHARED_PLAYLIST_NAME_CONFLICT', 'FLOW_NAME_CONFLICT']);

let running = false;
let stopRequested = false;
let currentLabel: string | null = null;
let idleController: ReturnType<typeof createIdleAbortController> | null = null;

function syncWorkerState() {
  setWeeklyFlowOperationWorkerState({
    running,
    currentLabel: (currentLabel as unknown as undefined | null),
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
      currentLabel = String((job.payload as Record<string, unknown>)?.label || (job.payload as Record<string, unknown>)?.kind || '') || null;
      syncWorkerState();
      try {
        const runOperation = () =>
          withWorkerPerfSpan(
            'weekly-flow-operation',
            () => processWeeklyFlowOperation(job.payload as Record<string, unknown>),
            currentLabel as string | undefined,
          );
        const result = await withJobHeartbeat(job, queue, () =>
          isFlowHarvestOperation(job.payload as Record<string, unknown>)
            ? withHeavyWorkBudget(HEAVY_WORK_TYPES.FLOW_HARVEST, runOperation, currentLabel as string)
            : runOperation(),
        );
        job.ack();
        resolveWeeklyFlowOperationResult(job.id, result);
      } catch (error: unknown) {
        const message = (error as Error)?.message || String(error);
        const permanent = PERMANENT_ERROR_CODES.has(String((error as Record<string, unknown>)?.code || ''));
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
      console.error('[weeklyFlowOperationWorker] loop error:', error);
    }
  } finally {
    const idleStopped = idleController?.idleStopped === true;
    idleController?.dispose();
    idleController = null;
    running = false;
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
  runLoop();
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
