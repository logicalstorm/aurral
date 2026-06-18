import {
  getPlaylistMbidEnrichmentQueue,
  getWorkerId,
} from "./honkerDb.js";
import {
  enrichSharedPlaylistMbids,
  schedulePlaylistMbidEnrichmentForMissingPlaylists,
} from "./playlistMbidEnrichmentService.js";
import {
  isHonkerShuttingDown,
  markHonkerWorkerLoopEnded,
  registerHonkerWorker,
  withJobHeartbeat,
} from "./honkerWorkerRuntime.js";

const WORKER_NAME = "playlist-mbid-enrichment";

let running = false;
let stopRequested = false;
let loopPromise = null;

async function processPlaylistMbidEnrichment(payload = {}) {
  const kind = String(payload?.kind || payload?.type || "").trim();
  switch (kind) {
    case "playlist-mbid-enrichment": {
      return enrichSharedPlaylistMbids(payload.playlistId);
    }
    case "playlist-mbid-enrichment-sweep": {
      const jobIds = schedulePlaylistMbidEnrichmentForMissingPlaylists({
        reason: payload?.reason || "sweep",
      });
      return {
        success: true,
        enqueued: jobIds.length,
        jobIds,
      };
    }
    default:
      throw new Error(
        `Unknown playlist MBID enrichment task: ${kind || "unknown"}`,
      );
  }
}

async function runLoop() {
  const queue = getPlaylistMbidEnrichmentQueue();
  const workerId = getWorkerId();
  try {
    for await (const job of queue.claim(workerId, { idlePollS: 10 })) {
      if (!running || stopRequested) break;
      try {
        await withJobHeartbeat(job, queue, () =>
          processPlaylistMbidEnrichment(job.payload),
        );
        job.ack();
      } catch (error) {
        const message = error?.message || String(error);
        if (job.attempts >= 4) {
          job.fail(message);
        } else {
          job.retry(300, message);
        }
      }
    }
  } catch (error) {
    console.error("[playlistMbidEnrichmentWorker] loop error:", error);
  } finally {
    running = false;
    loopPromise = null;
    const intentional = stopRequested;
    stopRequested = false;
    markHonkerWorkerLoopEnded(WORKER_NAME, startPlaylistMbidEnrichmentWorker, {
      intentional,
    });
  }
}

export function startPlaylistMbidEnrichmentWorker() {
  if (running || isHonkerShuttingDown()) return;
  running = true;
  stopRequested = false;
  loopPromise = runLoop();
}

export function stopPlaylistMbidEnrichmentWorker() {
  stopRequested = true;
  running = false;
}

export function isPlaylistMbidEnrichmentWorkerRunning() {
  return running;
}

registerHonkerWorker(WORKER_NAME, {
  start: startPlaylistMbidEnrichmentWorker,
  stop: stopPlaylistMbidEnrichmentWorker,
  isRunning: isPlaylistMbidEnrichmentWorkerRunning,
});
