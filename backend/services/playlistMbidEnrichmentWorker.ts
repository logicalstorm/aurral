import { getPlaylistMbidEnrichmentQueue, getWorkerId } from './honkerDb.js';
import {
  enrichSharedPlaylistMbids,
  schedulePlaylistMbidEnrichmentForMissingPlaylists,
} from './playlistMbidEnrichmentService.js';
import {
  createIdleAbortController,
  getWorkerIdleStopMs,
  isHonkerShuttingDown,
  markHonkerWorkerLoopEnded,
  registerHonkerWorker,
  withJobHeartbeat,
} from './honkerWorkerRuntime.js';

const WORKER_NAME = 'playlist-mbid-enrichment';

let running = false;
let stopRequested = false;
let idleController: ReturnType<typeof createIdleAbortController> | null = null;

async function processPlaylistMbidEnrichment(payload: Record<string, unknown> = {}) {
  const kind = String(payload?.['kind'] || payload?.['type'] || '').trim();
  switch (kind) {
    case 'playlist-mbid-enrichment': {
      return enrichSharedPlaylistMbids(payload['playlistId'] as string);
    }
    case 'playlist-mbid-enrichment-sweep': {
      const jobIds = schedulePlaylistMbidEnrichmentForMissingPlaylists({
        reason: (payload?.['reason'] as string) || 'sweep',
      });
      return {
        success: true,
        enqueued: jobIds.length,
        jobIds,
      };
    }
    default:
      throw new Error(`Unknown playlist MBID enrichment task: ${kind || 'unknown'}`);
  }
}

async function runLoop() {
  const queue = getPlaylistMbidEnrichmentQueue();
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
        await withJobHeartbeat(job, queue, () => processPlaylistMbidEnrichment(job.payload as Record<string, unknown>));
        job.ack();
      } catch (error: unknown) {
        const message = (error as { message?: string })?.message || String(error);
        if (job.attempts >= 4) {
          job.fail(message);
        } else {
          job.retry(300, message);
        }
      }
      idleController.arm();
    }
  } catch (error) {
    if (!idleController?.idleStopped && !stopRequested) {
      console.error('[playlistMbidEnrichmentWorker] loop error:', error);
    }
  } finally {
    const idleStopped = idleController?.idleStopped === true;
    idleController?.dispose();
    idleController = null;
    running = false;
    const intentional = stopRequested || idleStopped;
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
  runLoop();
}

export function stopPlaylistMbidEnrichmentWorker() {
  stopRequested = true;
  running = false;
  idleController?.abort();
}

export function isPlaylistMbidEnrichmentWorkerRunning() {
  return running;
}

registerHonkerWorker(WORKER_NAME, {
  start: startPlaylistMbidEnrichmentWorker,
  stop: stopPlaylistMbidEnrichmentWorker,
  isRunning: isPlaylistMbidEnrichmentWorkerRunning,
});
