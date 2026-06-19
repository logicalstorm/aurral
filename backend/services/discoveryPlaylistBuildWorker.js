import {
  getDiscoveryPlaylistBuildQueue,
  getWorkerId,
} from "./honkerDb.js";
import {
  emitDiscoverPlaylistBuildFailure,
  runQueuedDiscoverPlaylistBuild,
} from "./discoveryService.js";
import {
  createIdleAbortController,
  getWorkerIdleStopMs,
  isHonkerShuttingDown,
  markHonkerWorkerLoopEnded,
  registerHonkerWorker,
  withJobHeartbeat,
} from "./honkerWorkerRuntime.js";

const WORKER_NAME = "discovery-playlist-build";

let running = false;
let stopRequested = false;
let loopPromise = null;
let idleController = null;

async function runLoop() {
  const queue = getDiscoveryPlaylistBuildQueue();
  const workerId = getWorkerId();
  idleController = createIdleAbortController({
    idleStopMs: getWorkerIdleStopMs(),
  });
  idleController.arm();
  try {
    for await (const job of queue.claim(workerId, {
      idlePollS: 5,
      signal: idleController.signal,
    })) {
      idleController.disarm();
      if (!running || stopRequested) break;
      try {
        await withJobHeartbeat(job, queue, () =>
          runQueuedDiscoverPlaylistBuild(job.payload),
        );
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
      idleController.arm();
    }
  } catch (error) {
    if (!idleController?.idleStopped && !stopRequested) {
      console.error("[discoveryPlaylistBuildWorker] loop error:", error);
    }
  } finally {
    const idleStopped = idleController?.idleStopped === true;
    idleController?.dispose();
    idleController = null;
    running = false;
    loopPromise = null;
    const intentional = stopRequested || idleStopped;
    stopRequested = false;
    markHonkerWorkerLoopEnded(WORKER_NAME, startDiscoveryPlaylistBuildWorker, {
      intentional,
    });
  }
}

export function startDiscoveryPlaylistBuildWorker() {
  if (running || isHonkerShuttingDown()) return;
  running = true;
  stopRequested = false;
  loopPromise = runLoop();
}

export function stopDiscoveryPlaylistBuildWorker() {
  stopRequested = true;
  running = false;
  idleController?.abort();
}

export function isDiscoveryPlaylistBuildWorkerRunning() {
  return running;
}

registerHonkerWorker(WORKER_NAME, {
  start: startDiscoveryPlaylistBuildWorker,
  stop: stopDiscoveryPlaylistBuildWorker,
  isRunning: isDiscoveryPlaylistBuildWorkerRunning,
});
