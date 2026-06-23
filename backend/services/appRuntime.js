import { ensurePlaylistFilesystemLayout } from "./playlistFilesystemMigration.js";
import {
  enqueueHonkerStartupTasks,
  getHonkerQueueDepth,
  getHonkerQueueNextClaimAt,
  startHonkerScheduler,
} from "./honkerDb.js";
import { startSystemTaskWorker } from "./systemTaskWorker.js";
import { startLibraryScanWorker } from "./libraryScanWorker.js";
import { startImagePrefetchWorker } from "./imagePrefetchWorker.js";
import { startNotificationOutboxWorker } from "./notificationOutboxWorker.js";
import { startSlskdOrchestratorWorker } from "./slskdOrchestratorWorker.js";
import { startDiscoveryRefreshWorker } from "./discoveryRefreshWorker.js";
import { startDiscoveryPlaylistBuildWorker } from "./discoveryPlaylistBuildWorker.js";
import { startDiscoveryUserRefreshWorker } from "./discoveryUserRefreshWorker.js";
import { startWeeklyFlowOperationWorker } from "./weeklyFlowOperationWorker.js";
import { startWeeklyFlowPlaylistRetryWorker } from "./weeklyFlowPlaylistRetryWorker.js";
import { startWeeklyFlowPlaylistReserveBuildWorker } from "./weeklyFlowPlaylistReserveBuildWorker.js";
import { startPlaylistMbidEnrichmentWorker } from "./playlistMbidEnrichmentWorker.js";
import { registerHonkerShutdownHandler } from "./honkerWorkerRuntime.js";

let backgroundWorkersStarted = false;
let workerSupervisorStarted = false;
let workerSupervisorInterval = null;
let workerSupervisorTimer = null;

const WORKER_SUPERVISOR_POLL_MS = Math.max(
  15000,
  Math.floor(Number(process.env.AURRAL_WORKER_SUPERVISOR_POLL_MS) || 60000),
);

const QUEUE_WORKERS = [
  { queue: "system-task", start: startSystemTaskWorker },
  { queue: "library-scan", start: startLibraryScanWorker },
  { queue: "image-prefetch", start: startImagePrefetchWorker },
  { queue: "_outbox:notifications", start: startNotificationOutboxWorker },
  { queue: "slskd-pipeline", start: startSlskdOrchestratorWorker },
  { queue: "discovery-refresh", start: startDiscoveryRefreshWorker },
  { queue: "discovery-playlist-build", start: startDiscoveryPlaylistBuildWorker },
  { queue: "discovery-user-refresh", start: startDiscoveryUserRefreshWorker },
  { queue: "weekly-flow-operation", start: startWeeklyFlowOperationWorker },
  { queue: "playlist-retry", start: startWeeklyFlowPlaylistRetryWorker },
  {
    queue: "playlist-reserve-build",
    start: startWeeklyFlowPlaylistReserveBuildWorker,
  },
  { queue: "playlist-mbid-enrichment", start: startPlaylistMbidEnrichmentWorker },
];

function clearSupervisorWakeTimer() {
  if (!workerSupervisorTimer) return;
  clearTimeout(workerSupervisorTimer);
  workerSupervisorTimer = null;
}

function scheduleSupervisorWake(nextClaimAt) {
  clearSupervisorWakeTimer();
  const timestamp = Number(nextClaimAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return;
  const waitMs = timestamp * 1000 - Date.now();
  if (waitMs <= 0) return;
  workerSupervisorTimer = setTimeout(() => {
    workerSupervisorTimer = null;
    checkQueuedBackgroundWork();
  }, Math.max(1000, Math.min(waitMs, WORKER_SUPERVISOR_POLL_MS)));
  if (typeof workerSupervisorTimer.unref === "function") {
    workerSupervisorTimer.unref();
  }
}

function checkQueuedBackgroundWork() {
  if (process.env.AURRAL_TEST_SERVER === "1") return;
  let nextClaimAt = null;
  for (const worker of QUEUE_WORKERS) {
    try {
      if (getHonkerQueueDepth(worker.queue) > 0) {
        worker.start();
      }
      const queueNextClaimAt = getHonkerQueueNextClaimAt(worker.queue);
      if (
        queueNextClaimAt &&
        (nextClaimAt == null || queueNextClaimAt < nextClaimAt)
      ) {
        nextClaimAt = queueNextClaimAt;
      }
    } catch (error) {
      console.warn(
        `[AppRuntime] Failed to inspect ${worker.queue} queue:`,
        error?.message || error,
      );
    }
  }
  scheduleSupervisorWake(nextClaimAt);
}

function startWorkerSupervisor() {
  if (workerSupervisorStarted || process.env.AURRAL_TEST_SERVER === "1") {
    return;
  }
  workerSupervisorStarted = true;
  checkQueuedBackgroundWork();
  workerSupervisorInterval = setInterval(
    checkQueuedBackgroundWork,
    WORKER_SUPERVISOR_POLL_MS,
  );
  if (typeof workerSupervisorInterval.unref === "function") {
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
});

export function startBackgroundWorkers({ logger = console } = {}) {
  if (
    backgroundWorkersStarted ||
    process.env.AURRAL_TEST_SERVER === "1"
  ) {
    return false;
  }
  backgroundWorkersStarted = true;
  ensurePlaylistFilesystemLayout({ logger });
  import("./honkerTaskStatus.js")
    .then(({ clearStaleHonkerJobs }) => clearStaleHonkerJobs())
    .then((result) => {
      if (Number(result?.cleared || 0) > 0) {
        logger.info?.(
          `[AppRuntime] Cleared ${result.cleared} stuck background job(s) on startup`,
        );
      }
    })
    .catch((error) => {
      logger.warn?.(
        "[AppRuntime] Failed to clear stuck background jobs on startup:",
        error?.message || error,
      );
    });
  import("./aurralHistoryService.js")
    .then(({ syncProcessingActivityHistory }) =>
      syncProcessingActivityHistory(),
    )
    .catch((error) => {
      logger.warn?.(
        "[AppRuntime] Failed to reconcile stuck activity history on startup:",
        error?.message || error,
      );
    });
  enqueueHonkerStartupTasks();
  startWorkerSupervisor();
  return true;
}

export function initializeAppRuntime({ logger = console } = {}) {
  startHonkerScheduler();
  startBackgroundWorkers({ logger });
}
