import { Loader2, Clock } from "lucide-react";

export function FlowStatusCards({
  status,
  enabledCount,
  flowCount,
  runningCount,
  completedCount,
}) {
  const queuePending = Number(status?.operationQueue?.pending || 0);
  const queueProcessing = status?.operationQueue?.processing === true;
  const idleCount = Math.max(flowCount - runningCount - completedCount, 0);
  const workerRunning = status?.worker?.running === true;
  const pending = Number(status?.stats?.pending || 0);
  const downloading = Number(status?.stats?.downloading || 0);
  const done = Number(status?.stats?.done || 0);
  const total = pending + downloading + done;
  const processed = done;
  const progressPct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const hintMessage = String(status?.hint?.message || "").trim();
  const baseSummaryMessage =
    runningCount > 0
      ? `Processing ${runningCount} ${runningCount === 1 ? "playlist" : "playlists"} (${pending} pending, ${done} completed)`
      : done > 0
        ? `No active processing (${done} completed)`
        : "No active processing";
  const hasCurrentJob =
    status?.worker?.currentJob?.artistName && status?.worker?.currentJob?.trackName;
  const hintLower = hintMessage.toLowerCase();
  const hintIsDownloadLike =
    hintLower.includes("download") || hintLower.includes("downloading");
  const shouldShowHint =
    hintMessage.length > 0 && !(hasCurrentJob && hintIsDownloadLike);
  const summaryMessage = hasCurrentJob
    ? "Downloading tracks"
    : shouldShowHint
      ? hintMessage
      : baseSummaryMessage;
  const hasPreparationSignal = queuePending > 0 || queueProcessing || (shouldShowHint && !workerRunning);
  const statusLabel = workerRunning
    ? "Running"
    : hasPreparationSignal
        ? "Preparing"
        : "Stopped";
  const statusBadgeClass =
    statusLabel === "Running"
      ? "badge-success"
      : statusLabel === "Preparing"
        ? "badge-secondary"
        : "badge-neutral";

  return (
    <div className="flow-page__worker-card">
      <div className="flow-page__worker-card-header">
        <h2 className="flow-page__worker-card-title">Worker Overview</h2>
        <span className={`badge ${statusBadgeClass}`}>
          {statusLabel}
        </span>
      </div>
      <div className="flow-page__worker-summary">
        {workerRunning ? (
          <Loader2 className="flow-page__worker-summary-icon animate-spin" />
        ) : (
          <Clock className="flow-page__worker-summary-icon flow-page__worker-summary-icon--idle" />
        )}
        <span>{summaryMessage}</span>
      </div>
      {total > 0 ? (
        <div className="flow-page__progress">
          <div className="flow-page__progress-bar">
            <div
              className="flow-page__progress-fill"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      ) : null}
      <div className="flow-page__worker-stats">
        <div className="flow-page__worker-stats-row">
          <div className="flow-page__worker-stats-group">
            <span className="flow-page__worker-stats-label">
              Flows
            </span>
            <span>On <span className="flow-page__worker-stats-value">{enabledCount}/{flowCount}</span></span>
            <span className="flow-page__card-meta-dot">•</span>
            <span>Running <span className="flow-page__worker-stats-value">{runningCount}</span></span>
            <span className="flow-page__card-meta-dot">•</span>
            <span>Completed <span className="flow-page__worker-stats-value">{completedCount}</span></span>
            <span className="flow-page__card-meta-dot">•</span>
            <span>Idle <span className="flow-page__worker-stats-value">{idleCount}</span></span>
          </div>
          <div className="flow-page__worker-stats-divider" />
          <div className="flow-page__worker-stats-group">
            <span className="flow-page__worker-stats-label">
              Tracks
            </span>
            <span>Pending <span className="flow-page__worker-stats-value">{pending}</span></span>
            <span className="flow-page__card-meta-dot">•</span>
            <span>Downloading <span className="flow-page__worker-stats-value">{downloading}</span></span>
            <span className="flow-page__card-meta-dot">•</span>
            <span>Done <span className="flow-page__worker-stats-value">{done}</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}
