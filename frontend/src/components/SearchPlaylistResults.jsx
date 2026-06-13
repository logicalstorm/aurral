import { useState } from "react";
import PropTypes from "prop-types";
import { navigateFromSearchResult } from "../utils/searchNavigation";
import { getSearchPlaylistArtworkUrl } from "../utils/playlistArtworkUrls";

function PlaylistCover({ playlist }) {
  const [failed, setFailed] = useState(false);
  const src = getSearchPlaylistArtworkUrl(playlist);

  if (!src || failed) {
    return <span className="search-playlist-card__cover" aria-hidden="true" />;
  }

  return (
    <span className="search-playlist-card__cover" aria-hidden="true">
      <img
        src={src}
        alt=""
        className="search-playlist-card__image"
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

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
            <PlaylistCover playlist={playlist} />
            <span className="search-playlist-card__title">{playlist.name}</span>
            {playlist.trackCount != null && (
              <span className="search-playlist-card__meta">
                {playlist.source === "discover" ? "Discover · " : ""}
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

PlaylistCover.propTypes = {
  playlist: PropTypes.object.isRequired,
};

export default SearchPlaylistResults;
