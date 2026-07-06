import {
  Loader,
  Clock,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  XCircle,
  Play,
  Pause,
  Eye,
} from "lucide-react";
import { formatTimelineTime } from "./activityListUtils";

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

  if (request.status === "blocked") {
    return (
      <span className="requests-page__badge requests-page__badge--review">
        <Eye className="artist-icon-xs" />
        {request.statusLabel || "Review"}
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

export default function ActivityRequestRow({
  request,
  rowIndex = 0,
  reSearchingAlbumIds,
  approvingJobId,
  denyingJobId,
  jobErrors,
  currentTrack,
  isPlaying,
  onNavigate,
  onReSearch,
  onApprove,
  onDeny,
  onPreview,
}) {
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
  const rowArtistName = request.artistName || null;
  const metaLine = usesTitleSubtitle ? request.subtitle || null : rowArtistName;
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
  const isThisPlaying = currentTrack?.id === String(request.jobId) && isPlaying;
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
      className={`requests-page__row${rowIndex % 2 === 1 ? " requests-page__row--alt" : ""}${canNavigate ? " is-clickable" : ""}`}
      onClick={() => {
        if (!canNavigate) return;
        onNavigate(request, {
          isSlskd,
          isUsenet,
          isAurral,
          isAlbum,
          artistMbid,
          artistName: rowArtistName,
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
                  onPreview(request.jobId, trackName, rowArtistName);
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
                  onApprove(request.jobId);
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
                  onDeny(request.jobId);
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
          {jobError && <span className="requests-page__inline-error">{jobError}</span>}
          {canReSearch && (
            <button
              type="button"
              className="btn btn-secondary btn--icon requests-page__action"
              aria-label={`Re-search ${request.albumName || displayName}`}
              title="Re-search"
              onClick={() => onReSearch(request)}
            >
              <RotateCcw className="artist-icon-xs" />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
