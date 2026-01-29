import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader, Music, AlertCircle, RefreshCw } from "lucide-react";
import { getLibraryArtists, getAllDownloadStatus } from "../utils/api";
import ArtistImage from "../components/ArtistImage";
import { useToast } from "../contexts/ToastContext";

function LibraryPage() {
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [downloadStatuses, setDownloadStatuses] = useState({});
  const navigate = useNavigate();
  const { showError } = useToast();

  const fetchArtists = async () => {
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

    const pollDownloadStatus = async () => {
      try {
        const statuses = await getAllDownloadStatus();
        setDownloadStatuses(statuses);
      } catch (error) {
        console.error("Failed to fetch download status:", error);
      }
    };

    pollDownloadStatus();
    const interval = setInterval(pollDownloadStatus, 15000);

    return () => {
      clearInterval(interval);
    };
  }, []);

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

  const getArtistImage = (artist) => {
    if (artist.imageUrl) {
      return artist.imageUrl;
    }

    if (artist.images && artist.images.length > 0) {
      const posterImage = artist.images.find(
        (img) => img.coverType === "poster" || img.coverType === "fanart",
      );
      const image = posterImage || artist.images[0];
      return image?.remoteUrl || image?.url || null;
    }
    return null;
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-4 p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold mb-1" style={{ color: "#fff" }}>
              Your Library
            </h1>
            <p className="text-sm" style={{ color: "#c1c1c3" }}>
              {loading
                ? "Loading..."
                : `${artists.length} artist${artists.length !== 1 ? "s" : ""} in your collection`}
            </p>
          </div>
          <div className="flex gap-2 mt-2 md:mt-0">
            <button
              onClick={() => fetchArtists()}
              disabled={loading}
              className="btn btn-secondary btn-sm disabled:opacity-50"
              title="Refresh library from Lidarr"
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
          <Loader
            className="w-12 h-12 animate-spin"
            style={{ color: "#c1c1c3" }}
          />
        </div>
      )}

      {error && (
        <div className="bg-red-500/20 ">
          <div className="flex items-center">
            <AlertCircle className="w-6 h-6 text-red-400 mr-3" />
            <div>
              <h3 className="text-red-400 font-semibold">
                Error Loading Library
              </h3>
              <p className="text-red-300 mt-1">{error}</p>
            </div>
          </div>
          <button onClick={fetchArtists} className="btn btn-primary mt-4">
            Try Again
          </button>
        </div>
      )}

      {!loading && !error && artists.length === 0 && (
        <div className="card text-center py-12">
          <Music
            className="w-16 h-16 mx-auto mb-4"
            style={{ color: "#c1c1c3" }}
          />
          <h3 className="text-xl font-semibold mb-2" style={{ color: "#fff" }}>
            No Artists in Library
          </h3>
          <p className="mb-6" style={{ color: "#c1c1c3" }}>
            Your library is empty. Search and add artists in Lidarr.
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

      {!loading && !error && filteredArtists.length > 0 && (
        <div className="animate-slide-up">
          {searchTerm && (
            <div className="mb-3 text-sm" style={{ color: "#c1c1c3" }}>
              Showing {filteredArtists.length} of {artists.length} artists
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
            {filteredArtists.map((artist) => {
              const lidarrImage = getArtistImage(artist);
              const monitorOption =
                artist.addOptions?.monitor ||
                artist.monitorNewItems ||
                artist.monitorOption ||
                "none";
              const isMonitored = artist.monitored && monitorOption !== "none";

              return (
                <div key={artist.id} className="group relative">
                  <div
                    className="relative aspect-square overflow-hidden cursor-pointer mb-2 shadow-sm group-hover:shadow-md transition-all"
                    style={{ backgroundColor: "#211f27" }}
                    onClick={() =>
                      navigate(`/artist/${artist.foreignArtistId}`, { state: { artistName: artist.artistName } })
                    }
                  >
                    <ArtistImage
                      src={lidarrImage || undefined}
                      mbid={artist.foreignArtistId}
                      artistName={artist.artistName}
                      alt={artist.artistName}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      showLoading={false}
                    />

                    {/* Monitoring dot indicator */}
                    {isMonitored && (
                      <div className="absolute top-2 right-2">
                        <div
                          className="w-3 h-3 bg-green-500 shadow-md"
                          title="Monitored"
                        />
                      </div>
                    )}
                  </div>

                  {/* Artist Name */}
                  <h3
                    className="text-sm font-semibold group-hover:underline transition-colors cursor-pointer truncate text-center"
                    style={{ color: "#fff" }}
                    onClick={() =>
                      navigate(`/artist/${artist.foreignArtistId}`, { state: { artistName: artist.artistName } })
                    }
                    title={artist.artistName}
                  >
                    {artist.artistName}
                  </h3>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading &&
        !error &&
        artists.length > 0 &&
        filteredArtists.length === 0 && (
          <div className="card text-center py-12">
            <Music
              className="w-16 h-16 mx-auto mb-4"
              style={{ color: "#c1c1c3" }}
            />
            <h3
              className="text-xl font-semibold mb-2"
              style={{ color: "#fff" }}
            >
              No Artists Found
            </h3>
            <p className="mb-4" style={{ color: "#c1c1c3" }}>
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
