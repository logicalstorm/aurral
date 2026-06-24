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

export function ConfirmDisableModal({
  confirmDisable,
  togglingId,
  onCancel,
  onConfirm,
}) {
  if (!confirmDisable) return null;

  return (
    <div className="artist-modal-backdrop" onClick={onCancel}>
      <div className="artist-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="artist-modal__title">
          Turn off {confirmDisable.title}?
        </h3>
        <p className="artist-modal__subcopy">
          This pauses future runs. You can turn it back on anytime.
        </p>
        <div className="artist-modal__actions">
          <button onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="btn btn-secondary flow-page__btn--destructive"
            disabled={togglingId === confirmDisable.flowId}
          >
            {togglingId === confirmDisable.flowId ? "Turning off..." : "Turn Off"}
          </button>
        </div>
      </div>
    </div>
  );
}
