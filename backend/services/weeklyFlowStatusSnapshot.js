import { downloadTracker } from "./weeklyFlowDownloadTracker.js";
import { weeklyFlowWorker } from "./weeklyFlowWorker.js";
import { flowPlaylistConfig } from "./weeklyFlowPlaylistConfig.js";
import { weeklyFlowOperationQueue } from "./weeklyFlowOperationQueue.js";
import { soulseekClient } from "./simpleSoulseekClient.js";

function formatNextRunMessage(flows) {
  const nextRunAt = (Array.isArray(flows) ? flows : [])
    .filter((flow) => flow?.enabled === true)
    .map((flow) => Number(flow?.nextRunAt))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)[0];
  if (!nextRunAt) return null;
  const diff = nextRunAt - Date.now();
  if (diff <= 0) return "Refreshing soon";
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
  return days === 1 ? "Next run tomorrow" : `Next run in ${days} days`;
}

export function getWeeklyFlowStatusSnapshot({
  includeJobs = false,
  flowId = null,
  jobsLimit = null,
} = {}) {
  const workerStatus = weeklyFlowWorker.getStatus();
  const stats = workerStatus.stats || downloadTracker.getStats();
  const flows = flowPlaylistConfig.getFlows();
  const nextRunMessage = formatNextRunMessage(flows);
  const operationQueue = weeklyFlowOperationQueue.getStatus();
  const queueLabel = String(operationQueue?.currentLabel || "");
  let phase = "idle";
  let message = "Idle";
  if (operationQueue?.processing) {
    phase = "preparing";
    if (
      queueLabel.startsWith("enable:") ||
      queueLabel.startsWith("scheduled:")
    ) {
      message = "Generating track list";
    } else if (
      queueLabel.startsWith("disable:") ||
      queueLabel.startsWith("delete:")
    ) {
      message = "Cleaning existing flow files";
    } else if (queueLabel.startsWith("reset:")) {
      message = "Resetting flow files";
    } else {
      message = "Starting worker...";
    }
  } else if (workerStatus?.processing) {
    phase = "downloading";
    message = "Downloading track";
  } else if (Number(stats?.pending || 0) > 0) {
    phase = "queued";
    message = "Tracks queued and waiting";
  } else if (
    Number(stats?.total || 0) > 0 &&
    Number(stats?.pending || 0) === 0 &&
    Number(stats?.downloading || 0) === 0
  ) {
    phase = "completed";
  }
  if (phase === "completed" && nextRunMessage) {
    message = nextRunMessage;
  }
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
    soulseek: soulseekClient.getStatus(),
    stats,
    flowStats,
    jobs,
    flows,
    operationQueue,
    hint: {
      phase,
      message,
    },
  };
}
