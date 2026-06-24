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

export function MoreMenu({ children, activeButtonClass = "btn-primary" }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div className={`flow-page__menu-wrap${isOpen ? " is-open" : ""}`} ref={menuRef}>
      <button 
        type="button" 
        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }} 
        className={`btn btn-sm btn--toolbar ${isOpen ? activeButtonClass : "btn-secondary"}`}
        aria-label="More options"
      >
        <MoreHorizontal className="artist-icon-sm" />
        <span className="flow-page__btn-label--wide">More</span>
      </button>
      {isOpen && (
        <>
          <button
            type="button"
            className="artist-backdrop-button"
            onClick={() => setIsOpen(false)}
            aria-label="Close menu"
          />
          <div
            className="artist-dropdown artist-dropdown--right"
            onClick={() => setIsOpen(false)}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function getTrackStatusMeta(status) {
  switch (String(status || "").toLowerCase()) {
    case "done":
      return { label: "Downloaded", className: "flow-page__track-status-dot--done" };
    case "downloading":
      return {
        label: "Downloading",
        className: "flow-page__track-status-dot--downloading",
      };
    case "failed":
      return { label: "Failed", className: "flow-page__track-status-dot--failed" };
    case "pending":
    default:
      return { label: "Queued", className: "flow-page__track-status-dot--pending" };
  }
}
