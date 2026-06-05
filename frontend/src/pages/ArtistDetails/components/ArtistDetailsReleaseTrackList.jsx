import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Loader } from "lucide-react";
import { TrackPlayButton } from "./TrackPlayButton";
import { getReleaseYear } from "../utils";
import { TrackPlaylistMenu } from "./TrackPlaylistMenu";

export function ArtistDetailsReleaseTrackList({
  release,
  trackKey,
  tracks,
  loading,
  previewVolume = 0.75,
  onAddTrackToPlaylist,
  playlists,
  playlistsLoading,
  playlistSavingKey,
  playlistError,
  getDefaultPlaylistName,
  onLoadPlaylists,
}) {
  const [playingTrackId, setPlayingTrackId] = useState(null);
  const [loadingTrackId, setLoadingTrackId] = useState(null);
  const previewAudioRef = useRef(null);

  useEffect(() => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    audio.volume = previewVolume;
  }, [previewVolume]);

  useEffect(() => {
    const audio = previewAudioRef.current;
    if (!audio) return undefined;
    const resetPlayback = () => {
      setPlayingTrackId(null);
      setLoadingTrackId(null);
    };
    audio.addEventListener("ended", resetPlayback);
    audio.addEventListener("error", resetPlayback);
    return () => {
      audio.removeEventListener("ended", resetPlayback);
      audio.removeEventListener("error", resetPlayback);
      audio.pause();
      audio.src = "";
    };
  }, []);

  const handleTrackPreviewPlay = async (track, event) => {
    event.stopPropagation();
    const previewUrl = track?.preview_url;
    const currentTrackId = String(track?.id ?? track?.mbid ?? "");
    const audio = previewAudioRef.current;
    if (!audio || !previewUrl || !currentTrackId) return;
    try {
      if (playingTrackId === currentTrackId) {
        audio.pause();
        setPlayingTrackId(null);
        return;
      }
      setLoadingTrackId(currentTrackId);
      if (audio.src !== previewUrl) {
        audio.src = previewUrl;
      }
      audio.volume = previewVolume;
      await audio.play();
      setPlayingTrackId(currentTrackId);
    } catch {
      setPlayingTrackId(null);
    } finally {
      setLoadingTrackId(null);
    }
  };

  if (!release) return null;

  return (
    <div className="artist-expanded-panel">
      <audio ref={previewAudioRef} preload="none" />
      <div className="artist-expanded-panel__header">
        <div className="artist-min-0">
          <h3 className="artist-card-title artist-truncate">{release.title}</h3>
          <p className="artist-card-meta">
            {[getReleaseYear(release), release["primary-type"]]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="artist-loading">
          <Loader className="artist-spinner animate-spin" />
        </div>
      ) : tracks?.length ? (
        <div className="artist-track-list__rows">
          {tracks.map((track, index) => {
            const currentTrackId = String(
              track.id ?? track.mbid ?? `${trackKey}-${index}`,
            );
            const isPlaying = playingTrackId === currentTrackId;
            const isLoadingPreview = loadingTrackId === currentTrackId;
            const durationLabel = track.length
              ? `${Math.floor(track.length / 60000)}:${Math.floor(
                  (track.length % 60000) / 1000,
                )
                  .toString()
                  .padStart(2, "0")}`
              : "";
            return (
              <div
                key={currentTrackId}
                className="artist-track-row"
              >
                <span className="artist-track-number">
                  {track.trackNumber || track.position || index + 1}
                </span>
                {track.preview_url ? (
                  <TrackPlayButton
                    track={track}
                    isPlaying={isPlaying}
                    isLoading={isLoadingPreview}
                    onClick={(event) => handleTrackPreviewPlay(track, event)}
                  />
                ) : (
                  <span />
                )}
                <span className="artist-track-title">
                  {track.title || track.trackName || "Unknown Track"}
                </span>
                {onAddTrackToPlaylist ? (
                  <TrackPlaylistMenu
                    playlists={playlists}
                    loading={playlistsLoading}
                    saving={playlistSavingKey === currentTrackId}
                    error={playlistError}
                    defaultNewPlaylistName={getDefaultPlaylistName?.(
                      track,
                      release,
                    )}
                    onLoadPlaylists={onLoadPlaylists}
                    onSelect={(target) =>
                      onAddTrackToPlaylist(track, release, target)
                    }
                  />
                ) : null}
                <span className="artist-track-duration">
                  {durationLabel}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="artist-empty-message">No tracks available</p>
      )}
    </div>
  );
}

ArtistDetailsReleaseTrackList.propTypes = {
  release: PropTypes.object,
  trackKey: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  tracks: PropTypes.array,
  loading: PropTypes.bool,
  previewVolume: PropTypes.number,
  onAddTrackToPlaylist: PropTypes.func,
  playlists: PropTypes.array,
  playlistsLoading: PropTypes.bool,
  playlistSavingKey: PropTypes.string,
  playlistError: PropTypes.string,
  getDefaultPlaylistName: PropTypes.func,
  onLoadPlaylists: PropTypes.func,
};
