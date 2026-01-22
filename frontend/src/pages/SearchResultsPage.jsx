import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader, Music, ExternalLink, CheckCircle, Plus } from "lucide-react";
import {
  searchArtists,
  lookupArtistsInLidarrBatch,
  getArtistCover,
  searchArtistsByTag,
} from "../utils/api";
import AddArtistModal from "../components/AddArtistModal";
import ArtistImage from "../components/ArtistImage";
import { useToast } from "../contexts/ToastContext";

function SearchResultsPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const type = searchParams.get("type");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [existingArtists, setExistingArtists] = useState({});
  const [artistToAdd, setArtistToAdd] = useState(null);
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

        setResults(artists);

        if (artists.length > 0) {
          const imagesMap = {};

          artists.forEach((artist) => {
            if (artist.image) {
              imagesMap[artist.id] = artist.image;
            }
          });
          setArtistImages(imagesMap);

          try {
            const mbids = artists.map((a) => a.id).filter(Boolean);
            if (mbids.length > 0) {
              const existingMap = await lookupArtistsInLidarrBatch(mbids);
              setExistingArtists(existingMap);
            }
          } catch (err) {
            console.error("Failed to batch lookup artists:", err);
          }
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

  const handleAddArtistClick = (artist) => {
    setArtistToAdd(artist);
  };

  const handleAddSuccess = (artist) => {
    setExistingArtists((prev) => ({
      ...prev,

      [artist.id]: true,
    }));

    setArtistToAdd(null);


    showSuccess(`Successfully added ${artist.name} to Lidarr!`);
  };

  const handleModalClose = () => {
    setArtistToAdd(null);
  };

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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {type === "tag" ? "Genre Results" : "Search Results"}
        </h1>
        {query && (
          <p className="text-gray-600 dark:text-gray-400">
            {type === "tag"
              ? `Top artists for tag "${query}"`
              : `Showing results for "${query}"`}
          </p>
        )}
      </div>

      {error && (
        <div className="mb-6 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-500/20 rounded-lg p-4">
          <p className="text-red-800 dark:text-red-400">{error}</p>
        </div>
      )}

      {loading && (
        <div className="flex justify-center items-center py-20">
          <Loader className="w-12 h-12 text-primary-600 animate-spin" />
        </div>
      )}

      {!loading && query && (
        <div className="animate-slide-up">
          {results.length === 0 ? (
            <div className="card text-center py-12">
              <Music className="w-16 h-16 text-gray-300 dark:text-gray-700 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
                No Results Found
              </h3>
              <p className="text-gray-500 dark:text-gray-400">
                {type === "tag"
                  ? `We couldn't find any top artists for tag "${query}"`
                  : `We couldn't find any artists matching "${query}"`}
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                  Found {results.length} result{results.length !== 1 ? "s" : ""}
                </h2>
              </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                {results.map((artist) => (
                  <div
                    key={artist.id}
                    className="group relative flex flex-col w-full min-w-0"
                  >
                    <div
                      onClick={() => navigate(`/artist/${artist.id}`)}
                      className="relative aspect-square mb-3 overflow-hidden rounded-xl bg-gray-200 dark:bg-gray-800 cursor-pointer shadow-sm group-hover:shadow-md transition-all"
                    >
                      {/* Artist Image */}
                        <ArtistImage
                          src={artistImages[artist.id] || artist.image || artist.imageUrl}
                          mbid={artist.id}
                          alt={artist.name}
                          className="h-full w-full group-hover:scale-105 transition-transform duration-300"
                          showLoading={false}
                        />

                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          {!existingArtists[artist.id] && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddArtistClick(artist);
                              }}
                              className="p-2 bg-primary-500 text-white rounded-full hover:bg-primary-600 hover:scale-110 transition-all shadow-lg"
                              title="Add to Lidarr"
                            >
                              <Plus className="w-5 h-5" />
                            </button>
                          )}
                          <a
                            href={`https://musicbrainz.org/artist/${artist.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="p-2 bg-white/20 backdrop-blur-sm text-white rounded-full hover:bg-white/30 hover:scale-110 transition-all"
                            title="View on MusicBrainz"
                          >
                            <ExternalLink className="w-5 h-5" />
                          </a>
                        </div>
                        
                        {existingArtists[artist.id] && (
                          <div className="absolute top-2 right-2 bg-green-500 text-white p-1 rounded-full shadow-md">
                            <CheckCircle className="w-3 h-3" />
                          </div>
                        )}
                    </div>

                    <div className="flex flex-col min-w-0">
                        <h3 
                          onClick={() => navigate(`/artist/${artist.id}`)}
                          className="font-semibold text-gray-900 dark:text-gray-100 truncate hover:text-primary-500 cursor-pointer"
                        >
                          {artist.name}
                        </h3>
                        
                        <div className="flex flex-col min-w-0 text-sm text-gray-500 dark:text-gray-400">
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

      {artistToAdd && (
        <AddArtistModal
          artist={artistToAdd}
          onClose={handleModalClose}
          onSuccess={handleAddSuccess}
        />
      )}
    </div>
  );
}

export default SearchResultsPage;
