import { FilePlus2 } from "lucide-react";

export function FlowPageHeader({ onNewFlow }) {
  return (
    <div className="flow-page__page-header">
      <div className="flow-page__page-header-row">
        <h1 className="flow-page__page-title">Playlists</h1>
      </div>
      <div className="flow-page__header-actions">
        <button
          onClick={onNewFlow}
          className="btn btn-primary btn-sm"
        >
          <FilePlus2 className="artist-icon-sm" />
          New Flow
        </button>
      </div>
    </div>
  );
}
