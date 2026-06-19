import { getImagePrefetchQueue, getWorkerId } from "./honkerDb.js";
import { dbOps } from "../config/db-helpers.js";
import { getArtistImage } from "./imageService.js";
import {
  createIdleAbortController,
  getWorkerIdleStopMs,
  isHonkerShuttingDown,
  markHonkerWorkerLoopEnded,
  registerHonkerWorker,
  withJobHeartbeat,
} from "./honkerWorkerRuntime.js";

const WORKER_NAME = "image-prefetch";

let running = false;
let stopRequested = false;
let loopPromise = null;
let idleController = null;

async function processImagePrefetch(payload = {}) {
  const mbids = (Array.isArray(payload?.mbids) ? payload.mbids : [])
    .map((mbid) => String(mbid || "").trim())
    .filter(Boolean);
  if (mbids.length === 0) return { skipped: true };

  const artistNames =
    payload?.artistNames && typeof payload.artistNames === "object"
      ? payload.artistNames
      : {};
  await Promise.allSettled(
    mbids.map((mbid) => {
      const cached = dbOps.getImage(mbid);
      return getArtistImage(mbid, {
        artistName:
          typeof artistNames[mbid] === "string" ? artistNames[mbid] : null,
        forceRefresh: cached?.imageUrl === "NOT_FOUND",
      });
    }),
  );
  return { prefetched: mbids.length };
}

async function runLoop() {
  const queue = getImagePrefetchQueue();
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
        await withJobHeartbeat(job, queue, () => processImagePrefetch(job.payload));
        job.ack();
      } catch (error) {
        const message = error?.message || String(error);
        if (job.attempts >= 4) {
          job.fail(message);
        } else {
          job.retry(60, message);
        }
      }
      idleController.arm();
    }
  } catch (error) {
    if (!idleController?.idleStopped && !stopRequested) {
      console.error("[imagePrefetchWorker] loop error:", error);
    }
  } finally {
    const idleStopped = idleController?.idleStopped === true;
    idleController?.dispose();
    idleController = null;
    running = false;
    loopPromise = null;
    const intentional = stopRequested || idleStopped;
    stopRequested = false;
    markHonkerWorkerLoopEnded(WORKER_NAME, startImagePrefetchWorker, {
      intentional,
    });
  }
}

export function startImagePrefetchWorker() {
  if (running || isHonkerShuttingDown()) return;
  running = true;
  stopRequested = false;
  loopPromise = runLoop();
}

export function stopImagePrefetchWorker() {
  stopRequested = true;
  running = false;
  idleController?.abort();
}

export function isImagePrefetchWorkerRunning() {
  return running;
}

registerHonkerWorker(WORKER_NAME, {
  start: startImagePrefetchWorker,
  stop: stopImagePrefetchWorker,
  isRunning: isImagePrefetchWorkerRunning,
});
