import createHonkerWorker from "../honkerWorkerFactory.js";
import { getPlaylistRetryQueue, withHonkerLock } from "../honkerDb.js";
import { weeklyFlowWorker } from "./weeklyFlowWorker.js";

const {
  start: startWeeklyFlowPlaylistRetryWorker,
  stop: stopWeeklyFlowPlaylistRetryWorker,
  isRunning: isWeeklyFlowPlaylistRetryWorkerRunning,
} = createHonkerWorker({
  name: "playlist-retry",
  getQueue: getPlaylistRetryQueue,
  idlePollS: 10,
  retryDelayS: 300,
  maxAttempts: 4,
  filterJob(job) {
    const playlistType = String(job.payload?.playlistType || "").trim();
    const scheduledJobId = playlistType
      ? weeklyFlowWorker.getScheduledRetryJobId(playlistType)
      : null;
    if (!playlistType || scheduledJobId !== job.id) {
      return false;
    }
    weeklyFlowWorker.markIncompleteRetryDequeued(playlistType, job.id);
    return true;
  },
  processJob: (payload) =>
    withHonkerLock(
      `playlist-mutation:${payload.playlistType}`,
      () => weeklyFlowWorker.retryIncompletePlaylist(payload.playlistType),
      {
        ttlSeconds: 180,
        waitTimeoutMs: 5 * 60 * 1000,
      },
    ),
  onJobError(_error, job) {
    const playlistType = String(job.payload?.playlistType || "").trim();
    if (job.attempts < 4) {
      weeklyFlowWorker.restoreScheduledRetryJobId(playlistType, job.id);
    }
  },
});

export {
  startWeeklyFlowPlaylistRetryWorker,
  stopWeeklyFlowPlaylistRetryWorker,
  isWeeklyFlowPlaylistRetryWorkerRunning,
};
