import { getPlaylistReserveBuildQueue, getWorkerId } from "./honkerDb.js";
import { weeklyFlowWorker } from "./weeklyFlowWorker.js";

let running = false;
let loopPromise = null;

async function runLoop() {
  const queue = getPlaylistReserveBuildQueue();
  const workerId = getWorkerId();
  try {
    for await (const job of queue.claim(workerId, { idlePollS: 10 })) {
      if (!running) break;
      try {
        await weeklyFlowWorker.runQueuedReserveBuild(job.payload);
        job.ack();
      } catch (error) {
        const message = error?.message || String(error);
        if (job.attempts >= 3) {
          job.fail(message);
        } else {
          job.retry(120, message);
        }
      }
    }
  } catch (error) {
    console.error("[weeklyFlowPlaylistReserveBuildWorker] loop error:", error);
  } finally {
    running = false;
    loopPromise = null;
  }
}

export function startWeeklyFlowPlaylistReserveBuildWorker() {
  if (running) return;
  running = true;
  loopPromise = runLoop();
}

export function stopWeeklyFlowPlaylistReserveBuildWorker() {
  running = false;
}

export function isWeeklyFlowPlaylistReserveBuildWorkerRunning() {
  return running;
}
