import { getDiscoveryRecommendationEnrichmentQueue, getWorkerId } from './honkerDb.js';
import {
  markDiscoveryRecommendationEnrichmentFailed,
  runDiscoveryRecommendationEnrichment,
} from './discoveryService.js';
import {
  createIdleAbortController,
  getWorkerIdleStopMs,
  isHonkerShuttingDown,
  markHonkerWorkerLoopEnded,
  registerHonkerWorker,
  withJobHeartbeat,
} from './honkerWorkerRuntime.js';
import { HEAVY_WORK_TYPES, withHeavyWorkBudget } from './resourceBudget.js';
import { withWorkerPerfSpan } from './workerPerfMetrics.js';

const WORKER_NAME = 'discovery-recommendation-enrichment';

let running = false;
let stopRequested = false;
let idleController: ReturnType<typeof createIdleAbortController> | null = null;

async function runLoop() {
  const queue = getDiscoveryRecommendationEnrichmentQueue();
  const workerId = getWorkerId();
  idleController = createIdleAbortController({
    idleStopMs: getWorkerIdleStopMs(),
  });
  idleController.arm();
  try {
    for await (const job of queue.claim(workerId, {
      idlePollS: 1,
      signal: idleController.signal,
    })) {
      idleController.disarm();
      if (!running || stopRequested) break;
      try {
        const payload = job.payload as Record<string, unknown>;
        await withJobHeartbeat(job, queue, () =>
          withHeavyWorkBudget(
            HEAVY_WORK_TYPES.DISCOVERY_ENRICHMENT,
            () =>
              withWorkerPerfSpan(
                'discovery-enrichment',
                () => runDiscoveryRecommendationEnrichment(payload),
                (payload?.['discoveryRunId'] as string) || null,
              ),
            (payload?.['discoveryRunId'] as string) || 'discovery-enrichment',
          ),
        );
        job.ack();
      } catch (error: unknown) {
        const message = (error as { message?: string })?.message || String(error);
        if (job.attempts >= 4) {
          markDiscoveryRecommendationEnrichmentFailed(job.payload as Record<string, unknown>, error);
          job.fail(message);
        } else {
          job.retry(300, message);
        }
      }
      idleController.arm();
    }
  } catch (error) {
    if (!idleController?.idleStopped && !stopRequested) {
      console.error('[discoveryRecommendationEnrichmentWorker] loop error:', error);
    }
  } finally {
    const idleStopped = idleController?.idleStopped === true;
    idleController?.dispose();
    idleController = null;
    running = false;
    const intentional = stopRequested || idleStopped;
    stopRequested = false;
    markHonkerWorkerLoopEnded(WORKER_NAME, startDiscoveryRecommendationEnrichmentWorker, {
      intentional,
    });
  }
}

export function startDiscoveryRecommendationEnrichmentWorker() {
  if (running || isHonkerShuttingDown()) return;
  running = true;
  stopRequested = false;
  runLoop();
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
