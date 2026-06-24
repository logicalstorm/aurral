export function ConfirmStopAllModal({
  confirmStopAll,
  bulkActionRunning,
  onCancel,
  onConfirm,
}) {
  if (!confirmStopAll) return null;

  return (
    <div className="artist-modal-backdrop" onClick={onCancel}>
      <div className="artist-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="artist-modal__title">
          Stop all playlists?
        </h3>
        <p className="artist-modal__subcopy">
          This pauses future runs. You can start them again anytime.
        </p>
        <div className="artist-modal__actions">
          <button onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="btn btn-secondary flow-page__btn--destructive"
            disabled={bulkActionRunning}
          >
            {bulkActionRunning ? "Stopping..." : "Stop All"}
          </button>
        </div>
      </div>
    </div>
  );
}
