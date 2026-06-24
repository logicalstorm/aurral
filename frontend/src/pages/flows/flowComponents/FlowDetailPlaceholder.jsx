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

export function FlowDetailPlaceholder() {
  return (
    <div className="flow-page__detail-placeholder">
      <div className="flow-page__detail-placeholder__icon" aria-hidden="true">
        <ListMusic className="artist-icon-lg" />
      </div>
      <p className="flow-page__detail-placeholder__message">
        Select a playlist or flow to view tracks and settings.
      </p>
    </div>
  );
}
