import {
  getDiscoveryRecommendationEnrichmentQueue,
  getWorkerId,
} from "./honkerDb.js";
import {
  markDiscoveryRecommendationEnrichmentFailed,
  runDiscoveryRecommendationEnrichment,
} from "./discoveryService.js";
import {
  createIdleAbortController,
  getWorkerIdleStopMs,
  isHonkerShuttingDown,
  markHonkerWorkerLoopEnded,
  registerHonkerWorker,
  withJobHeartbeat,
} from "./honkerWorkerRuntime.js";
import {
  HEAVY_WORK_TYPES,
  withHeavyWorkBudget,
} from "./resourceBudget.js";
import { withWorkerPerfSpan } from "./workerPerfMetrics.js";

const WORKER_NAME = "discovery-recommendation-enrichment";

let running = false;
let stopRequested = false;
let loopPromise = null;
let idleController = null;

async function runLoop() {
  const queue = getDiscoveryRecommendationEnrichmentQueue();
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
          withHeavyWorkBudget(
            HEAVY_WORK_TYPES.DISCOVERY_ENRICHMENT,
            () =>
              withWorkerPerfSpan(
                "discovery-enrichment",
                () => runDiscoveryRecommendationEnrichment(job.payload),
                job.payload?.discoveryRunId || null,
              ),
            job.payload?.discoveryRunId || "discovery-enrichment",
          ),
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
      idleController.arm();
    }
  } catch (error) {
    if (!idleController?.idleStopped && !stopRequested) {
      console.error("[discoveryRecommendationEnrichmentWorker] loop error:", error);
    }
  } finally {
    const idleStopped = idleController?.idleStopped === true;
    idleController?.dispose();
    idleController = null;
    running = false;
    loopPromise = null;
    const intentional = stopRequested || idleStopped;
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
  idleController?.abort();
}

export function isDiscoveryRecommendationEnrichmentWorkerRunning() {
  return running;
}

registerHonkerWorker(WORKER_NAME, {
  start: startDiscoveryRecommendationEnrichmentWorker,
  stop: stopDiscoveryRecommendationEnrichmentWorker,
  isRunning: isDiscoveryRecommendationEnrichmentWorkerRunning,
});
