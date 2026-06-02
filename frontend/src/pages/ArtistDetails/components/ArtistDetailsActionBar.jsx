import { useState } from "react";
import PropTypes from "prop-types";
import {
  Ban,
  CheckCircle,
  ChevronDown,
  Loader,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import AddToLibraryButton from "../../../components/AddToLibraryButton";

const MONITOR_OPTIONS = [
  { value: "none", label: "None (Artist Only)" },
  { value: "existing", label: "Existing Albums" },
  { value: "all", label: "All Albums" },
  { value: "future", label: "Future Albums" },
  { value: "missing", label: "Missing Albums" },
  { value: "latest", label: "Latest Album" },
  { value: "first", label: "First Album" },
];

export function ArtistDetailsActionBar({
  existsInLibrary,
  loadingLibrary,
  showRemoveDropdown,
  setShowRemoveDropdown,
  showMonitorOptionMenu,
  setShowMonitorOptionMenu,
  updatingMonitor,
  canChangeMonitoring,
  getCurrentMonitorOption,
  handleUpdateMonitorOption,
  canDeleteArtist,
  handleDeleteClick,
  canAddArtist,
  handleAddToLibrary,
  handleOpenAddCustomizeModal,
  addingToLibrary,
  canRefreshArtist,
  handleRefreshArtist,
  refreshingArtist,
  previewTracks,
  loadingPreview,
  playingPreviewId,
  previewSnappingBack,
  handlePreviewPlay,
  onEditIds,
  onToggleBlockArtist,
  blockingArtist,
  artistBlocked,
}) {
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const firstPreview = previewTracks?.find((track) => track?.preview_url);
  const isPreviewPlaying =
    firstPreview && playingPreviewId === firstPreview.id && !previewSnappingBack;

  const renderLibraryAction = () => {
    if (loadingLibrary) {
      return (
        <div className="inline-flex h-10 items-center gap-2 bg-white/[0.06] px-4 text-sm font-semibold text-white/75">
          <Loader className="h-4 w-4 animate-spin" />
          {existsInLibrary ? "Loading library" : "Checking Lidarr"}
        </div>
      );
    }

    if (existsInLibrary) {
      return (
        <div className="relative inline-flex">
          <button
            type="button"
            onClick={() => setShowRemoveDropdown(!showRemoveDropdown)}
            className="inline-flex h-10 items-center gap-2 bg-green-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-green-500"
          >
            <CheckCircle className="h-4 w-4" />
            In Library
            {(canChangeMonitoring || canDeleteArtist) && (
              <ChevronDown
                className={`h-4 w-4 transition-transform ${
                  showRemoveDropdown ? "rotate-180" : ""
                }`}
              />
            )}
          </button>
          {showRemoveDropdown && (canChangeMonitoring || canDeleteArtist) && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-20 cursor-default"
                onClick={() => setShowRemoveDropdown(false)}
                aria-label="Close library actions"
              />
              <div className="absolute left-0 top-full z-30 mt-2 w-60 border border-white/10 bg-[#18181c] py-1 shadow-2xl">
                {canChangeMonitoring && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setShowMonitorOptionMenu(!showMonitorOptionMenu);
                    }}
                    disabled={updatingMonitor}
                    className="flex w-full items-center justify-between px-4 py-2 text-left text-sm text-white transition-colors hover:bg-white/10 disabled:opacity-60"
                  >
                    <span>Monitor: {getCurrentMonitorOption()}</span>
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${
                        showMonitorOptionMenu ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                )}
                {canChangeMonitoring && showMonitorOptionMenu && (
                  <div className="border-y border-white/10 py-1">
                    {MONITOR_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleUpdateMonitorOption(option.value);
                          setShowMonitorOptionMenu(false);
                          setShowRemoveDropdown(false);
                        }}
                        disabled={updatingMonitor}
                        className="w-full px-4 py-2 text-left text-sm text-white/85 transition-colors hover:bg-white/10 disabled:opacity-60"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
                {canDeleteArtist && (
                  <button
                    type="button"
                    onClick={() => {
                      handleDeleteClick();
                      setShowRemoveDropdown(false);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-300 transition-colors hover:bg-red-500/20"
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove from Library
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      );
    }

    if (!canAddArtist) return null;

    return (
      <div className="add-to-library-button-group">
        <AddToLibraryButton
          onClick={handleAddToLibrary}
          isLoading={addingToLibrary}
          className="add-to-library-button--split"
        />
        <button
          type="button"
          onClick={handleOpenAddCustomizeModal}
          disabled={addingToLibrary}
          className="add-to-library-button-split-trigger"
          aria-label="Customize add options"
          title="Customize add options"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
      </div>
    );
  };

  return (
    <div className="relative z-20 -mx-4 -mt-1 mb-7 border-b border-white/5 bg-[#050505]/95 px-4 py-4 backdrop-blur md:sticky md:top-16 md:-mx-8 md:px-8 lg:-mx-10 lg:px-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          {firstPreview && (
            <button
              type="button"
              onClick={() => handlePreviewPlay(firstPreview)}
              disabled={loadingPreview}
              className="artist-round-button flex h-12 w-12 items-center justify-center bg-[#707e61] text-white shadow-lg shadow-black/30 transition-transform hover:scale-105 disabled:opacity-60"
              style={{ borderRadius: "9999px" }}
              aria-label={isPreviewPlaying ? "Pause preview" : "Play preview"}
              title={isPreviewPlaying ? "Pause preview" : "Play preview"}
            >
              {loadingPreview ? (
                <Loader className="h-5 w-5 animate-spin" />
              ) : isPreviewPlaying ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Play className="ml-0.5 h-5 w-5" />
              )}
            </button>
          )}
          {renderLibraryAction()}
        </div>

        <div className="flex items-center gap-2">
          {existsInLibrary && canRefreshArtist && (
            <button
              type="button"
              onClick={handleRefreshArtist}
              disabled={refreshingArtist}
              className="inline-flex h-10 items-center gap-2 bg-white/[0.06] px-3 text-sm font-semibold text-white/85 transition-colors hover:bg-white/10 disabled:opacity-60"
            >
              {refreshingArtist ? (
                <Loader className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMoreMenu((value) => !value)}
              className="flex h-10 w-10 items-center justify-center bg-white/[0.06] text-white/85 transition-colors hover:bg-white/10"
              aria-label="More artist actions"
              title="More artist actions"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
            {showMoreMenu && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-20 cursor-default"
                  onClick={() => setShowMoreMenu(false)}
                  aria-label="Close artist actions"
                />
                <div className="absolute right-0 top-full z-30 mt-2 w-56 border border-white/10 bg-[#18181c] py-1 shadow-2xl">
                  {onEditIds && (
                    <button
                      type="button"
                      onClick={() => {
                        onEditIds();
                        setShowMoreMenu(false);
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-white transition-colors hover:bg-white/10"
                    >
                      <Pencil className="h-4 w-4" />
                      Edit IDs
                    </button>
                  )}
                  {onToggleBlockArtist && (
                    <button
                      type="button"
                      onClick={() => {
                        onToggleBlockArtist();
                        setShowMoreMenu(false);
                      }}
                      disabled={blockingArtist}
                      className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-white/10 disabled:opacity-60"
                      style={{ color: artistBlocked ? "#fca5a5" : "#fff" }}
                    >
                      {blockingArtist ? (
                        <Loader className="h-4 w-4 animate-spin" />
                      ) : (
                        <Ban className="h-4 w-4" />
                      )}
                      {artistBlocked ? "Remove from Blocklist" : "Add to Blocklist"}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

ArtistDetailsActionBar.propTypes = {
  existsInLibrary: PropTypes.bool,
  loadingLibrary: PropTypes.bool,
  showRemoveDropdown: PropTypes.bool,
  setShowRemoveDropdown: PropTypes.func.isRequired,
  showMonitorOptionMenu: PropTypes.bool,
  setShowMonitorOptionMenu: PropTypes.func.isRequired,
  updatingMonitor: PropTypes.bool,
  canChangeMonitoring: PropTypes.bool,
  getCurrentMonitorOption: PropTypes.func.isRequired,
  handleUpdateMonitorOption: PropTypes.func.isRequired,
  canDeleteArtist: PropTypes.bool,
  handleDeleteClick: PropTypes.func.isRequired,
  canAddArtist: PropTypes.bool,
  handleAddToLibrary: PropTypes.func.isRequired,
  handleOpenAddCustomizeModal: PropTypes.func.isRequired,
  addingToLibrary: PropTypes.bool,
  canRefreshArtist: PropTypes.bool,
  handleRefreshArtist: PropTypes.func.isRequired,
  refreshingArtist: PropTypes.bool,
  previewTracks: PropTypes.array,
  loadingPreview: PropTypes.bool,
  playingPreviewId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  previewSnappingBack: PropTypes.bool,
  handlePreviewPlay: PropTypes.func.isRequired,
  onEditIds: PropTypes.func,
  onToggleBlockArtist: PropTypes.func,
  blockingArtist: PropTypes.bool,
  artistBlocked: PropTypes.bool,
};
