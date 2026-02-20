import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import {
  getFlowStatus,
  createFlow,
  updateFlow,
  deleteFlow,
  setFlowEnabled,
} from "../utils/api";
import { useToast } from "../contexts/ToastContext";
import {
  FlowCard,
  FlowEmptyState,
  FlowPageHeader,
  FlowStatusCards,
  ConfirmDeleteModal,
  ConfirmDisableModal,
} from "./FlowPageComponents";

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

const DEFAULT_MIX = { discover: 50, mix: 30, trending: 20 };
const DEFAULT_SIZE = 30;

const MIX_PRESETS = [
  {
    id: "balanced",
    label: "Balanced",
    mix: DEFAULT_MIX,
  },
  {
    id: "discover",
    label: "Discover Focus",
    mix: { discover: 70, mix: 20, trending: 10 },
  },
  {
    id: "library",
    label: "Library Mix",
    mix: { discover: 25, mix: 65, trending: 10 },
  },
  {
    id: "trending",
    label: "Trending Lift",
    mix: { discover: 35, mix: 20, trending: 45 },
  },
  {
    id: "custom",
    label: "Custom",
    mix: null,
  },
];

const FOCUS_STRENGTHS = {
  light: 20,
  medium: 35,
  heavy: 50,
};

const FOCUS_OPTIONS = [
  { id: "light", label: "Light" },
  { id: "medium", label: "Medium" },
  { id: "heavy", label: "Heavy" },
];

const NEW_FLOW_TEMPLATE = {
  name: "Discover",
  size: DEFAULT_SIZE,
  mix: DEFAULT_MIX,
  deepDive: false,
  tags: {},
  relatedArtists: {},
};

const parseListInput = (value) =>
  String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const normalizeMixPercent = (mix) => {
  const raw = {
    discover: Number(mix?.discover ?? 0),
    mix: Number(mix?.mix ?? 0),
    trending: Number(mix?.trending ?? 0),
  };
  const sum = raw.discover + raw.mix + raw.trending;
  if (!Number.isFinite(sum) || sum <= 0) {
    return { ...DEFAULT_MIX };
  }
  const weights = [
    { key: "discover", value: raw.discover },
    { key: "mix", value: raw.mix },
    { key: "trending", value: raw.trending },
  ];
  const scaled = weights.map((w) => ({
    ...w,
    raw: (w.value / sum) * 100,
  }));
  const floored = scaled.map((w) => ({
    ...w,
    count: Math.floor(w.raw),
    remainder: w.raw - Math.floor(w.raw),
  }));
  let remaining = 100 - floored.reduce((acc, w) => acc + w.count, 0);
  const ordered = [...floored].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < ordered.length && remaining > 0; i++) {
    ordered[i].count += 1;
    remaining -= 1;
  }
  const out = {};
  for (const item of ordered) {
    out[item.key] = item.count;
  }
  return out;
};

const getPresetForMix = (mix) => {
  const normalized = normalizeMixPercent(mix);
  const preset = MIX_PRESETS.find(
    (entry) =>
      entry.mix &&
      entry.mix.discover === normalized.discover &&
      entry.mix.mix === normalized.mix &&
      entry.mix.trending === normalized.trending
  );
  return preset?.id ?? "custom";
};

const buildCountsFromMixPercent = (size, mix) => {
  const weights = normalizeMixPercent(mix);
  const entries = [
    { key: "discover", value: weights.discover },
    { key: "mix", value: weights.mix },
    { key: "trending", value: weights.trending },
  ];
  const scaled = entries.map((entry) => ({
    ...entry,
    raw: (entry.value / 100) * size,
  }));
  const floored = scaled.map((entry) => ({
    ...entry,
    count: Math.floor(entry.raw),
    remainder: entry.raw - Math.floor(entry.raw),
  }));
  let remaining = size - floored.reduce((acc, entry) => acc + entry.count, 0);
  const ordered = [...floored].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < ordered.length && remaining > 0; i++) {
    ordered[i].count += 1;
    remaining -= 1;
  }
  const out = {};
  for (const entry of ordered) {
    out[entry.key] = entry.count;
  }
  return out;
};

