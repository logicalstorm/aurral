import { useState, useEffect } from "react";
import {
  AudioWaveform,
  Sparkles,
  Music2,
  TrendingUp,
  Loader2,
  CheckCircle2,
  Clock,
  Trash2,
} from "lucide-react";
import {
  getFlowStatus,
  createFlow,
  updateFlow,
  deleteFlow,
  setFlowEnabled,
} from "../utils/api";
import { useToast } from "../contexts/ToastContext";
import PowerSwitch from "../components/PowerSwitch";

const DEFAULT_MIX = { discover: 34, mix: 33, trending: 33 };
const DEFAULT_SIZE = 30;
const MIN_SIZE = 10;
const MAX_SIZE = 50;

function formatNextRun(nextRunAt) {
  if (!nextRunAt) return null;
  const ts =
    typeof nextRunAt === "number" ? nextRunAt : parseInt(nextRunAt, 10);
  if (!Number.isFinite(ts)) return null;
  const now = Date.now();
  const diff = ts - now;
  if (diff <= 0) return "Refreshing soon";
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
  return days === 1 ? "Resets tomorrow" : `Resets in ${days} days`;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const updateMixValue = (mix, key, value) => ({
  ...mix,
  [key]: clamp(Math.round(Number(value) || 0), 0, 100),
});

const getMixTotal = (mix) =>
  (mix?.discover ?? 0) + (mix?.mix ?? 0) + (mix?.trending ?? 0);

function FlowPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(null);
  const [optimisticEnabled, setOptimisticEnabled] = useState({});
  const [confirmTurnOff, setConfirmTurnOff] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newFlowName, setNewFlowName] = useState("");
  const [newFlowSize, setNewFlowSize] = useState(DEFAULT_SIZE);
  const [newFlowMix, setNewFlowMix] = useState(DEFAULT_MIX);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editSize, setEditSize] = useState(DEFAULT_SIZE);
  const [editMix, setEditMix] = useState(DEFAULT_MIX);
  const [deletingId, setDeletingId] = useState(null);
  const [showNewFlow, setShowNewFlow] = useState(false);
  const { showSuccess, showError } = useToast();

  const fetchStatus = async () => {
    try {
      const data = await getFlowStatus();
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    if (!status?.worker?.running) return;
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [status?.worker?.running]);

  const getPlaylistStats = (flowId) => {
    if (!status?.jobs)
      return { total: 0, done: 0, failed: 0, pending: 0, downloading: 0 };
    const jobs = status.jobs.filter((j) => j.playlistType === flowId);
    return {
      total: jobs.length,
      done: jobs.filter((j) => j.status === "done").length,
      failed: jobs.filter((j) => j.status === "failed").length,
      pending: jobs.filter((j) => j.status === "pending").length,
      downloading: jobs.filter((j) => j.status === "downloading").length,
    };
  };

  const getPlaylistState = (flowId) => {
    const stats = getPlaylistStats(flowId);
    if (stats.total === 0) return "idle";
    if (stats.downloading > 0 || stats.pending > 0) return "running";
    if (stats.done > 0 || stats.failed > 0) return "completed";
    return "idle";
  };

  const isEnabled = (flowId) =>
    status?.flows?.find((flow) => flow.id === flowId)?.enabled === true;

  const handleToggle = async (flowId, enabled) => {
    setOptimisticEnabled((prev) => ({ ...prev, [flowId]: enabled }));
    setToggling(flowId);
    try {
      await setFlowEnabled(flowId, enabled);
      showSuccess(
        enabled ? "Flow on" : "Flow off"
      );
      await fetchStatus();
    } catch (err) {
      setOptimisticEnabled((prev) => {
        const next = { ...prev };
        delete next[flowId];
        return next;
      });
      showError(
        err.response?.data?.message || err.message || "Failed to update"
      );
    } finally {
      setToggling(null);
    }
  };

  const handleSwitchChange = (flow, checked) => {
    if (checked) {
      handleToggle(flow.id, true);
    } else {
      setConfirmTurnOff({
        flowId: flow.id,
        title: flow.name,
      });
    }
  };

  const handleConfirmTurnOff = async () => {
    if (!confirmTurnOff) return;
    await handleToggle(confirmTurnOff.flowId, false);
    setConfirmTurnOff(null);
  };
  const handleCreateFlow = async () => {
    const name = newFlowName.trim();
    if (!name) {
      showError("Flow name required");
      return;
    }
    setCreating(true);
    try {
      await createFlow({
        name,
        size: newFlowSize,
        mix: newFlowMix,
      });
      setNewFlowName("");
      setNewFlowSize(DEFAULT_SIZE);
      setNewFlowMix(DEFAULT_MIX);
      setShowNewFlow(false);
      showSuccess("Flow created");
      await fetchStatus();
    } catch (err) {
      showError(
        err.response?.data?.message || err.message || "Failed to create flow"
      );
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (flow) => {
    setEditingId(flow.id);
    setEditName(flow.name || "");
    setEditSize(flow.size || DEFAULT_SIZE);
    setEditMix(flow.mix || DEFAULT_MIX);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditSize(DEFAULT_SIZE);
    setEditMix(DEFAULT_MIX);
  };

  const saveEdit = async (flowId) => {
    const name = editName.trim();
    if (!name) {
      showError("Flow name required");
      return;
    }
    try {
      await updateFlow(flowId, {
        name,
        size: editSize,
        mix: editMix,
      });
      showSuccess("Flow updated");
      setEditingId(null);
      await fetchStatus();
    } catch (err) {
      showError(
        err.response?.data?.message || err.message || "Failed to update flow"
      );
    }
  };

  const handleDelete = async (flow) => {
    setConfirmDelete({
      flowId: flow.id,
      title: flow.name,
    });
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    setDeletingId(confirmDelete.flowId);
    try {
      await deleteFlow(confirmDelete.flowId);
      showSuccess("Flow deleted");
      await fetchStatus();
    } catch (err) {
      showError(
        err.response?.data?.message || err.message || "Failed to delete flow"
      );
    } finally {
      setDeletingId(null);
    }
    setConfirmDelete(null);
  };

  const flowList = status?.flows || [];
  const enabledCount = flowList.filter(
    (flow) => (optimisticEnabled[flow.id] ?? flow.enabled) === true
  ).length;
  const runningCount = flowList.filter(
    (flow) => getPlaylistState(flow.id) === "running"
  ).length;
  const completedCount = flowList.filter(
    (flow) => getPlaylistState(flow.id) === "completed"
  ).length;
  const newTotal = getMixTotal(newFlowMix);
  const editTotal = getMixTotal(editMix);
  const newRemaining = 100 - newTotal;
  const editRemaining = 100 - editTotal;
  const newScale = newTotal > 100 ? 100 / newTotal : 1;
  const editScale = editTotal > 100 ? 100 / editTotal : 1;


  if (loading && !status) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-[#707e61]" />
      </div>
    );
  }

  return (
    <div className="flow-page max-w-6xl mx-auto px-4 pb-10">
      <div className="flex flex-col gap-4 mb-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-white/5 border border-white/5">
            <AudioWaveform className="w-5 h-5 text-[#9aa886]" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-white">Flow</h1>
            <p className="text-sm text-[#c1c1c3]">
              Create configurable weekly flows and blend Discover, Mix, and
              Trending into playlists.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowNewFlow(true)}
            className="btn btn-primary btn-sm"
          >
            + New Flow
          </button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr] mb-6">
        <div className="p-4 bg-card rounded-lg border border-white/5">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-[0.3em] text-[#8b8b90]">
              Worker
            </span>
            <span
              className={`badge ${
                status?.worker?.running ? "badge-success" : "badge-neutral"
              }`}
            >
              {status?.worker?.running ? "Running" : "Stopped"}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            {status?.worker?.running ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#9aa886]" />
            ) : (
              <Clock className="w-4 h-4 text-[#c1c1c3]" />
            )}
            <div className="text-sm text-white">
              {status?.worker?.running
                ? `Worker ${
                    status?.worker?.processing ? "processing…" : "running"
                  }`
                : "Worker stopped"}
            </div>
          </div>
          {status?.stats && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-[#c1c1c3]">
              <div className="rounded bg-white/5 px-2 py-1 flex items-center justify-between">
                <span>Done</span>
                <span className="text-white">{status.stats.done}</span>
              </div>
              <div className="rounded bg-white/5 px-2 py-1 flex items-center justify-between">
                <span>Failed</span>
                <span className="text-white">{status.stats.failed}</span>
              </div>
              <div className="rounded bg-white/5 px-2 py-1 flex items-center justify-between">
                <span>Pending</span>
                <span className="text-white">{status.stats.pending}</span>
              </div>
              <div className="rounded bg-white/5 px-2 py-1 flex items-center justify-between">
                <span>Downloading</span>
                <span className="text-white">{status.stats.downloading}</span>
              </div>
            </div>
          )}
        </div>
        <div className="p-4 bg-card rounded-lg border border-white/5">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-[0.3em] text-[#8b8b90]">
              Flows
            </span>
            <span className="text-xs text-[#c1c1c3]">
              {enabledCount}/{flowList.length} on
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[#c1c1c3]">
            <div className="rounded bg-white/5 px-2 py-1 flex items-center justify-between">
              <span>Total</span>
              <span className="text-white">{flowList.length}</span>
            </div>
            <div className="rounded bg-white/5 px-2 py-1 flex items-center justify-between">
              <span>Running</span>
              <span className="text-white">{runningCount}</span>
            </div>
            <div className="rounded bg-white/5 px-2 py-1 flex items-center justify-between">
              <span>Completed</span>
              <span className="text-white">{completedCount}</span>
            </div>
            <div className="rounded bg-white/5 px-2 py-1 flex items-center justify-between">
              <span>Idle</span>
              <span className="text-white">
                {Math.max(flowList.length - runningCount - completedCount, 0)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase tracking-[0.35em] text-[#8b8b90]">
          Playlists
        </h2>
        <span className="text-xs text-[#c1c1c3]">
          {flowList.length} flows
        </span>
      </div>

      <div className="space-y-3">
        {flowList.length === 0 && (
          <div className="p-4 bg-card rounded-lg border border-white/5 text-sm text-[#c1c1c3]">
            No flows yet. Create one to start building weekly playlists.
          </div>
        )}
        {flowList.map((flow) => {
          const stats = getPlaylistStats(flow.id);
          const state = getPlaylistState(flow.id);
          const enabled = optimisticEnabled[flow.id] ?? isEnabled(flow.id);
          const nextRun = formatNextRun(flow.nextRunAt);
          const isToggling = toggling === flow.id;
          const isEditing = editingId === flow.id;
          const hasChanges =
            String(editName || "").trim() !== String(flow.name || "").trim() ||
            Number(editSize) !== Number(flow.size || DEFAULT_SIZE) ||
            (editMix?.discover ?? DEFAULT_MIX.discover) !==
              (flow.mix?.discover ?? DEFAULT_MIX.discover) ||
            (editMix?.mix ?? DEFAULT_MIX.mix) !==
              (flow.mix?.mix ?? DEFAULT_MIX.mix) ||
            (editMix?.trending ?? DEFAULT_MIX.trending) !==
              (flow.mix?.trending ?? DEFAULT_MIX.trending);
          const stateLabel =
            state === "running"
              ? "Running"
              : state === "completed"
                ? "Completed"
                : "Idle";
          const stateBadge =
            state === "running"
              ? "badge-success"
              : state === "completed"
                ? "badge-primary"
                : "badge-neutral";

          return (
            <div
              key={flow.id}
              className="bg-card rounded-lg border border-white/5 overflow-hidden"
            >
              <div
                className={`px-4 ${isEditing ? "py-3" : "py-2"} flex flex-col ${
                  isEditing ? "gap-3" : "gap-2"
                } md:flex-row md:items-center md:justify-between`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-white truncate">
                      {flow.name}
                    </h3>
                    <span className={`badge ${stateBadge}`}>{stateLabel}</span>
                    <span
                      className={`badge ${
                        enabled ? "badge-success" : "badge-neutral"
                      }`}
                    >
                      {enabled ? "On" : "Off"}
                    </span>
                    {isToggling && (
                      <Loader2 className="w-4 h-4 animate-spin text-[#707e61]" />
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#c1c1c3]">
                    <span>{flow.size} tracks</span>
                    <span>·</span>
                    <span>{flow.mix?.discover ?? 0}% Discover</span>
                    <span>·</span>
                    <span>{flow.mix?.mix ?? 0}% Mix</span>
                    <span>·</span>
                    <span>{flow.mix?.trending ?? 0}% Trending</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#c1c1c3]">
                    {state === "running" && (
                      <span className="inline-flex items-center gap-1.5 text-[#9aa886]">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {stats.done + stats.failed}/{stats.total}
                      </span>
                    )}
                    {state === "completed" && stats.total > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-[#9aa886]">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {stats.done} done
                        {stats.failed > 0 && ` · ${stats.failed} failed`}
                      </span>
                    )}
                    {enabled && nextRun && <span>{nextRun}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 md:justify-end">
                  <button
                    onClick={() => (isEditing ? cancelEdit() : startEdit(flow))}
                    className="btn btn-secondary btn-sm"
                  >
                    {isEditing ? "Close" : "Edit"}
                  </button>
                  <PowerSwitch
                    checked={enabled}
                    onChange={(e) =>
                      handleSwitchChange(flow, e.target.checked)
                    }
                  />
                </div>
              </div>

              {isEditing && (
                <div className="px-4 pb-4">
                  <div className="card-separator mb-4" />
                  <div className="grid gap-4 md:grid-cols-[1.1fr_1.2fr]">
                    <div className="grid gap-3">
                      <div>
                        <label className="text-xs uppercase tracking-[0.3em] text-[#8b8b90]">
                          Flow name
                        </label>
                        <div className="mt-2 flex items-center w-full rounded bg-white/5 border border-white/10 text-white overflow-hidden">
                          <span className="px-3 text-[#c1c1c3] whitespace-nowrap">
                            Aurral-
                          </span>
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="flex-1 px-3 py-2 bg-transparent text-white outline-none text-sm"
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between text-xs text-[#c1c1c3]">
                          <span>Playlist size</span>
                          <span className="text-white">{editSize} tracks</span>
                        </div>
                        <input
                          type="range"
                          min={MIN_SIZE}
                          max={MAX_SIZE}
                          value={editSize}
                          onChange={(e) => setEditSize(Number(e.target.value))}
                          className="flow-slider w-full mt-2"
                        />
                      </div>
                    </div>
                    <div className="grid gap-3">
                      <div className="flex items-center justify-between text-xs text-[#c1c1c3]">
                        <span>Mix balance</span>
                        <span
                          className={
                            editTotal === 100 ? "text-[#c1c1c3]" : "text-red-400"
                          }
                        >
                          Total {editTotal}%
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <label className="text-[11px] uppercase tracking-[0.2em] text-[#8b8b90]">
                            Discover
                          </label>
                          <div className="mt-2 flex items-center gap-2">
                            <Sparkles className="w-3.5 h-3.5 text-[#707e61]" />
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={editMix.discover}
                              onChange={(e) =>
                                setEditMix(
                                  updateMixValue(
                                    editMix,
                                    "discover",
                                    e.target.value
                                  )
                                )
                              }
                              className="w-full h-8 rounded bg-white/5 border border-white/10 px-2 text-sm text-white outline-none"
                            />
                            <span className="text-xs text-[#c1c1c3]">%</span>
                          </div>
                        </div>
                        <div className="flex-1">
                          <label className="text-[11px] uppercase tracking-[0.2em] text-[#8b8b90]">
                            Mix
                          </label>
                          <div className="mt-2 flex items-center gap-2">
                            <Music2 className="w-3.5 h-3.5 text-[#707e61]" />
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={editMix.mix}
                              onChange={(e) =>
                                setEditMix(
                                  updateMixValue(editMix, "mix", e.target.value)
                                )
                              }
                              className="w-full h-8 rounded bg-white/5 border border-white/10 px-2 text-sm text-white outline-none"
                            />
                            <span className="text-xs text-[#c1c1c3]">%</span>
                          </div>
                        </div>
                        <div className="flex-1">
                          <label className="text-[11px] uppercase tracking-[0.2em] text-[#8b8b90]">
                            Trending
                          </label>
                          <div className="mt-2 flex items-center gap-2">
                            <TrendingUp className="w-3.5 h-3.5 text-[#707e61]" />
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={editMix.trending}
                              onChange={(e) =>
                                setEditMix(
                                  updateMixValue(
                                    editMix,
                                    "trending",
                                    e.target.value
                                  )
                                )
                              }
                              className="w-full h-8 rounded bg-white/5 border border-white/10 px-2 text-sm text-white outline-none"
                            />
                            <span className="text-xs text-[#c1c1c3]">%</span>
                          </div>
                        </div>
                      </div>
                      <div className="h-2 w-full rounded-full bg-white/5 overflow-hidden flex">
                        <div
                          className="h-full bg-[#707e61]"
                          style={{ width: `${(editMix.discover ?? 0) * editScale}%` }}
                        />
                        <div
                          className="h-full bg-[#4a5162]"
                          style={{ width: `${(editMix.mix ?? 0) * editScale}%` }}
                        />
                        <div
                          className="h-full bg-[#7b7f8a]"
                          style={{ width: `${(editMix.trending ?? 0) * editScale}%` }}
                        />
                      </div>
                      <div className="text-xs text-[#c1c1c3]">
                        {editRemaining === 0
                          ? "Balanced at 100%"
                          : editRemaining > 0
                            ? `${editRemaining}% remaining`
                            : `${Math.abs(editRemaining)}% over`}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-2">
                    <button
                      onClick={() => handleDelete(flow)}
                      className="btn btn-danger btn-sm flex items-center gap-2"
                      disabled={deletingId === flow.id}
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>
                        {deletingId === flow.id ? "Deleting..." : "Delete"}
                      </span>
                    </button>
                    <button
                      onClick={() => saveEdit(flow.id)}
                      className="btn btn-primary btn-sm"
                      disabled={!hasChanges || editTotal !== 100}
                    >
                      Save changes
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-8 p-4 bg-white/5 rounded-lg border border-white/5">
        <p className="text-sm text-[#c1c1c3]">
          <strong className="text-white">Coming later:</strong> Pin playlists
          from Discover (“because you like X”) and tag searches to build custom
          Flow playlists by genre and tags.
        </p>
      </div>

      {confirmTurnOff && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.75)" }}
          onClick={() => setConfirmTurnOff(null)}
        >
          <div
            className="card max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold mb-2 text-white">
              Turn off {confirmTurnOff.title}?
            </h3>
            <p className="text-[#c1c1c3] mb-6">
              This flow will stop running and won&apos;t refresh until you turn
              it back on.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmTurnOff(null)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmTurnOff}
                className="btn btn-primary"
                style={{ backgroundColor: "#ef4444" }}
              >
                Turn off
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.75)" }}
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="card max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold mb-2 text-white">
              Delete {confirmDelete.title}?
            </h3>
            <p className="text-[#c1c1c3] mb-6">
              This removes the flow and its playlist setup. You can recreate it
              later.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="btn btn-primary"
                style={{ backgroundColor: "#ef4444" }}
                disabled={deletingId === confirmDelete.flowId}
              >
                {deletingId === confirmDelete.flowId ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showNewFlow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.75)" }}
          onClick={() => setShowNewFlow(false)}
        >
          <div
            className="card max-w-xl w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-white">New Flow</h3>
            </div>
            <div className="grid gap-3">
              <div>
                <label className="text-xs uppercase tracking-[0.3em] text-[#8b8b90]">
                  Flow name
                </label>
                <div className="mt-2 flex items-center w-full rounded bg-white/5 border border-white/10 text-white overflow-hidden">
                  <span className="px-3 text-[#c1c1c3] whitespace-nowrap">
                    Aurral-
                  </span>
                  <input
                    value={newFlowName}
                    onChange={(e) => setNewFlowName(e.target.value)}
                    className="flex-1 px-3 py-2 bg-transparent text-white outline-none"
                    placeholder="Mega Mix"
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-xs text-[#c1c1c3]">
                  <span>Playlist size</span>
                  <span className="text-white">{newFlowSize} tracks</span>
                </div>
                <input
                  type="range"
                  min={MIN_SIZE}
                  max={MAX_SIZE}
                  value={newFlowSize}
                  onChange={(e) => setNewFlowSize(Number(e.target.value))}
                  className="flow-slider w-full mt-2"
                />
              </div>
              <div className="grid gap-3">
                <div className="flex items-center justify-between text-xs text-[#c1c1c3]">
                  <span>Mix balance</span>
                  <span
                    className={
                      newTotal === 100 ? "text-[#c1c1c3]" : "text-red-400"
                    }
                  >
                    Total {newTotal}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="text-[11px] uppercase tracking-[0.2em] text-[#8b8b90]">
                      Discover
                    </label>
                    <div className="mt-2 flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-[#707e61]" />
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={newFlowMix.discover}
                        onChange={(e) =>
                          setNewFlowMix(
                            updateMixValue(
                              newFlowMix,
                              "discover",
                              e.target.value
                            )
                          )
                        }
                        className="w-full h-8 rounded bg-white/5 border border-white/10 px-2 text-sm text-white outline-none"
                      />
                      <span className="text-xs text-[#c1c1c3]">%</span>
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="text-[11px] uppercase tracking-[0.2em] text-[#8b8b90]">
                      Mix
                    </label>
                    <div className="mt-2 flex items-center gap-2">
                      <Music2 className="w-3.5 h-3.5 text-[#707e61]" />
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={newFlowMix.mix}
                        onChange={(e) =>
                          setNewFlowMix(
                            updateMixValue(newFlowMix, "mix", e.target.value)
                          )
                        }
                        className="w-full h-8 rounded bg-white/5 border border-white/10 px-2 text-sm text-white outline-none"
                      />
                      <span className="text-xs text-[#c1c1c3]">%</span>
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="text-[11px] uppercase tracking-[0.2em] text-[#8b8b90]">
                      Trending
                    </label>
                    <div className="mt-2 flex items-center gap-2">
                      <TrendingUp className="w-3.5 h-3.5 text-[#707e61]" />
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={newFlowMix.trending}
                        onChange={(e) =>
                          setNewFlowMix(
                            updateMixValue(
                              newFlowMix,
                              "trending",
                              e.target.value
                            )
                          )
                        }
                        className="w-full h-8 rounded bg-white/5 border border-white/10 px-2 text-sm text-white outline-none"
                      />
                      <span className="text-xs text-[#c1c1c3]">%</span>
                    </div>
                  </div>
                </div>
                <div className="h-2 w-full rounded-full bg-white/5 overflow-hidden flex">
                  <div
                    className="h-full bg-[#707e61]"
                    style={{ width: `${(newFlowMix.discover ?? 0) * newScale}%` }}
                  />
                  <div
                    className="h-full bg-[#4a5162]"
                    style={{ width: `${(newFlowMix.mix ?? 0) * newScale}%` }}
                  />
                  <div
                    className="h-full bg-[#7b7f8a]"
                    style={{ width: `${(newFlowMix.trending ?? 0) * newScale}%` }}
                  />
                </div>
                <div className="text-xs text-[#c1c1c3]">
                  {newRemaining === 0
                    ? "Balanced at 100%"
                    : newRemaining > 0
                      ? `${newRemaining}% remaining`
                      : `${Math.abs(newRemaining)}% over`}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowNewFlow(false)}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateFlow}
                  className="btn btn-primary btn-sm"
                  disabled={creating || newTotal !== 100 || !newFlowName.trim()}
                >
                  {creating ? "Saving..." : "Save Flow"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FlowPage;
