import { Pencil, X } from "lucide-react";

function statusTone(className) {
  if (className === "is-enabled") return "ok";
  if (className === "is-warning") return "warn";
  if (className === "is-disabled") return "muted";
  return "muted";
}

export function IntegrationCard({ title, subtitle, status, meta, onClick }) {
  return (
    <button type="button" className="arr-card" onClick={onClick}>
      <span className="arr-card__main">
        <span className="arr-card__title">{title}</span>
        {subtitle ? <span className="arr-card__subtitle">{subtitle}</span> : null}
        {meta ? <span className="arr-card__meta">{meta}</span> : null}
      </span>
      <span className="arr-card__side">
        <span className={`arr-card__status arr-card__status--${statusTone(status.className)}`}>
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
        className={`settings-arr__modal settings-page__modal settings-page__modal--integration${
          wide ? " settings-page__modal--wide" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="integration-settings-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-page__modal-header">
          <h3 id="integration-settings-modal-title" className="settings-page__modal-title">
            {title}
          </h3>
          <button
            type="button"
            className="arr-btn arr-btn--ghost arr-btn--icon"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="artist-icon-md" />
          </button>
        </div>
        {saveReminder ? (
          <p className="settings-page__modal-reminder">
            Save this settings section to apply changes.
          </p>
        ) : null}
        <div className="settings-page__modal-body">
          <div className="settings-modal">{children}</div>
        </div>
        <div className="settings-page__modal-actions">
          {footerActions}
          <button type="button" className="arr-btn arr-btn--primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
