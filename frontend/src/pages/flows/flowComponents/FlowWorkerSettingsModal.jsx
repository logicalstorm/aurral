import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  Loader2,
  Check,
  Trash2,
  Pencil,
  FilePlus2,
  Download,
  Upload,
  Play,
  Pause,
  Sparkles,
  Plus,
  Search,
  ChevronDown,
  MoreHorizontal,
  Save,
  X,
} from "lucide-react";
import { formatFlowLastRun } from "../flowStats";
import { Link } from "react-router-dom";
import PillToggle from "../../../components/PillToggle";
import { useAudioQueue } from "../../../hooks/useAudioQueue";
import { normalizeFlowTrack } from "../../../utils/audioQueue";
import { getTagSuggestions, searchUnified } from "../../../utils/api";
import { TAG_COLORS } from "../../ArtistDetails/constants";
import { getTagColor } from "../../ArtistDetails/utils";

export function FlowWorkerSettingsModal({
  isOpen,
  settings,
  hasChanges,
  saving,
  onCancel,
  onChange,
  onSave,
}) {
  if (!isOpen) return null;

  return (
    <div className="artist-modal-backdrop" onClick={onCancel}>
      <div
        className="settings-page__modal settings-page__modal--wide flow-page__worker-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-labelledby="worker-settings-title"
        aria-modal="true"
      >
        <div className="settings-page__modal-header settings-page__modal-header--spaced">
          <h3 id="worker-settings-title" className="settings-page__modal-title">
            Worker Settings
          </h3>
        </div>

        <div className="flow-page__worker-fields">
          <div className="flow-page__worker-fields-split">
            <div className="flow-page__field">
              <label className="flow-page__field-label">
                Download Concurrency
              </label>
              <div
                className="artist-segmented flow-page__worker-segmented"
                role="radiogroup"
                aria-label="Download concurrency"
              >
                {FLOW_WORKER_CONCURRENCY_OPTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={settings.concurrency === value}
                    className={`artist-segmented-button${settings.concurrency === value ? " is-active" : ""}`}
                    onClick={() =>
                      onChange((prev) => ({ ...prev, concurrency: value }))
                    }
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>

            <div className="flow-page__field">
              <label className="flow-page__field-label">Retry Cycle</label>
              <div className="artist-modal-field aurral-radius-round">
                <select
                  value={settings.retryCycleMinutes}
                  onChange={(event) =>
                    onChange((prev) => ({
                      ...prev,
                      retryCycleMinutes: Number(event.target.value),
                    }))
                  }
                  className="artist-modal-select"
                >
                  {FLOW_WORKER_RETRY_CYCLE_OPTIONS.map((option) => (
                    <option key={option.minutes} value={option.minutes}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="flow-page__field">
            <label className="flow-page__field-label">Existing Files</label>
            <div className="artist-modal-field aurral-radius-round">
              <select
                value={settings.existingFileMode || "reuse"}
                onChange={(event) =>
                  onChange((prev) => ({
                    ...prev,
                    existingFileMode: event.target.value,
                  }))
                }
                className="artist-modal-select"
                title="How generated playlists reuse existing Aurral or Lidarr files"
              >
                {FLOW_WORKER_EXISTING_FILE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="settings-page__modal-actions">
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-secondary"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="btn btn-primary"
            disabled={!hasChanges || saving}
          >
            {saving ? (
              <Loader2 className="artist-icon-xs animate-spin" />
            ) : (
              <Save className="artist-icon-xs" />
            )}
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
