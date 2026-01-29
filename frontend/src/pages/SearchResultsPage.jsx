import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader, Music } from "lucide-react";
import {
  searchArtists,
  getArtistCover,
  searchArtistsByTag,
} from "../utils/api";
import ArtistImage from "../components/ArtistImage";
import { useToast } from "../contexts/ToastContext";

function SearchResultsPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const type = searchParams.get("type");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [artistImages, setArtistImages] = useState({});
  const navigate = useNavigate();
  const { showSuccess } = useToast();

  useEffect(() => {
    const performSearch = async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        let artists = [];

        if (type === "tag") {
          const data = await searchArtistsByTag(query.trim());
          artists = data.recommendations || [];
        } else {
          const data = await searchArtists(query.trim());
          artists = data.artists || [];
        }

        // Remove duplicates by MBID (keep first occurrence)
        const seen = new Set();
        const uniqueArtists = artists.filter((artist) => {
          if (!artist.id) return false; // Skip artists without MBID
          if (seen.has(artist.id)) return false;
          seen.add(artist.id);
          return true;
        });

        setResults(uniqueArtists);

        if (uniqueArtists.length > 0) {
          const imagesMap = {};

          uniqueArtists.forEach((artist) => {
            if (artist.image && artist.id) {
              imagesMap[artist.id] = artist.image;
            }
          });
          setArtistImages(imagesMap);
        }
      } catch (err) {
        setError(
          err.response?.data?.message ||
            "Failed to search artists. Please try again.",
        );
        setResults([]);
      } finally {
        setLoading(false);
      }
    };

    performSearch();
  }, [query, type]);

  const getArtistType = (type) => {
    const types = {
      Person: "Solo Artist",
      Group: "Band",
      Orchestra: "Orchestra",
      Choir: "Choir",
      Character: "Character",
      Other: "Other",
    };
    return types[type] || type;
  };

  const formatLifeSpan = (lifeSpan) => {
    if (!lifeSpan) return null;
    const { begin, end, ended } = lifeSpan;
    if (!begin) return null;

    const beginYear = begin.split("-")[0];
    if (ended && end) {
      const endYear = end.split("-")[0];
      return `${beginYear} - ${endYear}`;
    }
    return `${beginYear} - Present`;
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#fff" }}>
          {type === "tag" ? "Genre Results" : "Search Results"}
        </h1>
        {query && (
          <p style={{ color: "#c1c1c3" }}>
            {type === "tag"
              ? `Top artists for tag "${query}"`
              : `Showing results for "${query}"`}
          </p>
        )}
      </div>

      {error && (
        <div className="mb-6 bg-red-500/20 ">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {loading && (
        <div className="flex justify-center items-center py-20">
          <Loader className="w-12 h-12 animate-spin" style={{ color: "#c1c1c3" }} />
        </div>
      )}

      {!loading && query && (
        <div className="animate-slide-up">
          {results.length === 0 ? (
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
                {type === "tag"
                  ? `We couldn't find any top artists for tag "${query}"`
                  : `We couldn't find any artists matching "${query}"`}
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold" style={{ color: "#fff" }}>
                  Found {results.length} result{results.length !== 1 ? "s" : ""}
                </h2>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                {results.map((artist, index) => (
                  <div
                    key={artist.id || `artist-${index}`}
                    className="group relative flex flex-col w-full min-w-0"
                  >
                    <div
                      onClick={() => navigate(`/artist/${artist.id}`, { state: { artistName: artist.name } })}
                      className="relative aspect-square mb-3 overflow-hidden cursor-pointer shadow-sm group-hover:shadow-md transition-all"
                      style={{ backgroundColor: "#211f27" }}
                    >
                      {/* Artist Image */}
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
                        onClick={() => navigate(`/artist/${artist.id}`, { state: { artistName: artist.name } })}
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
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default SearchResultsPage;
