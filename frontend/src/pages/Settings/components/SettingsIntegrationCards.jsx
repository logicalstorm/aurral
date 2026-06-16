import { Pencil, X } from "lucide-react";

export function IntegrationCard({ title, subtitle, status, meta, onClick }) {
  return (
    <button
      type="button"
      className="settings-page__download-card"
      onClick={onClick}
    >
      <span className="settings-page__download-card-main">
        <span className="settings-page__download-card-title">{title}</span>
        <span className="settings-page__download-card-subtitle">{subtitle}</span>
        {meta && <span className="settings-page__download-card-meta">{meta}</span>}
      </span>
      <span className="settings-page__download-card-side">
        <span className={`settings-page__download-status ${status.className}`}>
          {status.label}
        </span>
        <Pencil className="artist-icon-sm" aria-hidden />
      </span>
    </button>
  );
}

export function SettingsIntegrationModal({ title, children, onClose }) {
  return (
    <div className="artist-modal-backdrop" onClick={onClose}>
      <div
        className="settings-page__modal settings-page__modal--wide"
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
        <div className="settings-page__fields">{children}</div>
        <div className="settings-page__modal-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
