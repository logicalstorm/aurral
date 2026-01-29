import { downloadTracker } from "./weeklyFlowDownloadTracker.js";
import { weeklyFlowWorker } from "./weeklyFlowWorker.js";
import { playlistSource } from "./weeklyFlowPlaylistSource.js";
import { playlistManager } from "./weeklyFlowPlaylistManager.js";
import { flowPlaylistConfig } from "./weeklyFlowPlaylistConfig.js";
import { soulseekClient } from "./simpleSoulseekClient.js";

const DEFAULT_LIMIT = 30;
const QUEUE_LIMIT = 35;

export async function runScheduledRefresh() {
  if (!soulseekClient.isConfigured()) return;

  const due = flowPlaylistConfig.getDueForRefresh();
  if (due.length === 0) return;

  for (const playlistType of due) {
    try {
      weeklyFlowWorker.stop();
      playlistManager.updateConfig();
      await playlistManager.weeklyReset([playlistType]);
      downloadTracker.clearByPlaylistType(playlistType);

      const tracks = await playlistSource.getTracksForPlaylist(
        playlistType,
        QUEUE_LIMIT,
      );
      if (tracks.length === 0) {
        flowPlaylistConfig.scheduleNextRun(playlistType);
        continue;
      }

      downloadTracker.addJobs(tracks, playlistType);
      if (!weeklyFlowWorker.running) {
        await weeklyFlowWorker.start();
      }
      flowPlaylistConfig.scheduleNextRun(playlistType);
      console.log(
        `[WeeklyFlowScheduler] Refreshed ${playlistType} (${tracks.length} tracks)`,
      );
    } catch (error) {
      console.error(
        `[WeeklyFlowScheduler] Failed to refresh ${playlistType}:`,
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
