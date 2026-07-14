import { useId } from "react";
import { AlertTriangle } from "lucide-react";
import { useModalDialog } from "../../../hooks/useModalDialog.js";

export function UnsavedModal({ show, onCancel, onConfirm }) {
  const titleId = useId();
  const { dialogRef, handleBackdropClick } = useModalDialog({
    open: show,
    onClose: onCancel,
  });

  if (!show) return null;
  return (
    <div className="artist-modal-backdrop" onClick={handleBackdropClick}>
      <div
        ref={dialogRef}
        className="settings-page__modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="settings-page__modal-alert">
          <AlertTriangle className="settings-page__modal-alert-icon" />
          <div>
            <h3 id={titleId} className="settings-page__modal-title">
              Unsaved Changes
            </h3>
            <p className="settings-page__modal-copy">
              You have unsaved changes. Are you sure you want to leave? Your changes will be lost.
            </p>
          </div>
        </div>
        <div className="settings-page__modal-actions">
          <button type="button" onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="btn btn-danger">
            Leave Without Saving
          </button>
        </div>
      </div>
    </div>
  );
}
