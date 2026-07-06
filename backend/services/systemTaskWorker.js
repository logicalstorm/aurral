import createHonkerWorker from "./honkerWorkerFactory.js";
import { getSystemTaskQueue } from "./honkerDb.js";
import { cleanExpiredSessions } from "../config/session-helpers.js";

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
      const { enqueueDiscoveryRefreshIfNeeded } = await import("./discovery/refreshScheduler.js");
      await enqueueDiscoveryRefreshIfNeeded({ reason: "interval" });
      return;
    }
    case "weekly-flow-startup-check": {
      const { startWorkerIfPending } = await import("./weeklyFlow/weeklyFlowScheduler.js");
      await startWorkerIfPending();
      return;
    }
    case "discovery-bootstrap": {
      const { bootstrapDiscoveryRefresh } = await import("./discovery/refreshScheduler.js");
      await bootstrapDiscoveryRefresh();
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

const {
  start: startSystemTaskWorker,
  stop: stopSystemTaskWorker,
  isRunning: isSystemTaskWorkerRunning,
} = createHonkerWorker({
  name: "system-task",
  getQueue: getSystemTaskQueue,
  processJob: processSystemTask,
  idlePollS: 10,
  retryDelayS: 120,
  maxAttempts: 3,
});

export {
  startSystemTaskWorker,
  stopSystemTaskWorker,
  isSystemTaskWorkerRunning,
};
