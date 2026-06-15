import { getPipelineQueue, getWorkerId } from "./honkerDb.js";
import {
  continuePipeline,
  processPipelinePayload,
  enqueuePendingJobsWithoutBatch,
  failPipelineJob,
} from "./slskdOrchestrator.js";
import { slskdClient } from "./slskdClient.js";
import {
  isHonkerShuttingDown,
  markHonkerWorkerLoopEnded,
  registerHonkerWorker,
  withJobHeartbeat,
} from "./honkerWorkerRuntime.js";

const WORKER_NAME = "slskd-pipeline";
const DEFAULT_WORKER_COUNT = 3;
const MAX_WORKER_COUNT = 4;
const PHASE_DEFER_SECONDS = 15;
const DEFAULT_PHASE_LIMITS = {
  search: 2,
  download: 2,
  poll: 4,
  finalize: 1,
};

let running = false;
let stopRequested = false;
const workerLoops = new Map();
const activePhaseCounts = new Map();

function normalizePositiveInteger(
  value,
  fallback,
  max = Number.POSITIVE_INFINITY,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

function getTargetWorkerCount() {
  return normalizePositiveInteger(
    process.env.AURRAL_SLSKD_PIPELINE_WORKERS,
    DEFAULT_WORKER_COUNT,
    MAX_WORKER_COUNT,
  );
}

function getPhaseLimit(phase) {
  const key = String(phase || "").toLowerCase();
  const envKey = `AURRAL_SLSKD_${key.toUpperCase()}_WORKERS`;
  return normalizePositiveInteger(
    process.env[envKey],
    DEFAULT_PHASE_LIMITS[key] || getTargetWorkerCount(),
    MAX_WORKER_COUNT,
  );
}

function getActivePhaseCount(phase) {
  return Number(activePhaseCounts.get(String(phase || "").toLowerCase()) || 0);
}

function incrementActivePhase(phase) {
  const key = String(phase || "").toLowerCase();
  activePhaseCounts.set(key, getActivePhaseCount(key) + 1);
}

function decrementActivePhase(phase) {
  const key = String(phase || "").toLowerCase();
  const next = Math.max(0, getActivePhaseCount(key) - 1);
  if (next === 0) {
    activePhaseCounts.delete(key);
  } else {
    activePhaseCounts.set(key, next);
  }
}

function shouldDeferPhase(phase) {
  const key = String(phase || "").toLowerCase();
  return getActivePhaseCount(key) >= getPhaseLimit(key);
}

async function runLoop(slot) {
  if (!slskdClient.isConfigured()) {
    running = false;
    return;
  }
  const queue = getPipelineQueue();
  const workerId = `${getWorkerId()}-${WORKER_NAME}-${slot}`;
  try {
    for await (const job of queue.claim(workerId, { idlePollS: 2 })) {
      if (!running || stopRequested) break;
      const phase = String(job.payload?.phase || "").toLowerCase();
      if (phase && shouldDeferPhase(phase)) {
        await continuePipeline({
          ...job.payload,
          delaySeconds: PHASE_DEFER_SECONDS,
        });
        job.ack();
        continue;
      }
      try {
        incrementActivePhase(phase);
        const nextPayload = await withJobHeartbeat(job, queue, () =>
          processPipelinePayload(job.payload),
        );
        await continuePipeline(nextPayload);
        job.ack();
      } catch (error) {
        const message = error?.message || String(error);
        if (job.attempts >= 4) {
          job.fail(message);
          await failPipelineJob(job.payload, message);
        } else {
          job.retry(30, message);
        }
      } finally {
        decrementActivePhase(phase);
      }
    }
  } catch (error) {
    console.error(`[slskdOrchestratorWorker] loop ${slot} error:`, error);
  } finally {
    workerLoops.delete(slot);
    const intentional = stopRequested;
    if (!intentional && running && slskdClient.isConfigured()) {
      setTimeout(() => startSlskdOrchestratorWorker(), 0);
    }
    if (workerLoops.size === 0) {
      running = false;
      stopRequested = false;
      activePhaseCounts.clear();
      markHonkerWorkerLoopEnded(WORKER_NAME, startSlskdOrchestratorWorker, {
        intentional,
        shouldRestart: () => slskdClient.isConfigured(),
      });
    }
  }
}

export function startSlskdOrchestratorWorker() {
  if (isHonkerShuttingDown()) return;
  if (!slskdClient.isConfigured()) return;
  running = true;
  stopRequested = false;
  enqueuePendingJobsWithoutBatch();
  const target = getTargetWorkerCount();
  for (let slot = 1; slot <= target; slot += 1) {
    if (workerLoops.has(slot)) continue;
    workerLoops.set(slot, runLoop(slot));
  }
}

export function stopSlskdOrchestratorWorker() {
  stopRequested = true;
  running = false;
}

export function isSlskdOrchestratorRunning() {
  return running || workerLoops.size > 0;
}

registerHonkerWorker(WORKER_NAME, {
  start: startSlskdOrchestratorWorker,
  stop: stopSlskdOrchestratorWorker,
  isRunning: isSlskdOrchestratorRunning,
});
