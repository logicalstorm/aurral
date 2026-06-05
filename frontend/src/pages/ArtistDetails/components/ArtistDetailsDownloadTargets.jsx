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
        loading="lazy"
        decoding="async"
      />
    );
  }
  return (
    <div className="artist-media-placeholder">
      <Music className="artist-icon-lg" />
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
    <section className="artist-section">
      <div className="artist-pick-panel">
        <div className="artist-pick-panel__grid">
          <audio ref={previewAudioRef} preload="none" />
          <div className="artist-media-cell">
            <PickCover
              pick={missingReleasePick}
              albumCovers={albumCovers}
              artistCoverImage={artistCoverImage}
            />
          </div>
          <div className="artist-pick-panel__content">
            <div className="artist-min-0">
              <div className="artist-eyebrow">
                Aurral Pick
              </div>
              <h2 className="artist-pick-title">
                {missingReleasePick.title}
              </h2>
              <div className="artist-meta-line">
                {missingReleasePick.year && <span>{missingReleasePick.year}</span>}
                {missingReleasePick.type && <span>{missingReleasePick.type}</span>}
                {metric?.label && (
                  <span className="artist-meta-line__item">
                    <Star className="artist-star-icon" />
                    {metric.label}
                  </span>
                )}
              </div>
            </div>
            {canAddAlbum && missingReleasePick.releaseGroupId && (
              <div>
                <AddAlbumButton
                  className="btn-add-album is-expanded"
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
          <div className="artist-pick-panel__tracks artist-min-0">
            {loadingTracks ? (
              <div className="artist-loading">
                <Loader className="artist-spinner animate-spin" />
              </div>
            ) : tracks.length ? (
              <div className="artist-pick-panel__track-grid">
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
                      className="artist-track-row artist-track-row--compact"
                    >
                      <span className="artist-track-number">
                        {track.trackNumber || track.position || index + 1}
                      </span>
                      {track.preview_url ? (
                        <button
                          type="button"
                          className="btn btn-surface btn-track-play"
                          onClick={(event) => handleTrackPreviewPlay(track, event)}
                          aria-label={isPlaying ? "Pause preview" : "Play preview"}
                          title={isPlaying ? "Pause preview" : "Play preview"}
                        >
                          {isLoadingPreview ? (
                            <Loader className="artist-icon-xs animate-spin" />
                          ) : isPlaying ? (
                            <Pause className="artist-icon-xs" />
                          ) : (
                            <Play className="artist-icon-xs" />
                          )}
                        </button>
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
                      <span className="artist-track-duration">
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
