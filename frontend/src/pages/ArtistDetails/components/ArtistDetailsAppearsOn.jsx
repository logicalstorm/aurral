import { useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import { ArrowRight, CheckCircle, Music, Star } from "lucide-react";
import AddAlbumButton from "../../../components/AddAlbumButton";
import { getReleaseMetric, getReleaseYear } from "../utils";
import { ArtistDetailsReleaseTrackList } from "./ArtistDetailsReleaseTrackList";

const sortLatest = (items) =>
  [...items].sort((a, b) =>
    String(b["first-release-date"] || "").localeCompare(
      String(a["first-release-date"] || ""),
    ),
  );

export function ArtistDetailsAppearsOn({
  artist,
  albumCovers,
  artistCoverImage,
  expandedReleaseGroup,
  albumTracks,
  loadingTracks,
  getAlbumStatus,
  handleReleaseGroupAlbumClick,
  canAddAlbum,
  handleRequestAlbum,
  requestingAlbum,
  previewVolume,
  onAddTrackToPlaylist,
  playlists,
  playlistsLoading,
  playlistSavingKey,
  playlistError,
  getDefaultPlaylistName,
  onLoadPlaylists,
  onVisibleCoverIdsChange,
  onViewAll,
}) {
  const releaseGroups = useMemo(
    () => artist["appears-on-release-groups"] || [],
    [artist],
  );
  const visibleReleaseGroups = useMemo(
    () => sortLatest(releaseGroups).slice(0, 6),
    [releaseGroups],
  );

  useEffect(() => {
    onVisibleCoverIdsChange?.(visibleReleaseGroups.map((item) => item.id).filter(Boolean));
  }, [onVisibleCoverIdsChange, visibleReleaseGroups]);

  const expandedRelease = visibleReleaseGroups.find(
    (releaseGroup) => releaseGroup.id === expandedReleaseGroup,
  );
  const expandedStatus = expandedRelease ? getAlbumStatus(expandedRelease.id) : null;
  const expandedTrackKey = expandedStatus?.libraryId || expandedRelease?.id;
  const expandedTracks = expandedTrackKey ? albumTracks[expandedTrackKey] : null;
  const expandedLoading = expandedTrackKey ? loadingTracks[expandedTrackKey] : false;

  if (releaseGroups.length === 0) return null;

  return (
    <section className="artist-section">
      <div className="artist-heading-row">
        <div className="artist-min-0">
          <h2 className="artist-section-title">Appears On</h2>
        </div>
        {onViewAll ? (
          <button
            type="button"
            onClick={onViewAll}
            className="artist-link-button"
          >
            View All
            <ArrowRight className="artist-icon-sm" />
          </button>
        ) : null}
      </div>

      <div className="artist-release-grid">
        {visibleReleaseGroups.map((releaseGroup) => {
          const status = getAlbumStatus(releaseGroup.id);
          const metric = getReleaseMetric(releaseGroup);
          const artistCredit = releaseGroup["artist-credit"]?.[0]?.name || "";
          return (
            <article
              key={releaseGroup.id}
              className="artist-release-card"
              onClick={() => handleReleaseGroupAlbumClick(releaseGroup, status?.libraryId)}
            >
              <div className="artist-release-card__cover">
                {albumCovers[releaseGroup.id] || artistCoverImage ? (
                  <img
                    src={albumCovers[releaseGroup.id] || artistCoverImage}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="artist-release-card__placeholder">
                    <Music className="artist-icon-lg" />
                  </div>
                )}
                <div className="artist-release-card__action">
                  {status?.status === "available" || status?.status === "added" ? (
                    <span className="artist-release-card__status" title="Complete">
                      <CheckCircle className="artist-icon-sm" />
                      <span className="sr-only">Complete</span>
                    </span>
                  ) : canAddAlbum ? (
                    <div onClick={(event) => event.stopPropagation()}>
                      <AddAlbumButton
                        onClick={(event) => {
                          event.stopPropagation();
                          handleRequestAlbum(releaseGroup.id, releaseGroup.title);
                        }}
                        isLoading={requestingAlbum === releaseGroup.id}
                        disabled={requestingAlbum === releaseGroup.id}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
              <h3 className="artist-release-card__title artist-clamp-2">
                {releaseGroup.title}
              </h3>
              <p className="artist-release-card__meta artist-truncate">
                {[getReleaseYear(releaseGroup), artistCredit || releaseGroup["primary-type"]]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {releaseGroup._appearsOnTrack && (
                <p className="artist-release-card__meta artist-truncate">
                  {releaseGroup._appearsOnTrack}
                </p>
              )}
              {metric.label && (
                <p className="artist-release-card__metric">
                  <Star className="artist-star-icon" />
                  {metric.label}
                </p>
              )}
            </article>
          );
        })}
      </div>

      {expandedRelease && (
        <ArtistDetailsReleaseTrackList
          release={expandedRelease}
          trackKey={expandedTrackKey}
          tracks={expandedTracks}
          loading={expandedLoading}
          previewVolume={previewVolume}
          onAddTrackToPlaylist={onAddTrackToPlaylist}
          playlists={playlists}
          playlistsLoading={playlistsLoading}
          playlistSavingKey={playlistSavingKey}
          playlistError={playlistError}
          getDefaultPlaylistName={getDefaultPlaylistName}
          onLoadPlaylists={onLoadPlaylists}
        />
      )}
    </section>
  );
}

ArtistDetailsAppearsOn.propTypes = {
  artist: PropTypes.object.isRequired,
  albumCovers: PropTypes.object,
  artistCoverImage: PropTypes.string,
  expandedReleaseGroup: PropTypes.string,
  albumTracks: PropTypes.object,
  loadingTracks: PropTypes.object,
  getAlbumStatus: PropTypes.func.isRequired,
  handleReleaseGroupAlbumClick: PropTypes.func.isRequired,
  canAddAlbum: PropTypes.bool,
  handleRequestAlbum: PropTypes.func.isRequired,
  requestingAlbum: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  previewVolume: PropTypes.number,
  onAddTrackToPlaylist: PropTypes.func,
  playlists: PropTypes.array,
  playlistsLoading: PropTypes.bool,
  playlistSavingKey: PropTypes.string,
  playlistError: PropTypes.string,
  getDefaultPlaylistName: PropTypes.func,
  onLoadPlaylists: PropTypes.func,
  onVisibleCoverIdsChange: PropTypes.func,
  onViewAll: PropTypes.func,
};
