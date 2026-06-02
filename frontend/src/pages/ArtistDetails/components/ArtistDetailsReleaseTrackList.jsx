import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Loader, Pause, Play } from "lucide-react";
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
    <div className="mt-4 bg-[#101012] p-4">
      <audio ref={previewAudioRef} preload="none" />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold text-white">{release.title}</h3>
          <p className="text-xs text-white/50">
            {[getReleaseYear(release), release["primary-type"]]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader className="h-6 w-6 animate-spin text-white/65" />
        </div>
      ) : tracks?.length ? (
        <div className="space-y-1">
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
                className="grid grid-cols-[28px_28px_minmax(0,1fr)_auto_auto] items-center gap-2 px-2 py-2 text-sm transition-colors hover:bg-white/[0.06]"
              >
                <span className="text-right text-xs tabular-nums text-white/45">
                  {track.trackNumber || track.position || index + 1}
                </span>
                {track.preview_url ? (
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center bg-white/[0.06] text-white transition-colors hover:bg-white/10"
                    onClick={(event) => handleTrackPreviewPlay(track, event)}
                    aria-label={isPlaying ? "Pause preview" : "Play preview"}
                    title={isPlaying ? "Pause preview" : "Play preview"}
                  >
                    {isLoadingPreview ? (
                      <Loader className="h-3 w-3 animate-spin" />
                    ) : isPlaying ? (
                      <Pause className="h-3 w-3" />
                    ) : (
                      <Play className="ml-0.5 h-3 w-3" />
                    )}
                  </button>
                ) : (
                  <span />
                )}
                <span className="truncate text-white">
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
                <span className="w-11 text-right text-xs tabular-nums text-white/45">
                  {durationLabel}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="py-6 text-sm italic text-white/50">No tracks available</p>
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
