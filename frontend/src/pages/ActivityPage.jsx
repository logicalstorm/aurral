import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Loader, Clock, CheckCircle2, AlertCircle, Music, RotateCcw, XCircle, Play, Pause } from "lucide-react";
import { getRequests, triggerAlbumSearch } from "../utils/api";
import { approveBlockedJob, denyBlockedJob, getStagingStreamUrl } from "../utils/api/endpoints/playlists";
import { useAudioQueue } from "../hooks/useAudioQueue";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import {
  DEFAULT_ACTIVITY_VIEW,
  buildActivityPath,
  matchesActivityView,
  normalizeActivityView,
} from "../navigation/activityNavConfig";

const ACTIVITY_PAGE_SIZE = 25;
const QUEUE_POLL_INTERVAL_MS = 15000;
const HISTORY_POLL_INTERVAL_MS = 60000;

const AURRAL_INTERNAL_KINDS = new Set([
  "discovery_refresh",
  "flow_generated",
  "flow_generating",
  "playlist_tracks_added",
  "track_reused_aurral",
]);

const isAurralInternalRow = (request) =>
  request?.source === "aurral" && AURRAL_INTERNAL_KINDS.has(request?.kind);

const QUEUE_EMPTY_STATE = {
  title: "Queue is empty",
  message: "Active album requests and downloads will appear here.",
};

