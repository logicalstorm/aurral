import PropTypes from "prop-types";
import { ListMusic, Music } from "lucide-react";
import ArtistImage from "./ArtistImage";
import SearchLibraryCheck from "./SearchLibraryCheck";
import {
  getSearchResultKey,
  navigateFromSearchResult,
} from "../utils/searchNavigation";
import { getArtistRecordId } from "../utils/artistTaste";

function getTypeLabel(item) {
  if (item.type === "artist") return "Artist";
  if (item.type === "album") return "Album";
  if (item.type === "track") return "Song";
  if (item.type === "playlist") return "Playlist";
  return null;
}

function getPrimaryLabel(item) {
  if (item.type === "artist") return item.name || "";
  if (item.type === "playlist") return item.name || "";
  if (item.type === "album") return item.title || "";
  if (item.type === "track") return item.title || "";
  return "";
}

function getSecondaryLabel(item) {
  if (item.type === "artist") return "Artist";
  if (item.type === "album" && item.artistName) {
    return `Album · ${item.artistName}`;
  }
  if (item.type === "track" && item.artistName) {
    return `Song · ${item.artistName}`;
  }
  if (item.type === "playlist" && item.trackCount != null) {
    return `Playlist · ${item.trackCount} track${item.trackCount === 1 ? "" : "s"}`;
  }
  return getTypeLabel(item);
}

function ResultThumbnail({ item, artistImages, albumCovers }) {
  if (item.type === "artist") {
    const artistId = getArtistRecordId(item);
    return (
      <span className="search-mixed-results__thumb search-mixed-results__thumb--round">
        <ArtistImage
          src={artistImages[artistId] || item.image || item.imageUrl}
          mbid={artistId}
          artistName={item.name}
          alt={item.name}
          className="search-mixed-results__image"
          showLoading={false}
          enableBackendFallback={false}
        />
      </span>
    );
  }

  const coverSrc =
    item.type === "album"
      ? albumCovers[item.id] || item.coverUrl
      : item.type === "track"
        ? albumCovers[item.albumMbid] || item.coverUrl
        : null;

  return (
    <span className="search-mixed-results__thumb">
      {coverSrc ? (
        <img
          src={coverSrc}
          alt=""
          className="search-mixed-results__image"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span className="search-mixed-results__placeholder" aria-hidden="true">
          {item.type === "playlist" ? (
            <ListMusic className="artist-icon-sm" />
          ) : (
            <Music className="artist-icon-sm" />
          )}
        </span>
      )}
    </span>
  );
}

function SearchMixedResultList({
  items,
  navigate,
  query = "",
  artistImages = {},
  albumCovers = {},
}) {
  if (!items.length) return null;

  return (
    <ul className="search-mixed-results">
      {items.map((item, index) => {
        const typeLabel = getTypeLabel(item);
        return (
          <li key={getSearchResultKey(item, index)}>
            <button
              type="button"
              className="search-mixed-results__row"
              onClick={() => navigateFromSearchResult(navigate, item, { query })}
            >
              <ResultThumbnail
                item={item}
                artistImages={artistImages}
                albumCovers={albumCovers}
              />
              <span className="search-mixed-results__copy">
                <span className="search-mixed-results__title">
                  {getPrimaryLabel(item)}
                </span>
                <span className="search-mixed-results__subtitle">
                  {getSecondaryLabel(item)}
                </span>
              </span>
              <span className="search-mixed-results__tags">
                {typeLabel && (
                  <span className="search-mixed-results__type">{typeLabel}</span>
                )}
                {item.inLibrary && <SearchLibraryCheck />}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

SearchMixedResultList.propTypes = {
  items: PropTypes.arrayOf(PropTypes.object).isRequired,
  navigate: PropTypes.func.isRequired,
  query: PropTypes.string,
  artistImages: PropTypes.object,
  albumCovers: PropTypes.object,
};

ResultThumbnail.propTypes = {
  item: PropTypes.object.isRequired,
  artistImages: PropTypes.object.isRequired,
  albumCovers: PropTypes.object.isRequired,
};

export default SearchMixedResultList;
