import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader, Music, AlertCircle, RefreshCw, Search } from "lucide-react";
import {
  getLibraryArtists,
  scanLibrary,
  getAllDownloadStatus,
} from "../utils/api";
import ArtistImage from "../components/ArtistImage";
import { useToast } from "../contexts/ToastContext";

function LibraryPage() {
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [currentPage, setCurrentPage] = useState(1);
  const [scanning, setScanning] = useState(false);
  const [downloadStatuses, setDownloadStatuses] = useState({});
  const ITEMS_PER_PAGE = 50;
  const navigate = useNavigate();
  const { showSuccess, showError, showInfo } = useToast();

  const fetchArtists = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getLibraryArtists();
      setArtists(data);
    } catch (err) {
      setError(
        err.response?.data?.message || "Failed to fetch artists from library",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchArtists();

    // Poll download status every 5 seconds
    const pollDownloadStatus = async () => {
      try {
        const statuses = await getAllDownloadStatus();
        setDownloadStatuses(statuses);
      } catch (error) {
        console.error("Failed to fetch download status:", error);
      }
    };

    pollDownloadStatus();
    const interval = setInterval(pollDownloadStatus, 5000);

    // Refresh artists list periodically to catch deletions
    const refreshInterval = setInterval(() => {
      fetchArtists();
    }, 10000); // Refresh every 10 seconds

    return () => {
      clearInterval(interval);
      clearInterval(refreshInterval);
    };
  }, []);

  const handleDiscoverAndScan = async () => {
    if (scanning) return;

    setScanning(true);
    try {
      showInfo(
        "Discovering artists from your music folder... This may take a few minutes.",
      );
      const result = await scanLibrary(true);
      showSuccess(
        `Discovery complete! Found ${result.artists || 0} artists, ${result.filesScanned || 0} files scanned.`,
      );
      // Refresh the library
      await fetchArtists(true);
    } catch (err) {
      showError(
        `Failed to discover library: ${err.response?.data?.message || err.message}`,
      );
    } finally {
      setScanning(false);
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
    currentPage * ITEMS_PER_PAGE,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortBy]);

  const getArtistImage = (artist) => {
    if (artist.imageUrl) {
      return artist.imageUrl;
    }

    if (artist.images && artist.images.length > 0) {
      const posterImage = artist.images.find(
        (img) => img.coverType === "poster" || img.coverType === "fanart",
      );
      const image = posterImage || artist.images[0];

      if (image && artist.id) {
        const coverType = image.coverType || "poster";
        const filename = `${coverType}.jpg`;
        // Images are handled through the image service
        return null;
      }

      return image?.remoteUrl || image?.url || null;
    }
    return null;
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
          <div className="flex gap-2 mt-2 md:mt-0">
            {artists.length === 0 && (
              <button
                onClick={handleDiscoverAndScan}
                disabled={scanning || loading}
                className="btn btn-primary btn-sm disabled:opacity-50"
              >
                <Search
                  className={`w-4 h-4 mr-2 ${scanning ? "animate-spin" : ""}`}
                />
                {scanning ? "Discovering..." : "Discover from Files"}
              </button>
            )}
            <button
              onClick={() => fetchArtists(true)}
              disabled={loading}
              className="btn btn-secondary btn-sm disabled:opacity-50"
            >
              <RefreshCw
                className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </div>
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
        <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-500/20 p-6">
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
            Your library is empty. Discover artists from your music folder or
            search and add them manually.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={handleDiscoverAndScan}
              disabled={scanning}
              className="btn btn-primary"
            >
              <Search
                className={`w-4 h-4 mr-2 ${scanning ? "animate-spin" : ""}`}
              />
              {scanning ? "Discovering..." : "Discover from Files"}
            </button>
            <button
              onClick={() => navigate("/search")}
              className="btn btn-secondary"
            >
              Search for Artists
            </button>
          </div>
        </div>
      )}

      {!loading && !error && currentArtists.length > 0 && (
        <div className="animate-slide-up">
          {searchTerm && (
            <div className="mb-3 text-sm text-gray-600 dark:text-gray-400">
              Showing {filteredArtists.length} of {artists.length} artists
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
            {currentArtists.map((artist) => {
              const image = getArtistImage(artist);
              // Check if artist is monitored (monitored = true and monitorOption !== 'none')
              const monitorOption =
                artist.addOptions?.monitor ||
                artist.monitorNewItems ||
                artist.monitorOption ||
                "none";
              const isMonitored = artist.monitored && monitorOption !== "none";

              return (
                <div key={artist.id} className="group relative">
                  <div
                    className="relative aspect-square bg-gray-200 dark:bg-gray-800 overflow-hidden cursor-pointer mb-2 shadow-sm group-hover:shadow-md transition-all"
                    onClick={() =>
                      navigate(`/artist/${artist.foreignArtistId}`)
                    }
                  >
                    <ArtistImage
                      src={image || artist.imageUrl}
                      mbid={artist.foreignArtistId}
                      alt={artist.artistName}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      showLoading={false}
                    />

                    {/* Monitoring dot indicator */}
                    <div className="absolute top-2 right-2">
                      <div
                        className={`w-3 h-3 ${
                          isMonitored ? "bg-green-500" : "bg-gray-400"
                        } shadow-md`}
                        title={isMonitored ? "Monitored" : "Unmonitored"}
                      />
                    </div>
                  </div>

                  {/* Artist Name */}
                  <h3
                    className="text-sm font-semibold text-gray-900 dark:text-gray-100 group-hover:text-primary-500 transition-colors cursor-pointer truncate text-center"
                    onClick={() =>
                      navigate(`/artist/${artist.foreignArtistId}`)
                    }
                    title={artist.artistName}
                  >
                    {artist.artistName}
                  </h3>
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
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
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
    </div>
  );
}

export default LibraryPage;
