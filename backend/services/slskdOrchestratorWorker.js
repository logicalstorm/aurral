import createHonkerWorker from "./honkerWorkerFactory.js";
import { getPipelineQueue, resetProcessingPipelineJobs } from "./honkerDb.js";
import {
  continuePipeline,
  processPipelinePayload,
  enqueuePendingJobsWithoutBatch,
  failPipelineJob,
} from "./slskdOrchestrator.js";
import { isAnyDownloadSourceConfigured } from "./downloadSourceService.js";

const {
  start: startSlskdOrchestratorWorker,
  stop: stopSlskdOrchestratorWorker,
  isRunning: isSlskdOrchestratorRunning,
} = createHonkerWorker({
  name: "slskd-pipeline",
  getQueue: getPipelineQueue,
  idlePollS: 2,
  retryDelayS: 30,
  maxAttempts: 4,
  shouldRestart: () => isAnyDownloadSourceConfigured(),
  onStart() {
    if (!isAnyDownloadSourceConfigured()) return false;
    console.log("[pipeline] worker starting");
    resetProcessingPipelineJobs();
    enqueuePendingJobsWithoutBatch();
    return true;
  },
  processJob: async (payload) => {
    const nextPayload = await processPipelinePayload(payload);
    await continuePipeline(nextPayload);
  },
  onFinalFailure(job, error) {
    const message = error?.message || String(error);
    console.error("[slskdOrchestratorWorker] pipeline job failed:", {
      jobId: job.payload?.jobId || null,
      phase: job.payload?.phase || null,
      candidateIndex: job.payload?.candidateIndex ?? null,
      message,
      stack: error?.stack || null,
    });
    return failPipelineJob(job.payload, message);
  },
});

export {
  startSlskdOrchestratorWorker,
  stopSlskdOrchestratorWorker,
  isSlskdOrchestratorRunning,
};
