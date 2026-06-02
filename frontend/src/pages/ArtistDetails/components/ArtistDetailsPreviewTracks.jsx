import PropTypes from "prop-types";
import { Loader, Pause, Play } from "lucide-react";
import { TrackPlaylistMenu } from "./TrackPlaylistMenu";

const previewDurationLabel = (track) => {
  if (track?.duration_ms > 0) return "0:30";
  return "";
};

export function ArtistDetailsPreviewTracks({
  loadingPreview,
  previewTracks,
  playingPreviewId,
  previewProgress,
  previewSnappingBack,
  handlePreviewPlay,
  onAddTrackToPlaylist,
  playlists,
  playlistsLoading,
  playlistSavingKey,
  playlistError,
  getDefaultPlaylistName,
  onLoadPlaylists,
}) {
  if (!loadingPreview && (!previewTracks || previewTracks.length === 0)) {
    return null;
  }

  return (
    <section className="mb-10">
      <h2 className="mb-4 text-2xl font-bold text-white">Popular</h2>
      {loadingPreview ? (
        <div className="flex items-center justify-center py-10">
          <Loader className="h-7 w-7 animate-spin text-white/65" />
        </div>
      ) : (
        <div className="max-w-4xl space-y-1">
          {previewTracks.map((track, index) => {
            const isPlaying =
              playingPreviewId === track.id && !previewSnappingBack;
            return (
              <div
                key={track.id || `${track.title}-${index}`}
                className="group relative grid grid-cols-[32px_40px_minmax(0,1fr)_auto_auto] items-center gap-3 overflow-hidden px-2 py-2 transition-colors hover:bg-white/[0.06]"
              >
                {playingPreviewId === track.id && (
                  <div
                    className="absolute inset-y-0 left-0 pointer-events-none bg-[#707e61]/25"
                    style={{
                      width: `${previewProgress * 100}%`,
                      transition: previewSnappingBack
                        ? "width 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)"
                        : "width 0.1s linear",
                    }}
                  />
                )}
                <span className="relative text-right text-sm tabular-nums text-white/45">
                  {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => handlePreviewPlay(track)}
                  disabled={!track.preview_url}
                  className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-white transition-colors hover:bg-white/10 disabled:opacity-40"
                  aria-label={isPlaying ? "Pause preview" : "Play preview"}
                  title={isPlaying ? "Pause preview" : "Play preview"}
                >
                  {isPlaying ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="ml-0.5 h-4 w-4" />
                  )}
                </button>
                <div className="relative min-w-0">
                  <p className="truncate text-sm font-semibold text-white">
                    {track.title}
                  </p>
                  <p className="truncate text-xs text-white/50">
                    {track.album || "Preview available"}
                  </p>
                </div>
                {onAddTrackToPlaylist ? (
                  <div className="relative">
                    <TrackPlaylistMenu
                      playlists={playlists}
                      loading={playlistsLoading}
                      saving={playlistSavingKey === String(track.id || "")}
                      error={playlistError}
                      defaultNewPlaylistName={getDefaultPlaylistName?.(track)}
                      onLoadPlaylists={onLoadPlaylists}
                      onSelect={(target) => onAddTrackToPlaylist(track, target)}
                    />
                  </div>
                ) : null}
                <span className="relative w-10 text-right text-xs tabular-nums text-white/45">
                  {previewDurationLabel(track)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

ArtistDetailsPreviewTracks.propTypes = {
  loadingPreview: PropTypes.bool,
  previewTracks: PropTypes.array,
  playingPreviewId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  previewProgress: PropTypes.number,
  previewSnappingBack: PropTypes.bool,
  handlePreviewPlay: PropTypes.func.isRequired,
  onAddTrackToPlaylist: PropTypes.func,
  playlists: PropTypes.array,
  playlistsLoading: PropTypes.bool,
  playlistSavingKey: PropTypes.string,
  playlistError: PropTypes.string,
  getDefaultPlaylistName: PropTypes.func,
  onLoadPlaylists: PropTypes.func,
};
