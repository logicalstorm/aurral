import { useState, useEffect, useMemo, memo, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import { useNavigate } from "react-router-dom";
import { Loader, Music, Sparkles, Clock } from "lucide-react";
import {
  getDiscovery,
  getRequests,
  getRecentlyAdded,
  getAllDownloadStatus,
} from "../utils/api";
import ArtistImage from "../components/ArtistImage";

const TAG_COLORS = [
  "#845336",
  "#57553c",
  "#a17e3e",
  "#43454f",
  "#604848",
  "#5c6652",
  "#a18b62",
  "#8c4f4a",
  "#898471",
  "#c8b491",
  "#65788f",
  "#755e4a",
  "#718062",
  "#bc9d66",
];

const getTagColor = (name) => {
  if (!name) return "#211f27";
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
};

function DiscoverPage() {
  const [data, setData] = useState(null);
  const [requests, setRequests] = useState([]);
  const [recentlyAdded, setRecentlyAdded] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const downloadStatusesRef = useRef({});
  const navigate = useNavigate();

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

        const hasData =
          discoveryData &&
          ((discoveryData.recommendations &&
            discoveryData.recommendations.length > 0) ||
            (discoveryData.globalTop && discoveryData.globalTop.length > 0) ||
            (discoveryData.topGenres && discoveryData.topGenres.length > 0));

        setData(discoveryData);
        setRequests(requestsData);
        setRecentlyAdded(recentlyAddedData);
        downloadStatusesRef.current = {};

        if (hasData) {
          setLoading(false);
        } else {
          setTimeout(() => setLoading(false), 500);
        }
      } catch (err) {
        setError(
          err.response?.data?.message || "Failed to load discovery data",
        );
        setLoading(false);
      }
    };

    fetchData();

    const pollDownloadStatus = async () => {
      try {
        const statuses = await getAllDownloadStatus();
        const prev = downloadStatusesRef.current;
        const prevKeys = Object.keys(prev).sort().join(",");
        const newKeys = Object.keys(statuses).sort().join(",");

        if (prevKeys !== newKeys) {
          downloadStatusesRef.current = statuses;
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
        }
      } catch (error) {
        console.error("Failed to fetch download status:", error);
      }
    };

    pollDownloadStatus();
    const interval = setInterval(pollDownloadStatus, 15000);

    return () => clearInterval(interval);
  }, []);

  const getLibraryArtistImage = (artist) => {
    if (artist.images && artist.images.length > 0) {
      const posterImage = artist.images.find(
        (img) => img.coverType === "poster" || img.coverType === "fanart",
      );
      const image = posterImage || artist.images[0];

      if (image && artist.id) {
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
    const sortedGenres = [...data.topGenres].sort((a, b) => a.localeCompare(b));

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

  const ArtistCard = memo(
    ({ artist, status }) => {
      const navigateTo = artist.navigateTo || artist.id;
      const hasValidMbid =
        navigateTo && navigateTo !== "null" && navigateTo !== "undefined";
      const handleClick = useCallback(() => {
        if (hasValidMbid) {
          navigate(`/artist/${navigateTo}`, {
            state: { artistName: artist.name },
          });
        }
      }, [navigateTo, hasValidMbid, artist.name]);

      return (
        <div className="group relative flex flex-col w-full min-w-0">
          <div
            onClick={handleClick}
            className={`relative aspect-square mb-3 overflow-hidden shadow-sm group-hover:shadow-md transition-all ${hasValidMbid ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
            style={{ backgroundColor: "#211f27" }}
          >
            <ArtistImage
              src={artist.image || artist.imageUrl}
              mbid={artist.id}
              artistName={artist.name}
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
                      ? "bg-gray-700/90 text-white"
                      : "bg-yellow-500/90 text-white"
                }`}
              >
                {status}
              </div>
            )}
          </div>

          <div className="flex flex-col min-w-0">
            <h3
              onClick={handleClick}
              className={`font-semibold truncate ${hasValidMbid ? "hover:underline cursor-pointer" : "cursor-not-allowed opacity-75"}`}
              style={{ color: "#fff" }}
            >
              {artist.name}
            </h3>
            <div className="flex flex-col min-w-0">
              <p className="text-sm truncate" style={{ color: "#c1c1c3" }}>
                {artist.type === "Person" ? "Artist" : artist.type}
                {artist.sourceArtist && ` • Similar to ${artist.sourceArtist}`}
              </p>
              {artist.subtitle && (
                <p className="text-xs truncate" style={{ color: "#c1c1c3" }}>
                  {artist.subtitle}
                </p>
              )}
            </div>
          </div>
        </div>
      );
    },
    (prevProps, nextProps) => {
      return (
        prevProps.artist.id === nextProps.artist.id &&
        prevProps.artist.image === nextProps.artist.image &&
        prevProps.artist.imageUrl === nextProps.artist.imageUrl &&
        prevProps.artist.name === nextProps.artist.name &&
        prevProps.status === nextProps.status
      );
    },
  );

  ArtistCard.displayName = "ArtistCard";
  ArtistCard.propTypes = {
    artist: PropTypes.shape({
      id: PropTypes.string,
      name: PropTypes.string.isRequired,
      image: PropTypes.string,
      imageUrl: PropTypes.string,
      type: PropTypes.string,
      sourceArtist: PropTypes.string,
      subtitle: PropTypes.string,
      navigateTo: PropTypes.string,
    }).isRequired,
    status: PropTypes.string,
  };

  const hasData =
    data &&
    ((data.recommendations && data.recommendations.length > 0) ||
      (data.globalTop && data.globalTop.length > 0) ||
      (data.topGenres && data.topGenres.length > 0));
  const isActuallyUpdating = data?.isUpdating && !hasData;

  if (loading && !hasData && !isActuallyUpdating) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader
          className="w-12 h-12 animate-spin mb-4"
          style={{ color: "#c1c1c3" }}
        />
        <h2 className="text-xl font-semibold" style={{ color: "#fff" }}>
          Loading recommendations...
        </h2>
      </div>
    );
  }

  if (isActuallyUpdating) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader
          className="w-12 h-12 animate-spin mb-4"
          style={{ color: "#c1c1c3" }}
        />
        <h2 className="text-xl font-semibold" style={{ color: "#fff" }}>
          Curating your recommendations...
        </h2>
        <p className="mt-2" style={{ color: "#c1c1c3" }}>
          Analyzing your library to find hidden gems
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="bg-red-500/20 p-4 mb-4">
          <Sparkles className="w-8 h-8 text-red-400" />
        </div>
        <h2 className="text-xl font-bold mb-2" style={{ color: "#fff" }}>
          Unable to load discovery
        </h2>
        <p className="max-w-md mx-auto mb-6" style={{ color: "#c1c1c3" }}>
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
  // Only show "not configured" if explicitly set to false AND no data exists
  if (
    configured === false &&
    !recommendations.length &&
    !globalTop.length &&
    !topGenres.length
  ) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <div className="p-4 mb-4" style={{ backgroundColor: "#211f27" }}>
          <Sparkles className="w-12 h-12" style={{ color: "#c1c1c3" }} />
        </div>
        <h2 className="text-2xl font-bold mb-2" style={{ color: "#fff" }}>
          Discovery Not Configured
        </h2>
        <p className="max-w-md mx-auto mb-6" style={{ color: "#c1c1c3" }}>
          To see music recommendations, you need at least one of:
        </p>
        <ul
          className="text-left max-w-md mx-auto mb-6 space-y-2"
          style={{ color: "#c1c1c3" }}
        >
          <li className="flex items-start gap-2">
            <span style={{ color: "#c1c1c3" }} className="mt-1">
              •
            </span>
            <span>Add artists to your library, or</span>
          </li>
          <li className="flex items-start gap-2">
            <span style={{ color: "#c1c1c3" }} className="mt-1">
              •
            </span>
            <span>Configure Last.fm (API key and username) in Settings</span>
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
      <section
        className="relative overflow-hidden shadow-sm"
        style={{ color: "#fff" }}
      >
        <div className="relative p-8 md:p-12">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-8">
            <div>
              <div
                className="flex items-center gap-2 mb-8 -ml-6 font-medium"
                style={{ color: "#fff" }}
              >
                <span>Your Daily Mix</span>
              </div>
              <h1
                className="text-3xl md:text-5xl font-bold mb-4"
                style={{ color: "#fff" }}
              >
                Music Discovery
              </h1>
              <p className="max-w-xl text-lg" style={{ color: "#c1c1c3" }}>
                Curated recommendations updated daily based on your library.
              </p>
            </div>

            <div className="flex flex-col items-end gap-2">
              {lastUpdated && (
                <div
                  className="flex items-center text-sm"
                  style={{ color: "#c1c1c3" }}
                >
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
              <h3
                className="text-sm font-semibold uppercase tracking-wider mb-3"
                style={{ color: "#fff" }}
              >
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
                    className="genre-tag-pill px-4 py-2 text-sm font-medium"
                    style={{
                      backgroundColor: getTagColor(genre),
                      color: "#fff",
                    }}
                  >
                    {genre}
                  </button>
                ))}
              </div>
            </div>

            {basedOn.length > 0 && (
              <div className="pt-2">
                <p className="text-xs" style={{ color: "#c1c1c3" }}>
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
            <h2
              className="text-2xl font-bold flex items-center"
              style={{ color: "#fff" }}
            >
              Recent Requests
            </h2>
            <button
              onClick={() => navigate("/requests")}
              className="text-sm font-medium hover:underline"
              style={{ color: "#c1c1c3" }}
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
                const navigateTo =
                  request.type === "album"
                    ? artistMbid
                    : request.albumMbid || request.mbid;
                const hasValidMbid =
                  navigateTo &&
                  navigateTo !== "null" &&
                  navigateTo !== "undefined";

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
                      navigateTo: hasValidMbid ? navigateTo : null,
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
            <h2
              className="text-2xl font-bold flex items-center"
              style={{ color: "#fff" }}
            >
              Recently Added
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
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
          <h2 className="text-2xl font-bold text-white flex items-center">
            Recommended for You
          </h2>
          <button
            onClick={() => navigate("/search?type=recommended")}
            className="text-sm font-medium hover:underline"
            style={{ color: "#c1c1c3" }}
          >
            View All
          </button>
        </div>

        {recommendations.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {recommendations.slice(0, 12).map((artist) => (
              <ArtistCard key={artist.id} artist={artist} />
            ))}
          </div>
        ) : (
          <div
            className="text-center py-12"
            style={{ backgroundColor: "#211f27" }}
          >
            <Music
              className="w-12 h-12 mx-auto mb-3"
              style={{ color: "#c1c1c3" }}
            />
            <p style={{ color: "#c1c1c3" }}>
              Not enough data to generate recommendations yet.
            </p>
          </div>
        )}
      </section>

      {globalTop.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2
              className="text-2xl font-bold flex items-center"
              style={{ color: "#fff" }}
            >
              Global Trending
            </h2>
            <button
              onClick={() => navigate("/search?type=trending")}
              className="text-sm font-medium hover:underline"
              style={{ color: "#c1c1c3" }}
            >
              View All
            </button>
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
          <div className="flex items-center justify-between mb-6 pb-2">
            <h2
              className="text-xl font-bold flex items-center"
              style={{ color: "#fff" }}
            >
              <span style={{ color: "#c1c1c3" }}>
                Because you like{"\u00A0"}
              </span>
              {section.genre}
            </h2>
            <button
              onClick={() =>
                navigate(
                  `/search?q=${encodeURIComponent(section.genre)}&type=tag`,
                )
              }
              className="text-sm font-medium hover:underline"
              style={{ color: "#c1c1c3" }}
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
        <section className="p-8" style={{ backgroundColor: "#211f27" }}>
          <div className="flex items-center mb-6">
            <h3 className="text-lg font-semibold" style={{ color: "#fff" }}>
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
                className="genre-tag-pill px-3 py-1.5 text-sm"
                style={{ backgroundColor: getTagColor(tag), color: "#fff" }}
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
