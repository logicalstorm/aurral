import { getDiscoveryRefreshQueue, getWorkerId } from './honkerDb.js';
import {
  clearDiscoveryUpdateProgress,
  getDiscoveryCache,
  updateDiscoveryCache,
} from './discoveryService.js';
import {
  discoveryNeedsRefresh,
  isDiscoveryRefreshConfigured,
  markDiscoveryRefreshDequeued,
  scheduleNextDiscoveryRefresh,
} from './discoveryRefreshScheduler.js';
import {
  createIdleAbortController,
  getWorkerIdleStopMs,
  isHonkerShuttingDown,
  markHonkerWorkerLoopEnded,
  registerHonkerWorker,
  withJobHeartbeat,
} from './honkerWorkerRuntime.js';
import { HEAVY_WORK_TYPES, withHeavyWorkBudget } from './resourceBudget.js';
import { withWorkerPerfSpan } from './workerPerfMetrics.js';

const WORKER_NAME = 'discovery-refresh';

let running = false;
let stopRequested = false;
let idleController: ReturnType<typeof createIdleAbortController> | null = null;

async function runDiscoveryRefresh(payload: Record<string, unknown>) {
  if (!(await isDiscoveryRefreshConfigured())) {
    getDiscoveryCache().isUpdating = false;
    clearDiscoveryUpdateProgress();
    return;
  }

  if (payload?.scheduleOnly === true && !discoveryNeedsRefresh()) {
    return;
  }

  const cache = getDiscoveryCache();
  cache.isUpdating = true;

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
        const payload = job.payload as Record<string, unknown>;
        await withJobHeartbeat(job, queue, () =>
          withHeavyWorkBudget(
            HEAVY_WORK_TYPES.DISCOVERY_REFRESH,
            () =>
              withWorkerPerfSpan(
                'discovery-refresh',
                () => runDiscoveryRefresh(payload),
                (payload?.['reason'] as string) || 'scheduled',
              ),
            (payload?.['reason'] as string) || 'discovery-refresh',
          ),
        );
        job.ack();
        scheduleNextDiscoveryRefresh();
      } catch (error: unknown) {
        const message = (error as { message?: string })?.message || String(error);
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
      console.error('[discoveryRefreshWorker] loop error:', error);
    }
  } finally {
    const idleStopped = idleController?.idleStopped === true;
    idleController?.dispose();
    idleController = null;
    running = false;
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
  runLoop();
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
