import { useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { Loader2, Settings, Play, Pause } from "lucide-react";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import {
  updateFlowWorkerSettings,
  rotateFlowWorkerSoulseekCredentials,
  setPlaylistRetryCyclePaused,
  getFlowArtworkUrl,
} from "../utils/api";
import { useFlowStatus } from "./flows/useFlowStatus";
import {
  DEFAULT_WORKER_SETTINGS,
  getWorkerSettingsFromStatus,
  normalizeRetryCycleMinutes,
  normalizeExistingFileMode,
} from "./flows/flowWorkerSettings";
import {
  FlowStatusCards,
  FlowWorkerSettingsModal,
  PlaylistArtworkThumb,
} from "./FlowPageComponents";

function DownloadsQueueRow({
  entry,
  stats,
  artworkUrl,
  currentJob,
  retryCyclePaused,
  retryCycleScheduled,
  retryActionInFlight,
  onSetRetryCyclePaused,
}) {
  const pending = Number(stats?.pending || 0);
  const downloading = Number(stats?.downloading || 0);
  const done = Number(stats?.done || 0);
  const failed = Number(stats?.failed || 0);
  const total = Math.max(
    entry.kind === "flow"
      ? Number(entry.size || 0)
      : Number(entry.trackCount || 0),
    pending + downloading + done,
  );
  const progressPct =
    total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const isCurrentJob =
    currentJob?.playlistType === entry.id &&
    currentJob?.artistName &&
    currentJob?.trackName;
  const waitingForRetry =
    entry.kind === "shared" &&
    retryCycleScheduled === true &&
    pending === 0 &&
    downloading === 0 &&
    done < Number(entry.trackCount || 0);

  return (
    <div className="downloads-page__row">
      <PlaylistArtworkThumb
        artworkUrl={artworkUrl}
        name={entry.name}
        className="downloads-page__row-artwork"
      />
      <div className="downloads-page__row-body">
        <div className="downloads-page__row-header">
          <div>
            <span className="downloads-page__row-type">
              {entry.kind === "flow" ? "Flow" : "Playlist"}
            </span>
            <Link to="/flow" className="downloads-page__row-title">
              {entry.name}
            </Link>
          </div>
          {entry.kind === "shared" ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={retryActionInFlight}
              onClick={() => onSetRetryCyclePaused(entry.id, !retryCyclePaused)}
            >
              {retryActionInFlight ? (
                <Loader2 className="artist-icon-xs animate-spin" />
              ) : retryCyclePaused ? (
                <Play className="artist-icon-xs" />
              ) : (
                <Pause className="artist-icon-xs" />
              )}
              {retryCyclePaused ? "Resume retries" : "Pause retries"}
            </button>
          ) : null}
        </div>
        {isCurrentJob ? (
          <p className="downloads-page__row-status">
            Downloading {currentJob.trackName}
          </p>
        ) : null}
        {waitingForRetry ? (
          <p className="downloads-page__row-warning">
            Waiting for next retry cycle
          </p>
        ) : null}
        {total > 0 ? (
          <div className="flow-page__progress downloads-page__row-progress">
            <div className="flow-page__progress-bar">
              <div
                className="flow-page__progress-fill"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="downloads-page__row-stats">
              <span>{progressPct}%</span>
              <span>Pending {pending}</span>
              <span>Downloading {downloading}</span>
              <span>Done {done}</span>
              {failed > 0 ? <span>Stalled {failed}</span> : null}
            </div>
          </div>
        ) : (
          <p className="downloads-page__row-empty">No download activity yet</p>
        )}
      </div>
    </div>
  );
}

