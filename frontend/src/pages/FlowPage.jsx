import { useState, useEffect } from "react";
import {
  AudioWaveform,
  Loader2,
  CheckCircle2,
  Clock,
  HelpCircle,
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

const NEW_FLOW_TEMPLATE = {
  name: "Discover",
  blocks: [
    {
      source: "discover",
      count: 30,
      deepDive: false,
    },
  ],
};

const normalizeList = (value, label) => {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  throw new Error(`${label} must be a string or list`);
};

const normalizeInclude = (value) => {
  if (value == null) {
    return { tags: [], artists: [], relatedArtists: [], match: "any" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("include must be a map");
  }
  return {
    tags: normalizeList(value.tags ?? value.tag, "include.tags"),
    artists: normalizeList(value.artists ?? value.artist, "include.artists"),
    relatedArtists: normalizeList(
      value.relatedArtists ?? value.relatedArtist,
      "include.relatedArtists",
    ),
    match: value.match === "all" ? "all" : "any",
  };
};

const normalizeExclude = (value) => {
  if (value == null) {
    return { tags: [], artists: [], relatedArtists: [] };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("exclude must be a map");
  }
  return {
    tags: normalizeList(value.tags ?? value.tag, "exclude.tags"),
    artists: normalizeList(value.artists ?? value.artist, "exclude.artists"),
    relatedArtists: normalizeList(
      value.relatedArtists ?? value.relatedArtist,
      "exclude.relatedArtists",
    ),
  };
};

const normalizeSource = (value) => {
  const source = String(value ?? "").trim().toLowerCase();
  const allowed = ["discover", "mix", "trending", "all", "recommended"];
  if (!source) {
    return "discover";
  }
  if (!allowed.includes(source)) {
    throw new Error("source must be discover, mix, trending, recommended, or all");
  }
  return source;
};

const flowToYaml = (flow) => {
  const blocks = Array.isArray(flow?.blocks) ? flow.blocks : [];
  const payload = { name: flow?.name || "Flow" };
  blocks.forEach((block, index) => {
    const entry = {
      source: block?.source || "discover",
      count: Number(block?.count || 0),
      deepDive: block?.deepDive === true,
    };
    const include = block?.include || {};
    const exclude = block?.exclude || {};
    const includeTags = normalizeList(include.tags ?? include.tag, "include.tags");
    const includeArtists = normalizeList(
      include.artists ?? include.artist,
      "include.artists",
    );
    const includeRelated = normalizeList(
      include.relatedArtists ?? include.relatedArtist,
      "include.relatedArtists",
    );
    const includeMatch = include.match === "all" ? "all" : "any";
    if (includeTags.length || includeArtists.length || includeRelated.length) {
      entry.include = {};
      if (includeTags.length) entry.include.tags = includeTags;
      if (includeArtists.length) entry.include.artists = includeArtists;
      if (includeRelated.length) entry.include.relatedArtists = includeRelated;
      if (include.match) entry.include.match = includeMatch;
    }
    const excludeTags = normalizeList(exclude.tags ?? exclude.tag, "exclude.tags");
    const excludeArtists = normalizeList(
      exclude.artists ?? exclude.artist,
      "exclude.artists",
    );
    const excludeRelated = normalizeList(
      exclude.relatedArtists ?? exclude.relatedArtist,
      "exclude.relatedArtists",
    );
    if (excludeTags.length || excludeArtists.length || excludeRelated.length) {
      entry.exclude = {};
      if (excludeTags.length) entry.exclude.tags = excludeTags;
      if (excludeArtists.length) entry.exclude.artists = excludeArtists;
      if (excludeRelated.length) entry.exclude.relatedArtists = excludeRelated;
    }
    payload[`block${index + 1}`] = entry;
  });
  return dump(payload, { lineWidth: 80, noRefs: true });
};

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
  const entries = Object.entries(parsed)
    .filter(([key]) => /^block\d+$/i.test(String(key)))
    .map(([key, value]) => ({
      key,
      order: Number(String(key).replace(/^\D+/, "")) || 0,
      value,
    }))
    .sort((a, b) => a.order - b.order);
  if (entries.length === 0) {
    throw new Error("Flow must include at least one block");
  }
  const blocks = entries.map((entry) => {
    if (!entry.value || typeof entry.value !== "object" || Array.isArray(entry.value)) {
      throw new Error(`${entry.key} must be a map of block settings`);
    }
    const count = Number(entry.value.count);
    if (!Number.isFinite(count)) {
      throw new Error(`${entry.key}.count must be a number`);
    }
    if (count < 1 || count > 100) {
      throw new Error(`${entry.key}.count must be between 1 and 100`);
    }
    const include = normalizeInclude(entry.value.include);
    if (entry.value.match && include.match === "any") {
      include.match = entry.value.match === "all" ? "all" : "any";
    }
    return {
      source: normalizeSource(entry.value.source),
      count: Math.round(count),
      deepDive: entry.value.deepDive === true,
      include,
      exclude: normalizeExclude(entry.value.exclude),
    };
  });
  const total = blocks.reduce((acc, block) => acc + block.count, 0);
  if (total <= 0) {
    throw new Error("Flow must include at least one track");
  }
  return {
    name,
    blocks,
    size: total,
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
  const [showHelp, setShowHelp] = useState(false);
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

  const summarizeBlocks = (flow) => {
    const blocks = Array.isArray(flow?.blocks) ? flow.blocks : [];
    if (!blocks.length) return "";
    const totals = blocks.reduce((acc, block) => {
      const source = String(block?.source || "discover");
      const count = Number(block?.count || 0);
      if (!Number.isFinite(count) || count <= 0) return acc;
      acc[source] = (acc[source] || 0) + count;
      return acc;
    }, {});
    return Object.entries(totals)
      .map(([source, count]) => `${count} ${source}`)
      .join(" · ");
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
        blocks: payload.blocks,
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
        blocks: [],
      });
      await createFlow({
        name: payload.name,
        size: payload.size,
        blocks: payload.blocks,
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
            onClick={() => setShowHelp(true)}
            className="btn btn-secondary btn-sm flex items-center gap-2"
            aria-label="Flow YAML help"
          >
            <HelpCircle className="w-4 h-4" />
            Help
          </button>
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
                    {flow.blocks?.length ? (
                      <>
                        <span>·</span>
                        <span>{flow.blocks.length} blocks</span>
                      </>
                    ) : null}
                    {summarizeBlocks(flow) ? (
                      <>
                        <span>·</span>
                        <span>{summarizeBlocks(flow)}</span>
                      </>
                    ) : null}
                    {flow.blocks?.some((block) => block?.deepDive) ? (
                      <>
                        <span>·</span>
                        <span>Deep dive enabled</span>
                      </>
                    ) : null}
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
                      Edit name, block sources, counts, and include/exclude
                      filters. Total tracks are calculated from all blocks.
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
      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center px-4 py-10"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.75)" }}
          onClick={() => setShowHelp(false)}
        >
          <div
            className="bg-card rounded-lg border border-white/10 w-full max-w-3xl max-h-[85vh] overflow-hidden text-sm text-[#c1c1c3]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <h3 className="text-lg font-semibold text-white">Flow YAML guide</h3>
              <button
                onClick={() => setShowHelp(false)}
                className="btn btn-secondary btn-sm"
              >
                Close
              </button>
            </div>
            <div className="grid gap-5 px-5 py-4 overflow-y-auto max-h-[70vh] leading-relaxed">
              <div>
                <div className="text-xs uppercase tracking-[0.3em] text-[#8b8b90] mb-2">
                  Shape
                </div>
                <div className="text-sm text-[#c1c1c3]">
                  Use a name plus one or more numbered blocks. Each block is a
                  source slice with its own count and filters.
                </div>
                <pre className="mt-3 whitespace-pre-wrap rounded bg-black/50 border border-white/10 p-3 text-xs text-white font-mono overflow-x-auto">
{`name: Mega Mix
block1:
  source: discover
  count: 10
block2:
  source: mix
  count: 10
block3:
  source: trending
  count: 10`}
                </pre>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.3em] text-[#8b8b90] mb-2">
                  Sources (detailed)
                </div>
                <div className="grid gap-2 text-sm text-[#c1c1c3]">
                  <div>
                    <span className="text-white">discover</span> uses your 100
                    Recommended artists from discovery.
                  </div>
                  <div>
                    <span className="text-white">recommended</span> is the same
                    as discover, but kept explicit for YAML clarity.
                  </div>
                  <div>
                    <span className="text-white">mix</span> uses artists from
                    your library and picks tracks from them.
                  </div>
                  <div>
                    <span className="text-white">trending</span> uses global
                    discovery trending artists.
                  </div>
                  <div>
                    <span className="text-white">all</span> allows global tag
                    and related artist lookups beyond your recommended list.
                  </div>
                </div>
                <pre className="mt-3 whitespace-pre-wrap rounded bg-black/50 border border-white/10 p-3 text-xs text-white font-mono overflow-x-auto">
{`block1:
  source: recommended
  count: 30
block2:
  source: all
  count: 20`}
                </pre>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.3em] text-[#8b8b90] mb-2">
                  Block fields and modifiers
                </div>
                <div className="grid gap-2 text-sm text-[#c1c1c3]">
                  <div>
                    <span className="text-white">source</span> chooses where
                    tracks come from.
                  </div>
                  <div>
                    <span className="text-white">count</span> is how many tracks
                    to pull for that block (1–100).
                  </div>
                  <div>
                    <span className="text-white">deepDive</span> uses deeper
                    cuts for that block only.
                  </div>
                  <div>
                    <span className="text-white">include</span> narrows the
                    block; <span className="text-white">exclude</span> removes
                    matches after include is applied.
                  </div>
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.3em] text-[#8b8b90] mb-2">
                  Include filters
                </div>
                <div className="grid gap-2 text-sm text-[#c1c1c3]">
                  <div>
                    <span className="text-white">include.tags</span> (or{" "}
                    <span className="text-white">include.tag</span>) filters by
                    genre tags.
                  </div>
                  <div>
                    <span className="text-white">include.artists</span> (or{" "}
                    <span className="text-white">include.artist</span>) limits
                    to specific artists.
                  </div>
                  <div>
                    <span className="text-white">include.relatedArtists</span>{" "}
                    (or <span className="text-white">include.relatedArtist</span>) builds from similar-artist
                    seeds.
                  </div>
                  <div>
                    <span className="text-white">include.match</span> sets tag
                    matching: <span className="text-white">any</span> (default)
                    or <span className="text-white">all</span>.
                  </div>
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.3em] text-[#8b8b90] mb-2">
                  Exclude filters
                </div>
                <div className="grid gap-2 text-sm text-[#c1c1c3]">
                  <div>
                    <span className="text-white">exclude.tags</span> (or{" "}
                    <span className="text-white">exclude.tag</span>) removes
                    artists that carry those tags in your recommended list.
                  </div>
                  <div>
                    <span className="text-white">exclude.artists</span> (or{" "}
                    <span className="text-white">exclude.artist</span>) removes
                    exact artist matches.
                  </div>
                  <div>
                    <span className="text-white">exclude.relatedArtists</span>{" "}
                    (or <span className="text-white">exclude.relatedArtist</span>) removes matches by similar-artist name.
                  </div>
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.3em] text-[#8b8b90] mb-2">
                  Notes
                </div>
                <div className="grid gap-2 text-sm text-[#c1c1c3]">
                  <div>
                    For <span className="text-white">discover</span> or{" "}
                    <span className="text-white">recommended</span>, tag filters
                    use your discovery cache tags.
                  </div>
                  <div>
                    For <span className="text-white">all</span>, tag filters use
                    global tag lists to source artists.
                  </div>
                  <div>
                    If multiple include filters are set, relatedArtists take
                    priority, then tags, then artists.
                  </div>
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.3em] text-[#8b8b90] mb-2">
                  Example: granular mix
                </div>
                <pre className="mt-3 whitespace-pre-wrap rounded bg-black/50 border border-white/10 p-3 text-xs text-white font-mono overflow-x-auto">
{`block1:
  source: recommended
  count: 30
  include:
    tags: [punk, emo]
    match: all
block2:
  source: all
  count: 20
  include:
    relatedArtists: The Used
  exclude:
    artists: [My Chemical Romance]`}
                </pre>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.3em] text-[#8b8b90] mb-2">
                  Example: deep dive block
                </div>
                <pre className="mt-3 whitespace-pre-wrap rounded bg-black/50 border border-white/10 p-3 text-xs text-white font-mono overflow-x-auto">
{`block1:
  source: mix
  count: 25
  deepDive: true`}
                </pre>
              </div>
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
