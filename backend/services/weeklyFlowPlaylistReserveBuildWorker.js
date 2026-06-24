import { getPlaylistReserveBuildQueue, getWorkerId } from "./honkerDb.js";
import { weeklyFlowWorker } from "./weeklyFlowWorker.js";
import {
  createIdleAbortController,
  getWorkerIdleStopMs,
  isHonkerShuttingDown,
  markHonkerWorkerLoopEnded,
  registerHonkerWorker,
  withJobHeartbeat,
} from "./honkerWorkerRuntime.js";

const WORKER_NAME = "playlist-reserve-build";

let running = false;
let stopRequested = false;
let _loopPromise = null;
let idleController = null;

async function runLoop() {
  const queue = getPlaylistReserveBuildQueue();
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
        await withJobHeartbeat(job, queue, () =>
          weeklyFlowWorker.runQueuedReserveBuild(job.payload),
        );
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
      console.error("[weeklyFlowPlaylistReserveBuildWorker] loop error:", error);
    }
  } finally {
    const idleStopped = idleController?.idleStopped === true;
    idleController?.dispose();
    idleController = null;
    running = false;
    _loopPromise = null;
    const intentional = stopRequested || idleStopped;
    stopRequested = false;
    markHonkerWorkerLoopEnded(WORKER_NAME, startWeeklyFlowPlaylistReserveBuildWorker, {
      intentional,
    });
  }
}

export function startWeeklyFlowPlaylistReserveBuildWorker() {
  if (running || isHonkerShuttingDown()) return;
  running = true;
  stopRequested = false;
  _loopPromise = runLoop();
}

export function stopWeeklyFlowPlaylistReserveBuildWorker() {
  stopRequested = true;
  running = false;
  idleController?.abort();
}

export function isWeeklyFlowPlaylistReserveBuildWorkerRunning() {
  return running;
}

registerHonkerWorker(WORKER_NAME, {
  start: startWeeklyFlowPlaylistReserveBuildWorker,
  stop: stopWeeklyFlowPlaylistReserveBuildWorker,
  isRunning: isWeeklyFlowPlaylistReserveBuildWorkerRunning,
});
