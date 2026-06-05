import { useState, useEffect, useRef, memo } from "react";
import PropTypes from "prop-types";
import { useNavigate } from "react-router-dom";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import {
  Loader,
  Music,
  Clock,
  MapPin,
  Pencil,
  AlertCircle,
} from "lucide-react";
import { getNearbyShows } from "../utils/api";

const NEARBY_MODE_KEY = "discoverNearbyMode";
const NEARBY_ZIP_KEY = "discoverNearbyZip";
const SHOWS_PAGE_LIMIT = 60;
const SHOW_FILTER_OPTIONS = [
  { id: "all", label: "All" },
  { id: "library", label: "Library" },
  { id: "discover", label: "Discover" },
];

const formatShowDate = (show) => {
  if (!show?.date && !show?.dateTime) return null;
  const raw = show.dateTime || show.date;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return show.date || null;
  }
  const dateLabel = parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (show.time) {
    return `${dateLabel} at ${show.time}`;
  }
  return dateLabel;
};

const formatShowLocation = (show) =>
  [show?.venueName, [show?.city, show?.region].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(" - ");

const ShowCard = memo(({ show }) => {
  const showDate = formatShowDate(show);
  const showLocation = formatShowLocation(show);

  return (
    <article className="shows-page__card">
      <a
        href={show.url || "#"}
        target="_blank"
        rel="noopener noreferrer"
        className="shows-page__card-media"
      >
        {show.image ? (
          <img
            src={show.image}
            alt={show.eventName || show.artistName}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="artist-media-placeholder">
            <Music className="artist-icon-lg" />
          </div>
        )}
        {Number.isFinite(show.distance) && (
          <span className="shows-page__card-badge">
            {Math.round(show.distance)} mi
          </span>
        )}
      </a>
      <div className="shows-page__card-body">
        <p className="shows-page__card-artist artist-truncate">
          {show.artistName}
        </p>
        <h3 className="shows-page__card-title">
          <a
            href={show.url || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="shows-page__card-link"
          >
            {show.eventName}
          </a>
        </h3>
        <div className="shows-page__card-meta">
          {showDate && (
            <p className="shows-page__card-meta-line">
              <Clock className="artist-icon-xs" />
              <span className="artist-truncate">{showDate}</span>
            </p>
          )}
          {showLocation && (
            <p className="shows-page__card-meta-line">
              <MapPin className="artist-icon-xs" />
              <span className="artist-clamp-2">{showLocation}</span>
            </p>
          )}
        </div>
      </div>
    </article>
  );
});

ShowCard.displayName = "ShowCard";

ShowCard.propTypes = {
  show: PropTypes.shape({
    id: PropTypes.string,
    artistName: PropTypes.string,
    eventName: PropTypes.string,
    image: PropTypes.string,
    url: PropTypes.string,
    date: PropTypes.string,
    time: PropTypes.string,
    dateTime: PropTypes.string,
    venueName: PropTypes.string,
    city: PropTypes.string,
    region: PropTypes.string,
    distance: PropTypes.number,
  }).isRequired,
};

function ShowsPage() {
  useDocumentTitle("Shows");
  const navigate = useNavigate();
  const zipEditorRef = useRef(null);
  const [showsData, setShowsData] = useState(null);
  const [showsLoading, setShowsLoading] = useState(false);
  const [showsError, setShowsError] = useState(null);
  const [showFilter, setShowFilter] = useState("all");
  const [locationMode, setLocationMode] = useState("ip");
  const [appliedZip, setAppliedZip] = useState("");
  const [showZipEditor, setShowZipEditor] = useState(false);
  const [zipDraft, setZipDraft] = useState("");
  const zipModeActive = locationMode === "zip";
  const zipEditorVisible =
    showZipEditor || (zipModeActive && !appliedZip.trim());

  useEffect(() => {
    try {
      const storedMode = localStorage.getItem(NEARBY_MODE_KEY);
      const storedZip = localStorage.getItem(NEARBY_ZIP_KEY) || "";
      if (storedMode === "zip" || storedMode === "ip") {
        setLocationMode(storedMode);
      }
      setAppliedZip(storedZip);
      setZipDraft(storedZip);
    } catch {}
  }, []);

  useEffect(() => {
    if (!zipEditorVisible || !appliedZip.trim()) return;
    const handleClickOutside = (event) => {
      if (
        zipEditorRef.current &&
        !zipEditorRef.current.contains(event.target)
      ) {
        setShowZipEditor(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [zipEditorVisible, appliedZip]);

  useEffect(() => {
    const shouldUseZip = locationMode === "zip";
    if (shouldUseZip && !appliedZip.trim()) {
      setShowsData(null);
      setShowsError(null);
      setShowsLoading(false);
      return;
    }

    let cancelled = false;
    setShowsLoading(true);
    setShowsError(null);

    getNearbyShows(shouldUseZip ? appliedZip : "", SHOWS_PAGE_LIMIT)
      .then((response) => {
        if (cancelled) return;
        setShowsData(response);
        setShowsError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setShowsError(
          error.response?.data?.message || "Failed to load nearby shows",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setShowsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [locationMode, appliedZip]);

  const allShows = showsData?.shows || [];
  const libraryShows = showsData?.libraryShows || [];
  const discoverShows = showsData?.recommendedShows || [];
  const shows =
    showFilter === "library"
      ? libraryShows
      : showFilter === "discover"
        ? discoverShows
        : allShows;
  const locationLabel =
    showsData?.location?.label || showsData?.location?.postalCode || "your area";

  const saveZip = () => {
    const sanitized = zipDraft.trim();
    if (!sanitized) return;
    setAppliedZip(sanitized);
    setLocationMode("zip");
    setShowZipEditor(false);
    try {
      localStorage.setItem(NEARBY_MODE_KEY, "zip");
      localStorage.setItem(NEARBY_ZIP_KEY, sanitized);
    } catch {}
  };

  const emptyMessage =
    showFilter === "library"
      ? `We could not find local Ticketmaster shows for artists from your library around ${locationLabel}.`
      : showFilter === "discover"
        ? `We could not find local Ticketmaster shows tied to your Discover recommendations around ${locationLabel}.`
        : `We could not find local Ticketmaster shows for artists from your library or Discover around ${locationLabel}.`;

  return (
    <div className="shows-page">
      <header className="shows-page__header">
        <div className="shows-page__title-row">
          <h1 className="shows-page__title">Shows Near You</h1>
          <div className="shows-page__location-controls">
            <div className="artist-segmented">
              <button
                type="button"
                onClick={() => {
                  setLocationMode("ip");
                  setShowZipEditor(false);
                  try {
                    localStorage.setItem(NEARBY_MODE_KEY, "ip");
                  } catch {}
                }}
                className={`btn btn-xs shows-page__segment${!zipModeActive ? " btn-neutral-active" : " btn-ghost"}`}
              >
                Your Area
              </button>
              <button
                type="button"
                onClick={() => {
                  setLocationMode("zip");
                  try {
                    localStorage.setItem(NEARBY_MODE_KEY, "zip");
                  } catch {}
                  if (!appliedZip.trim()) {
                    setZipDraft("");
                    setShowZipEditor(true);
                  }
                }}
                className={`btn btn-xs shows-page__segment${zipModeActive ? " btn-neutral-active" : " btn-ghost"}`}
              >
                ZIP
              </button>
            </div>
            {zipModeActive && (
              <div ref={zipEditorRef} className="shows-page__zip-editor">
                <button
                  type="button"
                  onClick={() => {
                    setZipDraft(appliedZip);
                    setShowZipEditor((value) => !value);
                  }}
                  className="btn btn-surface btn-icon-square"
                  aria-label="Edit ZIP"
                  title="Edit ZIP"
                >
                  <Pencil className="artist-icon-sm" />
                </button>
                {zipEditorVisible && (
                  <div className="artist-nearby-zip-editor">
                    <div className="artist-nearby-zip-editor__field">
                      <input
                        type="text"
                        value={zipDraft}
                        onChange={(event) => setZipDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          saveZip();
                        }}
                        className="artist-nearby-zip-editor__input"
                        placeholder="ZIP or postal code"
                      />
                    </div>
                    <div className="artist-nearby-zip-editor__actions">
                      <button
                        type="button"
                        onClick={() => setShowZipEditor(false)}
                        className="btn btn-secondary btn-sm"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={saveZip}
                        className="btn btn-primary btn-sm"
                        disabled={!zipDraft.trim()}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {showsData?.configured === false ? (
        <div className="search-empty-panel">
          <div className="search-empty-panel__icon" aria-hidden="true">
            <MapPin className="artist-icon-lg" />
          </div>
          <h2 className="search-empty-panel__title">
            Ticketmaster not configured
          </h2>
          <p className="search-empty-panel__message">
            Add a Ticketmaster Consumer Key in Settings to enable local show
            discovery.
          </p>
          <button
            type="button"
            onClick={() => navigate("/settings")}
            className="btn btn-primary btn--bold btn-min-h shows-page__panel-action"
          >
            Open Settings
          </button>
        </div>
      ) : showsLoading ? (
        <div className="artist-loading">
          <Loader className="artist-spinner artist-spinner--large animate-spin" />
        </div>
      ) : showsError ? (
        <div className="artist-error-panel" role="alert">
          <AlertCircle className="artist-error-icon" aria-hidden="true" />
          <h2 className="artist-error-title">Unable to load nearby shows</h2>
          <p className="artist-error-copy">{showsError}</p>
        </div>
      ) : zipModeActive && !appliedZip.trim() ? (
        <div className="search-empty-panel">
          <div className="search-empty-panel__icon" aria-hidden="true">
            <MapPin className="artist-icon-lg" />
          </div>
          <h2 className="search-empty-panel__title">
            Enter a ZIP or postal code
          </h2>
          <p className="search-empty-panel__message">
            Use a postal code to browse library shows in another area.
          </p>
        </div>
      ) : shows.length > 0 ? (
        <section className="shows-page__content">
          <div className="shows-page__toolbar">
            <div className="shows-page__toolbar-main">
              <p className="artist-count shows-page__result-count">
                Showing {shows.length}
                {showFilter === "all" && showsData?.total > shows.length
                  ? ` of ${showsData.total}`
                  : ""}{" "}
                upcoming matches around {locationLabel}
              </p>
              <div className="artist-segmented">
                {SHOW_FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setShowFilter(option.id)}
                    className={`btn btn-xs shows-page__segment${showFilter === option.id ? " btn-neutral-active" : " btn-ghost"}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {showFilter === "all" && showsData?.total > shows.length && (
              <p className="shows-page__hint">Refine the area to narrow the list</p>
            )}
          </div>
          <div className="shows-page__grid">
            {shows.map((show) => (
              <ShowCard
                key={`${show.id}-${show.artistName}-${show.sourceType || show.matchType || "show"}`}
                show={show}
              />
            ))}
          </div>
        </section>
      ) : (
        <div className="search-empty-panel">
          <div className="search-empty-panel__icon" aria-hidden="true">
            <Music className="artist-icon-lg" />
          </div>
          <h2 className="search-empty-panel__title">
            No upcoming nearby matches
          </h2>
          <p className="search-empty-panel__message">{emptyMessage}</p>
        </div>
      )}
    </div>
  );
}

export default ShowsPage;
