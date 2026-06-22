import { dbOps } from '../config/db-helpers.js';
import { getDiscoveryUserRefreshQueue, getWorkerId } from './honkerDb.js';
import { updateUserDiscoveryCache } from './discoveryService.js';
import { getListenHistoryCacheNamespace } from './listeningHistory.js';
import {
  createIdleAbortController,
  getWorkerIdleStopMs,
  isHonkerShuttingDown,
  markHonkerWorkerLoopEnded,
  registerHonkerWorker,
  withJobHeartbeat,
} from './honkerWorkerRuntime.js';

const WORKER_NAME = 'discovery-user-refresh';

let running = false;
let stopRequested = false;
let idleController: ReturnType<typeof createIdleAbortController> | null = null;

function wasRefreshedSince(profile: string, requestedAt: number) {
  const cacheNamespace = getListenHistoryCacheNamespace(profile);
  if (!cacheNamespace || !Number.isFinite(requestedAt) || requestedAt <= 0) {
    return false;
  }
  const lastUpdated = Date.parse(dbOps.getDiscoveryCache(cacheNamespace)?.lastUpdated || '');
  return Number.isFinite(lastUpdated) && lastUpdated >= requestedAt;
}

async function processDiscoveryUserRefresh(payload: Record<string, unknown> = {}) {
  const profile = payload?.['listenHistoryProfile'] || null;
  if (!profile) {
    return { skipped: true };
  }
  if (wasRefreshedSince(profile as string, Number(payload?.['requestedAt']))) {
    return { skipped: true, reason: 'already_refreshed' };
  }
  await updateUserDiscoveryCache(profile as string, {
    feedbackUserId: (payload?.['feedbackUserId'] as string) || undefined,
  });
  return { refreshed: true };
}

async function runLoop() {
  const queue = getDiscoveryUserRefreshQueue();
  const workerId = getWorkerId();
  idleController = createIdleAbortController({
    idleStopMs: getWorkerIdleStopMs(),
  });
  idleController.arm();
  try {
    for await (const job of queue.claim(workerId, {
      idlePollS: 10,
      signal: idleController.signal,
    })) {
      idleController.disarm();
      if (!running || stopRequested) break;
      try {
        await withJobHeartbeat(job, queue, () => processDiscoveryUserRefresh(job.payload as Record<string, unknown>));
        job.ack();
      } catch (error: unknown) {
        const message = (error as { message?: string })?.message || String(error);
        if (job.attempts >= 4) {
          job.fail(message);
        } else {
          job.retry(300, message);
        }
      }
      idleController.arm();
    }
  } catch (error) {
    if (!idleController?.idleStopped && !stopRequested) {
      console.error('[discoveryUserRefreshWorker] loop error:', error);
    }
  } finally {
    const idleStopped = idleController?.idleStopped === true;
    idleController?.dispose();
    idleController = null;
    running = false;
    const intentional = stopRequested || idleStopped;
    stopRequested = false;
    markHonkerWorkerLoopEnded(WORKER_NAME, startDiscoveryUserRefreshWorker, {
      intentional,
    });
  }
}

export function startDiscoveryUserRefreshWorker() {
  if (running || isHonkerShuttingDown()) return;
  running = true;
  stopRequested = false;
  runLoop();
}

export function stopDiscoveryUserRefreshWorker() {
  stopRequested = true;
  running = false;
  idleController?.abort();
}

export function isDiscoveryUserRefreshWorkerRunning() {
  return running;
}

registerHonkerWorker(WORKER_NAME, {
  start: startDiscoveryUserRefreshWorker,
  stop: stopDiscoveryUserRefreshWorker,
  isRunning: isDiscoveryUserRefreshWorkerRunning,
});
