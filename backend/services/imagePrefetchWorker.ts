import { getImagePrefetchQueue, getWorkerId } from './honkerDb.js';
import { dbOps } from '../config/db-helpers.js';
import { getArtistImage } from './imageService.js';
import {
  createIdleAbortController,
  getWorkerIdleStopMs,
  isHonkerShuttingDown,
  markHonkerWorkerLoopEnded,
  registerHonkerWorker,
  withJobHeartbeat,
} from './honkerWorkerRuntime.js';

const WORKER_NAME = 'image-prefetch';

let running = false;
let stopRequested = false;
let idleController: ReturnType<typeof createIdleAbortController> | null = null;

async function processImagePrefetch(payload: Record<string, unknown> = {}) {
  const mbids = (Array.isArray(payload?.mbids) ? (payload.mbids as unknown[]) : [])
    .map((mbid: unknown) => String(mbid || '').trim())
    .filter(Boolean);
  if (mbids.length === 0) return { skipped: true };

  const artistNames: Record<string, string> =
    payload?.artistNames && typeof payload.artistNames === 'object' ? payload.artistNames as Record<string, string> : {};
  await Promise.allSettled(
    mbids.map((mbid: string) => {
      const cached = dbOps.getImage(mbid);
      return getArtistImage(mbid, {
        artistName: typeof artistNames[mbid] === 'string' ? artistNames[mbid] : null,
        forceRefresh: cached?.imageUrl === 'NOT_FOUND',
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
        await withJobHeartbeat(job, queue, () => processImagePrefetch(job.payload as Record<string, unknown>));
        job.ack();
      } catch (error: unknown) {
        const message = (error as Error)?.message || String(error);
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
      console.error('[imagePrefetchWorker] loop error:', error);
    }
  } finally {
    const idleStopped = idleController?.idleStopped === true;
    idleController?.dispose();
    idleController = null;
    running = false;
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
  runLoop();
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
