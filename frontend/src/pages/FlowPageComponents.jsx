import { useEffect, useRef, useCallback } from "react";
import {
  Loader2,
  CheckCircle2,
  Clock,
  Trash2,
  Pencil,
  Save,
  FilePlus2,
} from "lucide-react";
import PillToggle from "../components/PillToggle";

export function MixSlider({ mix, onChange, normalizeMixPercent }) {
  const normalized = normalizeMixPercent(mix);
  const barRef = useRef(null);
  const dragRef = useRef(null);

  const updateFromClientX = useCallback(
    (clientX, handle) => {
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect) return;
      const clampedX = Math.min(Math.max(clientX - rect.left, 0), rect.width);
      const percent = rect.width > 0 ? (clampedX / rect.width) * 100 : 0;
      if (handle === "left") {
        const totalLeft = 100 - normalized.trending;
        const nextDiscover = Math.min(Math.max(percent, 0), totalLeft);
        const nextMix = Math.max(0, totalLeft - nextDiscover);
        onChange(
          normalizeMixPercent({
            discover: nextDiscover,
            mix: nextMix,
            trending: normalized.trending,
          })
        );
        return;
      }
      const totalRight = 100 - normalized.discover;
      const nextMix = Math.min(
        Math.max(percent - normalized.discover, 0),
        totalRight
      );
      const nextTrending = Math.max(0, totalRight - nextMix);
      onChange(
        normalizeMixPercent({
          discover: normalized.discover,
          mix: nextMix,
          trending: nextTrending,
        })
      );
    },
    [normalized, onChange, normalizeMixPercent]
  );

  useEffect(() => {
    const handleMove = (event) => {
      if (!dragRef.current) return;
      updateFromClientX(event.clientX, dragRef.current.handle);
    };
    const handleUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [updateFromClientX]);

  const leftPosition = normalized.discover;
  const rightPosition = normalized.discover + normalized.mix;

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between text-xs text-[#8b8b90]">
        <span>Discover {normalized.discover}%</span>
        <span>Library {normalized.mix}%</span>
        <span>Trending {normalized.trending}%</span>
      </div>
      <div
        ref={barRef}
        className="relative h-9 rounded-full border border-white/10 bg-white/5 overflow-hidden select-none"
      >
        <div className="absolute inset-0 flex">
          <div
            className="h-full bg-[#9aa886] text-[10px] font-semibold text-black/70 flex items-center justify-center"
            style={{ width: `${normalized.discover}%` }}
          >
            Discover
          </div>
          <div
            className="h-full bg-[#7f8c6f] text-[10px] font-semibold text-black/70 flex items-center justify-center"
            style={{ width: `${normalized.mix}%` }}
          >
            Library
          </div>
          <div
            className="h-full bg-[#6a775c] text-[10px] font-semibold text-black/70 flex items-center justify-center"
            style={{ width: `${normalized.trending}%` }}
          >
            Trending
          </div>
        </div>
        <button
          type="button"
          onPointerDown={(event) => {
            dragRef.current = { handle: "left" };
            updateFromClientX(event.clientX, "left");
          }}
          className="absolute top-0 h-full w-3 -ml-1.5 cursor-ew-resize"
          style={{ left: `${leftPosition}%` }}
          aria-label="Adjust discover and library mix"
        >
          <span className="absolute left-1/2 top-1 bottom-1 w-1.5 -translate-x-1/2 rounded-full bg-white/80" />
        </button>
        <button
          type="button"
          onPointerDown={(event) => {
            dragRef.current = { handle: "right" };
            updateFromClientX(event.clientX, "right");
          }}
          className="absolute top-0 h-full w-3 -ml-1.5 cursor-ew-resize"
          style={{ left: `${rightPosition}%` }}
          aria-label="Adjust library and trending mix"
        >
          <span className="absolute left-1/2 top-1 bottom-1 w-1.5 -translate-x-1/2 rounded-full bg-white/80" />
        </button>
      </div>
    </div>
  );
}

