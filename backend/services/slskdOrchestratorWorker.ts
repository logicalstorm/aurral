import { getPipelineQueue, getWorkerId } from './honkerDb.js';
import {
  continuePipeline,
  processPipelinePayload,
  enqueuePendingJobsWithoutBatch,
  failPipelineJob,
} from './slskdOrchestrator.js';
import { isAnyDownloadSourceConfigured } from './downloadSourceService.js';
import {
  createIdleAbortController,
  getWorkerIdleStopMs,
  isHonkerShuttingDown,
  markHonkerWorkerLoopEnded,
  registerHonkerWorker,
  withJobHeartbeat,
} from './honkerWorkerRuntime.js';

const WORKER_NAME = 'slskd-pipeline';

let running = false;
let stopRequested = false;
let loopPromise: Promise<void> | null = null;
let idleController: ReturnType<typeof createIdleAbortController> | null = null;

async function runLoop() {
  if (!isAnyDownloadSourceConfigured()) {
    running = false;
    return;
  }
  const queue = getPipelineQueue();
  const workerId = getWorkerId();
  idleController = createIdleAbortController({
    idleStopMs: getWorkerIdleStopMs(),
  });
  idleController.arm();
  try {
    for await (const job of queue.claim(workerId, {
      idlePollS: 2,
      signal: idleController.signal,
    })) {
      idleController.disarm();
      if (!running || stopRequested) break;
      try {
        const nextPayload = await withJobHeartbeat(job, queue, () =>
          processPipelinePayload(job.payload as Record<string, unknown>),
        );
        await continuePipeline(nextPayload);
        job.ack();
      } catch (error: unknown) {
        const message = (error as Error)?.message || String(error);
        if (job.attempts >= 4) {
          const payload = job.payload as Record<string, unknown>;
          console.error('[slskdOrchestratorWorker] pipeline job failed:', {
            jobId: payload?.jobId || null,
            phase: payload?.phase || null,
            candidateIndex: payload?.candidateIndex ?? null,
            message,
            stack: (error as Error)?.stack || null,
          });
          job.fail(message);
          await failPipelineJob(job.payload as Record<string, unknown>, message);
        } else {
          job.retry(30, message);
        }
      }
      idleController.arm();
    }
  } catch (error) {
    if (!idleController?.idleStopped && !stopRequested) {
      console.error('[slskdOrchestratorWorker] loop error:', error);
    }
  } finally {
    const idleStopped = idleController?.idleStopped === true;
    idleController?.dispose();
    idleController = null;
    running = false;
    loopPromise = null;
    const intentional = stopRequested || idleStopped;
    stopRequested = false;
    markHonkerWorkerLoopEnded(WORKER_NAME, startSlskdOrchestratorWorker, {
      intentional,
      shouldRestart: () => isAnyDownloadSourceConfigured(),
    });
  }
}

export function startSlskdOrchestratorWorker() {
  if (running) {
    const loopEnded = !loopPromise;
    if (!loopEnded) return;
    running = false;
  }
  if (isHonkerShuttingDown()) return;
  if (!isAnyDownloadSourceConfigured()) return;
  running = true;
  stopRequested = false;
  enqueuePendingJobsWithoutBatch();
  loopPromise = runLoop();
}

export function stopSlskdOrchestratorWorker() {
  stopRequested = true;
  running = false;
  idleController?.abort();
}

export function isSlskdOrchestratorRunning() {
  return running;
}

registerHonkerWorker(WORKER_NAME, {
  start: startSlskdOrchestratorWorker,
  stop: stopSlskdOrchestratorWorker,
  isRunning: isSlskdOrchestratorRunning,
});
