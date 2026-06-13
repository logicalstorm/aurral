import PropTypes from "prop-types";
import { ListMusic, Music } from "lucide-react";
import ArtistImage from "./ArtistImage";
import SearchLibraryCheck from "./SearchLibraryCheck";
import { navigateFromSearchResult } from "../utils/searchNavigation";
import { getArtistRecordId } from "../utils/artistTaste";

function getPrimaryLabel(item) {
  if (item?.type === "artist") return item.name || "";
  if (item?.type === "album") return item.title || "";
  if (item?.type === "track") return item.title || "";
  if (item?.type === "playlist") return item.name || "";
  return "";
}

function getMetaLabel(item) {
  if (item?.type === "artist") return "Artist";
  if (item?.type === "album") {
    return item.artistName ? `Album · ${item.artistName}` : "Album";
  }
  if (item?.type === "track") {
    return item.artistName ? `Song · ${item.artistName}` : "Song";
  }
  if (item?.type === "playlist") {
    return item.trackCount != null
      ? `Playlist · ${item.trackCount} track${item.trackCount === 1 ? "" : "s"}`
      : "Playlist";
  }
  return "";
}

function TopResultImage({ item, artistImages, albumCovers }) {
  if (item.type === "artist") {
    const artistId = getArtistRecordId(item);
    return (
      <ArtistImage
        src={artistImages[artistId] || item.image || item.imageUrl}
        mbid={artistId}
        artistName={item.name}
        alt={item.name}
        className="search-top-artist__image"
        showLoading={false}
        enableBackendFallback={false}
      />
    );
  }

  const coverSrc =
    item.type === "album"
      ? albumCovers[item.id] || item.coverUrl
      : item.type === "track"
        ? albumCovers[item.albumMbid] || item.coverUrl
        : null;

  if (coverSrc) {
    return (
      <img
        src={coverSrc}
        alt=""
        className="search-top-artist__image"
        loading="lazy"
        decoding="async"
      />
    );
  }

  return item.type === "playlist" ? (
    <ListMusic className="artist-icon-lg" />
  ) : (
    <Music className="artist-icon-lg" />
  );
}

function SearchTopResultCard({
  item,
  artist: legacyArtist,
  artistImages,
  albumCovers = {},
  libraryLookup,
  navigate,
  query = "",
  albumDestination = "tracklist",
}) {
  const result = item || legacyArtist;
  const label = getPrimaryLabel(result);
  if (!result || !label) return null;

  const artistId = result.type === "artist" ? getArtistRecordId(result) : null;
  const isInLibrary =
    result.inLibrary || (artistId ? libraryLookup[artistId] : false);

  return (
    <article className="search-top-artist">
      <button
        type="button"
        className="search-top-artist__main"
        onClick={() =>
          navigateFromSearchResult(navigate, result, { query, albumDestination })
        }
      >
        <span
          className={`search-top-artist__image-wrap${
            result.type === "artist" ? "" : " search-top-artist__image-wrap--square"
          }`}
        >
          <TopResultImage
            item={result}
            artistImages={artistImages}
            albumCovers={albumCovers}
          />
        </span>
        <span className="search-top-artist__copy">
          <span className="search-top-artist__eyebrow">Top result</span>
          <span className="search-top-artist__title-row">
            <span className="search-top-artist__name">{label}</span>
            {isInLibrary && <SearchLibraryCheck />}
          </span>
          <span className="search-top-artist__meta">{getMetaLabel(result)}</span>
        </span>
      </button>
    </article>
  );
}

SearchTopResultCard.propTypes = {
  item: PropTypes.object,
  artist: PropTypes.object,
  artistImages: PropTypes.object.isRequired,
  albumCovers: PropTypes.object,
  libraryLookup: PropTypes.object.isRequired,
  navigate: PropTypes.func.isRequired,
  query: PropTypes.string,
  albumDestination: PropTypes.oneOf(["release", "tracklist"]),
};

TopResultImage.propTypes = {
  item: PropTypes.object.isRequired,
  artistImages: PropTypes.object.isRequired,
  albumCovers: PropTypes.object.isRequired,
};

export default SearchTopResultCard;
