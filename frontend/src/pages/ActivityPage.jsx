import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Loader, Clock, CheckCircle2, AlertCircle, Music, RotateCcw } from "lucide-react";
import { getRequests, triggerAlbumSearch, checkHealth } from "../utils/api";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { TAG_COLORS } from "./ArtistDetails/constants";
import { PageSectionMobileNav } from "../components/PageSectionMobileNav";
import {
  ACTIVITY_VIEWS,
  DEFAULT_ACTIVITY_SOURCE,
  DEFAULT_ACTIVITY_VIEW,
  buildActivityPath,
  getActivitySourceItems,
  matchesActivitySource,
  matchesActivityView,
  normalizeActivitySource,
  normalizeActivityView,
  getActivityRequestSource,
} from "../navigation/activityNavConfig";

const ACTIVITY_SOURCE_COLORS = {
  all: "var(--aurral-gray)",
  lidarr: TAG_COLORS[10],
  slskd: TAG_COLORS[0],
  usenet: TAG_COLORS[2],
  aurral: TAG_COLORS[12],
};

const ACTIVITY_PAGE_SIZE = 25;
const QUEUE_POLL_INTERVAL_MS = 15000;
const HISTORY_POLL_INTERVAL_MS = 60000;

const getRequestIdentity = (request) =>
  String(
    request?.id ||
      [
        request?.source,
        request?.kind,
        request?.type,
        request?.jobId,
        request?.albumId,
        request?.mbid,
        request?.title,
        request?.name,
      ]
        .filter(Boolean)
        .join(":"),
  );

const buildRequestChangeSignature = (request) =>
  JSON.stringify({
    source: request?.source || null,
    kind: request?.kind || null,
    type: request?.type || null,
    title: request?.title || null,
    subtitle: request?.subtitle || null,
    name: request?.name || null,
    albumName: request?.albumName || null,
    artistName: request?.artistName || null,
    status: request?.status || null,
    statusLabel: request?.statusLabel || null,
    href: request?.href || null,
    inQueue: request?.inQueue === true,
    canReSearch: request?.canReSearch === true,
  });

const mergeActivityRequests = (previousRequests, nextRequests) => {
  const incoming = Array.isArray(nextRequests) ? nextRequests : [];
  if (!Array.isArray(previousRequests) || previousRequests.length === 0) {
    return incoming;
  }

  const previousById = new Map(
    previousRequests.map((request) => [getRequestIdentity(request), request]),
  );

  return incoming.map((request) => {
    const previous = previousById.get(getRequestIdentity(request));
    if (!previous) return request;
    if (buildRequestChangeSignature(previous) !== buildRequestChangeSignature(request)) {
      return request;
    }
    return {
      ...request,
      requestedAt: previous.requestedAt || request.requestedAt,
    };
  });
};

const formatTimelineTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatDateGroupLabel = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
};

const groupRequestsByDate = (requests) => {
  const groups = [];
  let currentLabel = null;
  for (const request of requests) {
    const label = formatDateGroupLabel(request.requestedAt);
    if (label !== currentLabel) {
      currentLabel = label;
      groups.push({ type: "date", label, key: `date-${label}` });
    }
    groups.push({ type: "item", request, key: request.id || request.mbid });
  }
  return groups;
};

const compareActivityRequests = (a, b) => {
  const aReSearchable = a?.canReSearch === true ? 1 : 0;
  const bReSearchable = b?.canReSearch === true ? 1 : 0;
  if (aReSearchable !== bReSearchable) {
    return bReSearchable - aReSearchable;
  }
  return (
    new Date(b.requestedAt) - new Date(a.requestedAt) ||
    String(b.id || "").localeCompare(String(a.id || ""))
  );
};

const buildHistoryListEntries = (requests) => {
  const reSearchable = [];
  const rest = [];
  for (const request of requests) {
    if (request?.canReSearch === true) {
      reSearchable.push(request);
    } else {
      rest.push(request);
    }
  }
  const entries = reSearchable.map((request) => ({
    type: "item",
    request,
    key: request.id || request.mbid,
  }));
  return [...entries, ...groupRequestsByDate(rest)];
};

const QUEUE_EMPTY_STATE_COPY = {
  all: {
    title: "Queue is empty",
    message: "Active album requests, downloads, and jobs will appear here.",
  },
  lidarr: {
    title: "No Lidarr downloads in progress",
    message: "Album requests from Lidarr will appear here while they are active.",
  },
  slskd: {
    title: "No slskd downloads in progress",
    message: "Active Soulseek searches and downloads will appear here.",
  },
  usenet: {
    title: "No Usenet downloads in progress",
    message: "Active Usenet downloads will appear here.",
  },
  aurral: {
    title: "No Aurral jobs in progress",
    message: "Playlist updates, discovery refreshes, and other active work will appear here.",
  },
};

