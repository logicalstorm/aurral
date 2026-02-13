import { downloadTracker } from "./weeklyFlowDownloadTracker.js";
import { weeklyFlowWorker } from "./weeklyFlowWorker.js";
import { playlistSource } from "./weeklyFlowPlaylistSource.js";
import { playlistManager } from "./weeklyFlowPlaylistManager.js";
import { flowPlaylistConfig } from "./weeklyFlowPlaylistConfig.js";
import { soulseekClient } from "./simpleSoulseekClient.js";

const QUEUE_LIMIT = 50;

export async function runScheduledRefresh() {
  if (!soulseekClient.isConfigured()) return;

  const due = flowPlaylistConfig.getDueForRefresh();
  if (due.length === 0) return;

  for (const flow of due) {
    try {
      weeklyFlowWorker.stop();
      playlistManager.updateConfig();
      await playlistManager.weeklyReset([flow.id]);
      downloadTracker.clearByPlaylistType(flow.id);

      const tracks = await playlistSource.getTracksForFlow(
        flow,
        Math.max(flow.size || QUEUE_LIMIT, QUEUE_LIMIT),
      );
      if (tracks.length === 0) {
        flowPlaylistConfig.scheduleNextRun(flow.id);
        continue;
      }

      downloadTracker.addJobs(tracks, flow.id);
      if (!weeklyFlowWorker.running) {
        await weeklyFlowWorker.start();
      }
      flowPlaylistConfig.scheduleNextRun(flow.id);
      console.log(
        `[WeeklyFlowScheduler] Refreshed ${flow.id} (${tracks.length} tracks)`,
      );
    } catch (error) {
      console.error(
        `[WeeklyFlowScheduler] Failed to refresh ${flow.id}:`,
        error.message,
      );
    }
  }
}

export function startWorkerIfPending() {
  const pending = downloadTracker.getNextPending();
  if (pending && !weeklyFlowWorker.running) {
    weeklyFlowWorker.start().catch((err) => {
      console.error(
        "[WeeklyFlowScheduler] Failed to start worker:",
        err.message,
      );
    });
  }
}