const getFocusPercentFromStrength = (strength) =>
  FOCUS_STRENGTHS[strength] ?? FOCUS_STRENGTHS.medium;

const getFocusStrengthFromPercent = (percent) => {
  const numeric = Number(percent || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "medium";
  const entries = Object.entries(FOCUS_STRENGTHS);
  const closest = entries.reduce((best, [key, value]) => {
    if (!best) return { key, distance: Math.abs(value - numeric) };
    const distance = Math.abs(value - numeric);
    return distance < best.distance ? { key, distance } : best;
  }, null);
  return closest?.key ?? "medium";
};

const buildCountsFromFocusPercent = (size, tagPercent, relatedPercent) => {
  const safeSize = Number.isFinite(size) && size > 0 ? size : 0;
  const tag = Math.max(0, Number(tagPercent || 0));
  const related = Math.max(0, Number(relatedPercent || 0));
  const totalPercent = tag + related;
  if (safeSize <= 0 || totalPercent <= 0) {
    return { tag: 0, related: 0, remaining: safeSize };
  }
  const targetTotal = Math.round((totalPercent / 100) * safeSize);
  const entries = [
    { key: "tag", raw: (tag / 100) * safeSize },
    { key: "related", raw: (related / 100) * safeSize },
  ];
  const floored = entries.map((entry) => ({
    ...entry,
    count: Math.floor(entry.raw),
    remainder: entry.raw - Math.floor(entry.raw),
  }));
  let remaining = targetTotal - floored.reduce((acc, entry) => acc + entry.count, 0);
  const ordered = [...floored].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < ordered.length && remaining > 0; i++) {
    ordered[i].count += 1;
    remaining -= 1;
  }
  const out = {};
  for (const entry of ordered) {
    out[entry.key] = entry.count;
  }
  return {
    tag: out.tag ?? 0,
    related: out.related ?? 0,
    remaining: Math.max(0, safeSize - (out.tag ?? 0) - (out.related ?? 0)),
  };
};

const buildFocusStrengthFromCounts = (size, tagCount, relatedCount) => {
  const safeSize = Number.isFinite(size) && size > 0 ? size : 0;
  if (safeSize <= 0) {
    return { tagStrength: "medium", relatedStrength: "medium" };
  }
  const tag = Math.max(0, Number(tagCount || 0));
  const related = Math.max(0, Number(relatedCount || 0));
  const totalPercent = Math.round(((tag + related) / safeSize) * 100);
  if (totalPercent <= 0) {
    return { tagStrength: "medium", relatedStrength: "medium" };
  }
  const entries = [
    { key: "tag", raw: (tag / safeSize) * 100 },
    { key: "related", raw: (related / safeSize) * 100 },
  ];
  const floored = entries.map((entry) => ({
    ...entry,
    count: Math.floor(entry.raw),
    remainder: entry.raw - Math.floor(entry.raw),
  }));
  let remaining = totalPercent - floored.reduce((acc, entry) => acc + entry.count, 0);
  const ordered = [...floored].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < ordered.length && remaining > 0; i++) {
    ordered[i].count += 1;
    remaining -= 1;
  }
  const out = {};
  for (const entry of ordered) {
    out[entry.key] = entry.count;
  }
  return {
    tagStrength: getFocusStrengthFromPercent(out.tag ?? 0),
    relatedStrength: getFocusStrengthFromPercent(out.related ?? 0),
  };
};

const distributeCount = (total, values) => {
  const items = values.filter(Boolean);
  if (!items.length || total <= 0) return new Map();
  const per = Math.floor(total / items.length);
  let remaining = total - per * items.length;
  const result = new Map();
  for (const item of items) {
    const extra = remaining > 0 ? 1 : 0;
    if (remaining > 0) remaining -= 1;
    result.set(item, per + extra);
  }
  return result;
};

