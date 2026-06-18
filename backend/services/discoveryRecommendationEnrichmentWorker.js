import {
  getDiscoveryRecommendationEnrichmentQueue,
  getWorkerId,
} from "./honkerDb.js";
import {
  markDiscoveryRecommendationEnrichmentFailed,
  runDiscoveryRecommendationEnrichment,
} from "./discoveryService.js";
import {
  isHonkerShuttingDown,
  markHonkerWorkerLoopEnded,
  registerHonkerWorker,
  withJobHeartbeat,
} from "./honkerWorkerRuntime.js";

const WORKER_NAME = "discovery-recommendation-enrichment";

let running = false;
let stopRequested = false;
let loopPromise = null;

async function runLoop() {
  const queue = getDiscoveryRecommendationEnrichmentQueue();
  const workerId = getWorkerId();
  try {
    for await (const job of queue.claim(workerId, { idlePollS: 10 })) {
      if (!running || stopRequested) break;
      try {
        await withJobHeartbeat(job, queue, () =>
          runDiscoveryRecommendationEnrichment(job.payload),
        );
        job.ack();
      } catch (error) {
        const message = error?.message || String(error);
        if (job.attempts >= 4) {
          markDiscoveryRecommendationEnrichmentFailed(job.payload, error);
          job.fail(message);
        } else {
          job.retry(300, message);
        }
      }
    }
  } catch (error) {
    console.error("[discoveryRecommendationEnrichmentWorker] loop error:", error);
  } finally {
    running = false;
    loopPromise = null;
    const intentional = stopRequested;
    stopRequested = false;
    markHonkerWorkerLoopEnded(
      WORKER_NAME,
      startDiscoveryRecommendationEnrichmentWorker,
      { intentional },
    );
  }
}

export function startDiscoveryRecommendationEnrichmentWorker() {
  if (running || isHonkerShuttingDown()) return;
  running = true;
  stopRequested = false;
  loopPromise = runLoop();
}

export function stopDiscoveryRecommendationEnrichmentWorker() {
  stopRequested = true;
  running = false;
}

export function isDiscoveryRecommendationEnrichmentWorkerRunning() {
  return running;
}

registerHonkerWorker(WORKER_NAME, {
  start: startDiscoveryRecommendationEnrichmentWorker,
  stop: stopDiscoveryRecommendationEnrichmentWorker,
  isRunning: isDiscoveryRecommendationEnrichmentWorkerRunning,
});
