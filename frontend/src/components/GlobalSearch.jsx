import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Clock, Loader2, Search } from "lucide-react";
import {
  getBootstrapStatus,
  getTagSuggestions,
  searchUnified,
} from "../utils/api";
import {
  buildUnifiedSuggestionSections,
  flattenSuggestionSections,
  getSearchResultLabel,
  navigateFromSearchResult,
} from "../utils/searchNavigation";
import {
  addRecentSearch,
  clearRecentSearches,
  readRecentSearches,
} from "../utils/recentSearches";

const AUTOCOMPLETE_DEBOUNCE_MS = 250;
const SUGGEST_LIMIT = 5;
const TAG_SUGGESTIONS_LIMIT = 8;

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  return ["input", "textarea", "select"].includes(tagName);
}

function GlobalSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const [lastfmConfigured, setLastfmConfigured] = useState(true);
  const [localSearchConfigured, setLocalSearchConfigured] = useState(true);
  const [suggestionRows, setSuggestionRows] = useState([]);
  const [suggestionMode, setSuggestionMode] = useState(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [inputFocused, setInputFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState(() => readRecentSearches());
  const searchContainerRef = useRef(null);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  const selectableRows = useMemo(() => {
    if (suggestionMode === "tag") return suggestionRows;
    return suggestionRows.filter((row) => row.kind === "item");
  }, [suggestionRows, suggestionMode]);

  const showRecentSearches = useMemo(
    () =>
      inputFocused &&
      searchQuery.trim().length < 2 &&
      recentSearches.length > 0 &&
      !loadingSuggestions &&
      suggestionRows.length === 0,
    [
      inputFocused,
      loadingSuggestions,
      recentSearches.length,
      searchQuery,
      suggestionRows.length,
    ],
  );

  const recentSelectableRows = useMemo(
    () =>
      showRecentSearches
        ? recentSearches.map((query, index) => ({
            kind: "recent",
            key: `recent:${query}:${index}`,
            query,
          }))
        : [],
    [recentSearches, showRecentSearches],
  );

  const keyboardRows = showRecentSearches ? recentSelectableRows : selectableRows;

  const rememberSearch = useCallback((rawQuery) => {
    const next = addRecentSearch(rawQuery);
    setRecentSearches(next);
  }, []);

  const closeAutocomplete = useCallback(() => {
    setSuggestionRows([]);
    setSuggestionMode(null);
    setSuggestionIndex(-1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadBootstrapStatus = async () => {
      try {
        const bootstrap = await getBootstrapStatus();
        if (!cancelled) {
          setLastfmConfigured(!!bootstrap.lastfmConfigured);
        }
      } catch {
        if (!cancelled) {
          setLastfmConfigured(true);
        }
      }
    };
    loadBootstrapStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSearchQuery("");
    closeAutocomplete();
  }, [location.pathname, location.search, closeAutocomplete]);

  useEffect(() => {
    const handleGlobalKeyDown = (event) => {
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    const isTagShortcut = lastfmConfigured && trimmed.startsWith("#");
    const tagPart = isTagShortcut ? trimmed.slice(1).trim() : trimmed;

    if (isTagShortcut) {
      if (tagPart.length < 2) {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
        closeAutocomplete();
        return;
      }

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        debounceRef.current = null;
        setLoadingSuggestions(true);
        try {
          const data = await getTagSuggestions(tagPart, TAG_SUGGESTIONS_LIMIT);
          const raw = data.tags || [];
          const seen = new Set();
          const tags = raw.filter((tag) => {
            const key = String(tag || "")
              .trim()
              .toLowerCase();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          setSuggestionRows(
            tags.map((tagName) => ({
              kind: "tag",
              key: `tag:${tagName}`,
              tagName,
            })),
          );
          setSuggestionMode("tag");
          setSuggestionIndex(-1);
        } catch {
          closeAutocomplete();
        } finally {
          setLoadingSuggestions(false);
        }
      }, AUTOCOMPLETE_DEBOUNCE_MS);

      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }

    if (trimmed.length < 2) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      closeAutocomplete();
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      debounceRef.current = null;
      setLoadingSuggestions(true);
      try {
        const data = await searchUnified(trimmed, {
          mode: "suggest",
          limit: SUGGEST_LIMIT,
        });
        setLocalSearchConfigured(!!data?.localSearchConfigured);
        const sections = buildUnifiedSuggestionSections(data);
        setSuggestionRows(flattenSuggestionSections(sections));
        setSuggestionMode("unified");
        setSuggestionIndex(-1);
      } catch {
        closeAutocomplete();
      } finally {
        setLoadingSuggestions(false);
      }
    }, AUTOCOMPLETE_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, closeAutocomplete, lastfmConfigured]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target)
      ) {
        closeAutocomplete();
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [closeAutocomplete]);

  const navigateToSearch = useCallback(
    (rawQuery) => {
      const trimmed = String(rawQuery || "").trim();
      if (!trimmed) return;
      rememberSearch(trimmed);
      if (trimmed.startsWith("#")) {
        navigate(`/search?q=${encodeURIComponent(trimmed.slice(1))}&type=tag`);
      } else {
        navigate(`/search?q=${encodeURIComponent(trimmed)}`);
      }
      setSearchQuery("");
      closeAutocomplete();
      setInputFocused(false);
    },
    [navigate, closeAutocomplete, rememberSearch],
  );

  const handleSubmit = (event) => {
    event.preventDefault();
    navigateToSearch(searchQuery);
  };

  const handleSuggestionSelect = useCallback(
    (selection) => {
      if (!selection) return;

      if (selection.kind === "recent") {
        navigateToSearch(selection.query);
        return;
      }

      if (selection.kind === "tag") {
        rememberSearch(`#${selection.tagName}`);
        navigate(
          `/search?q=${encodeURIComponent(selection.tagName)}&type=tag`,
        );
        setSearchQuery("");
        closeAutocomplete();
        setInputFocused(false);
        return;
      }

      if (selection.kind === "item") {
        const query = searchQuery.trim();
        if (query) rememberSearch(query);
        navigateFromSearchResult(navigate, selection.item, { query });
        setSearchQuery("");
        closeAutocomplete();
        setInputFocused(false);
      }
    },
    [navigate, navigateToSearch, rememberSearch, searchQuery, closeAutocomplete],
  );

  const handleClearRecentSearches = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setRecentSearches(clearRecentSearches());
    setSuggestionIndex(-1);
  }, []);

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      closeAutocomplete();
      return;
    }
    if (keyboardRows.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSuggestionIndex((current) =>
        current < keyboardRows.length - 1 ? current + 1 : current,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSuggestionIndex((current) => (current > 0 ? current - 1 : -1));
    } else if (event.key === "Enter" && suggestionIndex >= 0) {
      event.preventDefault();
      handleSuggestionSelect(keyboardRows[suggestionIndex]);
    }
  };

  let selectableCursor = -1;

  return (
    <form
      ref={searchContainerRef}
      onSubmit={handleSubmit}
      className="global-search"
    >
      <div className="global-search__box global-search__box--unified">
        <div className="global-search__input-wrap global-search__input-wrap--unified">
          <Search className="global-search__icon" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onFocus={() => {
              setInputFocused(true);
              setSuggestionIndex(-1);
            }}
            onBlur={() => {
              window.setTimeout(() => setInputFocused(false), 120);
            }}
            onKeyDown={handleKeyDown}
            placeholder=""
            className="global-search__input"
            autoComplete="off"
          />
          {!searchQuery && (
            <div className="global-search__placeholder">
              <span className="global-search__scope-label--short">Search...</span>
              <span className="global-search__scope-label--full">Type</span>
              <span className="global-search__key">/</span>
              <span className="global-search__scope-label--full">to search</span>
            </div>
          )}
          {loadingSuggestions && (
            <div className="global-search__loader">
              <Loader2 className="artist-icon-md animate-spin" />
            </div>
          )}
        </div>
      </div>

      {!loadingSuggestions &&
        suggestionMode === "unified" &&
        !localSearchConfigured &&
        searchQuery.trim().length >= 2 && (
          <div className="global-search__suggestions global-search__suggestions--grouped">
            <div className="global-search__suggestion-group">
              Search not configured
            </div>
            <div className="global-search__suggestion global-search__suggestion--message">
              Configure the search server in Settings to search artists,
              releases, and tracks.
            </div>
          </div>
        )}

      {showRecentSearches && (
        <div className="global-search__suggestions global-search__suggestions--grouped global-search__suggestions--recent">
          <div className="global-search__recent-header">
            <span className="global-search__recent-label">Recent searches</span>
            <button
              type="button"
              className="global-search__recent-clear"
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleClearRecentSearches}
            >
              Clear
            </button>
          </div>
          {recentSelectableRows.map((row, index) => (
            <button
              key={row.key}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleSuggestionSelect(row)}
              className={`global-search__suggestion global-search__suggestion--recent${
                index === suggestionIndex ? " is-highlighted" : ""
              }`}
            >
              <Clock className="global-search__recent-icon" aria-hidden="true" />
              <span className="global-search__recent-query">{row.query}</span>
            </button>
          ))}
        </div>
      )}

      {!loadingSuggestions && suggestionRows.length > 0 && (
        <div className="global-search__suggestions global-search__suggestions--grouped">
          {suggestionMode === "tag"
            ? suggestionRows.map((row, index) => (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => handleSuggestionSelect(row)}
                  className={`global-search__suggestion${
                    index === suggestionIndex ? " is-highlighted" : ""
                  }`}
                >
                  #{row.tagName}
                </button>
              ))
            : suggestionRows.map((row) => {
                if (row.kind === "header") {
                  return (
                    <div
                      key={row.key}
                      className="global-search__suggestion-group"
                    >
                      {row.label}
                    </div>
                  );
                }

                selectableCursor += 1;
                const highlighted = selectableCursor === suggestionIndex;
                const item = row.item;
                const label = getSearchResultLabel(item);
                const typeLabel =
                  item.type === "artist"
                    ? "Artist"
                    : item.type === "album"
                      ? "Album"
                      : item.type === "track"
                        ? "Song"
                        : item.type === "playlist"
                          ? "Playlist"
                          : null;
                const meta =
                  item.type === "track" && item.albumTitle
                    ? item.albumTitle
                    : item.type === "album" && item.primaryType
                      ? item.primaryType
                      : item.type === "playlist" && item.trackCount != null
                        ? `${item.trackCount} track${item.trackCount === 1 ? "" : "s"}`
                        : null;

                return (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => handleSuggestionSelect(row)}
                    className={`global-search__suggestion global-search__suggestion--rich${
                      highlighted ? " is-highlighted" : ""
                    }`}
                  >
                    <span className="global-search__suggestion-copy">
                      <span className="global-search__suggestion-title">
                        {label}
                      </span>
                      {meta && (
                        <span className="global-search__suggestion-meta">
                          {meta}
                        </span>
                      )}
                    </span>
                    <span className="global-search__suggestion-tags">
                      {typeLabel && (
                        <span className="global-search__suggestion-type">
                          {typeLabel}
                        </span>
                      )}
                      {item.inLibrary && (
                        <span className="global-search__suggestion-badge">
                          Library
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
        </div>
      )}
    </form>
  );
}

export default GlobalSearch;
