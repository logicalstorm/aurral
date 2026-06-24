import { ListMusic, Sparkles, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { getFlowEmptyCopy } from "./flowTrackComponents";

export function FlowEmptyState({
  canCreate = true,
  libraryFilter = "all",
  variant = "full",
  onImport,
  onNewPlaylist,
  onNewFlow,
  creatingPlaylist = false,
  creatingFlow = false,
}) {
  const copy = getFlowEmptyCopy(libraryFilter, canCreate);
  const isCompact = variant === "compact";

  return (
    <div
      className={`flow-page__collection-empty${isCompact ? " flow-page__collection-empty--compact" : ""}`}
    >
      <div className="flow-page__collection-empty__icon" aria-hidden="true">
        <ListMusic className="artist-icon-lg" />
      </div>
      <h2 className="flow-page__collection-empty__title">{copy.title}</h2>
      <p className="flow-page__collection-empty__message">{copy.message}</p>
      {!isCompact ? (
        <div className="flow-page__collection-empty__actions">
          {copy.showPlaylistAction ? (
            <button
              type="button"
              onClick={onNewPlaylist}
              disabled={creatingPlaylist}
              className="btn btn-primary btn--bold btn-min-h"
            >
              <ListMusic className="artist-icon-sm" />
              {creatingPlaylist ? "Creating..." : "New Playlist"}
            </button>
          ) : null}
          {copy.showFlowAction ? (
            <button
              type="button"
              onClick={onNewFlow}
              disabled={creatingFlow}
              className="btn btn-secondary btn--bold btn-min-h"
            >
              <Sparkles className="artist-icon-sm" />
              {creatingFlow ? "Creating..." : "New Flow"}
            </button>
          ) : null}
          {copy.showImportAction ? (
            <button
              type="button"
              onClick={onImport}
              className="btn btn-secondary btn--bold btn-min-h"
            >
              <Upload className="artist-icon-sm" />
              Import
            </button>
          ) : null}
          {copy.showSettingsAction ? (
            <Link
              to="/settings"
              className="btn btn-primary btn--bold btn-min-h"
            >
              Open Settings
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
