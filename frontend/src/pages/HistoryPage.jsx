import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader,
  Clock,
  CheckCircle2,
  AlertCircle,
  X,
  Music,
  RefreshCw,
} from "lucide-react";
import {
  getRequests,
  deleteRequest,
  getDownloadStatus,
  triggerAlbumSearch,
} from "../utils/api";
import { useToast } from "../contexts/ToastContext";
import { useWebSocketChannel } from "../hooks/useWebSocket";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

const HISTORY_TABS = [
  { value: "all", label: "All" },
  { value: "lidarr", label: "Lidarr" },
  { value: "slskd", label: "slskd" },
  { value: "aurral", label: "Aurral" },
];

const getHistorySource = (request) => {
  if (request.source === "slskd") return "slskd";
  if (request.source === "aurral") return "aurral";
  if (request.source === "lidarr") return "lidarr";
  if (request.type === "album" || request.albumId) return "lidarr";
  return "aurral";
};

const matchesHistoryTab = (request, tab) => {
  if (tab === "all") return true;
  return getHistorySource(request) === tab;
};

const EMPTY_STATE_COPY = {
  all: {
    title: "No History Yet",
    message: "Downloads, requests, and app activity will show up here.",
  },
  lidarr: {
    title: "No Lidarr Activity",
    message: "Album requests and downloads from Lidarr will appear here.",
  },
  slskd: {
    title: "No slskd Downloads",
    message: "Playlist track downloads from slskd will appear here.",
  },
  aurral: {
    title: "No Aurral Activity",
    message:
      "Discovery refreshes, album requests, track searches, playlist changes, and other background work will appear here.",
  },
};

function RequestStatusBadge({ request, downloadStatuses }) {
  if (request.source === "slskd") {
    if (request.status === "completed") {
      return (
        <span className="requests-page__badge requests-page__badge--success">
          <CheckCircle2 className="artist-icon-xs" />
          Completed
        </span>
      );
    }
    if (request.status === "failed") {
      return (
        <span className="requests-page__badge requests-page__badge--failed">
          <AlertCircle className="artist-icon-xs" />
          Failed
        </span>
      );
    }
    if (request.status === "downloading") {
      return (
        <span className="requests-page__badge requests-page__badge--active">
          <Loader className="artist-icon-xs animate-spin" />
          Downloading
        </span>
      );
    }
    return (
      <span className="requests-page__badge requests-page__badge--pending">
        <Clock className="artist-icon-xs" />
        Pending
      </span>
    );
  }

  if (request.source === "aurral") {
    if (request.status === "completed") {
      return (
        <span className="requests-page__badge requests-page__badge--success">
          <CheckCircle2 className="artist-icon-xs" />
          {request.statusLabel || "Completed"}
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
          {request.statusLabel || "Working"}
        </span>
      );
    }
    return (
      <span className="requests-page__badge requests-page__badge--pending">
        <Clock className="artist-icon-xs" />
        {request.statusLabel || "Updated"}
      </span>
    );
  }

  const albumStatus = request.albumId
    ? downloadStatuses[String(request.albumId)]
    : null;
  const artistDownloadStatuses = Object.values(downloadStatuses).filter(
    (status) =>
      status &&
      (status.status === "adding" ||
        status.status === "searching" ||
        status.status === "downloading" ||
        status.status === "moving"),
  );
  const hasActiveDownloads = artistDownloadStatuses.length > 0;

  if (albumStatus?.status === "adding") {
    return (
      <span className="requests-page__badge requests-page__badge--active">
        <Loader className="artist-icon-xs animate-spin" />
        Adding...
      </span>
    );
  }

  if (albumStatus?.status === "downloading") {
    return (
      <span className="requests-page__badge requests-page__badge--active">
        <Loader className="artist-icon-xs animate-spin" />
        Downloading...
      </span>
    );
  }

  if (albumStatus?.status === "searching") {
    return (
      <span className="requests-page__badge requests-page__badge--active">
        <Loader className="artist-icon-xs animate-spin" />
        Searching...
      </span>
    );
  }

  if (albumStatus?.status === "moving") {
    return (
      <span className="requests-page__badge requests-page__badge--active">
        <Loader className="artist-icon-xs animate-spin" />
        Moving files...
      </span>
    );
  }

  if (albumStatus?.status === "processing") {
    return (
      <span className="requests-page__badge requests-page__badge--active">
        <Loader className="artist-icon-xs animate-spin" />
        Processing
      </span>
    );
  }

  if (albumStatus?.status === "added") {
    return (
      <span className="requests-page__badge requests-page__badge--success">
        <CheckCircle2 className="artist-icon-xs" />
        Completed
      </span>
    );
  }

  if (request.status === "available") {
    return (
      <span className="requests-page__badge requests-page__badge--success">
        <CheckCircle2 className="artist-icon-xs" />
        Available
      </span>
    );
  }

  if (albumStatus?.status === "failed" || request.status === "failed") {
    return (
      <span className="requests-page__badge requests-page__badge--failed">
        <AlertCircle className="artist-icon-xs" />
        Failed
      </span>
    );
  }

  if (request.status === "processing" || hasActiveDownloads) {
    return (
      <span className="requests-page__badge requests-page__badge--active">
        <Loader className="artist-icon-xs animate-spin" />
        {hasActiveDownloads ? "Downloading..." : "Processing"}
      </span>
    );
  }

  return (
    <span className="requests-page__badge requests-page__badge--pending">
      Requested
    </span>
  );
}

