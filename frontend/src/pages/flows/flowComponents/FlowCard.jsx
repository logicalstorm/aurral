import { Loader2, Check, Pencil, FilePlus2, Download, Play, Trash2, X, ListMusic } from "lucide-react";
import { formatFlowLastRun } from "../flowStats";
import PillToggle from "../../../components/PillToggle";
import FlipSaveButton from "../../../components/FlipSaveButton";
import { MoreMenu } from "./MoreMenu";
import { PlaylistArtworkThumb } from "./PlaylistArtworkThumb";
import { FlowFormFields } from "./flowFormComponents";
import { FlowTracksPanel } from "./flowTrackComponents";
import { getFocusDraftValidation, SOURCE_MIX_OPTIONS } from "./MixSlider";

export function FlowCard({
  flow,
  isAdminView = false,
  artworkUrl,
  enabled,
  state,
  stats,
  currentJob,
  statusHint,
  operationQueue,
  nextRun,
  isEditing,
  isNameEditing,
  isNameDirty,
  isNameApplying,
  isTracksOpen,
  tracks,
  tracksLoading,
  tracksError,
  simpleDraft,
  simpleRemaining,
  simpleError,
  isApplying,
  hasChanges,
  canExport,
  canConvertToStatic,
  convertingId,
  togglingId,
  rerunningId,
  deletingId,
  onRunNow,
  onExport,
  onConvertToStatic,
  onToggleNameEditing,
  onToggleEditing,
  onToggleEnabled,
  onDelete,
  onViewTracks,
  onAddTrackToPlaylist,
  onNavigateArtist,
  onNameCancel,
  onNameApply,
  onCancel,
  onApply,
  onDraftChange,
  onClearError,
  normalizeMixPercent,
  disabledSources = {},
}) {
  const { focusValidationError } = getFocusDraftValidation(
    simpleDraft,
    normalizeMixPercent,
  );
  const sourceValidationError = SOURCE_MIX_OPTIONS.find(
    (option) =>
      Number(normalizeMixPercent(simpleDraft?.mix)?.[option.key] || 0) > 0 &&
      disabledSources?.[option.key],
  )?.key;
  const saveDisabled =
    !hasChanges || Boolean(focusValidationError) || Boolean(sourceValidationError);
  const showSavedState = !hasChanges;
  const processed = Number(stats?.done || 0);
  const total = Number(stats?.total || 0);
  const processedDisplay = total > 0 ? Math.min(processed, total) : processed;
  const progressPct = total > 0 ? Math.min(100, Math.round((processedDisplay / total) * 100)) : 0;
  const isCurrentJobForFlow =
    currentJob?.playlistType === flow.id &&
    currentJob?.artistName &&
    currentJob?.trackName;
  const jobProgressPct = Math.max(
    0,
    Math.min(100, Math.round(Number(currentJob?.progressPct || 0))),
  );
  const hintPhase = String(statusHint?.phase || "").trim();
  const hintMessage = String(statusHint?.message || "").trim();
  const queueProcessing = operationQueue?.processing === true;
  const queueLabel = String(operationQueue?.currentLabel || "").trim();
  const queueAction = queueLabel.includes(":")
    ? queueLabel.slice(0, queueLabel.indexOf(":"))
    : queueLabel;
  const queueFlowId = queueLabel.includes(":")
    ? queueLabel.slice(queueLabel.indexOf(":") + 1)
    : "";
  const queueTargetsThisFlow = queueFlowId === flow.id;
  const isGeneratingThisFlow =
    enabled &&
    queueProcessing &&
    (queueAction === "enable" || queueAction === "scheduled") &&
    queueTargetsThisFlow;
  const isQueueCleanupThisFlow =
    enabled &&
    queueProcessing &&
    (queueAction === "disable" || queueAction === "delete" || queueAction === "reset") &&
    queueTargetsThisFlow;
  const pendingCount = Number(stats?.pending || 0);
  const downloadingCount = Number(stats?.downloading || 0);
  const isQueued =
    enabled &&
    pendingCount > 0 &&
    !isCurrentJobForFlow &&
    hintPhase === "downloading";
  const hasFlowWorkInProgress =
    pendingCount > 0 ||
    downloadingCount > 0 ||
    isCurrentJobForFlow ||
    isGeneratingThisFlow ||
    isQueueCleanupThisFlow;
  const isRerunningThisFlow = rerunningId === flow.id;
  const canRunNow = enabled && !hasFlowWorkInProgress && !isRerunningThisFlow;
  let flowWorkerMessage = "";
  if (isCurrentJobForFlow) {
    flowWorkerMessage = `Download: ${currentJob.trackName} (${jobProgressPct}%)`;
  } else if (isGeneratingThisFlow) {
    flowWorkerMessage = "Generating playlist";
  } else if (isQueueCleanupThisFlow) {
    flowWorkerMessage = "Cleaning flow files";
  } else if (isQueued) {
    flowWorkerMessage = "Queued";
  } else if (enabled && queueProcessing && pendingCount > 0) {
    flowWorkerMessage = "Queued";
  } else if (enabled && hintPhase === "queued" && pendingCount > 0) {
    flowWorkerMessage = "Tracks queued and waiting";
  } else if (
    enabled &&
    hintMessage &&
    (!queueProcessing || queueTargetsThisFlow) &&
    (hintPhase !== "queued" || hasFlowWorkInProgress) &&
    hintPhase !== "downloading" &&
    hintPhase !== "completed"
  ) {
    flowWorkerMessage = hintMessage;
  }
  const metaItems = [];
  const lastRun = formatFlowLastRun(flow?.lastRunAt);
  if (lastRun) {
    metaItems.push(`Last run ${lastRun}`);
  }
  if (enabled && nextRun && state !== "running" && !isGeneratingThisFlow) {
    metaItems.push(
      nextRun === "soon" ? "Next update soon" : `Next update in ${nextRun}`,
    );
  }
  const typeLabel = enabled ? "Flow" : "Flow draft";
  const statusSummary = enabled ? "" : "Flow ready when enabled";
  const ownerLabel = isAdminView && flow?.ownerUsername
    ? `Owner: ${flow.ownerUsername}`
    : null;

  const handleMobileTrackToggle = () => {
    onViewTracks?.();
  };

  return (
    <div className="flow-page__card">
      <div className="flow-page__card-body">
        <div
          className="flow-page__card-main"
          onClick={handleMobileTrackToggle}
        >
          <div className={enabled ? "" : "flow-page__card--dimmed"}>
            <PlaylistArtworkThumb artworkUrl={artworkUrl} name={flow.name} />
          </div>
          <div className="flow-page__card-content">
            <div className="flow-page__card-top">
              <div className={enabled ? "" : "flow-page__card--dimmed"}>
                <div className="flow-page__card-badges">
                  <span className="flow-page__badge flow-page__badge--type">
                    {typeLabel}
                  </span>
                  <span className="flow-page__badge flow-page__badge--count">
                    {flow.size} tracks
                  </span>
                  {ownerLabel ? (
                    <span className="flow-page__badge flow-page__badge--owner">
                      {ownerLabel}
                    </span>
                  ) : null}
                  {state === "running" && (
                    <span className="badge badge-success flow-page__status-badge">
                      <Loader2 className="artist-icon-xs animate-spin" />
                      Running
                    </span>
                  )}
                  {togglingId === flow.id && (
                    <span className="badge badge-secondary flow-page__status-badge">
                      <Loader2 className="artist-icon-xs animate-spin" />
                      Updating
                    </span>
                  )}
                </div>
              </div>
              <div className="flow-page__card-actions">
                <button
                  onClick={onViewTracks}
                  className={`btn btn--hide-mobile btn-sm btn--toolbar ${isTracksOpen ? "btn-neutral-active" : "btn-secondary"}`}
                  aria-label={isTracksOpen ? `Close ${flow.name} tracks` : `View ${flow.name} tracks`}
                  title={isTracksOpen ? `Close ${flow.name} tracks` : `View ${flow.name} tracks`}
                  aria-pressed={isTracksOpen}
                  disabled={!enabled && !isTracksOpen}
                >
                  <ListMusic className="artist-icon-sm" />
                  <span className="flow-page__btn-label--md">Tracks</span>
                </button>
                <button
                  onClick={onToggleEditing}
                  className={`btn btn--hide-mobile btn-sm btn--toolbar ${isEditing ? "btn-neutral-active" : "btn-secondary"}`}
                  aria-label={isEditing ? "Close editor" : "Edit flow"}
                  title={isEditing ? `Close ${flow.name} editor` : `Edit ${flow.name}`}
                  aria-pressed={isEditing}
                >
                  <Pencil className="artist-icon-sm" />
                  <span className="flow-page__btn-label--md">Manage</span>
                </button>
                <MoreMenu activeButtonClass="btn-neutral-active">
                  <button
                    onClick={onViewTracks}
                    className="artist-menu-item flow-page__menu-item--mobile-only"
                    aria-pressed={isTracksOpen}
                    disabled={!enabled && !isTracksOpen}
                  >
                    <span className="artist-menu-item__main">
                      <ListMusic className="artist-icon-sm" />
                      {isTracksOpen ? "Hide Tracks" : "View Tracks"}
                    </span>
                  </button>
                  <button
                    onClick={onToggleEditing}
                    className="artist-menu-item flow-page__menu-item--mobile-only"
                    aria-pressed={isEditing}
                  >
                    <span className="artist-menu-item__main">
                      <Pencil className="artist-icon-sm" />
                      {isEditing ? "Close Manage View" : "Manage Flow"}
                    </span>
                  </button>
                  {isNameEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={isNameDirty ? onNameApply : onNameCancel}
                        className="artist-menu-item flow-page__menu-item--mobile-only"
                        disabled={isNameApplying}
                      >
                        <span className="artist-menu-item__main">
                          {isNameApplying ? (
                            <Loader2 className="artist-icon-sm animate-spin" />
                          ) : (
                            <Check className="artist-icon-sm" />
                          )}
                          Save Title
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={onNameCancel}
                        className="artist-menu-item flow-page__menu-item--mobile-only"
                        disabled={isNameApplying}
                      >
                        <span className="artist-menu-item__main">
                          <X className="artist-icon-sm" />
                          Cancel Rename
                        </span>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={onToggleNameEditing}
                      className="artist-menu-item flow-page__menu-item--mobile-only"
                    >
                      <span className="artist-menu-item__main">
                        <Pencil className="artist-icon-sm" />
                        Rename Title
                      </span>
                    </button>
                  )}
                  <div className="flow-page__menu-divider flow-page__menu-divider--mobile-only" />
                  <button
                    onClick={onRunNow}
                    className="artist-menu-item"
                    disabled={!canRunNow}
                  >
                    <span className="artist-menu-item__main">
                      {isRerunningThisFlow ? (
                        <Loader2 className="artist-icon-sm animate-spin" />
                      ) : (
                        <Play className="artist-icon-sm" />
                      )}
                      Run Now
                    </span>
                  </button>
                  <button
                    onClick={onConvertToStatic}
                    className="artist-menu-item"
                    disabled={!canConvertToStatic || convertingId === flow.id}
                  >
                    <span className="artist-menu-item__main">
                      {convertingId === flow.id ? <Loader2 className="artist-icon-sm animate-spin" /> : <FilePlus2 className="artist-icon-sm" />}
                      Convert to Static
                    </span>
                  </button>
                  <button
                    onClick={onExport}
                    className="artist-menu-item"
                    disabled={!canExport}
                  >
                    <span className="artist-menu-item__main">
                      <Download className="artist-icon-sm" />
                      Download JSON
                    </span>
                  </button>
                  <div className="flow-page__menu-divider" />
                  <button
                    onClick={onDelete}
                    className="artist-menu-item artist-menu-item--danger"
                    disabled={deletingId === flow.id}
                  >
                    <span className="artist-menu-item__main">
                      {deletingId === flow.id ? <Loader2 className="artist-icon-sm animate-spin" /> : <Trash2 className="artist-icon-sm" />}
                      Delete Flow
                    </span>
                  </button>
                </MoreMenu>
                <div className="flow-page__toggle-wrap">
                  {togglingId === flow.id && (
                    <Loader2 className="artist-icon-xs animate-spin flow-page__toggle-spinner" />
                  )}
                  <PillToggle
                    checked={enabled}
                    className={`pill-toggle--flow-compact${enabled ? "" : " is-off"}`}
                    onChange={(event) => onToggleEnabled(event.target.checked)}
                    disabled={togglingId === flow.id}
                  />
                </div>
              </div>
            </div>
            <div className="flow-page__card-title-row">
              <div className={enabled ? "" : "flow-page__card--dimmed"}>
                <div className="flow-page__card-title-row">
                  {isNameEditing ? (
                    <input
                      type="text"
                      className="input input-sm flow-page__card-title-input"
                      value={simpleDraft?.name ?? ""}
                      onChange={(event) =>
                        onDraftChange((prev) => ({
                          ...prev,
                          name: event.target.value,
                        }))
                      }
                      onInput={onClearError}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          if (isNameDirty) {
                            onNameApply();
                            return;
                          }
                          onNameCancel();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          onNameCancel();
                        }
                      }}
                      aria-label={`Edit ${flow.name} name`}
                    />
                  ) : (
                    <h3 className="flow-page__card-title">
                      {flow.name}
                    </h3>
                  )}
                  <div className="flow-page__card-title-actions">
                    <button
                      type="button"
                      onClick={
                        isNameEditing
                          ? (isNameDirty ? onNameApply : onNameCancel)
                          : onToggleNameEditing
                      }
                      className={`btn ${isNameEditing ? "btn-primary" : "btn-ghost"} btn-xs`}
                      aria-label={isNameEditing ? `Save ${flow.name}` : `Edit ${flow.name}`}
                      title={isNameEditing ? `Save ${flow.name}` : `Edit ${flow.name}`}
                      disabled={isNameApplying}
                    >
                      {isNameApplying ? (
                        <Loader2 className="artist-icon-xs animate-spin" />
                      ) : isNameEditing ? (
                        <Check className="artist-icon-xs" />
                      ) : (
                        <Pencil className="artist-icon-xs" />
                      )}
                    </button>
                    {isNameEditing ? (
                      <button
                        type="button"
                        onClick={onNameCancel}
                        className="btn btn-ghost btn-xs"
                        aria-label={`Cancel editing ${flow.name}`}
                        title={`Cancel editing ${flow.name}`}
                        disabled={isNameApplying}
                      >
                        <X className="artist-icon-xs" />
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="flow-page__card-meta">
                  {statusSummary ? <span>{statusSummary}</span> : null}
                  {statusSummary && metaItems.length > 0 ? (
                    <span className="flow-page__card-meta-dot">•</span>
                  ) : null}
                  {metaItems.length > 0 ? <span>{metaItems.join(" • ")}</span> : null}
                </div>
              </div>
            </div>
              {flowWorkerMessage ? (
              <div className={`flow-page__card-status flow-page__card-hint--desktop${enabled ? "" : " flow-page__card--dimmed"}`}>
                {flowWorkerMessage}
              </div>
            ) : null}
            <div className={`flow-page__card-hint flow-page__card-hint--mobile${enabled ? "" : " flow-page__card--dimmed"}`}>
              {isTracksOpen ? "Tap card to hide tracks" : "Tap card to view tracks"}
            </div>
            {(state === "running" || state === "completed") && total > 0 ? (
              <div className={`flow-page__progress${enabled ? "" : " flow-page__card--dimmed"}`}>
                <div className="flow-page__progress-bar">
                  <div
                    className={`flow-page__progress-fill${state === "completed" ? " flow-page__progress-fill--completed" : ""}`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className="flow-page__progress-stats-mobile">{progressPct}% complete</div>
                <div className="flow-page__progress-stats">
                  <span>{progressPct}% complete</span>
                  <span className="flow-page__card-meta-dot">•</span>
                  <span>Pending {pendingCount}</span>
                  <span className="flow-page__card-meta-dot">•</span>
                  <span>Downloading {downloadingCount}</span>
                  <span className="flow-page__card-meta-dot">•</span>
                  <span>Done {processedDisplay}</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {isEditing && (
        <div className="flow-page__card-expanded">
          <div className="flow-page__card-expanded-separator" />
          <div className="flow-page__form">
            <FlowFormFields
              draft={simpleDraft}
              remaining={simpleRemaining}
              inputClassName="flow-page__field-control"
              errorMessage={simpleError}
              onDraftChange={onDraftChange}
              onClearError={onClearError}
              normalizeMixPercent={normalizeMixPercent}
              disabledSources={disabledSources}
            />
            <div className="flow-page__card-footer-actions">
              <button onClick={onCancel} className="btn btn-secondary btn-sm">
                Cancel
              </button>
              <FlipSaveButton
                disabled={saveDisabled}
                saving={isApplying}
                onClick={onApply}
                label="Save"
                savedLabel="Saved"
                showSavedState={showSavedState}
              />
            </div>
          </div>
        </div>
      )}

      {isTracksOpen && (
        <div className="flow-page__card-expanded">
          <div className="flow-page__card-expanded-separator" />
          <FlowTracksPanel
            tracks={tracks}
            loading={tracksLoading}
            error={tracksError}
            onAddTrackToPlaylist={onAddTrackToPlaylist}
            onNavigateArtist={onNavigateArtist}
          />
        </div>
      )}
    </div>
  );
}
