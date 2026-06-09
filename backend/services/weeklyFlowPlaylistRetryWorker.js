import { getPlaylistRetryQueue, getWorkerId, withHonkerLock } from "./honkerDb.js";
import { weeklyFlowWorker } from "./weeklyFlowWorker.js";

let running = false;
let loopPromise = null;

async function runLoop() {
  const queue = getPlaylistRetryQueue();
  const workerId = getWorkerId();
  try {
    for await (const job of queue.claim(workerId, { idlePollS: 10 })) {
      if (!running) break;
      const playlistType = String(job.payload?.playlistType || "").trim();
      const scheduledJobId = playlistType
        ? weeklyFlowWorker.getScheduledRetryJobId(playlistType)
        : null;
      if (!playlistType || scheduledJobId !== job.id) {
        job.ack();
        continue;
      }
      weeklyFlowWorker.markIncompleteRetryDequeued(playlistType, job.id);
      try {
        await withHonkerLock(
          `playlist-mutation:${playlistType}`,
          () => weeklyFlowWorker.retryIncompletePlaylist(playlistType),
          {
            ttlSeconds: 180,
            waitTimeoutMs: 5 * 60 * 1000,
          },
        );
        job.ack();
      } catch (error) {
        const message = error?.message || String(error);
        if (job.attempts >= 4) {
          job.fail(message);
        } else {
          weeklyFlowWorker.restoreScheduledRetryJobId(playlistType, job.id);
          job.retry(300, message);
        }
      }
    }
  } catch (error) {
    console.error("[weeklyFlowPlaylistRetryWorker] loop error:", error);
  } finally {
    running = false;
    loopPromise = null;
  }
}

export function startWeeklyFlowPlaylistRetryWorker() {
  if (running) return;
  running = true;
  loopPromise = runLoop();
}

export function stopWeeklyFlowPlaylistRetryWorker() {
  running = false;
}

export function isWeeklyFlowPlaylistRetryWorkerRunning() {
  return running;
}
