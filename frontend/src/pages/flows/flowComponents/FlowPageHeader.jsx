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

export function FlowPageHeader({ onNewFlow }) {
  return (
    <div className="flow-page__page-header">
      <div className="flow-page__page-header-row">
        <h1 className="flow-page__page-title">Playlists</h1>
      </div>
      <div className="flow-page__header-actions">
        <button
          onClick={onNewFlow}
          className="btn btn-primary btn-sm"
        >
          <FilePlus2 className="artist-icon-sm" />
          New Flow
        </button>
      </div>
    </div>
  );
}
