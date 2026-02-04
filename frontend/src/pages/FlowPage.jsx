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
  ChevronDown,
  ChevronUp,
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

const adjustMix = (mix, key, value) => {
  const nextValue = clamp(Math.round(Number(value) || 0), 0, 100);
  const keys = ["discover", "mix", "trending"];
  const others = keys.filter((k) => k !== key);
  const remaining = 100 - nextValue;
  const totalOther = others.reduce((sum, k) => sum + (mix[k] || 0), 0);
  const next = { ...mix, [key]: nextValue };
  if (totalOther <= 0) {
    next[others[0]] = remaining;
    next[others[1]] = 0;
    return next;
  }
  const first = Math.round((mix[others[0]] / totalOther) * remaining);
  next[others[0]] = first;
  next[others[1]] = remaining - first;
  return next;
};

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


  if (loading && !status) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-[#707e61]" />
      </div>
    );
  }

  return (
    <div className="flow-page max-w-4xl mx-auto px-4 pb-12">
      <div className="flex items-center gap-3 mb-8">
        <AudioWaveform className="w-8 h-8 text-[#707e61]" />
        <div>
          <h1 className="text-2xl font-semibold text-white">Flow</h1>
          <p className="text-sm text-[#c1c1c3]">
            Create configurable weekly flows and blend Discover, Mix, and
            Trending into playlists.
          </p>
        </div>
      </div>

      {status?.worker && (
        <div className="mb-6 p-4 bg-card rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            {status.worker.running ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin text-[#707e61]" />
                <span className="text-white">
                  Worker {status.worker.processing ? "processing…" : "running"}
                </span>
              </>
            ) : (
              <>
                <Clock className="w-5 h-5 text-[#c1c1c3]" />
                <span className="text-[#c1c1c3]">Worker stopped</span>
              </>
            )}
          </div>
          {status.stats && (
            <span className="text-sm text-[#c1c1c3]">
              {status.stats.done} done · {status.stats.failed} failed ·{" "}
              {status.stats.pending} pending · {status.stats.downloading}{" "}
              downloading
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white">Your Flows</h2>
        <button
          onClick={() => setShowNewFlow(true)}
          className="btn btn-primary"
        >
          + New Flow
        </button>
      </div>

      <div className="space-y-4">
        {(status?.flows || []).map((flow) => {
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

          return (
            <div
              key={flow.id}
              className="p-5 bg-card rounded-lg border border-white/5 overflow-hidden"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-medium text-white truncate">
                      {flow.name}
                    </h2>
                    {isToggling && (
                      <Loader2 className="w-4 h-4 animate-spin text-[#707e61] flex-shrink-0" />
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-sm text-[#c1c1c3]">
                    <span>{flow.size} tracks</span>
                    <span>·</span>
                    <span>
                      {flow.mix?.discover ?? 0}% Discover ·{" "}
                      {flow.mix?.mix ?? 0}% Mix · {flow.mix?.trending ?? 0}% Trending
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-sm text-[#c1c1c3]">
                    {state === "running" && (
                      <span className="inline-flex items-center gap-1.5 text-[#707e61]">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {stats.done + stats.failed}/{stats.total}
                      </span>
                    )}
                    {state === "completed" && stats.total > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-[#707e61]">
                        <CheckCircle2 className="w-4 h-4" />
                        {stats.done} done
                        {stats.failed > 0 && ` · ${stats.failed} failed`}
                      </span>
                    )}
                    {enabled && nextRun && <span>{nextRun}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <PowerSwitch
                    checked={enabled}
                    onChange={(e) =>
                      handleSwitchChange(flow, e.target.checked)
                    }
                  />
                </div>
              </div>

              {isEditing && (
                <div className="pt-4 grid gap-3">
                  <div>
                    <label className="text-sm text-[#c1c1c3]">Flow name</label>
                    <div className="mt-2 flex items-center w-full rounded bg-white/5 border border-white/10 text-white overflow-hidden">
                      <span className="px-3 text-[#c1c1c3] whitespace-nowrap">
                        Aurral-
                      </span>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 px-3 py-2 bg-transparent text-white outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-sm text-[#c1c1c3]">
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
                  <div className="grid gap-3">
                    <div className="flex items-center gap-2 text-sm text-[#c1c1c3]">
                      <Sparkles className="w-4 h-4 text-[#707e61]" />
                      <span className="min-w-[84px]">Discover</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={editMix.discover}
                        onChange={(e) =>
                          setEditMix(adjustMix(editMix, "discover", e.target.value))
                        }
                        className="flow-slider flex-1"
                      />
                      <span className="w-10 text-right text-white">
                        {editMix.discover}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-[#c1c1c3]">
                      <Music2 className="w-4 h-4 text-[#707e61]" />
                      <span className="min-w-[84px]">Mix</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={editMix.mix}
                        onChange={(e) =>
                          setEditMix(adjustMix(editMix, "mix", e.target.value))
                        }
                        className="flow-slider flex-1"
                      />
                      <span className="w-10 text-right text-white">
                        {editMix.mix}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-[#c1c1c3]">
                      <TrendingUp className="w-4 h-4 text-[#707e61]" />
                      <span className="min-w-[84px]">Trending</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={editMix.trending}
                        onChange={(e) =>
                          setEditMix(adjustMix(editMix, "trending", e.target.value))
                        }
                        className="flow-slider flex-1"
                      />
                      <span className="w-10 text-right text-white">
                        {editMix.trending}%
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => handleDelete(flow)}
                      className="btn btn-secondary flex items-center gap-2 bg-[#2a2830] hover:bg-red-800"
                      disabled={deletingId === flow.id}
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Delete flow</span>
                    </button>
                    <button
                      onClick={() => saveEdit(flow.id)}
                      className="btn btn-primary"
                      disabled={!hasChanges}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
              <button
                onClick={() => (isEditing ? cancelEdit() : startEdit(flow))}
                className="flex w-full items-center justify-center gap-2 text-xs uppercase tracking-[0.2em] text-[#c1c1c3] hover:text-white transition-colors"
              >
                {isEditing ? (
                  <>
                    <span>Hide settings</span>
                    <ChevronUp className="w-4 h-4" />
                  </>
                ) : (
                  <>
                    <span>Edit flow</span>
                    <ChevronDown className="w-4 h-4" />
                  </>
                )}
              </button>
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
            <div className="grid gap-4">
              <div>
                <label className="text-sm text-[#c1c1c3]">Flow name</label>
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
                <div className="flex items-center justify-between text-sm text-[#c1c1c3]">
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
                <div className="flex items-center gap-2 text-sm text-[#c1c1c3]">
                  <Sparkles className="w-4 h-4 text-[#707e61]" />
                  <span className="min-w-[84px]">Discover</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={newFlowMix.discover}
                    onChange={(e) =>
                      setNewFlowMix(
                        adjustMix(newFlowMix, "discover", e.target.value)
                      )
                    }
                    className="flow-slider flex-1"
                  />
                  <span className="w-10 text-right text-white">
                    {newFlowMix.discover}%
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm text-[#c1c1c3]">
                  <Music2 className="w-4 h-4 text-[#707e61]" />
                  <span className="min-w-[84px]">Mix</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={newFlowMix.mix}
                    onChange={(e) =>
                      setNewFlowMix(adjustMix(newFlowMix, "mix", e.target.value))
                    }
                    className="flow-slider flex-1"
                  />
                  <span className="w-10 text-right text-white">
                    {newFlowMix.mix}%
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm text-[#c1c1c3]">
                  <TrendingUp className="w-4 h-4 text-[#707e61]" />
                  <span className="min-w-[84px]">Trending</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={newFlowMix.trending}
                    onChange={(e) =>
                      setNewFlowMix(
                        adjustMix(newFlowMix, "trending", e.target.value)
                      )
                    }
                    className="flow-slider flex-1"
                  />
                  <span className="w-10 text-right text-white">
                    {newFlowMix.trending}%
                  </span>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowNewFlow(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateFlow}
                  className="btn btn-primary"
                  disabled={creating}
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
