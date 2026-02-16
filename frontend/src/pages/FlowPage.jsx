import { useState, useEffect } from "react";
import {
  AudioWaveform,
  Loader2,
  CheckCircle2,
  Clock,
  Trash2,
  Pencil,
  Copy,
  Save,
  RotateCcw,
  FilePlus2,
} from "lucide-react";
import { dump, load } from "js-yaml";
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

const distributeByRemainder = (values, targetTotal) => {
  const keys = Object.keys(values);
  const parts = keys.map((key) => {
    const raw = Number(values[key]);
    const safe = Number.isFinite(raw) ? raw : 0;
    const floor = Math.floor(safe);
    const remainder = safe - floor;
    return { key, floor, remainder };
  });
  const sum = parts.reduce((acc, part) => acc + part.floor, 0);
  let remaining = Math.max(targetTotal - sum, 0);
  const ranked = [...parts].sort((a, b) => b.remainder - a.remainder);
  let idx = 0;
  while (remaining > 0 && ranked.length) {
    ranked[idx % ranked.length].floor += 1;
    remaining -= 1;
    idx += 1;
  }
  return parts.reduce((acc, part) => {
    acc[part.key] = part.floor;
    return acc;
  }, {});
};

const normalizeMixPercentages = (mix) => {
  const src = mix ?? DEFAULT_MIX;
  const parseField = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return 0;
    }
    return clamp(Math.round(parsed), 0, 100);
  };
  const cleaned = {
    discover: parseField(src?.discover),
    mix: parseField(src?.mix),
    trending: parseField(src?.trending),
  };
  const total = cleaned.discover + cleaned.mix + cleaned.trending;
  if (total <= 0) {
    return { ...DEFAULT_MIX };
  }
  const scaled = {
    discover: (cleaned.discover / total) * 100,
    mix: (cleaned.mix / total) * 100,
    trending: (cleaned.trending / total) * 100,
  };
  return distributeByRemainder(scaled, 100);
};

const normalizeRecipe = (recipe, fallback) => {
  const src = recipe ?? fallback ?? {};
  const parseField = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error("Recipe values must be numbers");
    }
    return Math.max(Math.round(parsed), 0);
  };
  const cleaned = {
    discover: parseField(src?.discover ?? 0),
    mix: parseField(src?.mix ?? 0),
    trending: parseField(src?.trending ?? 0),
  };
  const total = cleaned.discover + cleaned.mix + cleaned.trending;
  return { recipe: cleaned, total };
};

const normalizeWeightMap = (value, fallback, label) => {
  if (value == null) return fallback ?? {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a map of names to counts`);
  }
  const out = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const name = String(key ?? "").trim();
    if (!name) continue;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${label} values must be numbers`);
    }
    const rounded = Math.round(parsed);
    if (rounded < 0) {
      throw new Error(`${label} values must be 0 or more`);
    }
    if (rounded === 0) continue;
    out[name] = rounded;
  }
  return out;
};

const sanitizeWeightMap = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const name = String(key ?? "").trim();
    if (!name) continue;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) continue;
    const rounded = Math.round(parsed);
    if (rounded <= 0) continue;
    out[name] = rounded;
  }
  return out;
};

const sumWeightMap = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  return Object.values(value).reduce((acc, entry) => {
    const parsed = Number(entry);
    return acc + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);
};

const recipeToMix = (recipe) => {
  const total =
    (recipe?.discover ?? 0) + (recipe?.mix ?? 0) + (recipe?.trending ?? 0);
  if (total <= 0) {
    return { ...DEFAULT_MIX };
  }
  const raw = {
    discover: (recipe.discover / total) * 100,
    mix: (recipe.mix / total) * 100,
    trending: (recipe.trending / total) * 100,
  };
  return distributeByRemainder(raw, 100);
};

const recipeFromMix = (size, mix) => {
  const safeSize = Math.max(Math.round(Number(size) || DEFAULT_SIZE), 1);
  const normalized = normalizeMixPercentages(mix);
  const raw = {
    discover: (safeSize * normalized.discover) / 100,
    mix: (safeSize * normalized.mix) / 100,
    trending: (safeSize * normalized.trending) / 100,
  };
  return distributeByRemainder(raw, safeSize);
};

const recipeFromFlow = (flow) => {
  if (!flow) return recipeFromMix(DEFAULT_SIZE, DEFAULT_MIX);
  if (flow.recipe) {
    return normalizeRecipe(flow.recipe, DEFAULT_RECIPE).recipe;
  }
  return recipeFromMix(flow?.size, flow?.mix);
};

const DEFAULT_RECIPE = recipeFromMix(DEFAULT_SIZE, DEFAULT_MIX);

const NEW_FLOW_TEMPLATE = {
  name: "Mega Mix",
  deepDive: false,
  recipe: DEFAULT_RECIPE,
  tags: {},
  relatedArtists: {},
};

