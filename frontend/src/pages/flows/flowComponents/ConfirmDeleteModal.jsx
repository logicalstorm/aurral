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

export function ConfirmDeleteModal({ confirmDelete, deletingId, onCancel, onConfirm }) {
  if (!confirmDelete) return null;
  const isShared = confirmDelete.kind === "shared";

  return (
    <div className="artist-modal-backdrop" onClick={onCancel}>
      <div className="artist-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="artist-modal__title">
          Delete {confirmDelete.title}?
        </h3>
        <p className="artist-modal__subcopy">
          {isShared
            ? "This removes the imported static playlist and any downloaded files tied to it."
            : "This removes the flow and its playlist setup. You can recreate it later."}
        </p>
        <div className="artist-modal__actions">
          <button onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="btn btn-secondary flow-page__btn--destructive"
            disabled={deletingId === confirmDelete.flowId}
          >
            {deletingId === confirmDelete.flowId ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