const sumWeightMap = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  return Object.values(value).reduce((acc, entry) => {
    const parsed = Number(entry);
    return acc + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);
};

const flowToForm = (flow) => {
  const tagsMap =
    flow?.tags && typeof flow.tags === "object" && !Array.isArray(flow.tags)
      ? flow.tags
      : {};
  const relatedMap =
    flow?.relatedArtists &&
    typeof flow.relatedArtists === "object" &&
    !Array.isArray(flow.relatedArtists)
      ? flow.relatedArtists
      : {};
  const tagCount = sumWeightMap(tagsMap);
  const relatedCount = sumWeightMap(relatedMap);
  const recipeCounts =
    flow?.recipe && typeof flow.recipe === "object" && !Array.isArray(flow.recipe)
      ? flow.recipe
      : null;
  const recipeTotal = sumWeightMap(recipeCounts);
  const rawSize = Number(flow?.size || 0);
  const size =
    Number.isFinite(rawSize) && rawSize > 0
      ? rawSize
      : recipeTotal > 0
        ? recipeTotal
        : DEFAULT_SIZE;
  const mix = normalizeMixPercent(flow?.mix || DEFAULT_MIX);
  const preset = getPresetForMix(mix);
  const focusStrengths = buildFocusStrengthFromCounts(
    Number.isFinite(size) ? size : 0,
    tagCount,
    relatedCount
  );
  return {
    name: flow?.name || "",
    size: Number.isFinite(size) && size > 0 ? Math.round(size) : DEFAULT_SIZE,
    mix,
    mixPreset: preset,
    deepDive: flow?.deepDive === true,
    includeTags: Object.keys(tagsMap).join(", "),
    includeRelatedArtists: Object.keys(relatedMap).join(", "),
    tagStrength: focusStrengths.tagStrength,
    relatedStrength: focusStrengths.relatedStrength,
  };
};

const buildFlowFromForm = (draft) => {
  const name = String(draft?.name ?? "").trim();
  if (!name) {
    throw new Error("Flow name is required");
  }
  const sizeValue = Number(draft?.size);
  if (!Number.isFinite(sizeValue) || sizeValue <= 0) {
    throw new Error("Total tracks must be a positive number");
  }
  const size = Math.round(sizeValue);
  const includeTags = parseListInput(draft?.includeTags);
  const includeRelatedArtists = parseListInput(draft?.includeRelatedArtists);
  const tagFocusPercent =
    includeTags.length > 0
      ? getFocusPercentFromStrength(draft?.tagStrength)
      : 0;
  const relatedFocusPercent =
    includeRelatedArtists.length > 0
      ? getFocusPercentFromStrength(draft?.relatedStrength)
      : 0;
  if (tagFocusPercent + relatedFocusPercent > 100) {
    throw new Error("Tag and related focus exceeds 100%");
  }
  const focusCounts = buildCountsFromFocusPercent(
    size,
    tagFocusPercent,
    relatedFocusPercent
  );
  const tagFocus = focusCounts.tag;
  const relatedFocus = focusCounts.related;
  const mix = normalizeMixPercent(draft?.mix);
  const recipe = buildCountsFromMixPercent(size, mix);
  const tags = {};
  if (tagFocus > 0 && includeTags.length > 0) {
    const tagCounts = distributeCount(tagFocus, includeTags);
    for (const [tag, count] of tagCounts.entries()) {
      if (count <= 0) continue;
      tags[tag] = count;
    }
  }
  const relatedArtists = {};
  if (relatedFocus > 0 && includeRelatedArtists.length > 0) {
    const relatedCounts = distributeCount(relatedFocus, includeRelatedArtists);
    for (const [artist, count] of relatedCounts.entries()) {
      if (count <= 0) continue;
      relatedArtists[artist] = count;
    }
  }
  return {
    name,
    size,
    mix,
    recipe,
    tags,
    relatedArtists,
    deepDive: draft?.deepDive === true,
  };
};

function FlowPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmDisable, setConfirmDisable] = useState(null);
  const [optimisticEnabled, setOptimisticEnabled] = useState({});
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [simpleDrafts, setSimpleDrafts] = useState({});
  const [simpleErrors, setSimpleErrors] = useState({});
  const [applyingFlowId, setApplyingFlowId] = useState(null);
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

  useEffect(() => {
    if (!status?.flows?.length) return;
    setSimpleDrafts((prev) => {
      const next = { ...prev };
      for (const flow of status.flows) {
        const normalized = flowToForm(flow);
        if (!next[flow.id]) {
          next[flow.id] = normalized;
          continue;
        }
        const current = next[flow.id];
        next[flow.id] = {
          ...normalized,
          ...current,
          tagStrength: current.tagStrength ?? normalized.tagStrength,
          relatedStrength: current.relatedStrength ?? normalized.relatedStrength,
        };
      }
      return next;
    });
  }, [status?.flows]);

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

  const handleCancelSimple = (flow) => {
    setSimpleDrafts((prev) => ({
      ...prev,
      [flow.id]: flowToForm(flow),
    }));
    setSimpleErrors((prev) => {
      const next = { ...prev };
      delete next[flow.id];
      return next;
    });
    setEditingId((prev) => (prev === flow.id ? null : prev));
  };

  const handleApplySimple = async (flow) => {
    setApplyingFlowId(flow.id);
    setSimpleErrors((prev) => {
      const next = { ...prev };
      delete next[flow.id];
      return next;
    });
    try {
      const draft = simpleDrafts[flow.id] || flowToForm(flow);
      const payload = buildFlowFromForm(draft);
      const response = await updateFlow(flow.id, payload);
      const updatedFlow = response?.flow || {
        ...flow,
        ...payload,
      };
      setSimpleDrafts((prev) => ({
        ...prev,
        [flow.id]: flowToForm(updatedFlow),
      }));
      showSuccess("Flow updated");
      await fetchStatus();
    } catch (err) {
      const message =
        err.response?.data?.message || err.message || "Failed to update flow";
      setSimpleErrors((prev) => ({ ...prev, [flow.id]: message }));
      showError(message);
    } finally {
      setApplyingFlowId(null);
    }
  };

  const handleCreateInline = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const draft = flowToForm(NEW_FLOW_TEMPLATE);
      const payload = buildFlowFromForm(draft);
      const response = await createFlow(payload);
      const createdFlow = response?.flow;
      if (createdFlow?.id) {
        setSimpleDrafts((prev) => ({
          ...prev,
          [createdFlow.id]: flowToForm(createdFlow),
        }));
        setEditingId(createdFlow.id);
      }
      showSuccess("Flow created");
      await fetchStatus();
    } catch (err) {
      const message =
        err.response?.data?.message || err.message || "Failed to create flow";
      showError(message);
    } finally {
      setCreating(false);
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

  const handleToggleEnabled = async (flow, nextEnabled) => {
    setTogglingId(flow.id);
    try {
      await setFlowEnabled(flow.id, nextEnabled);
      showSuccess(nextEnabled ? "Flow enabled" : "Flow disabled");
      await fetchStatus();
    } catch (err) {
      showError(
        err.response?.data?.message || err.message || "Failed to update flow"
      );
    } finally {
      setOptimisticEnabled((prev) => {
        const next = { ...prev };
        delete next[flow.id];
        return next;
      });
      setTogglingId(null);
    }
  };

  const handleToggleRequest = (flow, nextEnabled) => {
    if (!nextEnabled) {
      setConfirmDisable({ flowId: flow.id, title: flow.name });
      return;
    }
    setOptimisticEnabled((prev) => ({ ...prev, [flow.id]: true }));
    handleToggleEnabled(flow, true);
  };

  const handleConfirmDisable = async () => {
    if (!confirmDisable) return;
    const flow = flowList.find((entry) => entry.id === confirmDisable.flowId);
    if (flow) {
      setOptimisticEnabled((prev) => ({ ...prev, [flow.id]: false }));
      await handleToggleEnabled(flow, false);
    }
    setConfirmDisable(null);
  };

  const flowList = status?.flows || [];
  const enabledCount = flowList.filter((flow) => flow.enabled === true).length;
  const runningCount = flowList.filter(
    (flow) => getPlaylistState(flow.id) === "running"
  ).length;
  const completedCount = flowList.filter(
    (flow) => getPlaylistState(flow.id) === "completed"
  ).length;
  if (loading && !status) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-[#707e61]" />
      </div>
    );
  }

  return (
    <div className="flow-page max-w-6xl mx-auto px-4 pb-10">
      <FlowPageHeader
        onNewFlow={handleCreateInline}
      />

      <FlowStatusCards
        status={status}
        enabledCount={enabledCount}
        flowCount={flowList.length}
        runningCount={runningCount}
        completedCount={completedCount}
      />

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
          <FlowEmptyState onCreate={handleCreateInline} creating={creating} />
        )}
        {flowList.map((flow) => {
          const stats = getPlaylistStats(flow.id);
          const state = getPlaylistState(flow.id);
          const optimisticValue = optimisticEnabled[flow.id];
          const enabled =
            typeof optimisticValue === "boolean"
              ? optimisticValue
              : flow.enabled === true;
          const nextRun = formatNextRun(flow.nextRunAt);
          const isEditing = editingId === flow.id;
          const simpleDraft = simpleDrafts[flow.id] ?? flowToForm(flow);
          const simpleError = simpleErrors[flow.id];
          const simpleSize = Number(simpleDraft?.size ?? 0);
          const simpleMixSize = Number.isFinite(simpleSize) ? simpleSize : 0;
          const isApplying = applyingFlowId === flow.id;
          return (
            <FlowCard
              key={flow.id}
              flow={flow}
              enabled={enabled}
              state={state}
              stats={stats}
              nextRun={nextRun}
              isEditing={isEditing}
              simpleDraft={simpleDraft}
              simpleRemaining={simpleMixSize}
              simpleError={simpleError}
              isApplying={isApplying}
              togglingId={togglingId}
              deletingId={deletingId}
              onToggleEditing={() =>
                setEditingId((prev) => {
                  const next = prev === flow.id ? null : flow.id;
                  if (next) {
                    setSimpleErrors((prevErrors) => {
                      const nextErrors = { ...prevErrors };
                      delete nextErrors[flow.id];
                      return nextErrors;
                    });
                  }
                  return next;
                })
              }
              onToggleEnabled={(checked) => handleToggleRequest(flow, checked)}
              onDelete={() => handleDelete(flow)}
              onCancel={() => handleCancelSimple(flow)}
              onApply={() => handleApplySimple(flow)}
              onDraftChange={(updater) =>
                setSimpleDrafts((prev) => {
                  const base = prev[flow.id] ?? simpleDraft;
                  return { ...prev, [flow.id]: updater(base) };
                })
              }
              onClearError={() => {
                if (simpleErrors[flow.id]) {
                  setSimpleErrors((prev) => {
                    const next = { ...prev };
                    delete next[flow.id];
                    return next;
                  });
                }
              }}
              mixPresets={MIX_PRESETS}
              focusOptions={FOCUS_OPTIONS}
              normalizeMixPercent={normalizeMixPercent}
            />
          );
        })}
      </div>

      <ConfirmDeleteModal
        confirmDelete={confirmDelete}
        deletingId={deletingId}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={handleConfirmDelete}
      />
      <ConfirmDisableModal
        confirmDisable={confirmDisable}
        togglingId={togglingId}
        onCancel={() => setConfirmDisable(null)}
        onConfirm={handleConfirmDisable}
      />
    </div>
  );
}

export default FlowPage;