const HISTORY_EMPTY_STATE_COPY = {
  all: {
    title: "No activity yet",
    message:
      "A chronological log of album requests, track downloads, and other activity will appear here.",
  },
  lidarr: {
    title: "No Lidarr history",
    message: "Completed and failed Lidarr album requests will appear here.",
  },
  slskd: {
    title: "No slskd history",
    message: "Completed and failed Soulseek downloads will appear here.",
  },
  usenet: {
    title: "No Usenet history",
    message: "Completed and failed Usenet downloads will appear here.",
  },
  aurral: {
    title: "No Aurral history",
    message: "Completed playlist updates, discovery refreshes, and other work will appear here.",
  },
};

function RequestStatusBadge({ request }) {
  if (request.status === "completed" || request.status === "available") {
    return (
      <span className="requests-page__badge requests-page__badge--success">
        <CheckCircle2 className="artist-icon-xs" />
        {request.statusLabel || "Done"}
      </span>
    );
  }

  if (request.status === "failed") {
    return (
      <span className="requests-page__badge requests-page__badge--failed">
        <AlertCircle className="artist-icon-xs" />
        {request.statusLabel || "Failed"}
      </span>
    );
  }

  if (request.status === "processing" || request.status === "pending") {
    return (
      <span className="requests-page__badge requests-page__badge--active">
        <Loader className="artist-icon-xs animate-spin" />
        {request.statusLabel || "In progress"}
      </span>
    );
  }

  return (
    <span className="requests-page__badge requests-page__badge--pending">
      <Clock className="artist-icon-xs" />
      {request.statusLabel || "Requested"}
    </span>
  );
}

