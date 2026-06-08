const GENERATION_ACTIONS = new Set(["enable", "scheduled", "manual-start"]);
const CLEANUP_ACTIONS = new Set(["disable", "delete", "reset"]);

export function parseOperationQueueLabel(label) {
  const trimmed = String(label || "").trim();
  if (!trimmed.includes(":")) {
    return { action: trimmed, flowId: "" };
  }
  const index = trimmed.indexOf(":");
  return {
    action: trimmed.slice(0, index),
    flowId: trimmed.slice(index + 1),
  };
}

export function getFlowRunActivity({
  flowId,
  enabled = true,
  status = null,
  stats = null,
  rerunning = false,
} = {}) {
  if (!flowId || !enabled) return null;

  const operationQueue = status?.operationQueue;
  const queueProcessing = operationQueue?.processing === true;
  const { action: queueAction, flowId: queueFlowId } = parseOperationQueueLabel(
    operationQueue?.currentLabel,
  );
  const queueTargetsThisFlow = queueFlowId === flowId;
  const hintPhase = String(status?.hint?.phase || "").trim();
  const hintMessage = String(status?.hint?.message || "").trim();
  const currentJob = status?.worker?.currentJob;
  const isCurrentJobForFlow =
    currentJob?.playlistType === flowId &&
    currentJob?.artistName &&
    currentJob?.trackName;
  const pendingCount = Number(stats?.pending || 0);
  const downloadingCount = Number(stats?.downloading || 0);
  const doneCount = Number(stats?.done || 0);
  const isGeneratingThisFlow =
    queueProcessing &&
    GENERATION_ACTIONS.has(queueAction) &&
    queueTargetsThisFlow;
  const isQueueCleanupThisFlow =
    queueProcessing &&
    CLEANUP_ACTIONS.has(queueAction) &&
    queueTargetsThisFlow;

  if (rerunning || isGeneratingThisFlow) {
    return { message: "Generating playlist…", phase: "generating" };
  }

  if (isCurrentJobForFlow) {
    const progressPct = Math.max(
      0,
      Math.min(100, Math.round(Number(currentJob?.progressPct || 0))),
    );
    return {
      message: `Downloading: ${currentJob.trackName} (${progressPct}%)`,
      phase: "downloading",
    };
  }

  if (isQueueCleanupThisFlow) {
    return { message: "Cleaning flow files…", phase: "cleaning" };
  }

  if (pendingCount > 0 || downloadingCount > 0) {
    const total = pendingCount + downloadingCount + doneCount;
    if (downloadingCount > 0) {
      return {
        message: `Downloading tracks (${doneCount} of ${total})`,
        phase: "downloading",
      };
    }
    return {
      message: "Tracks queued and waiting…",
      phase: "queued",
    };
  }

  if (
    queueProcessing &&
    queueTargetsThisFlow &&
    hintMessage &&
    hintPhase !== "completed"
  ) {
    return {
      message: hintMessage.endsWith("…") ? hintMessage : `${hintMessage}…`,
      phase: hintPhase || "preparing",
    };
  }

  return null;
}