const flowToYaml = (flow) =>
  dump(
    {
      name: flow?.name || "Flow",
      deepDive: flow?.deepDive === true,
      recipe: recipeFromFlow(flow),
      tags: sanitizeWeightMap(flow?.tags),
      relatedArtists: sanitizeWeightMap(flow?.relatedArtists),
    },
    { lineWidth: 80, noRefs: true }
  );

const parseFlowYaml = (yamlText, fallback) => {
  let parsed;
  try {
    parsed = load(yamlText);
  } catch {
    throw new Error("YAML is not valid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("YAML must be a map of flow settings");
  }
  const name = String(parsed.name ?? fallback?.name ?? "").trim();
  if (!name) {
    throw new Error("Flow name is required");
  }
  const fallbackRecipe = fallback ? recipeFromFlow(fallback) : DEFAULT_RECIPE;
  const normalized = normalizeRecipe(parsed.recipe, fallbackRecipe);
  const mix = recipeToMix(normalized.recipe);
  const tags = normalizeWeightMap(
    parsed.tags,
    fallback?.tags ?? {},
    "Tags"
  );
  const relatedArtists = normalizeWeightMap(
    parsed.relatedArtists ?? parsed.relartedArtists,
    fallback?.relatedArtists ?? {},
    "Related artists"
  );
  const total =
    normalized.total + sumWeightMap(tags) + sumWeightMap(relatedArtists);
  if (total <= 0) {
    throw new Error("Flow must include at least one track");
  }
  const deepDive =
    typeof parsed.deepDive === "boolean"
      ? parsed.deepDive
      : fallback?.deepDive === true;
  return {
    name,
    size: total,
    mix,
    recipe: normalized.recipe,
    deepDive,
    tags,
    relatedArtists,
  };
};

function FlowPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [showNewFlow, setShowNewFlow] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [yamlDrafts, setYamlDrafts] = useState({});
  const [yamlErrors, setYamlErrors] = useState({});
  const [applyingFlowId, setApplyingFlowId] = useState(null);
  const [newFlowYaml, setNewFlowYaml] = useState(() =>
    flowToYaml(NEW_FLOW_TEMPLATE)
  );
  const [newFlowError, setNewFlowError] = useState("");
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
    setYamlDrafts((prev) => {
      const next = { ...prev };
      for (const flow of status.flows) {
        if (!next[flow.id]) {
          next[flow.id] = flowToYaml(flow);
        }
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

  const handleCopyYaml = async (flow) => {
    const yaml = yamlDrafts[flow.id] || flowToYaml(flow);
    try {
      await navigator.clipboard.writeText(yaml);
      showSuccess("YAML copied");
    } catch {
      showError("Failed to copy YAML");
    }
  };

  const handleResetYaml = (flow) => {
    setYamlDrafts((prev) => ({
      ...prev,
      [flow.id]: flowToYaml(flow),
    }));
    setYamlErrors((prev) => {
      const next = { ...prev };
      delete next[flow.id];
      return next;
    });
  };

  const handleApplyYaml = async (flow) => {
    const draft = yamlDrafts[flow.id] || "";
    setApplyingFlowId(flow.id);
    setYamlErrors((prev) => {
      const next = { ...prev };
      delete next[flow.id];
      return next;
    });
    try {
      const payload = parseFlowYaml(draft, flow);
      const response = await updateFlow(flow.id, {
        name: payload.name,
        size: payload.size,
        mix: payload.mix,
        recipe: payload.recipe,
        deepDive: payload.deepDive,
        tags: payload.tags,
        relatedArtists: payload.relatedArtists,
      });
      const updatedFlow = response?.flow || {
        ...flow,
        ...payload,
      };
      setYamlDrafts((prev) => ({
        ...prev,
        [flow.id]: flowToYaml(updatedFlow),
      }));
      showSuccess("Flow updated");
      await fetchStatus();
    } catch (err) {
      const message =
        err.response?.data?.message || err.message || "Failed to update flow";
      setYamlErrors((prev) => ({ ...prev, [flow.id]: message }));
      showError(message);
    } finally {
      setApplyingFlowId(null);
    }
  };

  const handleCreateFromYaml = async () => {
    setCreating(true);
    setNewFlowError("");
    try {
      const payload = parseFlowYaml(newFlowYaml, {
        name: "",
        recipe: DEFAULT_RECIPE,
        deepDive: false,
      });
      await createFlow({
        name: payload.name,
        size: payload.size,
        mix: payload.mix,
        recipe: payload.recipe,
        deepDive: payload.deepDive,
        tags: payload.tags,
        relatedArtists: payload.relatedArtists,
      });
      setNewFlowYaml(flowToYaml(NEW_FLOW_TEMPLATE));
      setShowNewFlow(false);
      showSuccess("Flow created");
      await fetchStatus();
    } catch (err) {
      const message =
        err.response?.data?.message || err.message || "Failed to create flow";
      setNewFlowError(message);
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
      setTogglingId(null);
    }
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
            className="btn btn-primary btn-sm flex items-center gap-2"
          >
            <FilePlus2 className="w-4 h-4" />
            New Flow
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
          const enabled = flow.enabled === true;
          const nextRun = formatNextRun(flow.nextRunAt);
          const isEditing = editingId === flow.id;
          const yamlDraft = yamlDrafts[flow.id] ?? flowToYaml(flow);
          const yamlError = yamlErrors[flow.id];
          const isApplying = applyingFlowId === flow.id;
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
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#c1c1c3]">
                    <span>{flow.size} tracks</span>
                    <span>·</span>
                    <span>{flow.mix?.discover ?? 0}% Discover</span>
                    <span>·</span>
                    <span>{flow.mix?.mix ?? 0}% Mix</span>
                    <span>·</span>
                    <span>{flow.mix?.trending ?? 0}% Trending</span>
                    <span>·</span>
                    <span>{flow.deepDive ? "Deep dive" : "Top picks"}</span>
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
                    onClick={() =>
                      setEditingId(isEditing ? null : flow.id)
                    }
                    className="btn btn-secondary btn-sm"
                    aria-label={isEditing ? "Close YAML" : "Edit YAML"}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-2">
                    <PowerSwitch
                      checked={enabled}
                      onChange={(event) =>
                        handleToggleEnabled(flow, event.target.checked)
                      }
                      disabled={togglingId === flow.id}
                    />
                    {togglingId === flow.id && (
                      <Loader2 className="w-4 h-4 animate-spin text-[#9aa886]" />
                    )}
                  </div>
                </div>
              </div>

              {isEditing && (
                <div className="px-4 pb-4">
                  <div className="card-separator mb-4" />
                  <div className="grid gap-3">
                    <div className="text-xs text-[#8b8b90]">
                      Edit name, deepDive, recipe counts, tags, and related
                      artists. Total tracks are calculated from all entries.
                    </div>
                    <textarea
                      value={yamlDraft}
                      onChange={(e) => {
                        const value = e.target.value;
                        setYamlDrafts((prev) => ({
                          ...prev,
                          [flow.id]: value,
                        }));
                        if (yamlErrors[flow.id]) {
                          setYamlErrors((prev) => {
                            const next = { ...prev };
                            delete next[flow.id];
                            return next;
                          });
                        }
                      }}
                      className="w-full min-h-[220px] rounded bg-white/5 border border-white/10 px-3 py-2 text-xs text-white font-mono outline-none"
                      spellCheck={false}
                    />
                    {yamlError && (
                      <div className="text-xs text-red-400">{yamlError}</div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2">
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
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleCopyYaml(flow)}
                          className="btn btn-secondary btn-sm flex items-center gap-2"
                        >
                          <Copy className="w-4 h-4" />
                          Copy YAML
                        </button>
                        <button
                          onClick={() => handleResetYaml(flow)}
                          className="btn btn-secondary btn-sm flex items-center gap-2"
                        >
                          <RotateCcw className="w-4 h-4" />
                          Reset
                        </button>
                        <button
                          onClick={() => handleApplyYaml(flow)}
                          className="btn btn-primary btn-sm flex items-center gap-2"
                          disabled={isApplying}
                        >
                          <Save className="w-4 h-4" />
                          {isApplying ? "Applying..." : "Apply YAML"}
                        </button>
                      </div>
                    </div>
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
              <h3 className="text-xl font-bold text-white">New Flow (YAML)</h3>
            </div>
            <div className="grid gap-3">
              <div className="text-xs text-[#8b8b90]">
                Paste a flow YAML or tweak the template below to share and
                remix.
              </div>
              <textarea
                value={newFlowYaml}
                onChange={(e) => {
                  const value = e.target.value;
                  setNewFlowYaml(value);
                  if (newFlowError) {
                    setNewFlowError("");
                  }
                }}
                className="w-full min-h-[240px] rounded bg-white/5 border border-white/10 px-3 py-2 text-xs text-white font-mono outline-none"
                spellCheck={false}
              />
              {newFlowError && (
                <div className="text-xs text-red-400">{newFlowError}</div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  onClick={() => setNewFlowYaml(flowToYaml(NEW_FLOW_TEMPLATE))}
                  className="btn btn-secondary btn-sm flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowNewFlow(false);
                      setNewFlowError("");
                    }}
                    className="btn btn-secondary btn-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateFromYaml}
                    className="btn btn-primary btn-sm flex items-center gap-2"
                    disabled={creating}
                  >
                    <FilePlus2 className="w-4 h-4" />
                    {creating ? "Saving..." : "Create Flow"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FlowPage;
