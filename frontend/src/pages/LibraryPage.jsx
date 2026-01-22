import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader,
  Music,
  ExternalLink,
  Trash2,
  AlertCircle,
  RefreshCw,
  ChevronDown,
} from "lucide-react";
import { getLidarrArtists, deleteArtistFromLidarr } from "../utils/api";
import ArtistImage from "../components/ArtistImage";
import { useToast } from "../contexts/ToastContext";

function LibraryPage() {
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deletingArtist, setDeletingArtist] = useState(null);
  const [artistToDelete, setArtistToDelete] = useState(null);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [currentPage, setCurrentPage] = useState(1);
  const [dropdownOpen, setDropdownOpen] = useState(null);
  const ITEMS_PER_PAGE = 50;
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();

  const fetchArtists = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getLidarrArtists();
      setArtists(data);
    } catch (err) {
      setError(
        err.response?.data?.message || "Failed to fetch artists from Lidarr",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchArtists();
  }, []);

  const handleDeleteClick = (artist) => {
    setArtistToDelete(artist);
    setDeleteFiles(false);
  };

  const handleDeleteCancel = () => {
    setArtistToDelete(null);
    setDeleteFiles(false);
  };

  const handleDeleteConfirm = async () => {
    if (!artistToDelete) return;

    setDeletingArtist(artistToDelete.id);
    try {
      await deleteArtistFromLidarr(artistToDelete.id, deleteFiles);
      setArtists((prev) => prev.filter((a) => a.id !== artistToDelete.id));
      showSuccess(
        `Successfully removed ${artistToDelete.artistName} from Lidarr${
          deleteFiles ? " and deleted files" : ""
        }`,
      );
      setArtistToDelete(null);
      setDeleteFiles(false);
    } catch (err) {
      showError(
        `Failed to delete artist: ${err.response?.data?.message || err.message}`,
      );
    } finally {
      setDeletingArtist(null);
    }
  };

  const getFilteredAndSortedArtists = () => {
    let filtered = artists;

    if (searchTerm) {
      filtered = filtered.filter((artist) =>
        artist.artistName.toLowerCase().includes(searchTerm.toLowerCase()),
      );
    }

    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.artistName.localeCompare(b.artistName);
        case "added":
          return new Date(b.added) - new Date(a.added);
        case "albums":
          return (
            (b.statistics?.albumCount || 0) - (a.statistics?.albumCount || 0)
          );
        default:
          return 0;
      }
    });

    return sorted;
  };

  const filteredArtists = getFilteredAndSortedArtists();
  const totalPages = Math.ceil(filteredArtists.length / ITEMS_PER_PAGE);
  
  const currentArtists = filteredArtists.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortBy]);

  const getArtistImage = (artist) => {
    if (artist.images && artist.images.length > 0) {
      const posterImage = artist.images.find(
        (img) => img.coverType === "poster" || img.coverType === "fanart",
      );
      const image = posterImage || artist.images[0];

      if (image && artist.id) {
        const coverType = image.coverType || "poster";
        const filename = `${coverType}.jpg`;
        return `/api/lidarr/mediacover/${artist.id}/${filename}`;
      }

      return image?.remoteUrl || image?.url || null;
    }
    return null;
  };

  const getMonitoringStatus = (artist) => {
    if (artist.monitored) {
      return { label: "Monitored", color: "green" };
    }
    return { label: "Unmonitored", color: "gray" };
  };

  return (
    <div className="animate-fade-in">
      <div className="card mb-4 p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
              Your Library
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {loading
                ? "Loading..."
                : `${artists.length} artist${artists.length !== 1 ? "s" : ""} in your collection`}
            </p>
          </div>
          <button
            onClick={fetchArtists}
            disabled={loading}
            className="btn btn-secondary btn-sm mt-2 md:mt-0 disabled:opacity-50"
          >
            <RefreshCw
              className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search library..."
              className="input input-sm"
            />
          </div>
          <div className="sm:w-40">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="input input-sm"
            >
              <option value="name">Sort by Name</option>
              <option value="added">Sort by Date Added</option>
              <option value="albums">Sort by Album Count</option>
            </select>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex justify-center items-center py-20">
          <Loader className="w-12 h-12 text-primary-600 animate-spin" />
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-500/20 rounded-lg p-6">
          <div className="flex items-center">
            <AlertCircle className="w-6 h-6 text-red-500 mr-3" />
            <div>
              <h3 className="text-red-900 dark:text-red-400 font-semibold">
                Error Loading Library
              </h3>
              <p className="text-red-700 dark:text-red-300 mt-1">{error}</p>
            </div>
          </div>
          <button onClick={fetchArtists} className="btn btn-primary mt-4">
            Try Again
          </button>
        </div>
      )}

      {!loading && !error && artists.length === 0 && (
        <div className="card text-center py-12">
          <Music className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
            No Artists in Library
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            Your Lidarr library is empty. Start by searching and adding artists.
          </p>
          <button
            onClick={() => navigate("/search")}
            className="btn btn-primary"
          >
            Search for Artists
          </button>
        </div>
      )}

      {!loading && !error && currentArtists.length > 0 && (
        <div className="animate-slide-up">
          {searchTerm && (
            <div className="mb-3 text-sm text-gray-600 dark:text-gray-400">
              Showing {filteredArtists.length} of {artists.length} artists
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {currentArtists.map((artist) => {
              const image = getArtistImage(artist);
              const status = getMonitoringStatus(artist);

              return (
                <div
                  key={artist.id}
                  className="card hover:shadow-md transition-shadow group p-3"
                >
                  <div
                    className="w-full aspect-square bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden cursor-pointer mb-2"
                    onClick={() =>
                      navigate(`/artist/${artist.foreignArtistId}`)
                    }
                  >
                    <ArtistImage
                      src={image}
                      mbid={artist.foreignArtistId}
                      alt={artist.artistName}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  </div>

                  {/* Artist Name */}
                  <h3
                    className="text-sm font-semibold text-gray-900 dark:text-gray-100 group-hover:text-primary-500 transition-colors cursor-pointer truncate mb-1.5"
                    onClick={() =>
                      navigate(`/artist/${artist.foreignArtistId}`)
                    }
                    title={artist.artistName}
                  >
                    {artist.artistName}
                  </h3>

                  <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 mb-2">
                    <span>{artist.statistics?.albumCount || 0} albums</span>
                    <span>{artist.statistics?.trackCount || 0} tracks</span>
                  </div>

                  {/* Status Badge and Actions */}
                  <div className="flex items-center justify-between">
                    <span
                      className={`badge text-xs ${
                        status.color === "green"
                          ? "badge-success"
                          : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                      }`}
                    >
                      {status.label}
                    </span>
                    <div className="relative">
                      <button
                        onClick={() =>
                          setDropdownOpen(
                            dropdownOpen === artist.id ? null : artist.id
                          )
                        }
                        className="btn btn-secondary text-xs py-1 px-2"
                        title="Options"
                      >
                        <ChevronDown
                          className={`w-3 h-3 transition-transform ${
                            dropdownOpen === artist.id ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                      {dropdownOpen === artist.id && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setDropdownOpen(null)}
                          />
                          <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 py-1">
                            <a
                              href={`https://musicbrainz.org/artist/${artist.foreignArtistId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => setDropdownOpen(null)}
                              className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center"
                            >
                              <ExternalLink className="w-4 h-4 mr-2" />
                              View on MusicBrainz
                            </a>
                            <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                            <button
                              onClick={() => {
                                handleDeleteClick(artist);
                                setDropdownOpen(null);
                              }}
                              disabled={deletingArtist === artist.id}
                              className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center disabled:opacity-50"
                            >
                              {deletingArtist === artist.id ? (
                                <Loader className="w-4 h-4 mr-2 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4 mr-2" />
                              )}
                              Remove from Lidarr
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center mt-6 space-x-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="btn btn-secondary btn-sm disabled:opacity-50"
              >
                Previous
              </button>
              <span className="flex items-center px-4 text-sm text-gray-700 dark:text-gray-300">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="btn btn-secondary btn-sm disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {!loading &&
        !error &&
        artists.length > 0 &&
        filteredArtists.length === 0 && (
          <div className="card text-center py-12">
            <Music className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
              No Artists Found
            </h3>
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              No artists match your search "{searchTerm}"
            </p>
            <button
              onClick={() => setSearchTerm("")}
              className="btn btn-secondary"
            >
              Clear Search
            </button>
          </div>
        )}

      {artistToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              Remove Artist from Lidarr
            </h3>
            <p className="text-gray-700 dark:text-gray-300 mb-6">
              Are you sure you want to remove{" "}
              <span className="font-semibold">{artistToDelete.artistName}</span>{" "}
              from Lidarr?
            </p>

            <div className="mb-6">
              <label className="flex items-start space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteFiles}
                  onChange={(e) => setDeleteFiles(e.target.checked)}
                  className="mt-1 form-checkbox h-5 w-5 text-primary-600 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                />
                <div className="flex-1">
                  <span className="text-gray-900 dark:text-gray-100 font-medium">
                    Delete artist folder and files
                  </span>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    This will permanently delete the artist's folder and all music
                    files from your disk. This action cannot be undone.
                  </p>
                </div>
              </label>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={handleDeleteCancel}
                disabled={deletingArtist === artistToDelete.id}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deletingArtist === artistToDelete.id}
                className="btn btn-danger"
              >
                {deletingArtist === artistToDelete.id ? (
                  <>
                    <Loader className="w-4 h-4 mr-2 animate-spin" />
                    Removing...
                  </>
                ) : (
                  "Remove Artist"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LibraryPage;
