import { getImagePrefetchQueue, getWorkerId } from "./honkerDb.js";
import { getArtistImage } from "./imageService.js";

let running = false;
let loopPromise = null;

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
    mbids.map((mbid) =>
      getArtistImage(mbid, {
        artistName:
          typeof artistNames[mbid] === "string" ? artistNames[mbid] : null,
      }),
    ),
  );
  return { prefetched: mbids.length };
}

async function runLoop() {
  const queue = getImagePrefetchQueue();
  const workerId = getWorkerId();
  try {
    for await (const job of queue.claim(workerId, { idlePollS: 10 })) {
      if (!running) break;
      try {
        await processImagePrefetch(job.payload);
        job.ack();
      } catch (error) {
        const message = error?.message || String(error);
        if (job.attempts >= 4) {
          job.fail(message);
        } else {
          job.retry(60, message);
        }
      }
    }
  } catch (error) {
    console.error("[imagePrefetchWorker] loop error:", error);
  } finally {
    running = false;
    loopPromise = null;
  }
}

export function startImagePrefetchWorker() {
  if (running) return;
  running = true;
  loopPromise = runLoop();
}

export function stopImagePrefetchWorker() {
  running = false;
}

export function isImagePrefetchWorkerRunning() {
  return running;
}
