import { useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Loader, Music, ArrowLeft } from "lucide-react";
import { useToast } from "../../contexts/ToastContext";
import { useArtistDetailsStream } from "./hooks/useArtistDetailsStream";
import { useReleaseTypeFilter } from "./hooks/useReleaseTypeFilter";
import { usePreviewPlayer } from "./hooks/usePreviewPlayer";
import { useArtistDetailsLibrary } from "./hooks/useArtistDetailsLibrary";
import { ArtistDetailsHero } from "./components/ArtistDetailsHero";
import { ArtistDetailsPreview } from "./components/ArtistDetailsPreview";
import { ArtistDetailsLibraryAlbums } from "./components/ArtistDetailsLibraryAlbums";
import { ArtistDetailsReleaseGroups } from "./components/ArtistDetailsReleaseGroups";
import { ArtistDetailsSimilar } from "./components/ArtistDetailsSimilar";
import { DeleteArtistModal } from "./components/DeleteArtistModal";
import { DeleteAlbumModal } from "./components/DeleteAlbumModal";

function ArtistDetailsPage() {
  const { mbid } = useParams();
  const { state: locationState } = useLocation();
  const navigate = useNavigate();
  const artistNameFromNav = locationState?.artistName;
  const { showSuccess, showError } = useToast();
  const similarArtistsScrollRef = useRef(null);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  const stream = useArtistDetailsStream(mbid, artistNameFromNav);
  const {
    artist,
    coverImages,
    libraryArtist,
    setLibraryArtist,
    libraryAlbums,
    setLibraryAlbums,
    similarArtists,
    loading,
    error,
    loadingCover,
    loadingSimilar,
    loadingLibrary,
    existsInLibrary,
    setExistsInLibrary,
    appSettings,
    albumCovers,
  } = stream;

  const filter = useReleaseTypeFilter();
  const {
    selectedReleaseTypes,
    setSelectedReleaseTypes,
    primaryReleaseTypes,
    secondaryReleaseTypes,
  } = filter;

  const preview = usePreviewPlayer(mbid, artistNameFromNav, artist);
  const {
    previewTracks,
    loadingPreview,
    playingPreviewId,
    previewProgress,
    previewSnappingBack,
    previewAudioRef,
    handlePreviewPlay,
  } = preview;

  const library = useArtistDetailsLibrary({
    artist,
    libraryArtist,
    setLibraryArtist,
    libraryAlbums,
    setLibraryAlbums,
    existsInLibrary,
    setExistsInLibrary,
    appSettings,
    showSuccess,
    showError,
    selectedReleaseTypes,
  });

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader
          className="w-12 h-12 animate-spin"
          style={{ color: "#c1c1c3" }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <div className="text-center py-12">
          <Music
            className="w-16 h-16 mx-auto mb-4"
            style={{ color: "#c1c1c3" }}
          />
          <h3 className="text-xl font-semibold mb-2" style={{ color: "#fff" }}>
            Error Loading Artist
          </h3>
          <p className="mb-6" style={{ color: "#c1c1c3" }}>
            {error}
          </p>
          <button
            onClick={() => navigate("/search")}
            className="btn btn-primary"
          >
            Back to Search
          </button>
        </div>
      </div>
    );
  }

  if (!artist) {
    return null;
  }

  return (
    <div className="animate-fade-in">
      <button
        onClick={() => navigate(-1)}
        className="btn btn-secondary mb-6 inline-flex items-center"
      >
        <ArrowLeft className="w-5 h-5 mr-2" />
        Back
      </button>

      <ArtistDetailsHero
        artist={artist}
        coverImages={coverImages}
        loadingCover={loadingCover}
        loadingLibrary={loadingLibrary}
        existsInLibrary={existsInLibrary}
        showRemoveDropdown={library.showRemoveDropdown}
        setShowRemoveDropdown={library.setShowRemoveDropdown}
        showMonitorOptionMenu={library.showMonitorOptionMenu}
        setShowMonitorOptionMenu={library.setShowMonitorOptionMenu}
        updatingMonitor={library.updatingMonitor}
        getCurrentMonitorOption={library.getCurrentMonitorOption}
        handleUpdateMonitorOption={library.handleUpdateMonitorOption}
        handleDeleteClick={library.handleDeleteClick}
        handleAddToLibrary={library.handleAddToLibrary}
        handleRefreshArtist={library.handleRefreshArtist}
        refreshingArtist={library.refreshingArtist}
        onNavigate={(path) => navigate(path)}
      />

      {(artist || artistNameFromNav) && (
        <ArtistDetailsPreview
          loadingPreview={loadingPreview}
          previewTracks={previewTracks}
          previewAudioRef={previewAudioRef}
          playingPreviewId={playingPreviewId}
          previewProgress={previewProgress}
          previewSnappingBack={previewSnappingBack}
          handlePreviewPlay={handlePreviewPlay}
        />
      )}

      {existsInLibrary && libraryAlbums && libraryAlbums.length > 0 && (
        <ArtistDetailsLibraryAlbums
          artist={artist}
          libraryAlbums={libraryAlbums}
          downloadStatuses={library.downloadStatuses}
          requestingAlbum={library.requestingAlbum}
          albumCovers={albumCovers}
          expandedLibraryAlbum={library.expandedLibraryAlbum}
          albumTracks={library.albumTracks}
          loadingTracks={library.loadingTracks}
          albumDropdownOpen={library.albumDropdownOpen}
          setAlbumDropdownOpen={library.setAlbumDropdownOpen}
          handleLibraryAlbumClick={library.handleLibraryAlbumClick}
          handleDeleteAlbumClick={library.handleDeleteAlbumClick}
        />
      )}

      {artist["release-groups"] && artist["release-groups"].length > 0 && (
        <ArtistDetailsReleaseGroups
          artist={artist}
          selectedReleaseTypes={selectedReleaseTypes}
          setSelectedReleaseTypes={setSelectedReleaseTypes}
          primaryReleaseTypes={primaryReleaseTypes}
          secondaryReleaseTypes={secondaryReleaseTypes}
          showFilterDropdown={showFilterDropdown}
          setShowFilterDropdown={setShowFilterDropdown}
          existsInLibrary={existsInLibrary}
          handleMonitorAll={library.handleMonitorAll}
          processingBulk={library.processingBulk}
          albumCovers={albumCovers}
          expandedReleaseGroup={library.expandedReleaseGroup}
          albumTracks={library.albumTracks}
          loadingTracks={library.loadingTracks}
          getAlbumStatus={library.getAlbumStatus}
          albumDropdownOpen={library.albumDropdownOpen}
          setAlbumDropdownOpen={library.setAlbumDropdownOpen}
          handleReleaseGroupAlbumClick={library.handleReleaseGroupAlbumClick}
          handleRequestAlbum={library.handleRequestAlbum}
          handleDeleteAlbumClick={library.handleDeleteAlbumClick}
          requestingAlbum={library.requestingAlbum}
          isReleaseGroupDownloadedInLibrary={
            library.isReleaseGroupDownloadedInLibrary
          }
        />
      )}

      {(loadingSimilar || similarArtists.length > 0) && (
        <ArtistDetailsSimilar
          loadingSimilar={loadingSimilar}
          similarArtists={similarArtists}
          similarArtistsScrollRef={similarArtistsScrollRef}
          onArtistClick={(id, name) =>
            navigate(`/artist/${id}`, { state: { artistName: name } })
          }
        />
      )}

      <DeleteArtistModal
        show={library.showDeleteModal && !!libraryArtist}
        artistName={artist?.name}
        libraryArtistName={libraryArtist?.artistName}
        deleteFiles={library.deleteFiles}
        onDeleteFilesChange={library.setDeleteFiles}
        onCancel={library.handleDeleteCancel}
        onConfirm={library.handleDeleteConfirm}
        deleting={library.deletingArtist}
      />

      <DeleteAlbumModal
        show={!!library.showDeleteAlbumModal}
        title={library.showDeleteAlbumModal?.title}
        deleteFiles={library.deleteAlbumFiles}
        onDeleteFilesChange={library.setDeleteAlbumFiles}
        onCancel={library.handleDeleteAlbumCancel}
        onConfirm={library.handleDeleteAlbumConfirm}
        removing={library.removingAlbum}
      />
    </div>
  );
}

export default ArtistDetailsPage;
