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

export function PlaylistArtworkThumb({
  artworkUrl,
  name,
  className = "",
  onClick,
}) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [artworkUrl]);

  const fallbackLabel = String(name || "?").trim().charAt(0).toUpperCase() || "?";
  const classes = `flow-page__artwork${onClick ? " flow-page__artwork--interactive" : ""}${className ? ` ${className}` : ""}`;
  const content =
    !imageFailed && artworkUrl ? (
      <img
        src={artworkUrl}
        alt={`${name} cover`}
        loading="lazy"
        onError={() => setImageFailed(true)}
      />
    ) : (
      <div className="flow-page__artwork-fallback">{fallbackLabel}</div>
    );

  if (onClick) {
    return (
      <button
        type="button"
        className={classes}
        onClick={onClick}
        aria-label={`Edit ${name} cover`}
      >
        {content}
      </button>
    );
  }

  return <div className={classes}>{content}</div>;
}
