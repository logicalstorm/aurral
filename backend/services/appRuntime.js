import { isV2MigrationPending } from "../middleware/migrationGate.js";
import { ensurePlaylistFilesystemLayout } from "./playlistFilesystemMigration.js";
import {
  enqueueHonkerStartupTasks,
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

let backgroundWorkersStarted = false;

export function startBackgroundWorkers({ logger = console } = {}) {
  if (backgroundWorkersStarted || isV2MigrationPending()) {
    return false;
  }
  backgroundWorkersStarted = true;
  ensurePlaylistFilesystemLayout({ logger });
  enqueueHonkerStartupTasks();
  startSystemTaskWorker();
  startLibraryScanWorker();
  startImagePrefetchWorker();
  startNotificationOutboxWorker();
  startSlskdOrchestratorWorker();
  startDiscoveryRefreshWorker();
  startDiscoveryPlaylistBuildWorker();
  startDiscoveryUserRefreshWorker();
  startWeeklyFlowOperationWorker();
  startWeeklyFlowPlaylistRetryWorker();
  startWeeklyFlowPlaylistReserveBuildWorker();
  return true;
}

export function initializeAppRuntime({ logger = console } = {}) {
  startHonkerScheduler();
  if (isV2MigrationPending()) {
    logger.info?.("V2 migration pending; background workers deferred.");
    return;
  }
  startBackgroundWorkers({ logger });
}
