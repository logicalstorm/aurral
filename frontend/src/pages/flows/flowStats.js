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
