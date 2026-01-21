import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader,
  Music,
  ExternalLink,
  Trash2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { getLidarrArtists, deleteArtistFromLidarr } from "../utils/api";
import ArtistImage from "../components/ArtistImage";
import { useToast } from "../contexts/ToastContext";

function LibraryPage() {
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deletingArtist, setDeletingArtist] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 24;
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

  const handleDeleteArtist = async (artist) => {
    const confirmDelete = window.confirm(
      `Are you sure you want to remove "${artist.artistName}" from Lidarr?\n\nThis will not delete the artist's files.`,
    );

    if (!confirmDelete) return;

    setDeletingArtist(artist.id);
    try {
      await deleteArtistFromLidarr(artist.id, false);
      setArtists((prev) => prev.filter((a) => a.id !== artist.id));
      showSuccess(`Successfully removed ${artist.artistName} from Lidarr`);
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

  // Reset page when search/sort changes
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
      <div className="card mb-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              Your Library
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              {loading
                ? "Loading..."
                : `${artists.length} artist${artists.length !== 1 ? "s" : ""} in your collection`}
            </p>
          </div>
          <button
            onClick={fetchArtists}
            disabled={loading}
            className="btn btn-secondary mt-4 md:mt-0 disabled:opacity-50"
          >
            <RefreshCw
              className={`w-5 h-5 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search library..."
              className="input"
            />
          </div>
          <div className="sm:w-48">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="input"
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
            <div className="mb-4 text-gray-600 dark:text-gray-400">
              Showing {filteredArtists.length} of {artists.length} artists
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {currentArtists.map((artist) => {
              const image = getArtistImage(artist);
              const status = getMonitoringStatus(artist);

              return (
                <div
                  key={artist.id}
                  className="card hover:shadow-md transition-shadow group min-w-0"
                >
                  <div className="flex gap-4 min-w-0">
                    {/* Artist Image */}
                    <div
                      className="w-24 h-24 flex-shrink-0 bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden cursor-pointer"
                      onClick={() =>
                        navigate(`/artist/${artist.foreignArtistId}`)
                      }
                    >
                      <ArtistImage
                        src={image}
                        mbid={artist.foreignArtistId}
                        alt={artist.artistName}
                        className="w-full h-full group-hover:scale-105 transition-transform"
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3
                        className="text-lg font-semibold text-gray-900 dark:text-gray-100 group-hover:text-primary-500 transition-colors cursor-pointer truncate"
                        onClick={() =>
                          navigate(`/artist/${artist.foreignArtistId}`)
                        }
                      >
                        {artist.artistName}
                      </h3>

                      <div className="mt-2 space-y-1">
                        <div className="flex items-center text-sm text-gray-600 dark:text-gray-400 min-w-0">
                          <span className="font-medium mr-2 flex-shrink-0">
                            Albums:
                          </span>
                          <span className="truncate">
                            {artist.statistics?.albumCount || 0}
                          </span>
                        </div>

                        <div className="flex items-center text-sm text-gray-600 dark:text-gray-400 min-w-0">
                          <span className="font-medium mr-2 flex-shrink-0">
                            Tracks:
                          </span>
                          <span className="truncate">
                            {artist.statistics?.trackCount || 0}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 mt-2">
                          <span
                            className={`badge ${
                              status.color === "green"
                                ? "badge-success"
                                : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                            }`}
                          >
                            {status.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 min-w-0">
                    <button
                      onClick={() =>
                        navigate(`/artist/${artist.foreignArtistId}`)
                      }
                      className="btn btn-secondary flex-1 text-sm"
                    >
                      View Details
                    </button>

                    <a
                      href={`https://musicbrainz.org/artist/${artist.foreignArtistId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-secondary text-sm"
                      title="View on MusicBrainz"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>

                    <button
                      onClick={() => handleDeleteArtist(artist)}
                      disabled={deletingArtist === artist.id}
                      className="btn btn-danger text-sm disabled:opacity-50"
                      title="Remove from Lidarr"
                    >
                      {deletingArtist === artist.id ? (
                        <Loader className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center mt-8 space-x-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="btn btn-secondary disabled:opacity-50"
              >
                Previous
              </button>
              <span className="flex items-center px-4 text-gray-700 dark:text-gray-300">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="btn btn-secondary disabled:opacity-50"
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
    </div>
  );
}

export default LibraryPage;
