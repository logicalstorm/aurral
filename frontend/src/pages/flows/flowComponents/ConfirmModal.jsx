export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel,
  busyLabel,
  busy = false,
  onCancel,
  onConfirm,
}) {
  if (!open) return null;

  return (
    <div className="artist-modal-backdrop" onClick={onCancel}>
      <div className="artist-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="artist-modal__title">{title}</h3>
        <p className="artist-modal__subcopy">{body}</p>
        <div className="artist-modal__actions">
          <button onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="btn btn-secondary flow-page__btn--destructive"
            disabled={busy}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
