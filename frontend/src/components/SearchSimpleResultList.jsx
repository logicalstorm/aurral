import PropTypes from "prop-types";
import {
  getSearchResultKey,
  getSearchResultLabel,
  navigateFromSearchResult,
} from "../utils/searchNavigation";

function SearchSimpleResultList({ items, navigate, query = "" }) {
  if (!items.length) return null;

  return (
    <ul className="search-track-results">
      {items.map((item, index) => (
        <li key={getSearchResultKey(item, index)}>
          <button
            type="button"
            className="search-track-results__row"
            onClick={() => navigateFromSearchResult(navigate, item, { query })}
          >
            <span className="search-track-results__copy">
              <span className="search-track-results__title">
                {getSearchResultLabel(item)}
              </span>
            </span>
            {item.source === "lastfm" && (
              <span className="search-track-results__badge search-track-results__badge--muted">
                Last.fm
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

SearchSimpleResultList.propTypes = {
  items: PropTypes.arrayOf(PropTypes.object).isRequired,
  navigate: PropTypes.func.isRequired,
  query: PropTypes.string,
};

export default SearchSimpleResultList;
