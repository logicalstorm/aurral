import { getSystemTaskQueue, getWorkerId } from "./honkerDb.js";
import { cleanExpiredSessions } from "../config/session-helpers.js";
import {
  createIdleAbortController,
  getWorkerIdleStopMs,
  isHonkerShuttingDown,
  markHonkerWorkerLoopEnded,
  registerHonkerWorker,
  withJobHeartbeat,
} from "./honkerWorkerRuntime.js";

const WORKER_NAME = "system-task";

let running = false;
let stopRequested = false;
let _loopPromise = null;
let idleController = null;

async function processSystemTask(payload = {}) {
  const kind = String(payload?.kind || "").trim();
  switch (kind) {
    case "weekly-flow-refresh": {
      const { runScheduledRefresh } = await import("./weeklyFlow/weeklyFlowScheduler.js");
      await runScheduledRefresh();
      return;
    }
    case "session-cleanup":
      cleanExpiredSessions();
      return;
    case "weekly-flow-reuse-repair": {
      const { weeklyFlowWorker } = await import("./weeklyFlow/weeklyFlowWorker.js");
      weeklyFlowWorker.scheduleReuseLinkRepair(false);
      return;
    }
    case "weekly-flow-startup-reuse-repair": {
      const { weeklyFlowWorker } = await import("./weeklyFlow/weeklyFlowWorker.js");
      weeklyFlowWorker.scheduleReuseLinkRepair(true);
      return;
    }
    case "discovery-refresh-check": {
      const { enqueueDiscoveryRefreshIfNeeded } = await import(
        "./discovery/refreshScheduler.js"
      );      await enqueueDiscoveryRefreshIfNeeded({ reason: "interval" });
      return;
    }
    case "weekly-flow-startup-check": {
      const { startWorkerIfPending } = await import("./weeklyFlow/weeklyFlowScheduler.js");
      await startWorkerIfPending();
      return;
    }
    case "discovery-bootstrap": {
      const { bootstrapDiscoveryRefresh } = await import(
        "./discovery/refreshScheduler.js"
      );      await bootstrapDiscoveryRefresh();
      return;
    }
    case "playlist-startup-migration": {
      const [
        { migrateLegacyWeeklyFlowPaths, resolveWeeklyFlowRoot },
        trackerModule,
        { playlistManager },
      ] = await Promise.all([
        import("./weeklyFlow/weeklyFlowPaths.js"),
        import("./weeklyFlow/weeklyFlowDownloadTracker.js"),
        import("./weeklyFlow/weeklyFlowPlaylistManager.js"),
      ]);
      const result = await migrateLegacyWeeklyFlowPaths(
        resolveWeeklyFlowRoot(),
        trackerModule.downloadTracker,
      );
      if (result.migrated > 0) {
        console.log(
          `[Playlists] Migrated ${result.migrated} legacy track paths to ${resolveWeeklyFlowRoot()}`,
        );
      }
      playlistManager.updateConfig(false);
      await playlistManager.ensurePlaylists();
      await playlistManager.scheduleScanLibrary(true);
      return;
    }
    case "lidarr-retry": {
      const { libraryManager } = await import("./libraryManager.js");
      await libraryManager.getAllArtists();
      return;
    }
    default:
      throw new Error(`Unknown system task: ${kind || "unknown"}`);
  }
}

async function runLoop() {
  const queue = getSystemTaskQueue();
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
        await withJobHeartbeat(job, queue, () => processSystemTask(job.payload));
        job.ack();
      } catch (error) {
        const message = error?.message || String(error);
        if (job.attempts >= 3) {
          job.fail(message);
        } else {
          job.retry(120, message);
        }
      }
      idleController.arm();
    }
  } catch (error) {
    if (!idleController?.idleStopped && !stopRequested) {
      console.error("[systemTaskWorker] loop error:", error);
    }
  } finally {
    const idleStopped = idleController?.idleStopped === true;
    idleController?.dispose();
    idleController = null;
    running = false;
    _loopPromise = null;
    const intentional = stopRequested || idleStopped;
    stopRequested = false;
    markHonkerWorkerLoopEnded(WORKER_NAME, startSystemTaskWorker, {
      intentional,
    });
  }
}

export function startSystemTaskWorker() {
  if (running || isHonkerShuttingDown()) return;
  running = true;
  stopRequested = false;
  _loopPromise = runLoop();
}

export function stopSystemTaskWorker() {
  stopRequested = true;
  running = false;
  idleController?.abort();
}

export function isSystemTaskWorkerRunning() {
  return running;
}

registerHonkerWorker(WORKER_NAME, {
  start: startSystemTaskWorker,
  stop: stopSystemTaskWorker,
  isRunning: isSystemTaskWorkerRunning,
});