export function FlowFormFields({
  draft,
  remaining,
  inputClassName = "input",
  errorMessage,
  onDraftChange,
  onClearError,
  mixPresets,
  focusOptions,
  normalizeMixPercent,
}) {
  const updateDraft = (updater) => {
    onDraftChange((prev) => updater(prev));
    if (onClearError) onClearError();
  };
  const parseList = (value) =>
    String(value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  const sizeValue = Number(draft?.size);
  const trackCount =
    Number.isFinite(sizeValue) && sizeValue > 0 ? Math.round(sizeValue) : "some";
  const tags = parseList(draft?.includeTags);
  const relatedArtists = parseList(draft?.includeRelatedArtists);
  const tagStrengthId = draft?.tagStrength ?? "medium";
  const relatedStrengthId = draft?.relatedStrength ?? "medium";
  const tagIntensityPhrase =
    {
      light: "sprinkle in tags like",
      medium: "feature tags like",
      heavy: "focus heavily on tags like",
    }[tagStrengthId] ?? "feature tags like";
  const relatedIntensityPhrase =
    {
      light: "a few related artists like",
      medium: "artists related to",
      heavy: "lots of artists related to",
    }[relatedStrengthId] ?? "artists related to";
  const tagPhrase = tags.length ? `${tagIntensityPhrase} ${tags.join(", ")}` : "";
  const relatedPhrase = relatedArtists.length
    ? `${relatedIntensityPhrase} ${relatedArtists.join(", ")}`
    : "";
  const mix = normalizeMixPercent(draft?.mix);
  const mixPreset = draft?.mixPreset ?? "custom";
  const mixPhrase =
    {
      balanced: "Keep it balanced across Discover, Mix, and Trending",
      discover: "Lean into discovery",
      library: "Let the library do most of the work",
      trending: "Give it a trending lift",
    }[mixPreset] ??
    `A custom blend of ${mix.discover}% Discover, ${mix.mix}% Mix, ${mix.trending}% Trending`;
  const deepDivePhrase = draft?.deepDive
    ? "dig into deep cuts"
    : "stick with the most popular picks";
  const clauses = [
    mixPhrase,
    tagPhrase,
    relatedPhrase,
    deepDivePhrase,
  ].filter(Boolean);
  const madlibsText = `${clauses.join(", ")}. No more than ${trackCount} tracks.`;
  const normalizedMix = normalizeMixPercent(draft?.mix);
  const totalSize = Number.isFinite(Number(remaining)) && Number(remaining) > 0 ? Math.round(Number(remaining)) : 0;
  
  const mixScaled = (() => {
    const entries = [
      { key: "discover", value: normalizedMix.discover },
      { key: "mix", value: normalizedMix.mix },
      { key: "trending", value: normalizedMix.trending },
    ];
    const scaled = entries.map((e) => ({
      ...e,
      raw: (e.value / 100) * totalSize,
    }));
    const floored = scaled.map((e) => ({
      ...e,
      count: Math.floor(e.raw),
      remainder: e.raw - Math.floor(e.raw),
    }));
    let leftover = totalSize - floored.reduce((acc, e) => acc + e.count, 0);
    const ordered = [...floored].sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < ordered.length && leftover > 0; i++) {
      ordered[i].count += 1;
      leftover -= 1;
    }
    const out = {};
    for (const item of ordered) out[item.key] = item.count;
    return out;
  })();

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 rounded-lg border border-white/10 bg-white/5 p-4">
        <div className="flex gap-4">
          <div className="flex-1 grid gap-1.5">
            <label className="text-xs uppercase tracking-wider text-[#8b8b90] font-medium">
              Flow Name
            </label>
            <input
              type="text"
              className={inputClassName}
              value={draft.name}
              onChange={(event) => {
                const value = event.target.value;
                updateDraft((prev) => ({ ...prev, name: value }));
              }}
            />
          </div>
          <div className="w-24 grid gap-1.5">
            <label className="text-xs uppercase tracking-wider text-[#8b8b90] font-medium">
              Tracks
            </label>
            <input
              type="number"
              min="1"
              max="100"
              className={inputClassName}
              value={draft.size}
              onChange={(event) => {
                const value = event.target.value;
                updateDraft((prev) => ({ ...prev, size: value }));
              }}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-white/10 bg-white/5 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-[0.3em] text-[#8b8b90] font-semibold">
            Source Mix
          </div>
          <div className="flex flex-wrap gap-1.5">
            {mixPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() =>
                  updateDraft((prev) => ({
                    ...prev,
                    mix: preset.mix ?? prev.mix,
                    mixPreset: preset.id,
                  }))
                }
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  draft.mixPreset === preset.id
                    ? "bg-[#9aa886] text-black"
                    : "bg-white/10 text-[#c1c1c3] hover:bg-white/20"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
        
        <div className="pt-1">
          <MixSlider
            mix={draft.mix}
            onChange={(nextMix) =>
              updateDraft((prev) => ({
                ...prev,
                mix: nextMix,
                mixPreset: "custom",
              }))
            }
            normalizeMixPercent={normalizeMixPercent}
          />
          <div className="mt-2 text-[10px] text-[#8b8b90] flex justify-between px-1">
            <span>{mixScaled.discover} tracks</span>
            <span>{mixScaled.mix} tracks</span>
            <span>{mixScaled.trending} tracks</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 rounded-lg border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-[0.3em] text-[#8b8b90] font-semibold">
            Focus Filters
          </div>
          <div className="flex items-center gap-2">
             <span className="text-xs text-[#c1c1c3]">Deep Dive</span>
             <PillToggle
                checked={draft.deepDive === true}
                onChange={(event) =>
                  updateDraft((prev) => ({
                    ...prev,
                    deepDive: event.target.checked,
                  }))
                }
              />
          </div>
        </div>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <label className="text-xs uppercase tracking-wider text-[#8b8b90] font-medium">
              Genre Tags
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                className={`${inputClassName} flex-1`}
                placeholder="lofi, indie"
                value={draft.includeTags}
                onChange={(event) =>
                  updateDraft((prev) => ({
                    ...prev,
                    includeTags: event.target.value,
                  }))
                }
              />
              <div className="flex bg-black/20 rounded p-1 gap-1 shrink-0">
                {focusOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() =>
                      updateDraft((prev) => ({
                        ...prev,
                        tagStrength: option.id,
                      }))
                    }
                    className={`px-3 py-1 rounded text-xs transition-colors ${
                      (draft.tagStrength ?? "medium") === option.id
                        ? "bg-[#9aa886] text-black font-medium"
                        : "text-[#8b8b90] hover:text-white"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-1.5">
            <label className="text-xs uppercase tracking-wider text-[#8b8b90] font-medium">
              Related Artists
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                className={`${inputClassName} flex-1`}
                placeholder="Artist A, Artist B"
                value={draft.includeRelatedArtists}
                onChange={(event) =>
                  updateDraft((prev) => ({
                    ...prev,
                    includeRelatedArtists: event.target.value,
                  }))
                }
              />
              <div className="flex bg-black/20 rounded p-1 gap-1 shrink-0">
                {focusOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() =>
                      updateDraft((prev) => ({
                        ...prev,
                        relatedStrength: option.id,
                      }))
                    }
                    className={`px-3 py-1 rounded text-xs transition-colors ${
                      (draft.relatedStrength ?? "medium") === option.id
                        ? "bg-[#9aa886] text-black font-medium"
                        : "text-[#8b8b90] hover:text-white"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-white/5 bg-white/5 p-4">
        <div className="text-xs uppercase tracking-[0.3em] text-[#8b8b90] mb-2 font-semibold">
          Summary
        </div>
        <div className="text-sm text-[#c1c1c3] leading-relaxed italic">
          &quot;{madlibsText}&quot;
        </div>
      </div>
      
      {errorMessage && <div className="text-xs text-red-400 font-medium">{errorMessage}</div>}
    </div>
  );
}

export function FlowPageHeader({ onNewFlow }) {
  return (
    <div className="flex flex-col gap-4 mb-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-start gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Flow</h1>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onNewFlow}
          className="btn btn-primary btn-sm flex items-center gap-2"
        >
          <FilePlus2 className="w-4 h-4" />
          New Flow
        </button>
      </div>
    </div>
  );
}

export function FlowStatusCards({
  status,
  enabledCount,
  flowCount,
  runningCount,
  completedCount,
}) {
  return (
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
              ? `Worker ${status?.worker?.processing ? "processing…" : "running"}`
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
            {enabledCount}/{flowCount} on
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[#c1c1c3]">
          <div className="rounded bg-white/5 px-2 py-1 flex items-center justify-between">
            <span>Total</span>
            <span className="text-white">{flowCount}</span>
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
              {Math.max(flowCount - runningCount - completedCount, 0)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FlowCard({
  flow,
  enabled,
  state,
  stats,
  nextRun,
  isEditing,
  simpleDraft,
  simpleRemaining,
  simpleError,
  isApplying,
  togglingId,
  deletingId,
  onToggleEditing,
  onToggleEnabled,
  onDelete,
  onCancel,
  onApply,
  onDraftChange,
  onClearError,
  mixPresets,
  focusOptions,
  normalizeMixPercent,
}) {
  return (
    <div className="bg-card rounded-lg border border-white/5 overflow-hidden">
      <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="min-w-0 flex-1 grid gap-1">
          <div className="flex items-center gap-3">
            <h3 className="text-base font-medium text-white truncate">
              {flow.name}
            </h3>
            {state === "running" && (
              <span className="badge badge-success badge-sm gap-1.5 pl-1.5 pr-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                Running
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#8b8b90]">
            <span>{flow.size} tracks</span>
            {flow.deepDive && (
              <>
                <span className="text-white/10">•</span>
                <span>Deep dive</span>
              </>
            )}
            {state === "running" && (
              <>
                <span className="text-white/10">•</span>
                <span className="text-[#9aa886]">
                  {stats.done + stats.failed}/{stats.total} processed
                </span>
              </>
            )}
            {state === "completed" && stats.total > 0 && (
              <>
                <span className="text-white/10">•</span>
                <span className="flex items-center gap-1.5 text-[#9aa886]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {stats.done} done
                  {stats.failed > 0 && `(${stats.failed} failed)`}
                </span>
              </>
            )}
            {enabled && nextRun && state !== "running" && (
              <>
                <span className="text-white/10">•</span>
                <span>Next: {nextRun}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1">
            {isEditing && (
              <button
                onClick={onDelete}
                className="btn btn-sm btn-ghost px-2 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                aria-label="Delete flow"
                disabled={deletingId === flow.id}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onToggleEditing}
              className="btn btn-secondary btn-sm px-2"
              aria-label={isEditing ? "Close editor" : "Edit flow"}
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
          
          <div className="w-px h-6 bg-white/10" />
          
          <div className="flex items-center gap-2">
            {togglingId === flow.id && (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-white/50" />
            )}
            <PillToggle
              checked={enabled}
              onChange={(event) => onToggleEnabled(event.target.checked)}
              disabled={togglingId === flow.id}
            />
          </div>
        </div>
      </div>

      {isEditing && (
        <div className="px-4 pb-4">
          <div className="card-separator mb-4" />
          <div className="grid gap-3">
            <FlowFormFields
              draft={simpleDraft}
              remaining={simpleRemaining}
              inputClassName="input bg-[#1f1f24]"
              errorMessage={simpleError}
              onDraftChange={onDraftChange}
              onClearError={onClearError}
              mixPresets={mixPresets}
              focusOptions={focusOptions}
              normalizeMixPercent={normalizeMixPercent}
            />
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button onClick={onCancel} className="btn btn-secondary btn-sm">
                Cancel
              </button>
              <button
                onClick={onApply}
                className="btn btn-primary btn-sm flex items-center gap-2"
                disabled={isApplying}
              >
                <Save className="w-4 h-4" />
                {isApplying ? "Applying..." : "Apply changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function FlowEmptyState({ onCreate, creating }) {
  return (
    <div className="p-4 bg-card rounded-lg border border-white/5 text-sm text-[#c1c1c3]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>No flows yet. Start with your first flow.</span>
        <button
          onClick={onCreate}
          className="btn btn-primary btn-sm flex items-center gap-2"
          disabled={creating}
        >
          <FilePlus2 className="w-4 h-4" />
          {creating ? "Creating..." : "Create First Flow"}
        </button>
      </div>
    </div>
  );
}

export function ConfirmDeleteModal({ confirmDelete, deletingId, onCancel, onConfirm }) {
  if (!confirmDelete) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.75)" }}
      onClick={onCancel}
    >
      <div className="card max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-xl font-bold mb-2 text-white">
          Delete {confirmDelete.title}?
        </h3>
        <p className="text-[#c1c1c3] mb-6">
          This removes the flow and its playlist setup. You can recreate it later.
        </p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="btn btn-primary"
            style={{ backgroundColor: "#ef4444" }}
            disabled={deletingId === confirmDelete.flowId}
          >
            {deletingId === confirmDelete.flowId ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmDisableModal({
  confirmDisable,
  togglingId,
  onCancel,
  onConfirm,
}) {
  if (!confirmDisable) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.75)" }}
      onClick={onCancel}
    >
      <div className="card max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-xl font-bold mb-2 text-white">
          Turn off {confirmDisable.title}?
        </h3>
        <p className="text-[#c1c1c3] mb-6">
          This pauses future runs. You can turn it back on anytime.
        </p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="btn btn-primary"
            style={{ backgroundColor: "#ef4444" }}
            disabled={togglingId === confirmDisable.flowId}
          >
            {togglingId === confirmDisable.flowId ? "Turning off..." : "Turn Off"}
          </button>
        </div>
      </div>
    </div>
  );
}