function ActivityPage() {
  const navigate = useNavigate();
  const { view: viewParam, source: sourceParam } = useParams();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [usenetActive, setUsenetActive] = useState(false);
  const [visibleCount, setVisibleCount] = useState(ACTIVITY_PAGE_SIZE);
  const [reSearchingAlbumIds, setReSearchingAlbumIds] = useState({});
  const fetchRequestsInFlightRef = useRef(false);

  const sourceNavItems = useMemo(() => getActivitySourceItems(usenetActive), [usenetActive]);
  const activeView = normalizeActivityView(viewParam);
  const activeSource = normalizeActivitySource(sourceParam, usenetActive);
  const isQueueView = activeView === "queue";
  const shouldRedirectView = viewParam && normalizeActivityView(viewParam) !== viewParam;
  const shouldRedirectSource =
    sourceParam && normalizeActivitySource(sourceParam, usenetActive) !== sourceParam;

  const activeViewLabel =
    ACTIVITY_VIEWS.find((entry) => entry.id === activeView)?.label || "Activity";
  const activeSourceLabel =
    sourceNavItems.find((entry) => entry.id === activeSource)?.label || "All";

  useDocumentTitle(
    activeView === "queue" && activeSource === "all"
      ? "Queue - Activity"
      : activeView === "history" && activeSource === "all"
        ? "Activity"
        : `${activeSourceLabel} - ${activeViewLabel} - Activity`,
  );

  const filteredRequests = useMemo(
    () =>
      requests.filter(
        (request) =>
          matchesActivityView(request, activeView) && matchesActivitySource(request, activeSource),
      ),
    [requests, activeView, activeSource],
  );

  const sortedRequests = useMemo(
    () => [...filteredRequests].sort(compareActivityRequests),
    [filteredRequests],
  );

  const visibleRequests = useMemo(
    () => sortedRequests.slice(0, visibleCount),
    [sortedRequests, visibleCount],
  );

  const hasMoreItems = visibleCount < sortedRequests.length;

  const listEntries = useMemo(() => {
    if (isQueueView) {
      return visibleRequests.map((request) => ({
        type: "item",
        request,
        key: request.id || request.mbid,
      }));
    }
    return buildHistoryListEntries(visibleRequests);
  }, [isQueueView, visibleRequests]);

  useEffect(() => {
    setVisibleCount(ACTIVITY_PAGE_SIZE);
  }, [activeView, activeSource]);

  const fetchRequests = useCallback(async ({ silent = false } = {}) => {
    if (fetchRequestsInFlightRef.current) return;
    fetchRequestsInFlightRef.current = true;
    if (!silent) {
      setLoading(true);
    }

    try {
      const data = await getRequests();
      setRequests((previous) => mergeActivityRequests(previous, data));
      setError(null);
    } catch {
      setError("Failed to load activity.");
    } finally {
      fetchRequestsInFlightRef.current = false;
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    checkHealth()
      .then((health) => {
        if (!cancelled) {
          setUsenetActive(health?.usenetConfigured === true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    fetchRequests();
    const initialRefreshTimeout = setTimeout(() => {
      fetchRequests({ silent: true });
    }, 2000);

    const handleFocus = () => {
      fetchRequests({ silent: true });
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchRequests({ silent: true });
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearTimeout(initialRefreshTimeout);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchRequests]);

  useEffect(() => {
    const intervalMs = isQueueView ? QUEUE_POLL_INTERVAL_MS : HISTORY_POLL_INTERVAL_MS;
    const interval = setInterval(() => {
      fetchRequests({ silent: true });
    }, intervalMs);
    return () => clearInterval(interval);
  }, [isQueueView, fetchRequests]);

  const navigateToArtist = (request, isAlbum, artistMbid, artistName, displayName) => {
    if (!artistMbid || artistMbid === "null" || artistMbid === "undefined") {
      return;
    }
    navigate(isAlbum ? `/artist/${artistMbid}` : `/artist/${request.mbid}`, {
      state: {
        artistName: isAlbum ? artistName : displayName,
      },
    });
  };

  const handleReSearchAlbum = async (request) => {
    const albumId = request.albumId;
    if (!albumId || reSearchingAlbumIds[albumId]) return;
    setReSearchingAlbumIds((prev) => ({ ...prev, [albumId]: true }));
    try {
      await triggerAlbumSearch(albumId);
      setRequests((prev) =>
        prev.map((item) =>
          String(item.albumId) === String(albumId)
            ? {
                ...item,
                requestedAt: new Date().toISOString(),
                status: "processing",
                statusLabel: "Searching",
                title: item.albumName
                  ? `Searching Lidarr for ${item.albumName}`
                  : item.title?.replace(/^No results for /, "Searching Lidarr for ") || item.title,
                canReSearch: false,
              }
            : item,
        ),
      );
    } catch {
      setError("Failed to trigger album search.");
    } finally {
      setReSearchingAlbumIds(({ [albumId]: _, ...prev }) => prev);
    }
  };

  const handleRowNavigate = (
    request,
    { isSlskd, isUsenet, isAurral, isAlbum, artistMbid, artistName, displayName },
  ) => {
    if ((isSlskd || isUsenet) && request.playlistId) {
      navigate(`/playlists?selected=${encodeURIComponent(request.playlistId)}`);
      return;
    }
    if (request.href && (isAurral || request.type === "activity")) {
      navigate(request.href);
      return;
    }
    navigateToArtist(request, isAlbum, artistMbid, artistName, displayName);
  };

  const renderRequestRow = (request, rowIndex = 0) => {
    const isSlskd = request.source === "slskd";
    const isUsenet = request.source === "nzbget" || request.source === "sabnzbd";
    const isTrackDownload = isSlskd || isUsenet || request.kind === "track_download";
    const isAurral = request.source === "aurral" && !isTrackDownload;
    const isActivity = request.type === "activity";
    const isAlbum = request.type === "album";
    const usesTitleSubtitle = isTrackDownload || isAurral || isActivity;
    const displayName = usesTitleSubtitle
      ? request.title
      : isAlbum
        ? request.albumName
        : request.name;
    const artistName = isAlbum ? request.artistName : null;
    const metaLine = usesTitleSubtitle ? request.subtitle || null : artistName;
    const artistMbid = isAlbum ? request.artistMbid : request.mbid;
    const canNavigate =
      ((isSlskd || isUsenet) && request.playlistId) ||
      ((isAurral || isActivity) && request.href) ||
      (artistMbid && artistMbid !== "null" && artistMbid !== "undefined");
    const requestSource = getActivityRequestSource(request);
    const sourceColor = ACTIVITY_SOURCE_COLORS[requestSource];
    const timelineTime = formatTimelineTime(request.requestedAt);
    const canReSearch =
      request.canReSearch === true && request.albumId && !reSearchingAlbumIds[request.albumId];
    const isReSearching = Boolean(request.albumId && reSearchingAlbumIds[request.albumId]);
    const displayRequest =
      isReSearching && request.status === "failed"
        ? {
            ...request,
            status: "processing",
            statusLabel: "Searching",
          }
        : request;

    return (
      <article
        key={request.id || request.mbid}
        className={`requests-page__row requests-page__row--${requestSource}${rowIndex % 2 === 1 ? " requests-page__row--alt" : ""}${canNavigate ? " is-clickable" : ""}`}
        style={{ "--history-source-color": sourceColor }}
        onClick={() => {
          if (!canNavigate) return;
          handleRowNavigate(request, {
            isSlskd,
            isUsenet,
            isAurral,
            isAlbum,
            artistMbid,
            artistName,
            displayName,
          });
        }}
      >
        <div className="requests-page__details">
          <h3 className="requests-page__item-title" title={displayName}>
            {displayName}
          </h3>
          {(timelineTime || metaLine) && (
            <div className="requests-page__meta">
              {timelineTime && (
                <time className="requests-page__meta-time" dateTime={request.requestedAt}>
                  {timelineTime}
                </time>
              )}
              {timelineTime && metaLine && (
                <span className="requests-page__meta-separator" aria-hidden="true">
                  ·
                </span>
              )}
              {metaLine && <span className="artist-truncate">{metaLine}</span>}
            </div>
          )}
        </div>

        <div className="requests-page__status" onClick={(event) => event.stopPropagation()}>
          <RequestStatusBadge request={displayRequest} />
          {canReSearch && (
            <div className="requests-page__actions">
              <button
                type="button"
                className="btn btn-secondary btn--icon requests-page__action"
                aria-label={`Re-search ${request.albumName || displayName}`}
                title="Re-search"
                onClick={() => handleReSearchAlbum(request)}
              >
                <RotateCcw className="artist-icon-xs" />
              </button>
            </div>
          )}
        </div>
      </article>
    );
  };

  const emptyStateCopy = isQueueView ? QUEUE_EMPTY_STATE_COPY : HISTORY_EMPTY_STATE_COPY;
  const emptyState = emptyStateCopy[activeSource] || emptyStateCopy.all;
  const activityPath = buildActivityPath(activeView, activeSource);

  if (!viewParam || !sourceParam) {
    return (
      <Navigate
        to={buildActivityPath(
          viewParam || DEFAULT_ACTIVITY_VIEW,
          sourceParam || DEFAULT_ACTIVITY_SOURCE,
        )}
        replace
      />
    );
  }

  if (shouldRedirectView || shouldRedirectSource) {
    return <Navigate to={activityPath} replace />;
  }

  if (loading) {
    return (
      <div className="requests-page">
        <header className="requests-page__header">
          <h1 className="page-title">Activity</h1>
        </header>
        <div className="artist-loading">
          <Loader className="artist-spinner artist-spinner--large animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="requests-page">
      <header className="requests-page__header">
        <h1 className="page-title">Activity</h1>
      </header>

      <div className="requests-page__toolbar">
        <div className="artist-tabs requests-page__tabs" role="tablist" aria-label="Source">
          {sourceNavItems.map((entry) => (
            <Link
              key={entry.id}
              to={buildActivityPath(activeView, entry.id)}
              className={`artist-tab requests-page__tab--source${
                activeSource === entry.id ? " is-active" : ""
              }`}
              style={{
                "--history-source-color": ACTIVITY_SOURCE_COLORS[entry.id],
              }}
              role="tab"
              aria-selected={activeSource === entry.id}
            >
              {entry.label}
            </Link>
          ))}
        </div>
      </div>

      <PageSectionMobileNav
        sections={sourceNavItems}
        activeId={activeSource}
        label="Source"
        selectId="activity-source-select"
        getSectionPath={(source) => buildActivityPath(activeView, source)}
      />

      {error && (
        <div className="artist-error-panel requests-page__error" role="alert">
          <AlertCircle className="artist-error-icon" aria-hidden="true" />
          <h2 className="artist-error-title">Unable to load activity</h2>
          <p className="artist-error-copy">{error}</p>
          <button
            type="button"
            onClick={() => fetchRequests()}
            className="btn btn-secondary btn--bold btn-min-h requests-page__retry-button"
          >
            Try Again
          </button>
        </div>
      )}

      {!error && filteredRequests.length === 0 ? (
        <div className="search-empty-panel">
          <div className="search-empty-panel__icon" aria-hidden="true">
            <Music className="artist-icon-lg" />
          </div>
          <h2 className="search-empty-panel__title">{emptyState.title}</h2>
          <p className="search-empty-panel__message">{emptyState.message}</p>
          {isQueueView && activeSource === "all" && (
            <button
              type="button"
              onClick={() => navigate("/")}
              className="btn btn-primary btn--bold btn-min-h requests-page__empty-action"
            >
              Start Discovering
            </button>
          )}
        </div>
      ) : (
        !error && (
          <div className="requests-page__list">
            {(() => {
              let rowIndex = 0;
              return listEntries.map((entry) => {
                if (entry.type === "date") {
                  return (
                    <div key={entry.key} className="requests-page__date-group">
                      {entry.label}
                    </div>
                  );
                }
                const row = renderRequestRow(entry.request, rowIndex);
                rowIndex += 1;
                return row;
              });
            })()}
            {hasMoreItems && (
              <div className="requests-page__load-more">
                <button
                  type="button"
                  onClick={() => setVisibleCount((count) => count + ACTIVITY_PAGE_SIZE)}
                  className="btn btn-secondary btn--bold btn-min-h"
                >
                  Load more
                </button>
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}

export default ActivityPage;
