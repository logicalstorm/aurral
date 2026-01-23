import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader,
  Clock,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Music,
  ExternalLink,
  ArrowLeft,
  RefreshCw,
} from "lucide-react";
import { getRequests, deleteRequest, getAllDownloadStatus } from "../utils/api";
import ArtistImage from "../components/ArtistImage";
import { useToast } from "../contexts/ToastContext";

function RequestsPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadStatuses, setDownloadStatuses] = useState({});
  const navigate = useNavigate();
  const { showError } = useToast();

  const fetchRequests = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const data = await getRequests();
      setRequests(data);
      setError(null);
    } catch (err) {
      setError("Failed to load requests history.");
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchRequests();

    // Poll download status every 5 seconds
    const pollDownloadStatus = async () => {
      try {
        const statuses = await getAllDownloadStatus();
        setDownloadStatuses(statuses);
      } catch (error) {
        console.error("Failed to fetch download status:", error);
      }
    };

    pollDownloadStatus();
    const interval = setInterval(pollDownloadStatus, 5000);

    return () => clearInterval(interval);
  }, []);

  const handleDelete = async (mbid, name) => {
    if (
      window.confirm(
        `Are you sure you want to remove the request for "${name}" from your history?`,
      )
    ) {
      try {
        await deleteRequest(mbid);
        setRequests((prev) => prev.filter((r) => r.mbid !== mbid));
      } catch (err) {
        showError("Failed to delete request");
      }
    }
  };

  const getStatusBadge = (request) => {
    // Check if there are any active downloads for this artist's albums
    const artistDownloadStatuses = Object.values(downloadStatuses).filter(
      (status) => {
        // We'd need to match by artistId, but downloadStatuses are keyed by albumId
        // For now, just show request status
        return (
          status &&
          (status.status === "adding" ||
            status.status === "searching" ||
            status.status === "downloading" ||
            status.status === "moving")
        );
      },
    );

    const hasActiveDownloads = artistDownloadStatuses.length > 0;

    if (request.status === "available") {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold uppercase bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Available
        </span>
      );
    }

    if (request.status === "processing" || hasActiveDownloads) {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold uppercase bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
          <Loader className="w-3.5 h-3.5 animate-spin" />
          {hasActiveDownloads ? "Downloading..." : "Processing"}
        </span>
      );
    }

    return (
      <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold uppercase bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
        <Clock className="w-3.5 h-3.5" />
        Requested
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader className="w-12 h-12 text-primary-500 animate-spin mb-4" />
        <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300">
          Loading your requests...
        </h2>
      </div>
    );
  }

  return (
    <div className="animate-fade-in pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              Requests
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Track your album requests and their availability
            </p>
          </div>
        </div>

        <button
          onClick={() => fetchRequests(true)}
          disabled={refreshing}
          className="btn btn-secondary flex items-center gap-2 self-start md:self-auto"
        >
          <RefreshCw
            className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
          />
          Refresh Status
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-500/20 p-4 flex items-center gap-3 mb-8">
          <AlertCircle className="w-5 h-5 text-red-500" />
          <p className="text-red-800 dark:text-red-400">{error}</p>
        </div>
      )}

      {requests.length === 0 ? (
        <div className="card text-center py-20">
          <Music className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
            No Requests Found
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            You haven't requested any albums yet.
          </p>
          <button onClick={() => navigate("/")} className="btn btn-primary">
            Start Discovering
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {requests.map((request) => {
            const isAlbum = request.type === "album";
            const displayName = isAlbum ? request.albumName : request.name;
            const artistName = isAlbum ? request.artistName : null;
            const mbid = isAlbum
              ? request.albumMbid || request.mbid
              : request.mbid;
            const artistMbid = isAlbum ? request.artistMbid : request.mbid;

            return (
              <div
                key={request.id || request.mbid}
                className="card group hover:shadow-md transition-all border border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row items-center gap-4 sm:gap-6 min-w-0"
              >
                <div
                  className="w-24 h-24 flex-shrink-0 bg-gray-200 dark:bg-gray-800 overflow-hidden cursor-pointer"
                  onClick={() =>
                    navigate(
                      isAlbum
                        ? `/artist/${artistMbid}`
                        : `/artist/${request.mbid}`,
                    )
                  }
                >
                  <ArtistImage
                    src={request.image}
                    mbid={artistMbid}
                    alt={displayName}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                </div>

                <div className="flex-1 text-center sm:text-left min-w-0">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mb-1 min-w-0">
                    <h3
                      className="text-xl font-bold text-gray-900 dark:text-gray-100 hover:text-primary-500 cursor-pointer truncate"
                      onClick={() =>
                        navigate(
                          isAlbum
                            ? `/artist/${artistMbid}`
                            : `/artist/${request.mbid}`,
                        )
                      }
                    >
                      {displayName}
                    </h3>
                    <div className="flex justify-center sm:justify-start">
                      {getStatusBadge(request)}
                    </div>
                  </div>

                  <div className="text-sm text-gray-500 dark:text-gray-400 flex flex-col sm:flex-row sm:items-center gap-x-4 gap-y-1 min-w-0">
                    {isAlbum && artistName && (
                      <span className="flex items-center justify-center sm:justify-start gap-1 truncate">
                        <Music className="w-3.5 h-3.5" />
                        {artistName}
                      </span>
                    )}
                    <span className="flex items-center justify-center sm:justify-start gap-1 truncate">
                      <Clock className="w-3.5 h-3.5" />
                      Requested on{" "}
                      {new Date(request.requestedAt).toLocaleDateString(
                        undefined,
                        {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        },
                      )}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-2 sm:mt-0">
                  <button
                    onClick={() =>
                      navigate(
                        isAlbum
                          ? `/artist/${artistMbid}`
                          : `/artist/${request.mbid}`,
                      )
                    }
                    className="p-2.5 text-gray-500 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-all"
                    title={isAlbum ? "View Artist" : "View Artist"}
                  >
                    <ExternalLink className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => {
                      if (isAlbum && request.albumId) {
                        deleteRequest(request.albumId)
                          .then(() => {
                            fetchRequests(true);
                          })
                          .catch((err) => {
                            showError("Failed to delete request");
                          });
                      } else {
                        handleDelete(request.mbid, displayName);
                      }
                    }}
                    className="p-2.5 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                    title="Remove from history"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-12 p-6 bg-primary-50 dark:bg-primary-900/10 border border-primary-100 dark:border-primary-500/10">
        <h4 className="font-bold text-primary-900 dark:text-primary-400 mb-2">
          Request Status Guide
        </h4>
        <div className="grid sm:grid-cols-3 gap-4 text-sm">
          <div className="flex gap-2 text-gray-600 dark:text-gray-400">
            <div className="w-2 h-2 bg-yellow-500 mt-1.5 shrink-0"></div>
            <p>
              <strong>Requested:</strong> Artist has been added to library and
              is awaiting monitoring/search.
            </p>
          </div>
          <div className="flex gap-2 text-gray-600 dark:text-gray-400">
            <div className="w-2 h-2 bg-blue-500 mt-1.5 shrink-0"></div>
            <p>
              <strong>Processing:</strong> Artist is in library but content is
              still being downloaded.
            </p>
          </div>
          <div className="flex gap-2 text-gray-600 dark:text-gray-400">
            <div className="w-2 h-2 bg-green-500 mt-1.5 shrink-0"></div>
            <p>
              <strong>Available:</strong> Content is available on disk and ready
              to play.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RequestsPage;
