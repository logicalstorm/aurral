import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Loader, Pause, Play } from "lucide-react";
import { getArtistTopSongVideo } from "../../../utils/api";
import { TrackPlaylistMenu } from "./TrackPlaylistMenu";

const previewDurationLabel = (track) => {
  if (track?.duration_ms > 0) return "0:30";
  return "";
};

export function ArtistDetailsPreviewTracks({
  mbid,
  artistName,
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
  const topTrack = useMemo(
    () => (Array.isArray(previewTracks) ? previewTracks[0] : null),
    [previewTracks],
  );
  const [topSongVideo, setTopSongVideo] = useState(null);
  const [loadingVideo, setLoadingVideo] = useState(false);

  useEffect(() => {
    const trackTitle = topTrack?.title;
    if (!mbid || !artistName || !trackTitle) {
      setTopSongVideo(null);
      setLoadingVideo(false);
      return;
    }

    const controller = new AbortController();
    setLoadingVideo(true);
    setTopSongVideo(null);

    getArtistTopSongVideo(mbid, artistName, trackTitle, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setTopSongVideo(data?.video || null);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setTopSongVideo(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingVideo(false);
        }
      });

    return () => controller.abort();
  }, [artistName, mbid, topTrack?.title]);

  if (!loadingPreview && (!previewTracks || previewTracks.length === 0)) {
    return null;
  }

  const showVideoPanel = loadingVideo || topSongVideo?.embedUrl;
  const embedSrc = topSongVideo?.embedUrl
    ? `${topSongVideo.embedUrl}?rel=0&modestbranding=1`
    : "";

  return (
    <section className="mb-10">
      <h2 className="mb-4 text-2xl font-bold text-white">Popular</h2>
      {loadingPreview ? (
        <div className="flex items-center justify-center py-10">
          <Loader className="h-7 w-7 animate-spin text-white/65" />
        </div>
      ) : (
        <div
          className={
            showVideoPanel
              ? "grid w-full max-w-[92rem] items-start gap-6 xl:grid-cols-[minmax(520px,0.9fr)_minmax(420px,1.1fr)]"
              : "max-w-4xl"
          }
        >
          <div className="space-y-1">
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
                        onSelect={(target) =>
                          onAddTrackToPlaylist(track, target)
                        }
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
          {showVideoPanel ? (
            <div className="flex min-w-0 justify-center">
              <div className="aspect-video h-auto w-full max-w-[560px] overflow-hidden bg-black/35 sm:h-[260px] sm:w-auto sm:max-w-full">
                {embedSrc ? (
                  <iframe
                    className="h-full w-full"
                    src={embedSrc}
                    title={`${artistName} ${topTrack?.title || ""}`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Loader className="h-7 w-7 animate-spin text-white/65" />
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

ArtistDetailsPreviewTracks.propTypes = {
  mbid: PropTypes.string,
  artistName: PropTypes.string,
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
