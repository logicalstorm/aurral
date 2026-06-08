import { getPipelineQueue, getWorkerId } from "./honkerDb.js";
import {
  continuePipeline,
  processPipelinePayload,
  enqueuePendingJobsWithoutBatch,
  failPipelineJob,
} from "./slskdOrchestrator.js";
import { slskdClient } from "./slskdClient.js";

let running = false;
let loopPromise = null;

async function runLoop() {
  if (!slskdClient.isConfigured()) {
    running = false;
    return;
  }
  const queue = getPipelineQueue();
  const workerId = getWorkerId();
  try {
    for await (const job of queue.claim(workerId, { idlePollS: 2 })) {
      if (!running) break;
      try {
        const nextPayload = await processPipelinePayload(job.payload);
        job.ack();
        await continuePipeline(nextPayload);
      } catch (error) {
        const message = error?.message || String(error);
        if (job.attempts >= 4) {
          job.fail(message);
          await failPipelineJob(job.payload, message);
        } else {
          job.retry(30, message);
        }
      }
    }
  } catch (error) {
    console.error("[slskdOrchestratorWorker] loop error:", error);
  } finally {
    running = false;
    loopPromise = null;
  }
}

export function startSlskdOrchestratorWorker() {
  if (running) return;
  if (!slskdClient.isConfigured()) return;
  running = true;
  enqueuePendingJobsWithoutBatch();
  loopPromise = runLoop();
}

export function stopSlskdOrchestratorWorker() {
  running = false;
}

export function isSlskdOrchestratorRunning() {
  return running;
}
