import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Loader, Music, Pause, Play, Star } from "lucide-react";
import AddAlbumButton from "../../../components/AddAlbumButton";
import { getReleaseGroupTracks } from "../../../utils/api";
import { buildAurralPick, getReleaseMetric } from "../utils";
import { TrackPlaylistMenu } from "./TrackPlaylistMenu";

function PickCover({ pick, albumCovers, artistCoverImage }) {
  const cover = albumCovers?.[pick.releaseGroupId] || artistCoverImage;
  if (cover) {
    return (
      <img
        src={cover}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-white/[0.06]">
      <Music className="h-14 w-14 text-white/35" />
    </div>
  );
}

PickCover.propTypes = {
  pick: PropTypes.object.isRequired,
  albumCovers: PropTypes.object,
  artistCoverImage: PropTypes.string,
};

const formatDuration = (track) => {
  const duration = Number(track?.length || track?.duration_ms || 0);
  if (!Number.isFinite(duration) || duration <= 0) return "";
  const seconds = Math.floor(duration / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export function ArtistDetailsDownloadTargets({
  targets,
  artist,
  albumCovers,
  artistCoverImage,
  canAddAlbum,
  requestingAlbum,
  handleRequestAlbum,
  previewVolume = 0.75,
  onAddTrackToPlaylist,
  playlists,
  playlistsLoading,
  playlistSavingKey,
  playlistError,
  getDefaultPlaylistName,
  onLoadPlaylists,
}) {
  const missingReleasePick =
    targets.find((target) => target.source === "release") ||
    buildAurralPick(targets);
  const [tracks, setTracks] = useState([]);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [playingTrackId, setPlayingTrackId] = useState(null);
  const [loadingTrackId, setLoadingTrackId] = useState(null);
  const previewAudioRef = useRef(null);

  useEffect(() => {
    const audio = previewAudioRef.current;
    if (audio) audio.volume = previewVolume;
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

  useEffect(() => {
    const releaseGroupId = missingReleasePick?.releaseGroupId;
    const releaseGroup = missingReleasePick?.releaseGroup;
    if (!releaseGroupId) {
      setTracks([]);
      setLoadingTracks(false);
      return;
    }

    let cancelled = false;
    setLoadingTracks(true);
    setTracks([]);
    getReleaseGroupTracks(releaseGroupId, {
      artistMbid: artist?.id || "",
      artistName: artist?.name || "",
      albumTitle: missingReleasePick?.title || releaseGroup?.title || "",
      releaseType: missingReleasePick?.type || releaseGroup?.["primary-type"] || "",
      releaseDate: releaseGroup?.["first-release-date"] || "",
      deezerAlbumId: releaseGroup?._deezerAlbumId || "",
    })
      .then((nextTracks) => {
        if (!cancelled) setTracks(Array.isArray(nextTracks) ? nextTracks : []);
      })
      .catch(() => {
        if (!cancelled) setTracks([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTracks(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    artist?.id,
    artist?.name,
    missingReleasePick?.releaseGroup,
    missingReleasePick?.releaseGroupId,
    missingReleasePick?.title,
    missingReleasePick?.type,
  ]);

  if (!missingReleasePick) return null;

  const metric =
    missingReleasePick.metric || getReleaseMetric(missingReleasePick.releaseGroup);

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
      if (audio.src !== previewUrl) audio.src = previewUrl;
      audio.volume = previewVolume;
      await audio.play();
      setPlayingTrackId(currentTrackId);
    } catch {
      setPlayingTrackId(null);
    } finally {
      setLoadingTrackId(null);
    }
  };

  return (
    <section className="mb-10">
      <div className="relative overflow-hidden bg-[#101012]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(112,126,97,0.32),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.08),transparent_38%)]" />
        <div className="relative grid gap-5 p-5 sm:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(250px,0.55fr)_minmax(420px,1fr)] md:p-6">
          <audio ref={previewAudioRef} preload="none" />
          <div className="aspect-square overflow-hidden bg-white/[0.06] shadow-2xl shadow-black/30">
            <PickCover
              pick={missingReleasePick}
              albumCovers={albumCovers}
              artistCoverImage={artistCoverImage}
            />
          </div>
          <div className="flex min-w-0 flex-col justify-between gap-5 sm:min-h-[260px] sm:self-start">
            <div className="min-w-0">
              <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-white">
                Aurral Pick
              </div>
              <h2 className="max-w-4xl break-words text-3xl font-black leading-tight text-white xl:text-[2rem] 2xl:text-4xl">
                {missingReleasePick.title}
              </h2>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-white/60">
                {missingReleasePick.year && <span>{missingReleasePick.year}</span>}
                {missingReleasePick.type && <span>{missingReleasePick.type}</span>}
                {metric?.label && (
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-4 w-4 text-yellow-400" />
                    {metric.label}
                  </span>
                )}
              </div>
            </div>
            {canAddAlbum && missingReleasePick.releaseGroupId && (
              <div>
                <AddAlbumButton
                  className="add-album-btn--expanded"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleRequestAlbum(
                      missingReleasePick.releaseGroupId,
                      missingReleasePick.title,
                    );
                  }}
                  isLoading={requestingAlbum === missingReleasePick.releaseGroupId}
                  disabled={requestingAlbum === missingReleasePick.releaseGroupId}
                />
              </div>
            )}
          </div>
          <div className="min-w-0 xl:pl-2">
            {loadingTracks ? (
              <div className="flex h-full min-h-[180px] items-center justify-center">
                <Loader className="h-6 w-6 animate-spin text-white/65" />
              </div>
            ) : tracks.length ? (
              <div className="grid gap-x-4 gap-y-1 xl:grid-cols-2">
                {tracks.map((track, index) => {
                  const currentTrackId = String(
                    track.id ??
                      track.mbid ??
                      `${missingReleasePick.releaseGroupId}-${index}`,
                  );
                  const isPlaying = playingTrackId === currentTrackId;
                  const isLoadingPreview = loadingTrackId === currentTrackId;
                  return (
                    <div
                      key={currentTrackId}
                      className="grid grid-cols-[24px_28px_minmax(0,1fr)_auto_auto] items-center gap-2 px-2 py-1.5 text-sm transition-colors hover:bg-white/[0.06]"
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
                            missingReleasePick.releaseGroup,
                          )}
                          onLoadPlaylists={onLoadPlaylists}
                          onSelect={(target) =>
                            onAddTrackToPlaylist(
                              track,
                              missingReleasePick.releaseGroup,
                              target,
                            )
                          }
                        />
                      ) : null}
                      <span className="w-9 text-right text-xs tabular-nums text-white/45">
                        {formatDuration(track)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

ArtistDetailsDownloadTargets.propTypes = {
  targets: PropTypes.arrayOf(PropTypes.object).isRequired,
  artist: PropTypes.object,
  albumCovers: PropTypes.object,
  artistCoverImage: PropTypes.string,
  canAddAlbum: PropTypes.bool,
  requestingAlbum: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  handleRequestAlbum: PropTypes.func.isRequired,
  previewVolume: PropTypes.number,
  onAddTrackToPlaylist: PropTypes.func,
  playlists: PropTypes.array,
  playlistsLoading: PropTypes.bool,
  playlistSavingKey: PropTypes.string,
  playlistError: PropTypes.string,
  getDefaultPlaylistName: PropTypes.func,
  onLoadPlaylists: PropTypes.func,
};
