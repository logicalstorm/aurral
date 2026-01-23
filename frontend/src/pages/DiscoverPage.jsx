import { useState, useEffect, useMemo, memo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader,
  Music,
  Sparkles,
  TrendingUp,
  ExternalLink,
  CheckCircle,
  Tag,
  PlayCircle,
  Clock,
  History,
} from "lucide-react";
import {
  getDiscovery,
  getRequests,
  getRecentlyAdded,
  getAllDownloadStatus,
} from "../utils/api";
import { useToast } from "../contexts/ToastContext";
import ArtistImage from "../components/ArtistImage";

function DiscoverPage() {
  const [data, setData] = useState(null);
  const [requests, setRequests] = useState([]);
  const [recentlyAdded, setRecentlyAdded] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloadStatuses, setDownloadStatuses] = useState({});
  const downloadStatusesRef = useRef({});
  const navigate = useNavigate();
  const { showSuccess } = useToast();

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [discoveryData, requestsData, recentlyAddedData] =
          await Promise.all([
            getDiscovery(),
            getRequests(),
            getRecentlyAdded(),
          ]);

        setData(discoveryData);
        setRequests(requestsData);
        setRecentlyAdded(recentlyAddedData);
        downloadStatusesRef.current = {};
        setLoading(false);
      } catch (err) {
        setError(
          err.response?.data?.message || "Failed to load discovery data",
        );
        setLoading(false);
      }
    };

    fetchData();

    // Poll download status every 5 seconds, but only update if changed
    const pollDownloadStatus = async () => {
      try {
        const statuses = await getAllDownloadStatus();
        // Only update if the statuses actually changed (shallow comparison of keys and values)
        const prev = downloadStatusesRef.current;
        const prevKeys = Object.keys(prev).sort().join(',');
        const newKeys = Object.keys(statuses).sort().join(',');
        
        if (prevKeys !== newKeys) {
          downloadStatusesRef.current = statuses;
          setDownloadStatuses(statuses);
          return;
        }
        
        // Check if any values changed
        let hasChanges = false;
        for (const key in statuses) {
          if (prev[key] !== statuses[key]) {
            hasChanges = true;
            break;
          }
        }
        
        if (hasChanges) {
          downloadStatusesRef.current = statuses;
          setDownloadStatuses(statuses);
        }
        // If no changes, don't update state to prevent re-render
      } catch (error) {
        console.error("Failed to fetch download status:", error);
      }
    };

    pollDownloadStatus();
    const interval = setInterval(pollDownloadStatus, 5000);

    return () => clearInterval(interval);
  }, []);

  const getLibraryArtistImage = (artist) => {
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

  const genreSections = useMemo(() => {
    if (!data?.topGenres || !data?.recommendations) return [];

    const sections = [];
    const usedArtistIds = new Set();

    // Use a stable sort based on genre name instead of random to prevent re-renders
    const sortedGenres = [...data.topGenres].sort((a, b) => 
      a.localeCompare(b)
    );

    for (const genre of sortedGenres) {
      if (sections.length >= 4) break;

      const genreArtists = data.recommendations.filter((artist) => {
        if (usedArtistIds.has(artist.id)) return false;

        const artistTags = artist.tags || [];
        return artistTags.some((tag) =>
          tag.toLowerCase().includes(genre.toLowerCase()),
        );
      });

      if (genreArtists.length >= 4) {
        const selectedArtists = genreArtists.slice(0, 6);

        selectedArtists.forEach((artist) => usedArtistIds.add(artist.id));

        sections.push({
          genre,
          artists: selectedArtists,
        });
      }
    }

    return sections;
  }, [data]);

  const ArtistCard = memo(({ artist, status }) => {
    // For album requests, navigate to artist page; otherwise use artist.id
    const navigateTo = artist.navigateTo || artist.id;
    const handleClick = useCallback(() => navigate(`/artist/${navigateTo}`), [navigateTo]);
    const handleButtonClick = useCallback((e) => {
      e.stopPropagation();
      navigate(`/artist/${navigateTo}`);
    }, [navigateTo]);

    return (
      <div className="group relative flex flex-col w-full min-w-0">
        <div
          onClick={handleClick}
          className="relative aspect-square mb-3 overflow-hidden bg-gray-200 dark:bg-gray-800 cursor-pointer shadow-sm group-hover:shadow-md transition-all"
        >
          <ArtistImage
            src={artist.image || artist.imageUrl}
            mbid={artist.id}
            alt={artist.name}
            className="h-full w-full group-hover:scale-105 transition-transform duration-300"
            showLoading={false}
          />

          {status && (
            <div
              className={`absolute bottom-2 left-2 right-2 py-1 px-2 rounded text-[10px] font-bold uppercase text-center backdrop-blur-md shadow-lg ${
                status === "available"
                  ? "bg-green-500/90 text-white"
                  : status === "processing"
                    ? "bg-blue-500/90 text-white"
                    : "bg-yellow-500/90 text-white"
              }`}
            >
              {status}
            </div>
          )}

          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <button
              onClick={handleButtonClick}
              className="p-2 bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 hover:scale-110 transition-all"
              title="View Details"
            >
              <ExternalLink className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex flex-col min-w-0">
          <h3
            onClick={handleClick}
            className="font-semibold text-gray-900 dark:text-gray-100 truncate hover:text-primary-500 cursor-pointer"
          >
            {artist.name}
          </h3>
          <div className="flex flex-col min-w-0">
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
              {artist.type === "Person" ? "Artist" : artist.type}
              {artist.sourceArtist && ` • Similar to ${artist.sourceArtist}`}
            </p>
            {artist.subtitle && (
              <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                {artist.subtitle}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }, (prevProps, nextProps) => {
    // Custom comparison: only re-render if artist id, image, name, or status actually changed
    return (
      prevProps.artist.id === nextProps.artist.id &&
      prevProps.artist.image === nextProps.artist.image &&
      prevProps.artist.imageUrl === nextProps.artist.imageUrl &&
      prevProps.artist.name === nextProps.artist.name &&
      prevProps.status === nextProps.status
    );
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader className="w-12 h-12 text-primary-500 animate-spin mb-4" />
        <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300">
          Curating your recommendations...
        </h2>
        <p className="text-gray-500 dark:text-gray-400 mt-2">
          Analyzing your library to find hidden gems
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="bg-red-100 dark:bg-red-900/20 p-4 mb-4">
          <Sparkles className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Unable to load discovery
        </h2>
        <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto mb-6">
          {error}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="btn btn-primary"
        >
          Try Again
        </button>
      </div>
    );
  }

  const {
    recommendations = [],
    globalTop = [],
    topGenres = [],
    topTags = [],
    basedOn = [],
    lastUpdated,
    isUpdating,
    configured = true,
  } = data || {};

  // Show configuration message if discovery isn't set up
  if (
    !configured ||
    (!recommendations.length && !globalTop.length && !topGenres.length)
  ) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <div className="bg-primary-100 dark:bg-primary-900/20 p-4 mb-4">
          <Sparkles className="w-12 h-12 text-primary-500" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Discovery Not Configured
        </h2>
        <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto mb-6">
          To see music recommendations, you need to either:
        </p>
        <ul className="text-left text-gray-600 dark:text-gray-400 max-w-md mx-auto mb-6 space-y-2">
          <li className="flex items-start gap-2">
            <span className="text-primary-500 mt-1">•</span>
            <span>Add artists to your library, or</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary-500 mt-1">•</span>
            <span>Configure Last.fm integration in Settings</span>
          </li>
        </ul>
        <button
          onClick={() => navigate("/settings")}
          className="btn btn-primary"
        >
          Go to Settings
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-10 pb-12">
      <section className="relative overflow-hidden bg-gradient-to-br from-primary-50 via-white to-primary-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 text-gray-900 dark:text-white shadow-sm dark:shadow-xl border border-primary-100/50 dark:border-transparent">
        <div className="absolute top-0 right-0 -mt-20 -mr-20 h-96 w-96 bg-primary-500/10 dark:bg-primary-500/20 blur-3xl"></div>
        <div className="absolute bottom-0 left-0 -mb-20 -ml-20 h-96 w-96 bg-blue-500/10 dark:bg-blue-500/20 blur-3xl"></div>

        <div className="relative p-8 md:p-12">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-8">
            <div>
              <div className="flex items-center gap-2 text-primary-600 dark:text-primary-300 mb-2 font-medium">
                <Sparkles className="w-5 h-5" />
                <span>Your Daily Mix</span>
              </div>
              <h1 className="text-3xl md:text-5xl font-bold mb-4 text-gray-900 dark:text-white">
                Music Discovery
              </h1>
              <p className="text-gray-600 dark:text-gray-300 max-w-xl text-lg">
                Curated recommendations updated daily based on your library
                library.
              </p>
            </div>

            <div className="flex flex-col items-end gap-2">
              {lastUpdated && (
                <div className="flex items-center text-sm text-gray-500 dark:text-gray-400 bg-white/50 dark:bg-black/20 px-3 py-1 backdrop-blur-md border border-gray-200 dark:border-transparent shadow-sm">
                  <Clock className="w-3 h-3 mr-1.5" />
                  Updated {new Date(lastUpdated).toLocaleDateString()}
                  {isUpdating && (
                    <Loader className="w-3 h-3 ml-2 animate-spin" />
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                Your Top Genres
              </h3>
              <div className="flex flex-wrap gap-2 max-h-[5.5rem] overflow-hidden">
                {topGenres.map((genre, i) => (
                  <button
                    key={i}
                    onClick={() =>
                      navigate(
                        `/search?q=${encodeURIComponent(genre)}&type=tag`,
                      )
                    }
                    className="px-4 py-2 bg-white dark:bg-white/10 hover:bg-gray-50 dark:hover:bg-white/20 border border-gray-200 dark:border-white/10 transition-colors text-sm font-medium text-gray-700 dark:text-white shadow-sm dark:shadow-none"
                  >
                    {genre}
                  </button>
                ))}
              </div>
            </div>

            {basedOn.length > 0 && (
              <div className="pt-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Inspired by{" "}
                  {basedOn
                    .slice(0, 3)
                    .map((a) => a.name)
                    .join(", ")}{" "}
                  {basedOn.length > 3 && `and ${basedOn.length - 3} others`}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {requests.filter((r) => r.status !== "available").length > 0 && (
        <section className="animate-slide-up">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center">
              <History className="w-6 h-6 mr-3 text-primary-500" />
              Recent Requests
            </h2>
            <button
              onClick={() => navigate("/requests")}
              className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
            >
              View All
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {requests
              .filter((r) => r.status !== "available")
              .slice(0, 6)
              .map((request) => {
                const artistMbid = request.artistMbid || request.mbid;

                return (
                  <ArtistCard
                    key={request.id || request.mbid}
                    status={request.status}
                    artist={{
                      id: request.albumMbid || request.mbid, // Use album MBID for image lookup
                      name:
                        request.type === "album"
                          ? request.albumName
                          : request.name, // Show album name if album request
                      image: request.image,
                      subtitle:
                        request.type === "album"
                          ? `${request.artistName} • ${new Date(request.requestedAt).toLocaleDateString()}`
                          : `Requested ${new Date(request.requestedAt).toLocaleDateString()}`,
                      // For album requests, navigate to artist page
                      navigateTo:
                        request.type === "album"
                          ? artistMbid
                          : request.albumMbid || request.mbid,
                    }}
                  />
                );
              })}
          </div>
        </section>
      )}

      {(recentlyAdded.length > 0 ||
        requests.filter((r) => r.status === "available").length > 0) && (
        <section
          className="animate-slide-up"
          style={{ animationDelay: "0.1s" }}
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center">
              <CheckCircle className="w-6 h-6 mr-3 text-primary-500" />
              Recently Added
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {/* Show completed album requests first */}
            {requests
              .filter((r) => r.status === "available")
              .slice(0, 6)
              .map((request) => {
                const artistMbid = request.artistMbid || request.mbid;

                return (
                  <ArtistCard
                    key={`request-${request.id || request.mbid}`}
                    status="available"
                    artist={{
                      id: request.albumMbid || request.mbid, // Use album MBID for image lookup
                      name:
                        request.type === "album"
                          ? request.albumName
                          : request.name,
                      image: request.image,
                      subtitle:
                        request.type === "album"
                          ? `${request.artistName} • ${new Date(request.requestedAt).toLocaleDateString()}`
                          : `Added ${new Date(request.requestedAt).toLocaleDateString()}`,
                      // For album requests, navigate to artist page
                      navigateTo:
                        request.type === "album"
                          ? artistMbid
                          : request.albumMbid || request.mbid,
                    }}
                  />
                );
              })}
            {/* Then show recently added artists (if any slots remaining) */}
            {recentlyAdded
              .slice(
                0,
                Math.max(
                  0,
                  6 - requests.filter((r) => r.status === "available").length,
                ),
              )
              .map((artist) => {
                return (
                  <ArtistCard
                    key={`artist-${artist.id}`}
                    status="available"
                    artist={{
                      id: artist.foreignArtistId || artist.mbid,
                      name: artist.artistName,
                      image: getLibraryArtistImage(artist),
                      type: "Artist",
                      subtitle: `Added ${new Date(artist.added || artist.addedAt).toLocaleDateString()}`,
                    }}
                  />
                );
              })}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center">
            <PlayCircle className="w-6 h-6 mr-3 text-primary-500" />
            Recommended for You
          </h2>
        </div>

        {recommendations.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {recommendations.slice(0, 12).map((artist) => (
              <ArtistCard key={artist.id} artist={artist} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
            <Music className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">
              Not enough data to generate recommendations yet.
            </p>
          </div>
        )}
      </section>

      {globalTop.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center">
              <TrendingUp className="w-6 h-6 mr-3 text-primary-500" />
              Global Trending
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {globalTop.slice(0, 12).map((artist) => (
              <ArtistCard key={artist.id} artist={artist} />
            ))}
          </div>
        </section>
      )}

      {genreSections.map((section) => (
        <section key={section.genre}>
          <div className="flex items-center justify-between mb-6 border-b border-gray-100 dark:border-gray-800 pb-2">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center">
              <span className="text-primary-500 mr-2">Because you like</span>
              {section.genre}
            </h2>
            <button
              onClick={() =>
                navigate(
                  `/search?q=${encodeURIComponent(section.genre)}&type=tag`,
                )
              }
              className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
            >
              See All
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {section.artists.slice(0, 6).map((artist) => (
              <ArtistCard
                key={`${section.genre}-${artist.id}`}
                artist={artist}
              />
            ))}
          </div>
        </section>
      ))}

      {topTags.length > 0 && (
        <section className="bg-gray-50 dark:bg-gray-900 p-8 border border-gray-100 dark:border-gray-800">
          <div className="flex items-center mb-6">
            <Tag className="w-5 h-5 text-gray-400 mr-2" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Explore by Tag
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {topTags.map((tag, i) => (
              <button
                key={i}
                onClick={() =>
                  navigate(`/search?q=${encodeURIComponent(tag)}&type=tag`)
                }
                className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-primary-300 hover:text-primary-600 transition-colors"
              >
                #{tag}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default DiscoverPage;
