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

export function FlowImportReviewModal({
  importReview,
  importing,
  onNameChange,
  onCancel,
  onConfirm,
}) {
  if (!importReview) return null;

  const flows = Array.isArray(importReview.flows) ? importReview.flows : [];

  return (
    <div
      className="artist-modal-backdrop"
      onClick={importing ? undefined : onCancel}
    >
      <div
        className="flow-page__import-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flow-page__import-modal-header">
          <div className="flow-page__import-modal-header-row">
            <div>
              <div className="flow-page__import-modal-eyebrow">
                Import Playlist
              </div>
              <h3 className="flow-page__import-modal-title">
                {importReview.fileName || "Selected playlist file"}
              </h3>
              <p className="flow-page__import-modal-copy">
                {flows.length} {flows.length === 1 ? "playlist" : "playlists"} detected. Imports stay separate from weekly flows and queue their own downloads.
              </p>
            </div>
            <div className="flow-page__import-modal-badge">
              JSON import
            </div>
          </div>
        </div>

        <div className="flow-page__import-modal-body">
          <div className="flow-page__import-list">
            {flows.map((flow, index) => {
              const trackCount = Number(flow?.tracks?.length || flow?.trackCount || 0);
              const previewTracks = Array.isArray(flow?.tracks) ? flow.tracks.slice(0, 3) : [];
              return (
                <div
                  key={`${flow?.name || "flow"}-${index}`}
                  className="flow-page__import-item"
                >
                  <div className="flow-page__import-item-header">
                    <h4 className="flow-page__import-item-title">
                      {flow?.name || `Playlist ${index + 1}`}
                    </h4>
                    <span className="flow-page__badge flow-page__badge--count">
                      {trackCount} tracks
                    </span>
                    {flow?.sourceName ? (
                      <span className="flow-page__badge flow-page__badge--type">
                        From {flow.sourceName}
                      </span>
                    ) : null}
                  </div>
                  <div className="flow-page__field">
                    <label className="flow-page__field-label">
                      Playlist Name
                    </label>
                    <input
                      type="text"
                      value={flow?.importName ?? flow?.name ?? ""}
                      onChange={(event) => onNameChange?.(index, event.target.value)}
                      placeholder={`Playlist ${index + 1}`}
                      disabled={importing}
                      className="input flow-page__field-input"
                    />
                  </div>
                  <div className="flow-page__import-preview">
                    {previewTracks.map((track) => (
                      <span key={`${track.artistName}-${track.trackName}`}>
                        {track.artistName} — {track.trackName}
                      </span>
                    ))}
                    {trackCount > previewTracks.length ? (
                      <span className="flow-page__import-preview-more">
                        +{trackCount - previewTracks.length} more tracks
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flow-page__import-modal-footer">
          <p className="flow-page__import-modal-hint">
            Supports exported playlist files, a single playlist object, or a raw array of tracks. Imported playlists stay separate from weekly flow refreshes.
          </p>
          <div className="flow-page__import-modal-actions">
            <button
              type="button"
              onClick={onCancel}
              className="btn btn-secondary"
              disabled={importing}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="btn btn-primary"
              disabled={importing || flows.length === 0}
            >
              {importing ? (
                <>
                  <Loader2 className="artist-icon-sm animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="artist-icon-sm" />
                  Import Playlists
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
