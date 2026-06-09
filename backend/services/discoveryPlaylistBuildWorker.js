import {
  getDiscoveryPlaylistBuildQueue,
  getWorkerId,
} from "./honkerDb.js";
import {
  emitDiscoverPlaylistBuildFailure,
  runQueuedDiscoverPlaylistBuild,
} from "./discoveryService.js";

let running = false;
let loopPromise = null;

async function runLoop() {
  const queue = getDiscoveryPlaylistBuildQueue();
  const workerId = getWorkerId();
  try {
    for await (const job of queue.claim(workerId, { idlePollS: 5 })) {
      if (!running) break;
      try {
        await runQueuedDiscoverPlaylistBuild(job.payload);
        job.ack();
      } catch (error) {
        const message = error?.message || String(error);
        if (job.attempts >= 3) {
          job.fail(message);
          emitDiscoverPlaylistBuildFailure(job.payload, error);
        } else {
          job.retry(120, message);
        }
      }
    }
  } catch (error) {
    console.error("[discoveryPlaylistBuildWorker] loop error:", error);
  } finally {
    running = false;
    loopPromise = null;
  }
}

export function startDiscoveryPlaylistBuildWorker() {
  if (running) return;
  running = true;
  loopPromise = runLoop();
}

export function stopDiscoveryPlaylistBuildWorker() {
  running = false;
}

export function isDiscoveryPlaylistBuildWorkerRunning() {
  return running;
}
