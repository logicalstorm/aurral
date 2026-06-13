import { useCallback } from "react";
import PropTypes from "prop-types";
import { Music } from "lucide-react";
import SearchLibraryCheck from "./SearchLibraryCheck";
import {
  getSearchResultKey,
  navigateFromSearchResult,
} from "../utils/searchNavigation";
import { TrackPlaylistMenu } from "../pages/ArtistDetails/components/TrackPlaylistMenu";
import { TrackPlayButton } from "../pages/ArtistDetails/components/TrackPlayButton";
import { useGlobalTrackPlayback } from "../hooks/useGlobalTrackPlayback";
import { normalizePreviewTrack } from "../utils/audioQueue";

function TrackCover({ src, title }) {
  if (!src) {
    return (
      <span className="search-track-results__cover search-track-results__cover--placeholder">
        <Music className="artist-icon-sm" />
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={title ? `${title} cover art` : ""}
      className="search-track-results__cover"
      loading="lazy"
      decoding="async"
    />
  );
}

function SearchTrackResults({
  tracks,
  navigate,
  query = "",
  albumCovers = {},
  playlists = [],
  playlistsLoading = false,
  playlistSavingKey = "",
  playlistError = "",
  onLoadPlaylists,
  onAddTrackToPlaylist,
  getDefaultPlaylistName,
}) {
  const normalizeTrack = useCallback(
    (track, index) =>
      normalizePreviewTrack(
        {
          id: track.id ?? track.trackMbid ?? `search-track-${index}`,
          title: track.title,
          preview_url: track.preview_url,
        },
        track.artistName || "",
        { album: track.albumTitle || "" },
      ),
    [],
  );

  const { isTrackPlaying, isTrackLoading, handlePlay } = useGlobalTrackPlayback(
    (track, index) => normalizeTrack(track, index),
  );

  const handleTrackPlay = useCallback(
    (track, index, event) => {
      event.stopPropagation();
      if (!track?.preview_url) return;
      const previewTracks = tracks.filter((entry) => entry?.preview_url);
      const queue = previewTracks.map((entry, entryIndex) =>
        normalizeTrack(entry, entryIndex),
      );
      const queueIndex = previewTracks.findIndex((entry) => entry === track);
      handlePlay(
        track,
        {
          source: { type: "search", id: query, label: query || "Search" },
          queue,
        },
        queueIndex,
      );
    },
    [handlePlay, normalizeTrack, query, tracks],
  );

  if (!tracks.length) return null;

  return (
    <ul className="search-track-results">
      {tracks.map((track, index) => {
        const label = track.title || "Unknown Track";
        const subtitle = [track.artistName, track.albumTitle]
          .filter(Boolean)
          .join(" · ");
        const trackId = String(
          track.id ?? track.trackMbid ?? getSearchResultKey(track, index),
        );
        const canPreview = Boolean(track.preview_url);
        const isPlaying = canPreview && isTrackPlaying(trackId);
        const isLoadingPreview = canPreview && isTrackLoading(trackId);
        const coverSrc =
          track.coverUrl ||
          (track.albumMbid ? albumCovers[track.albumMbid] : null);

        return (
          <li key={getSearchResultKey(track, index)}>
            <div className="search-track-results__row">
              <button
                type="button"
                className="search-track-results__main"
                onClick={() =>
                  navigateFromSearchResult(navigate, track, {
                    query,
                    albumDestination: "tracklist",
                  })
                }
              >
                <TrackCover src={coverSrc} title={track.albumTitle || label} />
                <span className="search-track-results__play-slot">
                  {canPreview ? (
                    <TrackPlayButton
                      track={track}
                      isPlaying={isPlaying}
                      isLoading={isLoadingPreview}
                      onClick={(event) => handleTrackPlay(track, index, event)}
                    />
                  ) : (
                    <span className="search-track-results__play-placeholder" />
                  )}
                </span>
                <span className="search-track-results__copy">
                  <span className="search-track-results__title">{label}</span>
                  {subtitle && (
                    <span className="search-track-results__subtitle">
                      {subtitle}
                    </span>
                  )}
                </span>
                {track.inLibrary && <SearchLibraryCheck />}
              </button>
              {onAddTrackToPlaylist ? (
                <div
                  className="search-track-results__actions"
                  onClick={(event) => event.stopPropagation()}
                >
                  <TrackPlaylistMenu
                    track={track}
                    triggerLabel="Add to playlist"
                    playlists={playlists}
                    loading={playlistsLoading}
                    saving={playlistSavingKey === trackId}
                    error={playlistError}
                    defaultNewPlaylistName={
                      getDefaultPlaylistName?.(track) ||
                      `${track.artistName || "Artist"} Picks`
                    }
                    onLoadPlaylists={onLoadPlaylists}
                    onSelect={(target) => onAddTrackToPlaylist(track, target)}
                  />
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

SearchTrackResults.propTypes = {
  tracks: PropTypes.arrayOf(PropTypes.object).isRequired,
  navigate: PropTypes.func.isRequired,
  query: PropTypes.string,
  albumCovers: PropTypes.object,
  playlists: PropTypes.array,
  playlistsLoading: PropTypes.bool,
  playlistSavingKey: PropTypes.string,
  playlistError: PropTypes.string,
  onLoadPlaylists: PropTypes.func,
  onAddTrackToPlaylist: PropTypes.func,
  getDefaultPlaylistName: PropTypes.func,
};

TrackCover.propTypes = {
  src: PropTypes.string,
  title: PropTypes.string,
};

export default SearchTrackResults;
