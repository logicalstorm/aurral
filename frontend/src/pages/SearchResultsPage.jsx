import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader, Music, ArrowLeft } from "lucide-react";
import { searchArtists, searchArtistsByTag, getDiscovery } from "../utils/api";
import ArtistImage from "../components/ArtistImage";

const PAGE_SIZE = 24;

function SearchResultsPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const type = searchParams.get("type");
  const [results, setResults] = useState([]);
  const [fullList, setFullList] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [artistImages, setArtistImages] = useState({});
  const [hasMore, setHasMore] = useState(false);
  const [searchTotalCount, setSearchTotalCount] = useState(0);
  const navigate = useNavigate();

  const trimmedQuery = useMemo(() => query.trim(), [query]);
  const isTagSearch = useMemo(
    () => type === "tag" || trimmedQuery.startsWith("#"),
    [type, trimmedQuery],
  );

  const dedupe = useCallback((artists) => {
    const seen = new Set();
    return artists.filter((artist) => {
      if (!artist.id) return false;
      if (seen.has(artist.id)) return false;
      seen.add(artist.id);
      return true;
    });
  }, []);

  useEffect(() => {
    const performSearch = async () => {
      if (type === "recommended" || type === "trending") {
        setLoading(true);
        setError(null);
        try {
          const data = await getDiscovery();
          const list =
            type === "recommended"
              ? data.recommendations || []
              : data.globalTop || [];
          setFullList(list);
          setResults(list);
          setVisibleCount(PAGE_SIZE);
          setHasMore(list.length > PAGE_SIZE);
          if (list.length > 0) {
            const imagesMap = {};
            list.forEach((artist) => {
              if (artist.image && artist.id)
                imagesMap[artist.id] = artist.image;
            });
            setArtistImages(imagesMap);
          }
        } catch (err) {
          setError(
            err.response?.data?.message || "Failed to load. Please try again.",
          );
          setFullList(null);
          setResults([]);
        } finally {
          setLoading(false);
        }
        return;
      }

      if (!query.trim() && type !== "recommended" && type !== "trending") {
        setResults([]);
        setFullList(null);
        setHasMore(false);
        return;
      }

      setLoading(true);
      setError(null);
      setVisibleCount(PAGE_SIZE);

      try {
        let artists = [];
        let totalCount = 0;
        if (isTagSearch) {
          const tag = trimmedQuery.startsWith("#")
            ? trimmedQuery.substring(1)
            : trimmedQuery;
          const data = await searchArtistsByTag(tag, PAGE_SIZE, 0);
          artists = data.recommendations || [];
        } else {
          const data = await searchArtists(trimmedQuery, PAGE_SIZE, 0);
          artists = data.artists || [];
          totalCount = data?.count ?? 0;
        }
        const uniqueArtists = dedupe(artists);
        setResults(uniqueArtists);
        setFullList(null);
        if (!isTagSearch) {
          setSearchTotalCount(totalCount);
        }
        setHasMore(
          (isTagSearch && uniqueArtists.length >= PAGE_SIZE) ||
            (!isTagSearch && totalCount > uniqueArtists.length),
        );
        if (uniqueArtists.length > 0) {
          const imagesMap = {};
          uniqueArtists.forEach((artist) => {
            if (artist.image && artist.id) imagesMap[artist.id] = artist.image;
          });
          setArtistImages(imagesMap);
        }
      } catch (err) {
        setError(
          err.response?.data?.message ||
            "Failed to search artists. Please try again.",
        );
        setResults([]);
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    };

    performSearch();
  }, [query, type, dedupe, trimmedQuery, isTagSearch]);

  const loadMore = useCallback(async () => {
    if (type === "recommended" || type === "trending") {
      const next = visibleCount + PAGE_SIZE;
      setVisibleCount((c) =>
        Math.min(c + PAGE_SIZE, fullList?.length ?? c + PAGE_SIZE),
      );
      setHasMore((fullList?.length ?? 0) > next);
      return;
    }
    if (isTagSearch) {
      setLoadingMore(true);
      try {
        const tag = trimmedQuery.startsWith("#")
          ? trimmedQuery.substring(1)
          : trimmedQuery;
        const data = await searchArtistsByTag(tag, PAGE_SIZE, results.length);
        const newArtists = data.recommendations || [];
        const combined = dedupe([...results, ...newArtists]);
        setResults(combined);
        setHasMore(newArtists.length >= PAGE_SIZE);
        newArtists.forEach((artist) => {
          if (artist.image && artist.id) {
            setArtistImages((prev) => ({ ...prev, [artist.id]: artist.image }));
          }
        });
      } finally {
        setLoadingMore(false);
      }
      return;
    }
    setLoadingMore(true);
    try {
      const offset = results.length;
      const data = await searchArtists(query.trim(), PAGE_SIZE, offset);
      const newArtists = data.artists || [];
      const total = data.count ?? 0;
      if (newArtists.length === 0) {
        setHasMore(false);
      } else {
        setResults((prev) => dedupe([...prev, ...newArtists]));
        setSearchTotalCount(total);
        setHasMore(total > offset + newArtists.length);
        newArtists.forEach((artist) => {
          if (artist.image && artist.id) {
            setArtistImages((prev) => ({ ...prev, [artist.id]: artist.image }));
          }
        });
      }
    } finally {
      setLoadingMore(false);
    }
  }, [
    type,
    fullList,
    visibleCount,
    query,
    results,
    dedupe,
    trimmedQuery,
    isTagSearch,
  ]);

  const getArtistType = (artistType) => {
    const types = {
      Person: "Solo Artist",
      Group: "Band",
      Orchestra: "Orchestra",
      Choir: "Choir",
      Character: "Character",
      Other: "Other",
    };
    return types[artistType] || artistType;
  };

  const displayedArtists =
    type === "recommended" || type === "trending"
      ? results.slice(0, visibleCount)
      : results;

  const showContent =
    !loading && (query || type === "recommended" || type === "trending");
  const isEmpty = displayedArtists.length === 0;
  const showBackButton =
    type === "recommended" ||
    type === "trending" ||
    isTagSearch ||
    !!trimmedQuery;
  const showLoadMore =
    hasMore &&
    (type === "recommended" || type === "trending"
      ? results.length > PAGE_SIZE
      : isTagSearch
        ? results.length >= PAGE_SIZE
        : results.length >= PAGE_SIZE && searchTotalCount > PAGE_SIZE);

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        {showBackButton && (
          <button
            onClick={() => navigate(-1)}
            className="btn btn-secondary mb-6 inline-flex items-center"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back
          </button>
        )}
        <h1 className="text-2xl font-bold" style={{ color: "#fff" }}>
          {type === "recommended"
            ? "Recommended for You"
            : type === "trending"
              ? "Global Trending"
              : isTagSearch
                ? "Genre Results"
                : trimmedQuery
                  ? loading
                    ? `Showing results for "${trimmedQuery}"`
                    : `Showing ${results.length} results for "${trimmedQuery}"`
                  : "Search Results"}
        </h1>
        {type === "recommended" && (
          <p style={{ color: "#c1c1c3" }}>
            {results.length} artist{results.length !== 1 ? "s" : ""} we think
            you&apos;ll like
          </p>
        )}
        {type === "trending" && (
          <p style={{ color: "#c1c1c3" }}>Trending artists right now</p>
        )}
        {isTagSearch && trimmedQuery && (
          <p
            style={{ color: "#c1c1c3" }}
          >{`Top artists for tag "${trimmedQuery.startsWith("#") ? trimmedQuery.substring(1) : trimmedQuery}"`}</p>
        )}
      </div>

      {error && (
        <div className="mb-6 bg-red-500/20 ">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {loading && (
        <div className="flex justify-center items-center py-20">
          <Loader
            className="w-12 h-12 animate-spin"
            style={{ color: "#c1c1c3" }}
          />
        </div>
      )}

      {showContent && (
        <div className="animate-slide-up">
          {isEmpty ? (
            <div className="card text-center py-12">
              <Music
                className="w-16 h-16 mx-auto mb-4"
                style={{ color: "#c1c1c3" }}
              />
              <h3
                className="text-xl font-semibold mb-2"
                style={{ color: "#fff" }}
              >
                No Results Found
              </h3>
              <p style={{ color: "#c1c1c3" }}>
                {type === "recommended" || type === "trending"
                  ? "Nothing to show here yet."
                  : isTagSearch
                    ? `We couldn't find any top artists for tag "${trimmedQuery.startsWith("#") ? trimmedQuery.substring(1) : trimmedQuery}"`
                    : `We couldn't find any artists matching "${trimmedQuery}"`}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                {displayedArtists.map((artist, index) => (
                  <div
                    key={artist.id || `artist-${index}`}
                    className="group relative flex flex-col w-full min-w-0"
                  >
                    <div
                      onClick={() =>
                        navigate(`/artist/${artist.id}`, {
                          state: { artistName: artist.name },
                        })
                      }
                      className="relative aspect-square mb-3 overflow-hidden cursor-pointer shadow-sm group-hover:shadow-md transition-all"
                      style={{ backgroundColor: "#211f27" }}
                    >
                      <ArtistImage
                        src={
                          artistImages[artist.id] ||
                          artist.image ||
                          artist.imageUrl
                        }
                        mbid={artist.id}
                        artistName={artist.name}
                        alt={artist.name}
                        className="h-full w-full group-hover:scale-105 transition-transform duration-300"
                        showLoading={false}
                      />
                    </div>

                    <div className="flex flex-col min-w-0">
                      <h3
                        onClick={() =>
                          navigate(`/artist/${artist.id}`, {
                            state: { artistName: artist.name },
                          })
                        }
                        className="font-semibold truncate hover:underline cursor-pointer"
                        style={{ color: "#fff" }}
                      >
                        {artist.name}
                      </h3>

                      <div
                        className="flex flex-col min-w-0 text-sm"
                        style={{ color: "#c1c1c3" }}
                      >
                        {artist.type && (
                          <p className="truncate">
                            {getArtistType(artist.type)}
                          </p>
                        )}

                        {artist.country && (
                          <p className="truncate text-xs opacity-80">
                            {artist.country}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {showLoadMore && (
                <div className="mt-8 flex justify-center">
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="px-6 py-3 font-medium rounded-lg transition-colors disabled:opacity-50"
                    style={{
                      backgroundColor: "#43454f",
                      color: "#fff",
                    }}
                  >
                    {loadingMore ? (
                      <span className="flex items-center gap-2">
                        <Loader className="w-5 h-5 animate-spin" />
                        Loading...
                      </span>
                    ) : (
                      "Load more"
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default SearchResultsPage;
