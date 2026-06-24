import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import {
  Loader2,
  Check,
  Clock,
  Pencil,
  FilePlus2,
  ListMusic,
  Sparkles,
  Play,
  Pause,
  Shuffle,
  Save,
  X,
  Search,
  ChevronDown,
  MoreHorizontal,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { getFlowTrackDisplayNumber, sortFlowTracks } from "../../../utils/flowTrackSort";
import { Link } from "react-router-dom";
import PillToggle from "../../../components/PillToggle";
import FlipSaveButton from "../../../components/FlipSaveButton";
import { useAudioQueue } from "../../../hooks/useAudioQueue";
import { normalizeFlowTrack } from "../../../utils/audioQueue";
import { TrackPlaylistMenu, TrackPlaylistSubmenu } from "../../ArtistDetails/components/TrackPlaylistMenu";
import { TAG_COLORS } from "../../ArtistDetails/constants";
import { getTagColor } from "../../ArtistDetails/utils";

function FlowTrackPlaylistMenus({
  track,
  useTrackContextMenu,
  playlists,
  playlistsLoading,
  playlistSavingKey,
  playlistMenuError,
  excludedPlaylistIds,
  getDefaultPlaylistName,
  onLoadPlaylists,
  onAddTrackToPlaylist,
  onMoveTrackToPlaylist,
  children,
}) {
  const canUsePlaylistMenus =
    track?.artistName &&
    track?.trackName &&
    (onAddTrackToPlaylist || onMoveTrackToPlaylist);
  const saving = playlistSavingKey === String(track?.id || "");
  const defaultNewPlaylistName =
    getDefaultPlaylistName?.(track) || "Playlist";
  const sharedMenuProps = {
    track,
    playlists,
    loading: playlistsLoading,
    saving,
    error: playlistMenuError,
    defaultNewPlaylistName,
    excludedPlaylistIds,
    onLoadPlaylists,
  };

  if (!canUsePlaylistMenus) {
    return typeof children === "function" ? children() : children;
  }

  if (useTrackContextMenu) {
    return children({
      playlistMenuProps: {
        ...sharedMenuProps,
        onAddTrackToPlaylist: onAddTrackToPlaylist
          ? (target) => onAddTrackToPlaylist(track, target)
          : null,
        onMoveTrackToPlaylist: onMoveTrackToPlaylist
          ? (target) => onMoveTrackToPlaylist(track, target)
          : null,
      },
    });
  }

  return (
    <>
      {onAddTrackToPlaylist ? (
        <TrackPlaylistMenu
          {...sharedMenuProps}
          triggerVariant="compact"
          onSelect={(target) => onAddTrackToPlaylist(track, target)}
        />
      ) : null}
      {typeof children === "function" ? children() : children}
    </>
  );
}


function FlowTrackKebabMenu({
  track,
  canReSearch,
  isReSearching,
  canDelete,
  isDeleting,
  onReSearch,
  onDelete,
  playlistMenuProps = null,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [openSubmenu, setOpenSubmenu] = useState(null);
  const [menuPosition, setMenuPosition] = useState(null);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const onLoadPlaylistsRef = useRef(playlistMenuProps?.onLoadPlaylists);
  onLoadPlaylistsRef.current = playlistMenuProps?.onLoadPlaylists;

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
        setOpenSubmenu(null);
        setMenuPosition(null);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    onLoadPlaylistsRef.current?.();
  }, [isOpen]);

  const close = () => {
    setIsOpen(false);
    setOpenSubmenu(null);
    setMenuPosition(null);
  };
  const trackLabel = track?.trackName || "track";
  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const menuWidth = 216;
      const viewportPadding = 12;
      setMenuPosition({
        top: rect.bottom + 8,
        left: Math.min(
          Math.max(viewportPadding, rect.right - menuWidth),
          window.innerWidth - menuWidth - viewportPadding,
        ),
      });
    }
    setIsOpen(true);
  };

  return (
    <div
      className={`flow-page__track-menu${isOpen ? " is-open" : ""}`}
      ref={menuRef}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (isOpen) {
            close();
            return;
          }
          openMenu();
        }}
        className="btn btn-secondary btn-icon btn-xs flow-page__track-menu-trigger"
        aria-label={`Options for ${trackLabel}`}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <MoreHorizontal className="artist-icon-xs" />
      </button>
      {isOpen ? (
        <>
          <button
            type="button"
            className="artist-backdrop-button"
            onClick={close}
            aria-label="Close track menu"
          />
          <div
            className="artist-floating-menu flow-page__track-menu-dropdown"
            style={{
              top: menuPosition?.top ?? 0,
              left: menuPosition?.left ?? 0,
            }}
            role="menu"
          >
            {canReSearch ? (
              <button
                type="button"
                role="menuitem"
                className="artist-menu-item"
                disabled={isReSearching}
                onClick={() => {
                  onReSearch?.(track);
                  close();
                }}
              >
                <span className="artist-menu-item__main">
                  {isReSearching ? (
                    <Loader2 className="artist-icon-sm animate-spin" />
                  ) : (
                    <Search className="artist-icon-sm" />
                  )}
                  Re-search
                </span>
              </button>
            ) : null}
            {playlistMenuProps?.onAddTrackToPlaylist ? (
              <TrackPlaylistSubmenu
                label="Add to playlist"
                icon={Plus}
                track={playlistMenuProps.track}
                playlists={playlistMenuProps.playlists}
                loading={playlistMenuProps.loading}
                saving={playlistMenuProps.saving}
                error={playlistMenuProps.error}
                defaultNewPlaylistName={playlistMenuProps.defaultNewPlaylistName}
                excludedPlaylistIds={playlistMenuProps.excludedPlaylistIds}
                onSelect={playlistMenuProps.onAddTrackToPlaylist}
                onClose={close}
                toggleOnClick
                isOpen={openSubmenu === "add"}
                onToggle={() =>
                  setOpenSubmenu((current) =>
                    current === "add" ? null : "add",
                  )
                }
              />
            ) : null}
            {playlistMenuProps?.onMoveTrackToPlaylist ? (
              <TrackPlaylistSubmenu
                label="Move to playlist"
                icon={ListMusic}
                track={playlistMenuProps.track}
                playlists={playlistMenuProps.playlists}
                loading={playlistMenuProps.loading}
                saving={playlistMenuProps.saving}
                error={playlistMenuProps.error}
                defaultNewPlaylistName={playlistMenuProps.defaultNewPlaylistName}
                excludedPlaylistIds={playlistMenuProps.excludedPlaylistIds}
                onSelect={playlistMenuProps.onMoveTrackToPlaylist}
                onClose={close}
                toggleOnClick
                isOpen={openSubmenu === "move"}
                onToggle={() =>
                  setOpenSubmenu((current) =>
                    current === "move" ? null : "move",
                  )
                }
              />
            ) : null}
            {canDelete ? (
              <button
                type="button"
                role="menuitem"
                className="artist-menu-item artist-menu-item--danger"
                disabled={isDeleting}
                onClick={() => {
                  onDelete?.(track);
                  close();
                }}
              >
                <span className="artist-menu-item__main">
                  {isDeleting ? (
                    <Loader2 className="artist-icon-sm animate-spin" />
                  ) : (
                    <Trash2 className="artist-icon-sm" />
                  )}
                  Remove from playlist
                </span>
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}


function TrackStatusDot({ status }) {
  const meta = getTrackStatusMeta(status);
  const normalized = String(status || "").toLowerCase();
  const isLinkable = normalized !== "done";
  if (isLinkable) {
    return (
      <Link
        to="/downloads"
        className={`flow-page__track-status-dot flow-page__track-status-dot--link ${meta.className}`}
        title={`${meta.label} — view activity`}
        aria-label={`${meta.label}, view activity`}
      />
    );
  }
  return (
    <span
      className={`flow-page__track-status-dot ${meta.className}`}
      title={meta.label}
      aria-label={meta.label}
      role="img"
    />
  );
}


function FlowTracksSortHeader({
  label,
  sortKey,
  activeSortKey,
  sortDirection,
  onSort,
  className = "",
}) {
  const active = activeSortKey === sortKey;
  const DirectionIcon = sortDirection === "asc" ? ArrowUp : ArrowDown;
  const ariaSort = active
    ? sortDirection === "asc"
      ? "ascending"
      : "descending"
    : "none";
  return (
    <th className={className} scope="col" aria-sort={ariaSort}>
      <button
        type="button"
        className={`flow-page__tracks-sort-button${active ? " is-active" : ""}`}
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        {active ? (
          <DirectionIcon className="artist-icon-xs" aria-hidden="true" />
        ) : null}
      </button>
    </th>
  );
}


export function FlowTracksPanel({
  tracks,
  loading,
  error,
  activityHint = null,
  emptyMessage = "No tracks generated for this flow yet.",
  headerActions = null,
  deletingTrackId = null,
  reSearchingTrackIds = {},
  useTrackContextMenu = false,
  playlists = [],
  playlistsLoading = false,
  playlistSavingKey = "",
  playlistMenuError = "",
  excludedPlaylistIds = [],
  getDefaultPlaylistName,
  onLoadPlaylists,
  onDeleteTrack,
  onAddTrackToPlaylist,
  onMoveTrackToPlaylist,
  onNavigateArtist,
  onReSearchTrack,
  playbackSource = null,
  showPlaybackControls = true,
  hideAlbumColumn = false,
  hideStatusColumn = false,
}) {
  const [sortKey, setSortKey] = useState("index");
  const [sortDirection, setSortDirection] = useState("asc");
  const trackOrderKey = useMemo(
    () => tracks.map((track) => track.id).join("\n"),
    [tracks],
  );

  useEffect(() => {
    setSortKey("index");
    setSortDirection("asc");
  }, [trackOrderKey]);

  const {
    playQueue,
    playTrack,
    togglePlayPause,
    isShuffleEnabled,
    matchesSource,
    isPlaying,
    currentTrack: activeTrack,
  } = useAudioQueue();

  const sortedTracks = useMemo(
    () => sortFlowTracks(tracks, sortKey, sortDirection),
    [tracks, sortKey, sortDirection],
  );

  const playableTracks = useMemo(
    () =>
      sortedTracks.filter(
        (track) => track.status === "done" && track.streamUrl,
      ),
    [sortedTracks],
  );

  const handleSort = (nextSortKey) => {
    if (sortKey === nextSortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection("asc");
  };

  const isSourceActive = matchesSource(playbackSource);
  const currentTrackId =
    isSourceActive && activeTrack?.id ? activeTrack.id : null;
  const isCurrentPlaying = isSourceActive && isPlaying;

  const isPlaylistPlaying = isSourceActive && isCurrentPlaying;

  const handlePrimaryPlay = () => {
    if (playableTracks.length === 0) return;
    if (isSourceActive && (isPlaying || currentTrackId)) {
      togglePlayPause();
      return;
    }
    const queueTracks = playableTracks.map((track) => normalizeFlowTrack(track));
    playQueue(queueTracks, {
      source: playbackSource,
      shuffle: false,
    });
  };

  const handleShufflePlay = () => {
    if (playableTracks.length === 0) return;
    const queueTracks = playableTracks.map((track) => normalizeFlowTrack(track));
    playQueue(queueTracks, {
      source: playbackSource,
      shuffle: true,
    });
  };

  const handlePlayTrack = (track) => {
    if (!track?.streamUrl) return;
    const normalized = normalizeFlowTrack(track);
    if (currentTrackId === track.id && isSourceActive) {
      togglePlayPause();
      return;
    }
    playTrack(normalized, {
      source: playbackSource,
      queue: playableTracks.map((entry) => normalizeFlowTrack(entry)),
      shuffle: isShuffleEnabled,
    });
  };

  return (
    <div className="flow-page__tracks">
      {showPlaybackControls || headerActions ? (
        <div className="flow-page__tracks-toolbar">
          {showPlaybackControls ? (
            <div className="flow-page__tracks-toolbar-start">
              <button
                type="button"
                onClick={handlePrimaryPlay}
                className="btn btn-primary btn-round-lg"
                disabled={playableTracks.length === 0}
                aria-label={
                  isPlaylistPlaying ? "Pause playback" : "Play all tracks"
                }
              >
                {isPlaylistPlaying ? (
                  <Pause className="artist-icon-md" />
                ) : (
                  <Play className="artist-icon-md" />
                )}
              </button>
              <button
                type="button"
                onClick={handleShufflePlay}
                className={`btn btn-secondary btn-round-lg flow-page__tracks-toolbar-shuffle${isShuffleEnabled ? " is-active" : ""}`}
                disabled={playableTracks.length === 0}
                aria-label="Shuffle and play"
              >
                <Shuffle className="artist-icon-md" />
              </button>
            </div>
          ) : headerActions ? (
            <div className="flow-page__tracks-toolbar-start flow-page__tracks-toolbar-start--full">
              {headerActions}
            </div>
          ) : null}
          {showPlaybackControls && headerActions ? (
            <div className="flow-page__tracks-toolbar-actions">
              {headerActions}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flow-page__tracks-body">
        {loading && (
          <div className="flow-page__tracks-loading">
            <Loader2 className="artist-icon-sm animate-spin" />
            Loading tracks...
          </div>
        )}
        {!loading && error && (
          <div className="flow-page__tracks-error">{error}</div>
        )}
        {!loading && !error && tracks.length === 0 && (
          <div className="flow-page__tracks-empty">
            {activityHint ? (
              <>
                <Loader2 className="artist-icon-sm animate-spin" />
                <span>{activityHint}</span>
              </>
            ) : (
              emptyMessage
            )}
          </div>
        )}
        {!loading && !error && tracks.length > 0 && (
          <table
            className={`flow-page__tracks-table${hideAlbumColumn ? " flow-page__tracks-table--no-album" : ""}`}
          >
            <thead className="flow-page__tracks-table-head">
              <tr>
                <FlowTracksSortHeader
                  label="#"
                  sortKey="index"
                  activeSortKey={sortKey}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                  className="flow-page__tracks-table-index"
                />
                <FlowTracksSortHeader
                  label="Song"
                  sortKey="song"
                  activeSortKey={sortKey}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                  className="flow-page__tracks-table-song"
                />
                <FlowTracksSortHeader
                  label="Artist"
                  sortKey="artist"
                  activeSortKey={sortKey}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                  className="flow-page__tracks-table-artist"
                />
                {hideAlbumColumn ? null : (
                  <FlowTracksSortHeader
                    label="Album"
                    sortKey="album"
                    activeSortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    className="flow-page__tracks-table-album"
                  />
                )}
                {hideStatusColumn ? null : (
                  <FlowTracksSortHeader
                    label="Status"
                    sortKey="status"
                    activeSortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    className="flow-page__tracks-table-status-head"
                  />
                )}
                <th
                  className="flow-page__tracks-table-actions-head"
                  aria-hidden="true"
                />
              </tr>
            </thead>
            <tbody>
              {sortedTracks.map((track, index) => {
                const trackDisplayNumber = getFlowTrackDisplayNumber(track, {
                  tracks,
                  sortedTracks,
                  sortedIndex: index,
                  sortKey,
                  sortDirection,
                });
                const canPlay =
                  showPlaybackControls &&
                  track.status === "done" &&
                  !!track.streamUrl;
                const canDelete =
                  typeof onDeleteTrack === "function" && !!track.id;
                const canReSearch =
                  typeof onReSearchTrack === "function" &&
                  !!track.id &&
                  (track.status === "done" || track.status === "failed");
                const isReSearching = reSearchingTrackIds[track.id] === true;
                const isDeleting = deletingTrackId === track.id;
                const isCurrent = track.id === currentTrackId && isCurrentPlaying;
                return (
                  <tr
                    key={track.id}
                    className={`flow-page__tracks-table-row${isCurrent ? " is-current" : ""}`}
                  >
                    <td className="flow-page__tracks-table-index">
                      {showPlaybackControls ? (
                        <div className="flow-page__tracks-table-index-inner">
                          <span className="flow-page__tracks-table-index-number">
                            {trackDisplayNumber}
                          </span>
                          <button
                            type="button"
                            onClick={() => handlePlayTrack(track)}
                            className="flow-page__tracks-table-index-play btn btn-secondary btn-icon btn-xs"
                            disabled={!canPlay}
                            aria-label={
                              isCurrent
                                ? `Pause ${track.trackName}`
                                : `Play ${track.trackName}`
                            }
                          >
                            {isCurrent ? (
                              <Pause className="artist-icon-xs" />
                            ) : (
                              <Play className="artist-icon-xs" />
                            )}
                          </button>
                        </div>
                      ) : (
                        trackDisplayNumber
                      )}
                    </td>
                    <td
                      className="flow-page__tracks-table-song"
                      title={track.trackName}
                    >
                      <span className="flow-page__tracks-table-cell-text">
                        {track.trackName}
                      </span>
                    </td>
                    <td
                      className="flow-page__tracks-table-artist"
                      title={track.artistName}
                    >
                      {track.artistMbid ? (
                        <button
                          type="button"
                          onClick={() => onNavigateArtist(track)}
                          className="flow-page__tracks-artist-link"
                        >
                          {track.artistName}
                        </button>
                      ) : (
                        <span className="flow-page__tracks-table-cell-text">
                          {track.artistName}
                        </span>
                      )}
                    </td>
                    {hideAlbumColumn ? null : (
                      <td
                        className="flow-page__tracks-table-album"
                        title={track.albumName || "Unknown Album"}
                      >
                        <span className="flow-page__tracks-table-cell-text">
                          {track.albumName || "Unknown Album"}
                        </span>
                      </td>
                    )}
                    {hideStatusColumn ? null : (
                      <td className="flow-page__tracks-table-status-cell">
                        <TrackStatusDot status={track.status} />
                      </td>
                    )}
                    <td className="flow-page__tracks-table-actions-cell">
                      <div className="flow-page__tracks-actions">
                        <FlowTrackPlaylistMenus
                          track={track}
                          useTrackContextMenu={useTrackContextMenu}
                          playlists={playlists}
                          playlistsLoading={playlistsLoading}
                          playlistSavingKey={playlistSavingKey}
                          playlistMenuError={playlistMenuError}
                          excludedPlaylistIds={excludedPlaylistIds}
                          getDefaultPlaylistName={getDefaultPlaylistName}
                          onLoadPlaylists={onLoadPlaylists}
                          onAddTrackToPlaylist={onAddTrackToPlaylist}
                          onMoveTrackToPlaylist={onMoveTrackToPlaylist}
                        >
                          {(playlistMenuHandlers) =>
                            useTrackContextMenu ? (
                              <FlowTrackKebabMenu
                                track={track}
                                canReSearch={canReSearch}
                                isReSearching={isReSearching}
                                canDelete={canDelete}
                                isDeleting={isDeleting}
                                onReSearch={onReSearchTrack}
                                onDelete={onDeleteTrack}
                                playlistMenuProps={
                                  playlistMenuHandlers?.playlistMenuProps
                                }
                              />
                            ) : (
                              <>
                                {canReSearch ? (
                                  <button
                                    type="button"
                                    onClick={() => onReSearchTrack(track)}
                                    className="btn btn-secondary btn-icon btn-xs"
                                    aria-label={`Re-search ${track.trackName}`}
                                    title={`Re-search ${track.trackName}`}
                                    disabled={isReSearching}
                                  >
                                    {isReSearching ? (
                                      <Loader2 className="artist-icon-xs animate-spin" />
                                    ) : (
                                      <Search className="artist-icon-xs" />
                                    )}
                                  </button>
                                ) : null}
                                {canDelete ? (
                                  <button
                                    type="button"
                                    onClick={() => onDeleteTrack?.(track)}
                                    className="btn btn-ghost-danger btn-icon btn-xs"
                                    aria-label={`Remove ${track.trackName} from playlist`}
                                    title={`Remove ${track.trackName} from playlist`}
                                    disabled={isDeleting}
                                  >
                                    {isDeleting ? (
                                      <Loader2 className="artist-icon-xs animate-spin" />
                                    ) : (
                                      <Trash2 className="artist-icon-xs" />
                                    )}
                                  </button>
                                ) : null}
                              </>
                            )
                          }
                        </FlowTrackPlaylistMenus>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const getFlowEmptyCopy = (libraryFilter, canCreate) => {
  if (libraryFilter === "playlists") {
    return {
      title: "No playlists yet",
      message:
        "Create a playlist to curate tracks, or import one from Aurral Convert or a JSON export.",
      showPlaylistAction: true,
      showFlowAction: false,
      showImportAction: true,
    };
  }
  if (libraryFilter === "flows") {
    if (!canCreate) {
      return {
        title: "Flows need listening history",
        message:
          "Connect Last.fm in Settings to create flows that generate tracks from your taste.",
        showPlaylistAction: false,
        showFlowAction: false,
        showImportAction: false,
        showSettingsAction: true,
      };
    }
    return {
      title: "No flows yet",
      message:
        "Flows are auto-updating playlists built from recipes like Release Radar or your top artists.",
      showPlaylistAction: false,
      showFlowAction: true,
      showImportAction: false,
    };
  }
  return {
    title: "Start your playlist library",
    message:
      "Import a playlist, build your own track list, or create a flow that updates automatically from your taste.",
    showPlaylistAction: true,
    showFlowAction: canCreate,
    showImportAction: true,
  };
};


