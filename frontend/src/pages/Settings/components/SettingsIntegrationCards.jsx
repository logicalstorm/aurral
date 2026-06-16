import { Pencil, X } from "lucide-react";

export function IntegrationCard({ title, subtitle, status, meta, onClick }) {
  return (
    <button
      type="button"
      className="settings-page__integration-card"
      onClick={onClick}
    >
      <span className="settings-page__integration-card-main">
        <span className="settings-page__integration-card-title">{title}</span>
        <span className="settings-page__integration-card-subtitle">{subtitle}</span>
        {meta && (
          <span className="settings-page__integration-card-meta">{meta}</span>
        )}
      </span>
      <span className="settings-page__integration-card-side">
        <span className={`settings-page__integration-status ${status.className}`}>
          {status.label}
        </span>
        <Pencil className="artist-icon-sm" aria-hidden />
      </span>
    </button>
  );
}

export function SettingsIntegrationModal({
  title,
  children,
  onClose,
  saveReminder = true,
  wide = true,
  footerActions = null,
}) {
  return (
    <div className="artist-modal-backdrop" onClick={onClose}>
      <div
        className={`settings-page__modal settings-page__modal--integration${
          wide ? " settings-page__modal--wide" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="integration-settings-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-page__modal-header">
          <h3
            id="integration-settings-modal-title"
            className="settings-page__modal-title"
          >
            {title}
          </h3>
          <button
            type="button"
            className="btn btn-ghost btn-icon-square"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="artist-icon-md" />
          </button>
        </div>
        {saveReminder && (
          <p className="settings-page__modal-reminder">
            Save this settings section to apply changes.
          </p>
        )}
        <div className="settings-page__modal-body">
          <div className="settings-modal">{children}</div>
        </div>
        <div className="settings-page__modal-actions">
          {footerActions}
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
