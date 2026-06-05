export const EMPTY_FLOW_STATS = {
  total: 0,
  done: 0,
  pending: 0,
  downloading: 0,
  failed: 0,
};

export const getDownloadedTrackCount = (stats) => {
  const done = Number(stats?.done);
  return Number.isFinite(done) && done >= 0 ? done : 0;
};

export const buildFlowStatsFromJobs = (jobs) => {
  const stats = { ...EMPTY_FLOW_STATS };
  if (!Array.isArray(jobs)) return stats;
  for (const job of jobs) {
    if (!job?.status) continue;
    stats[job.status] = (stats[job.status] || 0) + 1;
  }
  stats.total = stats.pending + stats.downloading + stats.done;
  return stats;
};

export const sanitizeFlowStats = (stats) => {
  const pending = Number(stats?.pending || 0);
  const downloading = Number(stats?.downloading || 0);
  const done = Number(stats?.done || 0);
  const failed = Number(stats?.failed || 0);
  return {
    total: pending + downloading + done,
    pending,
    downloading,
    done,
    failed,
  };
};

export const getPlaylistStateFromStats = (stats) => {
  if (stats.total === 0) return "idle";
  if (stats.downloading > 0 || stats.pending > 0) return "running";
  if (stats.done > 0) return "completed";
  return "idle";
};

export const getCombinedActivityStats = (status) => {
  const flow = status?.stats || EMPTY_FLOW_STATS;
  const shared = status?.sharedStats || EMPTY_FLOW_STATS;
  const pending = Number(flow.pending || 0) + Number(shared.pending || 0);
  const downloading =
    Number(flow.downloading || 0) + Number(shared.downloading || 0);
  const done = Number(flow.done || 0) + Number(shared.done || 0);
  const failed = Number(flow.failed || 0) + Number(shared.failed || 0);
  return {
    pending,
    downloading,
    done,
    failed,
    total: pending + downloading + done,
  };
};

export const hasFlowWorkerActivity = (status) => {
  if (!status) return false;
  if (status.worker?.running === true) return true;
  if (status.operationQueue?.processing === true) return true;
  const stats = getCombinedActivityStats(status);
  return stats.pending > 0 || stats.downloading > 0;
};