function HistoryPage() {
  useDocumentTitle("History");
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("all");
  const [downloadStatuses, setDownloadStatuses] = useState({});
  const [reSearchingAlbumIds, setReSearchingAlbumIds] = useState({});
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();
  const activeAlbumIdsRef = useRef([]);
  const lastDownloadWsAtRef = useRef(0);
  const handleDownloadStatusMessage = useCallback((msg) => {
    if (msg?.type !== "download_statuses") return;
    lastDownloadWsAtRef.current = Date.now();
    const activeIds = activeAlbumIdsRef.current;
    if (!activeIds.length) return;
    const incoming = msg.statuses || {};
    const next = {};
    for (const id of activeIds) {
      if (incoming[id]) next[id] = incoming[id];
    }
    setDownloadStatuses((prev) => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length !== nextKeys.length) return next;
      for (const key of nextKeys) {
        const prevStatus = prev[key];
        const nextStatus = next[key];
        if (
          prevStatus?.status !== nextStatus?.status ||
          prevStatus?.progress !== nextStatus?.progress ||
          prevStatus?.updatedAt !== nextStatus?.updatedAt
        ) {
          return next;
        }
      }
      return prev;
    });
  }, []);

  useWebSocketChannel("downloads", handleDownloadStatusMessage);

  const filteredRequests = useMemo(
    () => requests.filter((request) => matchesHistoryTab(request, activeTab)),
    [requests, activeTab],
  );

  const activeAlbumIds = useMemo(() => {
    return requests
      .filter(
        (request) =>
          request.albumId &&
          (request.inQueue ||
            (request.status &&
              request.status !== "available" &&
              request.status !== "failed")),
      )
      .map((request) => String(request.albumId));
  }, [requests]);

  const activeAlbumIdsKey = useMemo(() => {
    if (!activeAlbumIds.length) return "";
    return [...activeAlbumIds].sort().join(",");
  }, [activeAlbumIds]);

  const fetchRequests = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }

    try {
      const data = await getRequests();
      setRequests(data);
      setError(null);
    } catch {
      setError("Failed to load history.");
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  const fetchActiveDownloadStatus = useCallback(async (albumIds) => {
    const hasExplicitAlbumIds = Array.isArray(albumIds);
    const ids = Array.isArray(albumIds)
      ? albumIds
      : activeAlbumIdsRef.current;
    if (!ids.length) {
      setDownloadStatuses({});
      return;
    }
    try {
      const statuses = await getDownloadStatus(ids);
      setDownloadStatuses((prev) => {
        if (hasExplicitAlbumIds) {
          return {
            ...prev,
            ...(statuses || {}),
          };
        }
        return statuses || {};
      });
    } catch {}
  }, []);

  useEffect(() => {
    activeAlbumIdsRef.current = activeAlbumIds;
  }, [activeAlbumIds]);

  useEffect(() => {
    fetchRequests();
    const initialRefreshTimeout = setTimeout(() => {
      fetchRequests({ silent: true });
    }, 2500);

    const handleFocus = () => {
      fetchRequests({ silent: true });
      fetchActiveDownloadStatus();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchRequests({ silent: true });
        fetchActiveDownloadStatus();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearTimeout(initialRefreshTimeout);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchRequests, fetchActiveDownloadStatus]);

  useEffect(() => {
    const albumIds = activeAlbumIdsKey ? activeAlbumIdsKey.split(",") : [];
    if (!albumIds.length) {
      setDownloadStatuses({});
      return;
    }

    let cancelled = false;
    const pollDownloadStatus = async () => {
      if (Date.now() - lastDownloadWsAtRef.current < 20000) {
        return;
      }
      try {
        const statuses = await getDownloadStatus(albumIds);
        if (!cancelled) {
          setDownloadStatuses(statuses || {});
        }
      } catch {}
    };

    pollDownloadStatus();
    const interval = setInterval(pollDownloadStatus, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeAlbumIdsKey]);

  useEffect(() => {
    const hasActive = requests.some(
      (request) =>
        request.inQueue ||
        (request.status && request.status !== "available" && request.status !== "failed"),
    );
    const intervalMs = hasActive ? 15000 : 60000;
    const interval = setInterval(() => {
      fetchRequests({ silent: true });
    }, intervalMs);
    return () => clearInterval(interval);
  }, [requests, fetchRequests]);

  const handleStopDownload = async (request) => {
    if (!request.inQueue || !request.albumId) return;
    try {
      await deleteRequest(request.albumId);
      setRequests((prev) =>
        prev.filter((r) => String(r.albumId) !== String(request.albumId)),
      );
    } catch {
      showError("Failed to stop download");
    }
  };

  const handleReSearchRequest = async (request) => {
    if (!request?.albumId) return;
    const albumId = String(request.albumId);
    setReSearchingAlbumIds((prev) => ({
      ...prev,
      [albumId]: true,
    }));
    try {
      setDownloadStatuses((prev) => ({
        ...prev,
        [albumId]: { status: "searching" },
      }));
      await triggerAlbumSearch(request.albumId);
      showSuccess("Search triggered for album");
      fetchActiveDownloadStatus([albumId]);
    } catch (err) {
      showError(
        `Failed to re-search album: ${
          err.response?.data?.message || err.message
        }`,
      );
    } finally {
      setReSearchingAlbumIds((prev) => {
        const next = { ...prev };
        delete next[albumId];
        return next;
      });
    }
  };

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

  const handleRowNavigate = (request, {
    isSlskd,
    isAurral,
    isAlbum,
    artistMbid,
    artistName,
    displayName,
  }) => {
    if (isSlskd && request.playlistId) {
      navigate(`/playlists?selected=${encodeURIComponent(request.playlistId)}`);
      return;
    }
    if (isAurral && request.href) {
      navigate(request.href);
      return;
    }
    navigateToArtist(request, isAlbum, artistMbid, artistName, displayName);
  };

  const emptyState = EMPTY_STATE_COPY[activeTab] || EMPTY_STATE_COPY.all;

  if (loading) {
    return (
      <div className="requests-page">
        <header className="requests-page__header">
          <h1 className="requests-page__title">History</h1>
          <p className="requests-page__subtitle">
            Downloads, requests, and activity across Lidarr, slskd, and Aurral
          </p>
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
        <h1 className="requests-page__title">History</h1>
        <p className="requests-page__subtitle">
          Downloads, requests, and activity across Lidarr, slskd, and Aurral
        </p>
      </header>

      <div className="artist-tabs requests-page__tabs" role="tablist">
        {HISTORY_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`artist-tab${activeTab === tab.value ? " is-active" : ""}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="artist-error-panel requests-page__error" role="alert">
          <AlertCircle className="artist-error-icon" aria-hidden="true" />
          <h2 className="artist-error-title">Unable to load history</h2>
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
          {activeTab === "all" && (
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
            {filteredRequests.map((request) => {
              const isSlskd = request.source === "slskd";
              const isAurral = request.source === "aurral";
              const isAlbum = request.type === "album";
              const displayName = isSlskd || isAurral
                ? request.title
                : isAlbum
                  ? request.albumName
                  : request.name;
              const artistName = isAlbum ? request.artistName : null;
              const metaLine = isSlskd || isAurral
                ? request.subtitle || null
                : artistName;
              const artistMbid = isAlbum ? request.artistMbid : request.mbid;
              const canNavigate =
                (isSlskd && request.playlistId) ||
                (isAurral && request.href) ||
                (artistMbid &&
                  artistMbid !== "null" &&
                  artistMbid !== "undefined");
              const albumStatus = request.albumId
                ? downloadStatuses[String(request.albumId)]
                : null;
              const statusValue = albumStatus?.status;
              const isFailed =
                statusValue === "failed" ||
                (!statusValue && request.status === "failed");
              const isReSearching =
                request.albumId &&
                !!reSearchingAlbumIds[String(request.albumId)];

              const formattedDate = new Date(request.requestedAt).toLocaleDateString(
                undefined,
                {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                },
              );

              return (
                <article
                  key={request.id || request.mbid}
                  className={`requests-page__row${canNavigate ? " is-clickable" : ""}`}
                  onClick={() => {
                    if (!canNavigate) return;
                    handleRowNavigate(request, {
                      isSlskd,
                      isAurral,
                      isAlbum,
                      artistMbid,
                      artistName,
                      displayName,
                    });
                  }}
                >
                  <div className="requests-page__details">
                    <h3 className="requests-page__item-title">{displayName}</h3>
                    <div className="requests-page__meta">
                      {metaLine && (
                        <span className="requests-page__meta-line">
                          <Music className="artist-icon-xs" />
                          <span className="artist-truncate">{metaLine}</span>
                        </span>
                      )}
                      {metaLine && (
                        <span className="requests-page__meta-separator" aria-hidden="true">
                          ·
                        </span>
                      )}
                      <span className="requests-page__meta-line">
                        <Clock className="artist-icon-xs" />
                        <span>{formattedDate}</span>
                      </span>
                    </div>
                  </div>

                  <div
                    className="requests-page__status"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <RequestStatusBadge
                      request={request}
                      downloadStatuses={downloadStatuses}
                    />
                    {(isFailed || request.inQueue) && request.albumId && (
                      <div className="requests-page__actions">
                        {isFailed && (
                          <button
                            type="button"
                            onClick={() => handleReSearchRequest(request)}
                            className="btn btn-surface btn-icon-square requests-page__action"
                            title="Re-search"
                            aria-label="Re-search"
                            disabled={isReSearching}
                          >
                            {isReSearching ? (
                              <Loader className="artist-icon-xs animate-spin" />
                            ) : (
                              <RefreshCw className="artist-icon-xs" />
                            )}
                          </button>
                        )}
                        {request.inQueue && (
                          <button
                            type="button"
                            onClick={() => handleStopDownload(request)}
                            className="btn btn-surface btn-icon-square requests-page__action btn--danger-text"
                            title="Stop download"
                            aria-label="Stop download"
                          >
                            <X className="artist-icon-xs" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}

export default HistoryPage;
