import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  ArrowRight,
  CheckCircle,
  Loader,
  Music,
  Star,
} from "lucide-react";
import AddAlbumButton from "../../../components/AddAlbumButton";
import { getReleaseMetric, getReleaseYear } from "../utils";
import { ArtistDetailsReleaseTrackList } from "./ArtistDetailsReleaseTrackList";

const viewModes = [
  { value: "popular", label: "Popular Releases" },
  { value: "albums", label: "Albums" },
  { value: "singles", label: "Singles & EPs" },
  { value: "compilations", label: "Compilations" },
];

const isCompilation = (releaseGroup) =>
  releaseGroup?.["primary-type"] === "Compilation" ||
  (releaseGroup?.["secondary-types"] || []).includes("Compilation");

const isSingleOrEp = (releaseGroup) =>
  releaseGroup?.["primary-type"] === "Single" ||
  releaseGroup?.["primary-type"] === "EP";

const sortLatest = (items) =>
  [...items].sort((a, b) =>
    String(b["first-release-date"] || "").localeCompare(
      String(a["first-release-date"] || ""),
    ),
  );

const getVisibleReleases = (releaseGroups, viewMode) => {
  if (viewMode === "popular") {
    return [...releaseGroups]
      .sort((a, b) => getReleaseMetric(b).sortValue - getReleaseMetric(a).sortValue)
      .slice(0, 6);
  }
  if (viewMode === "albums") {
    return sortLatest(
      releaseGroups.filter(
        (releaseGroup) =>
          releaseGroup?.["primary-type"] === "Album" &&
          !isCompilation(releaseGroup),
      ),
    ).slice(0, 6);
  }
  if (viewMode === "singles") {
    return sortLatest(
      releaseGroups.filter(
        (releaseGroup) => isSingleOrEp(releaseGroup) && !isCompilation(releaseGroup),
      ),
    ).slice(0, 6);
  }
  return sortLatest(releaseGroups.filter(isCompilation)).slice(0, 6);
};

export function ArtistDetailsReleaseGroups({
  artist,
  loadingReleases,
  albumCovers,
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
  const [viewMode, setViewMode] = useState("popular");
  const releaseGroups = useMemo(
    () => artist["release-groups"] || [],
    [artist],
  );
  const visibleReleaseGroups = useMemo(
    () => getVisibleReleases(releaseGroups, viewMode),
    [releaseGroups, viewMode],
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
    <section className="mb-10">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-white">Discography</h2>
            {loadingReleases && <Loader className="h-4 w-4 animate-spin text-white/65" />}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {viewModes.map((mode) => (
              <button
                key={mode.value}
                type="button"
                onClick={() => setViewMode(mode.value)}
                className="px-3 py-1.5 text-xs font-bold transition-colors"
                style={{
                  backgroundColor:
                    viewMode === mode.value ? "#fff" : "rgba(255,255,255,0.08)",
                  color: viewMode === mode.value ? "#050505" : "#fff",
                }}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={onViewAll}
          className="inline-flex items-center gap-2 text-sm font-bold text-white/70 transition-colors hover:text-white"
        >
          View All
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-6 lg:gap-x-5">
        {visibleReleaseGroups.map((releaseGroup) => {
          const status = getAlbumStatus(releaseGroup.id);
          const metric = getReleaseMetric(releaseGroup);
          return (
            <article
              key={releaseGroup.id}
              className="group min-w-0 cursor-pointer"
              onClick={() => handleReleaseGroupAlbumClick(releaseGroup, status?.libraryId)}
            >
              <div className="relative mb-2 aspect-square overflow-hidden bg-white/[0.06] shadow-lg shadow-black/20">
                {albumCovers[releaseGroup.id] ? (
                  <img
                    src={albumCovers[releaseGroup.id]}
                    alt=""
                    className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Music className="h-9 w-9 text-white/35" />
                  </div>
                )}
                <div className="absolute bottom-2 right-2">
                  {status?.status === "available" || status?.status === "added" ? (
                    <span
                      className="inline-flex h-8 min-w-12 items-center justify-center rounded-full bg-green-500 text-white shadow-lg shadow-black/30 ring-1 ring-white/15"
                      title="Complete"
                    >
                      <CheckCircle className="h-4 w-4" />
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
              <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-bold leading-5 text-white">
                {releaseGroup.title}
              </h3>
              <p className="mt-1 truncate text-xs text-white/50">
                {[getReleaseYear(releaseGroup), releaseGroup["primary-type"]]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {metric.label && (
                <p className="mt-2 inline-flex items-center gap-1 text-xs text-white/50">
                  <Star className="h-3.5 w-3.5 text-yellow-400" />
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

ArtistDetailsReleaseGroups.propTypes = {
  artist: PropTypes.object.isRequired,
  loadingReleases: PropTypes.bool,
  albumCovers: PropTypes.object,
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
  onViewAll: PropTypes.func.isRequired,
};
