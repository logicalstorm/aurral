import { ListMusic } from "lucide-react";

export function FlowDetailPlaceholder() {
  return (
    <div className="flow-page__detail-placeholder">
      <div className="flow-page__detail-placeholder__icon" aria-hidden="true">
        <ListMusic className="artist-icon-lg" />
      </div>
      <p className="flow-page__detail-placeholder__message">
        Select a playlist or flow to view tracks and settings.
      </p>
    </div>
  );
}
