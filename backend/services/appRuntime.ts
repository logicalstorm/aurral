import { ensurePlaylistFilesystemLayout } from './playlistFilesystemMigration.js';
import {
  enqueueHonkerStartupTasks,
  getHonkerQueueDepth,
  getHonkerQueueNextClaimAt,
  startHonkerScheduler,
} from './honkerDb.js';
import { startSystemTaskWorker } from './systemTaskWorker.js';
import { startLibraryScanWorker } from './libraryScanWorker.js';
import { startImagePrefetchWorker } from './imagePrefetchWorker.js';
import { startNotificationOutboxWorker } from './notificationOutboxWorker.js';
import { startSlskdOrchestratorWorker } from './slskdOrchestratorWorker.js';
import { startDiscoveryRefreshWorker } from './discoveryRefreshWorker.js';
import { startDiscoveryRecommendationEnrichmentWorker } from './discoveryRecommendationEnrichmentWorker.js';
import { startDiscoveryUserRefreshWorker } from './discoveryUserRefreshWorker.js';
import { startWeeklyFlowOperationWorker } from './weeklyFlowOperationWorker.js';
import { startWeeklyFlowPlaylistRetryWorker } from './weeklyFlowPlaylistRetryWorker.js';
import { startPlaylistMbidEnrichmentWorker } from './playlistMbidEnrichmentWorker.js';
import { registerHonkerShutdownHandler } from './honkerWorkerRuntime.js';

let backgroundWorkersStarted = false;
let workerSupervisorStarted = false;
let workerSupervisorInterval: ReturnType<typeof setInterval> | null = null;
let workerSupervisorTimer: ReturnType<typeof setTimeout> | null = null;

const WORKER_SUPERVISOR_POLL_MS = Math.max(
  15000,
  Math.floor(Number(process.env.AURRAL_WORKER_SUPERVISOR_POLL_MS) || 60000),
);

const QUEUE_WORKERS = [
  { queue: 'system-task', start: startSystemTaskWorker },
  { queue: 'library-scan', start: startLibraryScanWorker },
  { queue: 'image-prefetch', start: startImagePrefetchWorker },
  { queue: '_outbox:notifications', start: startNotificationOutboxWorker },
  { queue: 'slskd-pipeline', start: startSlskdOrchestratorWorker },
  { queue: 'discovery-refresh', start: startDiscoveryRefreshWorker },
  {
    queue: 'discovery-recommendation-enrichment',
    start: startDiscoveryRecommendationEnrichmentWorker,
  },
  { queue: 'discovery-user-refresh', start: startDiscoveryUserRefreshWorker },
  { queue: 'weekly-flow-operation', start: startWeeklyFlowOperationWorker },
  { queue: 'playlist-retry', start: startWeeklyFlowPlaylistRetryWorker },
  { queue: 'playlist-mbid-enrichment', start: startPlaylistMbidEnrichmentWorker },
];

function clearSupervisorWakeTimer() {
  if (!workerSupervisorTimer) return;
  clearTimeout(workerSupervisorTimer);
  workerSupervisorTimer = null;
}

function scheduleSupervisorWake(nextClaimAt: unknown | null) {
  clearSupervisorWakeTimer();
  const timestamp = Number(nextClaimAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return;
  const waitMs = timestamp * 1000 - Date.now();
  if (waitMs <= 0) return;
  workerSupervisorTimer = setTimeout(
    () => {
      workerSupervisorTimer = null;
      checkQueuedBackgroundWork();
    },
    Math.max(1000, Math.min(waitMs, WORKER_SUPERVISOR_POLL_MS)),
  );
  if (typeof workerSupervisorTimer.unref === 'function') {
    workerSupervisorTimer.unref();
  }
}

function checkQueuedBackgroundWork() {
  if (process.env.AURRAL_TEST_SERVER === '1') return;
  let nextClaimAt = null;
  for (const worker of QUEUE_WORKERS) {
    try {
      if (getHonkerQueueDepth(worker.queue) > 0) {
        worker.start();
      }
      const queueNextClaimAt = getHonkerQueueNextClaimAt(worker.queue);
      if (queueNextClaimAt && (nextClaimAt == null || queueNextClaimAt < nextClaimAt)) {
        nextClaimAt = queueNextClaimAt;
      }
    } catch (error: unknown) {
      console.warn(
        `[AppRuntime] Failed to inspect ${worker.queue} queue:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  scheduleSupervisorWake(nextClaimAt);
}

function startWorkerSupervisor() {
  if (workerSupervisorStarted || process.env.AURRAL_TEST_SERVER === '1') {
    return;
  }
  workerSupervisorStarted = true;
  checkQueuedBackgroundWork();
  workerSupervisorInterval = setInterval(checkQueuedBackgroundWork, WORKER_SUPERVISOR_POLL_MS);
  if (typeof workerSupervisorInterval.unref === 'function') {
    workerSupervisorInterval.unref();
  }
}

function stopWorkerSupervisor() {
  workerSupervisorStarted = false;
  clearSupervisorWakeTimer();
  if (workerSupervisorInterval) {
    clearInterval(workerSupervisorInterval);
    workerSupervisorInterval = null;
  }
}

registerHonkerShutdownHandler(() => {
  stopWorkerSupervisor();
  import('./rustWorkerRunner.js')
    .then(({ shutdownRustWorkerDaemon }) => shutdownRustWorkerDaemon())
    .catch(() => {});
});

export function startBackgroundWorkers({ logger = console } = {}) {
  if (backgroundWorkersStarted || process.env.AURRAL_TEST_SERVER === '1') {
    return false;
  }
  backgroundWorkersStarted = true;
  ensurePlaylistFilesystemLayout({ logger });
  import('./honkerTaskStatus.js')
    .then(({ clearStaleHonkerJobs }) => clearStaleHonkerJobs())
    .then((result) => {
      if (Number(result?.cleared || 0) > 0) {
        logger.info?.(`[AppRuntime] Cleared ${result.cleared} stuck background job(s) on startup`);
      }
    })
    .catch((error) => {
      logger.warn?.(
        '[AppRuntime] Failed to clear stuck background jobs on startup:',
        error?.message || error,
      );
    });
  import('./aurralHistoryService.js')
    .then(({ syncProcessingActivityHistory }) => syncProcessingActivityHistory())
    .catch((error) => {
      logger.warn?.(
        '[AppRuntime] Failed to reconcile stuck activity history on startup:',
        error?.message || error,
      );
    });
  enqueueHonkerStartupTasks();
  startWorkerSupervisor();
  import('./rustWorkerRunner.js')
    .then(({ getRustWorkerStatus }) => {
      const status = getRustWorkerStatus();
      if (status.required && !status.available) {
        logger.warn?.(
          '[AppRuntime] aurral-worker is unavailable; discovery enrichment will fail until the binary is built (cd backend/native/aurral-worker && cargo build --release)',
        );
      }
    })
    .catch(() => {});
  return true;
}

export function initializeAppRuntime({ logger = console } = {}) {
  startHonkerScheduler();
  startBackgroundWorkers({ logger });
}
