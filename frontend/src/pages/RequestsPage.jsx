import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader,
  Clock,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Music,
  ArrowLeft,
} from "lucide-react";
import { getRequests, deleteRequest, getAllDownloadStatus } from "../utils/api";
import ArtistImage from "../components/ArtistImage";
import { useToast } from "../contexts/ToastContext";

function RequestsPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloadStatuses, setDownloadStatuses] = useState({});
  const navigate = useNavigate();
  const { showError } = useToast();

  const fetchRequests = async () => {
    setLoading(true);

    try {
      const data = await getRequests();
      setRequests(data);
      setError(null);
    } catch {
      setError("Failed to load requests history.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();

    const pollDownloadStatus = async () => {
      try {
        const statuses = await getAllDownloadStatus();
        setDownloadStatuses(statuses);
      } catch {}
    };

    pollDownloadStatus();
    const interval = setInterval(pollDownloadStatus, 15000);

    return () => clearInterval(interval);
  }, []);

  const handleDelete = async (mbid, name) => {
    if (
      !window.confirm(
        `Are you sure you want to remove the request for "${name}" from your history?`,
      )
    )
      return;
    try {
      await deleteRequest(mbid);
      setRequests((prev) => prev.filter((r) => r.mbid !== mbid));
    } catch {
      showError("Failed to delete request");
    }
  };

  const removeRequestById = (idOrAlbumId, isAlbum) => {
    if (isAlbum && idOrAlbumId != null) {
      setRequests((prev) =>
        prev.filter((r) => String(r.albumId) !== String(idOrAlbumId)),
      );
    } else if (idOrAlbumId) {
      setRequests((prev) => prev.filter((r) => r.mbid !== idOrAlbumId));
    }
  };

  const getStatusBadge = (request) => {
    const artistDownloadStatuses = Object.values(downloadStatuses).filter(
      (status) => {
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
        <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase bg-green-500/20 text-green-400 rounded">
          <CheckCircle2 className="w-3 h-3" />
          Available
        </span>
      );
    }

    if (request.status === "processing" || hasActiveDownloads) {
      return (
        <span
          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase rounded"
          style={{ backgroundColor: "#211f27", color: "#c1c1c3" }}
        >
          <Loader className="w-3 h-3 animate-spin" />
          {hasActiveDownloads ? "Downloading..." : "Processing"}
        </span>
      );
    }

    return (
      <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase bg-yellow-500/20 text-yellow-400 rounded">
        Requested
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader
          className="w-12 h-12 animate-spin mb-4"
          style={{ color: "#c1c1c3" }}
        />
        <h2 className="text-xl font-semibold" style={{ color: "#fff" }}>
          Loading your requests...
        </h2>
      </div>
    );
  }

  return (
    <div className="animate-fade-in pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-gray-900/50 transition-colors"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div>
            <h1
              className="text-2xl font-bold flex items-center"
              style={{ color: "#fff" }}
            >
              Requests
            </h1>
            <p className="text-sm" style={{ color: "#c1c1c3" }}>
              Track your album requests and their availability
            </p>
          </div>
        </div>
        {requests.length > 0 && (
          <button
            onClick={async () => {
              if (
                !window.confirm(
                  `Are you sure you want to remove all ${requests.length} requests from history?`,
                )
              )
                return;
              setRequests([]);
              try {
                await Promise.all(
                  requests.map((request) => {
                    if (request.type === "album" && request.albumId) {
                      return deleteRequest(request.albumId).catch(() => null);
                    }
                    return deleteRequest(request.mbid).catch(() => null);
                  }),
                );
                await fetchRequests();
              } catch {
                showError("Failed to clear some requests");
                fetchRequests();
              }
            }}
            className="btn btn-secondary flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Clear All
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-500/20 ">
          <AlertCircle className="w-5 h-5 text-red-400" />
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {requests.length === 0 ? (
        <div className="card text-center py-20">
          <Music
            className="w-16 h-16 mx-auto mb-4"
            style={{ color: "#c1c1c3" }}
          />
          <h3 className="text-xl font-semibold mb-2" style={{ color: "#fff" }}>
            No Requests Found
          </h3>
          <p className="mb-6" style={{ color: "#c1c1c3" }}>
            You haven&apos;t requested any albums yet.
          </p>
          <button onClick={() => navigate("/")} className="btn btn-primary">
            Start Discovering
          </button>
        </div>
      ) : (
        <div className="grid gap-2">
          {requests.map((request) => {
            const isAlbum = request.type === "album";
            const displayName = isAlbum ? request.albumName : request.name;
            const artistName = isAlbum ? request.artistName : null;
            const artistMbid = isAlbum ? request.artistMbid : request.mbid;
            const hasValidMbid =
              artistMbid && artistMbid !== "null" && artistMbid !== "undefined";

            return (
              <div
                key={request.id || request.mbid}
                className="card group hover:shadow-md transition-all relative p-3"
              >
                <button
                  onClick={async () => {
                    if (isAlbum && request.albumId) {
                      removeRequestById(request.albumId, true);
                      try {
                        await deleteRequest(request.albumId);
                        await fetchRequests();
                      } catch {
                        showError("Failed to delete request");
                        fetchRequests();
                      }
                    } else {
                      handleDelete(request.mbid, displayName);
                    }
                  }}
                  className="absolute top-1.5 right-1.5 p-1.5 hover:text-red-400 hover:bg-red-500/20 transition-all z-10 rounded"
                  style={{ color: "#fff" }}
                  title={
                    isAlbum && request.albumId
                      ? "Remove from queue/history"
                      : "Remove from history"
                  }
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                <div className="flex items-center gap-3">
                  <div
                    className={`w-16 h-16 flex-shrink-0 overflow-hidden rounded ${hasValidMbid ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
                    style={{ backgroundColor: "#211f27" }}
                    onClick={() => {
                      if (hasValidMbid) {
                        navigate(
                          isAlbum
                            ? `/artist/${artistMbid}`
                            : `/artist/${request.mbid}`,
                          {
                            state: {
                              artistName: isAlbum ? artistName : displayName,
                            },
                          },
                        );
                      }
                    }}
                  >
                    <ArtistImage
                      src={request.image}
                      mbid={artistMbid}
                      artistName={isAlbum ? artistName : displayName}
                      alt={displayName}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  </div>

                  <div className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 min-w-0">
                      <h3
                        className={`text-base font-semibold truncate ${hasValidMbid ? "hover:underline cursor-pointer" : "cursor-not-allowed opacity-75"}`}
                        style={{ color: "#fff" }}
                        onClick={() => {
                          if (hasValidMbid) {
                            navigate(
                              isAlbum
                                ? `/artist/${artistMbid}`
                                : `/artist/${request.mbid}`,
                              {
                                state: {
                                  artistName: isAlbum
                                    ? artistName
                                    : displayName,
                                },
                              },
                            );
                          }
                        }}
                      >
                        {displayName}
                      </h3>
                      {getStatusBadge(request)}
                    </div>

                    <div
                      className="text-xs flex items-center gap-3 min-w-0"
                      style={{ color: "#c1c1c3" }}
                    >
                      {isAlbum && artistName && (
                        <span className="flex items-center gap-1 truncate">
                          <Music className="w-3 h-3" />
                          {artistName}
                        </span>
                      )}
                      <span className="flex items-center gap-1 truncate">
                        <Clock className="w-3 h-3" />
                        {new Date(request.requestedAt).toLocaleDateString(
                          undefined,
                          {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          },
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-8 p-4" style={{ backgroundColor: "#211f27" }}>
        <h4
          className="font-bold mb-2 text-sm flex items-center"
          style={{ color: "#fff" }}
        >
          Request Status Guide
        </h4>
        <div className="grid sm:grid-cols-3 gap-3 text-xs">
          <div className="flex gap-2" style={{ color: "#c1c1c3" }}>
            <div className="w-2 h-2 bg-yellow-500 mt-1.5 shrink-0"></div>
            <p>
              <strong>Requested:</strong> Album is in queue or has been
              requested but not yet imported.
            </p>
          </div>
          <div className="flex gap-2" style={{ color: "#c1c1c3" }}>
            <div className="w-2 h-2 bg-gray-600 mt-1.5 shrink-0"></div>
            <p>
              <strong>Processing:</strong> Album is downloading, importing, or
              import failed. Check Lidarr for details.
            </p>
          </div>
          <div className="flex gap-2" style={{ color: "#c1c1c3" }}>
            <div className="w-2 h-2 bg-green-500 mt-1.5 shrink-0"></div>
            <p>
              <strong>Available:</strong> Album has been successfully imported
              and is available on disk.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RequestsPage;
