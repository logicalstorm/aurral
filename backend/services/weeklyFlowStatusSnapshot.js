import { downloadTracker } from "./weeklyFlowDownloadTracker.js";
import { weeklyFlowWorker } from "./weeklyFlowWorker.js";
import { flowPlaylistConfig } from "./weeklyFlowPlaylistConfig.js";
import { weeklyFlowOperationQueue } from "./weeklyFlowOperationQueue.js";

export function getWeeklyFlowStatusSnapshot({
  includeJobs = false,
  flowId = null,
  jobsLimit = null,
} = {}) {
  const workerStatus = weeklyFlowWorker.getStatus();
  const stats = downloadTracker.getStats();
  const flows = flowPlaylistConfig.getFlows();
  const flowIds = flows.map((flow) => flow.id);
  const flowStats = downloadTracker.getStatsByPlaylistType(flowIds);
  let jobs;
  if (includeJobs) {
    const sourceJobs = flowId
      ? downloadTracker.getByPlaylistType(flowId)
      : downloadTracker.getAll();
    jobs = jobsLimit ? sourceJobs.slice(0, jobsLimit) : sourceJobs;
  }
  return {
    worker: workerStatus,
    stats,
    flowStats,
    jobs,
    flows,
    operationQueue: weeklyFlowOperationQueue.getStatus(),
  };
}
