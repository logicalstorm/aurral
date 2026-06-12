import PropTypes from "prop-types";
import ArtistImage from "./ArtistImage";
import SearchLibraryCheck from "./SearchLibraryCheck";
import { getArtistRecordId } from "../utils/artistTaste";

function SearchTopArtistCard({ artist, artistImages, libraryLookup, navigate }) {
  const artistId = getArtistRecordId(artist);
  if (!artistId) return null;

  const openArtist = () => {
    navigate(`/artist/${artistId}`, {
      state: {
        artistName: artist.name,
        ...(typeof libraryLookup[artistId] === "boolean"
          ? { inLibrary: libraryLookup[artistId] }
          : {}),
      },
    });
  };

  return (
    <article className="search-top-artist">
      <button
        type="button"
        className="search-top-artist__main"
        onClick={openArtist}
      >
        <span className="search-top-artist__image-wrap">
          <ArtistImage
            src={artistImages[artistId] || artist.image || artist.imageUrl}
            mbid={artistId}
            artistName={artist.name}
            alt={artist.name}
            className="search-top-artist__image"
            showLoading={false}
            enableBackendFallback={false}
          />
        </span>
        <span className="search-top-artist__copy">
          <span className="search-top-artist__eyebrow">Top result</span>
          <span className="search-top-artist__title-row">
            <span className="search-top-artist__name">{artist.name}</span>
            {libraryLookup[artistId] && <SearchLibraryCheck />}
          </span>
          <span className="search-top-artist__meta">Artist</span>
        </span>
      </button>
    </article>
  );
}

SearchTopArtistCard.propTypes = {
  artist: PropTypes.object.isRequired,
  artistImages: PropTypes.object.isRequired,
  libraryLookup: PropTypes.object.isRequired,
  navigate: PropTypes.func.isRequired,
};

export default SearchTopArtistCard;