function DownloadsPage() {
  useDocumentTitle("Downloads");
  const { user } = useAuth();
  const { showSuccess, showError } = useToast();
  const {
    status,
    loading,
    fetchStatus,
    getPlaylistStats,
    sharedPlaylists,
    flows,
    enabledFlowCount,
    runningCount,
    completedCount,
  } = useFlowStatus();

  const [isWorkerSettingsOpen, setIsWorkerSettingsOpen] = useState(false);
  const [workerSettingsDraft, setWorkerSettingsDraft] = useState(
    DEFAULT_WORKER_SETTINGS,
  );
  const [workerSettingsBaseline, setWorkerSettingsBaseline] = useState(
    DEFAULT_WORKER_SETTINGS,
  );
  const [savingWorkerSettings, setSavingWorkerSettings] = useState(false);
  const [rotatingSoulseekCredential, setRotatingSoulseekCredential] =
    useState(false);
  const [retryActionPlaylistId, setRetryActionPlaylistId] = useState(null);

  const retryCyclePausedByPlaylist = status?.retryCyclePausedByPlaylist || {};
  const retryCycleScheduledByPlaylist =
    status?.retryCycleScheduledByPlaylist || {};

  const queueEntries = useMemo(() => {
    const shared = (sharedPlaylists || []).map((playlist) => ({
      ...playlist,
      kind: "shared",
    }));
    const generated = (flows || []).map((flow) => ({
      ...flow,
      kind: "flow",
    }));
    return [...shared, ...generated];
  }, [sharedPlaylists, flows]);

  const handleOpenWorkerSettings = () => {
    if (user?.role !== "admin") return;
    const current = getWorkerSettingsFromStatus(status);
    setWorkerSettingsBaseline(current);
    setWorkerSettingsDraft(current);
    setIsWorkerSettingsOpen(true);
  };

  const handleSaveWorkerSettings = async () => {
    const safeConcurrency = Math.min(
      3,
      Math.max(
        1,
        Math.floor(
          Number(workerSettingsDraft.concurrency) ||
            DEFAULT_WORKER_SETTINGS.concurrency,
        ),
      ),
    );
    const safePreferredFormat =
      workerSettingsDraft.preferredFormat === "mp3" ? "mp3" : "flac";
    const safePreferredFormatStrict =
      workerSettingsDraft.preferredFormatStrict === true;
    const safeRetryCycleMinutes = normalizeRetryCycleMinutes(
      workerSettingsDraft.retryCycleMinutes,
    );
    const safeExistingFileMode = normalizeExistingFileMode(
      workerSettingsDraft.existingFileMode,
    );
    const current = workerSettingsBaseline;
    const hasChanges =
      safeConcurrency !== current.concurrency ||
      safePreferredFormat !== current.preferredFormat ||
      safePreferredFormatStrict !== current.preferredFormatStrict ||
      safeRetryCycleMinutes !== current.retryCycleMinutes ||
      safeExistingFileMode !== current.existingFileMode;
    if (!hasChanges || savingWorkerSettings) return;
    setSavingWorkerSettings(true);
    try {
      await updateFlowWorkerSettings({
        concurrency: safeConcurrency,
        preferredFormat: safePreferredFormat,
        preferredFormatStrict: safePreferredFormatStrict,
        retryCycleMinutes: safeRetryCycleMinutes,
        existingFileMode: safeExistingFileMode,
      });
      setWorkerSettingsBaseline({
        concurrency: safeConcurrency,
        preferredFormat: safePreferredFormat,
        preferredFormatStrict: safePreferredFormatStrict,
        retryCycleMinutes: safeRetryCycleMinutes,
        existingFileMode: safeExistingFileMode,
      });
      showSuccess("Flow worker settings updated");
      setIsWorkerSettingsOpen(false);
      await fetchStatus();
    } catch (err) {
      showError(
        err.response?.data?.message ||
          err.response?.data?.error ||
          err.message ||
          "Failed to update flow worker settings",
      );
    } finally {
      setSavingWorkerSettings(false);
    }
  };

  const handleRotateSoulseekCredential = async () => {
    if (rotatingSoulseekCredential) return;
    setRotatingSoulseekCredential(true);
    try {
      const result = await rotateFlowWorkerSoulseekCredentials();
      showSuccess(
        result?.username
          ? `Rotated Soulseek account to ${result.username}`
          : "Rotated Soulseek credentials",
      );
      await fetchStatus();
    } catch (err) {
      showError(
        err.response?.data?.message ||
          err.response?.data?.error ||
          err.message ||
          "Failed to rotate Soulseek credentials",
      );
    } finally {
      setRotatingSoulseekCredential(false);
    }
  };

  const handleSetRetryCyclePaused = useCallback(
    async (playlistId, paused) => {
      if (!playlistId || retryActionPlaylistId) return;
      setRetryActionPlaylistId(playlistId);
      try {
        await setPlaylistRetryCyclePaused(playlistId, paused);
        showSuccess(paused ? "Retry cycle paused" : "Retry cycle resumed");
        await fetchStatus();
      } catch (err) {
        showError(
          err.response?.data?.message ||
            err.message ||
            "Failed to update retry cycle state",
        );
      } finally {
        setRetryActionPlaylistId(null);
      }
    },
    [retryActionPlaylistId, fetchStatus, showSuccess, showError],
  );

  const currentWorkerSettings = workerSettingsBaseline;
  const hasWorkerSettingsChanges =
    Number(workerSettingsDraft.concurrency) !==
      currentWorkerSettings.concurrency ||
    (workerSettingsDraft.preferredFormat === "mp3" ? "mp3" : "flac") !==
      currentWorkerSettings.preferredFormat ||
    (workerSettingsDraft.preferredFormatStrict === true) !==
      currentWorkerSettings.preferredFormatStrict ||
    normalizeRetryCycleMinutes(workerSettingsDraft.retryCycleMinutes) !==
      currentWorkerSettings.retryCycleMinutes ||
    normalizeExistingFileMode(workerSettingsDraft.existingFileMode) !==
      currentWorkerSettings.existingFileMode;

  if (loading && !status) {
    return (
      <div className="downloads-page__loading">
        <Loader2 className="artist-spinner artist-spinner--large" />
      </div>
    );
  }

  return (
    <div className="downloads-page">
      <div className="downloads-page__header">
        <div>
          <h1 className="downloads-page__title">Downloads</h1>
          <p className="downloads-page__subtitle">
            Worker queue, download progress, and retry orchestration for your
            playlists and flows.
          </p>
        </div>
        {user?.role === "admin" ? (
          <button
            type="button"
            onClick={handleOpenWorkerSettings}
            className="btn btn-secondary btn-sm"
          >
            <Settings className="artist-icon-xs" />
            Worker settings
          </button>
        ) : null}
      </div>

      <FlowStatusCards
        status={status}
        enabledCount={enabledFlowCount}
        flowCount={flows.length}
        runningCount={runningCount}
        completedCount={completedCount}
      />

      <section className="downloads-page__section">
        <h2 className="downloads-page__section-title">Queue by playlist</h2>
        {queueEntries.length === 0 ? (
          <div className="artist-empty-panel">
            <p className="artist-empty-message">
              No playlists or flows yet. Create them on the Flow page.
            </p>
          </div>
        ) : (
          <div className="downloads-page__list">
            {queueEntries.map((entry) => (
              <DownloadsQueueRow
                key={entry.id}
                entry={entry}
                stats={getPlaylistStats(entry.id)}
                artworkUrl={getFlowArtworkUrl(entry.id)}
                currentJob={status?.worker?.currentJob}
                retryCyclePaused={
                  retryCyclePausedByPlaylist[entry.id] === true
                }
                retryCycleScheduled={
                  retryCycleScheduledByPlaylist[entry.id] === true
                }
                retryActionInFlight={retryActionPlaylistId === entry.id}
                onSetRetryCyclePaused={(paused) =>
                  handleSetRetryCyclePaused(entry.id, paused)
                }
              />
            ))}
          </div>
        )}
      </section>

      {user?.role === "admin" && (
        <FlowWorkerSettingsModal
          isOpen={isWorkerSettingsOpen}
          settings={workerSettingsDraft}
          soulseekCredential={status?.soulseek?.credential || null}
          hasChanges={hasWorkerSettingsChanges}
          saving={savingWorkerSettings}
          rotatingSoulseekCredential={rotatingSoulseekCredential}
          onCancel={() => {
            if (savingWorkerSettings || rotatingSoulseekCredential) return;
            setIsWorkerSettingsOpen(false);
          }}
          onChange={setWorkerSettingsDraft}
          onRotateSoulseekCredential={handleRotateSoulseekCredential}
          onSave={handleSaveWorkerSettings}
        />
      )}
    </div>
  );
}

export default DownloadsPage;
