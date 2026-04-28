import PropTypes from "prop-types";
import { CheckCircle2 } from "lucide-react";
import ArtistImage from "./ArtistImage";

function SearchArtistResults({
  artists,
  type,
  artistImages,
  libraryLookup,
  navigate,
}) {
  const getArtistId = (artist) =>
    artist?.id || artist?.mbid || artist?.foreignArtistId;

  const formatLifeSpan = (artist) => {
    const begin =
      artist?.begin || artist?.["life-span"]?.begin || artist?.lifeSpan?.begin;
    if (!begin) return null;
    const ended =
      artist?.ended ??
      artist?.["life-span"]?.ended ??
      artist?.lifeSpan?.ended ??
      false;
    const end =
      artist?.end || artist?.["life-span"]?.end || artist?.lifeSpan?.end || null;
    const beginYear = String(begin).split("-")[0];
    if (ended && end) {
      const endYear = String(end).split("-")[0];
      return `${beginYear} - ${endYear}`;
    }
    return `${beginYear} - Present`;
  };

  const normalizeArtistType = (artist) => {
    const raw = artist?.artistType || artist?.type || null;
    if (!raw) return null;
    const types = {
      Person: "Solo Artist",
      Group: "Band",
      Orchestra: "Orchestra",
      Choir: "Choir",
      Character: "Character",
      Other: "Other",
    };
    return types[raw] || raw;
  };

  const normalizeArea = (artist) => {
    const value = artist?.area || artist?.area?.name || null;
    if (!value) return null;
    return String(value).trim() || null;
  };

  return (
    <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {artists.map((artist, index) => {
        const artistId = getArtistId(artist);
        const artistTypeLabel = normalizeArtistType(artist);
        const lifeSpan = formatLifeSpan(artist);
        const area = normalizeArea(artist);
        const country = artist?.country ? String(artist.country).trim() : null;
        const disambiguation = artist?.disambiguation
          ? String(artist.disambiguation).trim()
          : null;
        const disambiguationLine = [
          artistTypeLabel,
          area || country,
          lifeSpan,
          disambiguation,
        ]
          .filter(Boolean)
          .join(" • ");
        const artistMetaText = [
          type === "recommended" &&
            artist.sourceArtist &&
            `Similar to ${artist.sourceArtist}`,
        ]
          .filter(Boolean)
          .join(" • ");

        return (
          <div
            key={artistId || `artist-${index}`}
            className="group relative flex min-w-0 flex-col"
          >
            <div
              onClick={() =>
                navigate(`/artist/${artistId}`, {
                  state: { artistName: artist.name },
                })
              }
              className="relative mb-3 aspect-square cursor-pointer overflow-hidden shadow-sm transition-all group-hover:shadow-md"
              style={{ backgroundColor: "#211f27" }}
            >
              <ArtistImage
                src={artistImages[artistId] || artist.image || artist.imageUrl}
                mbid={artistId}
                artistName={artist.name}
                alt={artist.name}
                className="h-full w-full transition-transform duration-300 group-hover:scale-105"
                showLoading={false}
              />
            </div>

            <div className="flex min-w-0 flex-col">
              <div className="flex min-w-0 items-center gap-2">
                <h3
                  onClick={() =>
                    navigate(`/artist/${artistId}`, {
                      state: { artistName: artist.name },
                    })
                  }
                  className="truncate font-semibold hover:underline cursor-pointer"
                  style={{ color: "#fff" }}
                  title={artist.name}
                >
                  {artist.name}
                </h3>
                {libraryLookup[artistId] && (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-400" />
                )}
              </div>

              <div
                className="flex min-w-0 flex-col text-sm"
                style={{ color: "#c1c1c3" }}
              >
                {artistMetaText && (
                  <p className="truncate" title={artistMetaText}>
                    {artistMetaText}
                  </p>
                )}
                {disambiguationLine && (
                  <p
                    className="truncate text-xs opacity-80"
                    title={disambiguationLine}
                  >
                    {disambiguationLine}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

SearchArtistResults.propTypes = {
  artists: PropTypes.arrayOf(PropTypes.object).isRequired,
  type: PropTypes.string,
  artistImages: PropTypes.object.isRequired,
  libraryLookup: PropTypes.object.isRequired,
  navigate: PropTypes.func.isRequired,
};

export default SearchArtistResults;
