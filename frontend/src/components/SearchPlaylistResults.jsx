import PropTypes from "prop-types";
import { ListMusic } from "lucide-react";
import { navigateFromSearchResult } from "../utils/searchNavigation";

function SearchPlaylistResults({ playlists, navigate, query = "" }) {
  if (!playlists.length) return null;

  return (
    <div className="search-playlist-grid">
      {playlists.map((playlist, index) => (
        <article
          key={playlist.id || `playlist-${index}`}
          className="search-playlist-card"
        >
          <button
            type="button"
            className="search-playlist-card__button"
            onClick={() =>
              navigateFromSearchResult(navigate, playlist, { query })
            }
          >
            <span className="search-playlist-card__cover" aria-hidden="true">
              <ListMusic className="artist-icon-lg" />
            </span>
            <span className="search-playlist-card__title">{playlist.name}</span>
            {playlist.trackCount != null && (
              <span className="search-playlist-card__meta">
                {playlist.trackCount} track
                {playlist.trackCount === 1 ? "" : "s"}
              </span>
            )}
          </button>
        </article>
      ))}
    </div>
  );
}

SearchPlaylistResults.propTypes = {
  playlists: PropTypes.arrayOf(PropTypes.object).isRequired,
  navigate: PropTypes.func.isRequired,
  query: PropTypes.string,
};

export default SearchPlaylistResults;