const HISTORY_EMPTY_STATE = {
  title: "No activity yet",
  message: "A chronological log of album requests, track downloads, and other activity will appear here.",
};

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
  const { view: viewParam } = useParams();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [visibleCount, setVisibleCount] = useState(ACTIVITY_PAGE_SIZE);
  const [reSearchingAlbumIds, setReSearchingAlbumIds] = useState({});
  const [approvingJobId, setApprovingJobId] = useState(null);
  const [denyingJobId, setDenyingJobId] = useState(null);
  const [jobErrors, setJobErrors] = useState({});
  const fetchRequestsInFlightRef = useRef(false);

  const { playTrack, currentTrack, isPlaying, togglePlayPause } = useAudioQueue();

  const activeView = normalizeActivityView(viewParam);
  const isQueueView = activeView === "queue";
  const shouldRedirectView = viewParam && normalizeActivityView(viewParam) !== viewParam;

  useDocumentTitle(
    activeView === "queue" ? "Queue - Activity" : "Activity",
  );

  const filteredRequests = useMemo(
    () =>
      requests.filter(
        (request) =>
          matchesActivityView(request, activeView) && !isAurralInternalRow(request),
      ),
    [requests, activeView],
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
  }, [activeView]);

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
      if (!silent) {
        setError("Failed to load activity.");
      }
    } finally {
      fetchRequestsInFlightRef.current = false;
      if (!silent) {
        setLoading(false);
      }
    }
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

  const handleApproveBlockedJob = async (jobId) => {
    if (!jobId || approvingJobId === jobId) return;
    setApprovingJobId(jobId);
    try {
      await approveBlockedJob(jobId);
      setRequests((prev) =>
        prev.map((r) =>
          r.jobId === jobId
            ? { ...r, status: "completed", statusLabel: "Downloaded", title: `Downloaded ${r.title?.replace(/^Review needed for /, "") || "track"}` }
            : r,
        ),
      );
      setApprovingJobId(null);
      setJobErrors((prev) => {
        const { [jobId]: _, ...rest } = prev;
        return rest;
      });
    } catch {
      setJobErrors((prev) => ({ ...prev, [jobId]: "Failed to approve" }));
      setApprovingJobId(null);
    }
  };

  const handleDenyBlockedJob = async (jobId) => {
    if (!jobId || denyingJobId === jobId) return;
    setDenyingJobId(jobId);
    try {
      await denyBlockedJob(jobId);
      setRequests((prev) =>
        prev.map((r) =>
          r.jobId === jobId
            ? { ...r, status: "failed", statusLabel: "Denied", title: `Denied ${r.title?.replace(/^Review needed for /, "") || "track"}` }
            : r,
        ),
      );
      setDenyingJobId(null);
      setJobErrors((prev) => {
        const { [jobId]: _, ...rest } = prev;
        return rest;
      });
    } catch {
      setJobErrors((prev) => ({ ...prev, [jobId]: "Failed to deny" }));
      setDenyingJobId(null);
    }
  };

  const handleReviewPreview = (jobId, trackName, artistName) => {
    const trackId = String(jobId);
    if (currentTrack?.id === trackId) {
      togglePlayPause();
      return;
    }
    playTrack({
      id: trackId,
      src: getStagingStreamUrl(jobId),
      title: trackName || "Track",
      artist: artistName || "Artist",
    });
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
    const timelineTime = formatTimelineTime(request.requestedAt);
    const canReSearch =
      request.canReSearch === true && request.albumId && !reSearchingAlbumIds[request.albumId];
    const isReSearching = Boolean(request.albumId && reSearchingAlbumIds[request.albumId]);
    const isBlockedTrack =
      request.kind === "track_download" && request.status === "blocked" && !!request.jobId;
    const isApproving = approvingJobId === request.jobId;
    const isDenying = denyingJobId === request.jobId;
    const isThisPlaying = currentTrack?.id === request.jobId && isPlaying;
    const trackName = request.title?.replace(/^Review needed for /, "") || "track";
    const jobError = jobErrors[request.jobId];
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
        className={`requests-page__row${rowIndex % 2 === 1 ? " requests-page__row--alt" : ""}${canNavigate ? " is-clickable" : ""}`}
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
          <div className="requests-page__actions">
            {isBlockedTrack && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn--icon requests-page__action"
                  aria-label={isThisPlaying ? "Pause preview" : "Play preview"}
                  title={isThisPlaying ? "Pause" : "Preview"}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleReviewPreview(request.jobId, trackName, artistName);
                  }}
                >
                  {isThisPlaying ? (
                    <Pause className="artist-icon-xs" />
                  ) : (
                    <Play className="artist-icon-xs" />
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn--icon requests-page__action"
                  aria-label="Approve track"
                  title="Approve"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleApproveBlockedJob(request.jobId);
                  }}
                  disabled={isApproving || isDenying}
                >
                  {isApproving ? (
                    <Loader className="artist-icon-xs animate-spin" />
                  ) : (
                    <CheckCircle2 className="artist-icon-xs" />
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn--icon requests-page__action"
                  aria-label="Deny track"
                  title="Deny"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleDenyBlockedJob(request.jobId);
                  }}
                  disabled={isApproving || isDenying}
                >
                  {isDenying ? (
                    <Loader className="artist-icon-xs animate-spin" />
                  ) : (
                    <XCircle className="artist-icon-xs" />
                  )}
                </button>
              </>
            )}
            {jobError && (
              <span className="requests-page__inline-error">{jobError}</span>
            )}
            {canReSearch && (
              <button
                type="button"
                className="btn btn-secondary btn--icon requests-page__action"
                aria-label={`Re-search ${request.albumName || displayName}`}
                title="Re-search"
                onClick={() => handleReSearchAlbum(request)}
              >
                <RotateCcw className="artist-icon-xs" />
              </button>
            )}
          </div>
        </div>
      </article>
    );
  };

  if (!viewParam) {
    return (
      <Navigate
        to={buildActivityPath(DEFAULT_ACTIVITY_VIEW)}
        replace
      />
    );
  }

  if (shouldRedirectView) {
    return <Navigate to={buildActivityPath(activeView)} replace />;
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
          <h2 className="search-empty-panel__title">
            {isQueueView ? QUEUE_EMPTY_STATE.title : HISTORY_EMPTY_STATE.title}
          </h2>
          <p className="search-empty-panel__message">
            {isQueueView ? QUEUE_EMPTY_STATE.message : HISTORY_EMPTY_STATE.message}
          </p>
          {isQueueView && (
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
