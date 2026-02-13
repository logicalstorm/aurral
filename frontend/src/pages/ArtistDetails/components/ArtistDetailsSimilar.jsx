import PropTypes from "prop-types";
import { Loader, ChevronLeft, ChevronRight } from "lucide-react";
import ArtistImage from "../../../components/ArtistImage";

export function ArtistDetailsSimilar({
  loadingSimilar,
  similarArtists,
  similarArtistsScrollRef,
  onArtistClick,
}) {
  if (!loadingSimilar && similarArtists.length === 0) return null;

  return (
    <div className="mt-12">
      <h2
        className="text-2xl font-bold  mb-6 flex items-center"
        style={{ color: "#fff" }}
      >
        Similar Artists
        {loadingSimilar && (
          <Loader
            className="w-4 h-4 ml-2 animate-spin"
            style={{ color: "#c1c1c3" }}
          />
        )}
      </h2>
      {loadingSimilar ? (
        <div className="flex items-center justify-center py-12">
          <Loader
            className="w-8 h-8 animate-spin"
            style={{ color: "#c1c1c3" }}
          />
        </div>
      ) : similarArtists.length > 0 ? (
        <div className="flex items-start gap-2">
          <button
            onClick={() => {
              if (similarArtistsScrollRef.current) {
                similarArtistsScrollRef.current.scrollBy({
                  left: -320,
                  behavior: "smooth",
                });
              }
            }}
            className="flex-shrink-0 p-2 hover:bg-black/50 transition-colors"
            style={{
              color: "#fff",
              marginTop: "70px",
            }}
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div
            ref={similarArtistsScrollRef}
            className="flex overflow-x-auto pb-4 gap-4 scroll-smooth similar-artists-scroll flex-1"
            style={{
              scrollbarWidth: "none",
              msOverflowStyle: "none",
            }}
          >
            {similarArtists.map((similar) => (
              <div
                key={similar.id}
                className="flex-shrink-0 w-40 group cursor-pointer"
                onClick={() => onArtistClick(similar.id, similar.name)}
              >
                <div
                  className="relative aspect-square overflow-hidden  mb-2 shadow-sm group-hover:shadow-md transition-all"
                  style={{ backgroundColor: "#211f27" }}
                >
                  <ArtistImage
                    src={similar.image}
                    mbid={similar.id}
                    artistName={similar.name}
                    alt={similar.name}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                  />

                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"></div>

                  {similar.match && (
                    <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-sm text-white text-[10px] px-1.5 py-0.5 font-medium">
                      {similar.match}% Match
                    </div>
                  )}
                </div>
                <h3
                  className="font-medium text-sm  truncate transition-colors"
                  style={{ color: "#fff" }}
                >
                  {similar.name}
                </h3>
              </div>
            ))}
          </div>
          <button
            onClick={() => {
              if (similarArtistsScrollRef.current) {
                similarArtistsScrollRef.current.scrollBy({
                  left: 320,
                  behavior: "smooth",
                });
              }
            }}
            className="flex-shrink-0 p-2 hover:bg-black/50 transition-colors"
            style={{
              color: "#fff",
              marginTop: "70px",
            }}
            aria-label="Scroll right"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

ArtistDetailsSimilar.propTypes = {
  loadingSimilar: PropTypes.bool,
  similarArtists: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      name: PropTypes.string,
      image: PropTypes.string,
      match: PropTypes.number,
    })
  ),
  similarArtistsScrollRef: PropTypes.oneOfType([
    PropTypes.func,
    PropTypes.shape({ current: PropTypes.instanceOf(Element) }),
  ]),
  onArtistClick: PropTypes.func,
};
