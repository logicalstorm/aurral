export function SettingsGeneralTab({ health }) {
  const version = health?.appVersion || "—";

  return (
    <div className="settings-page__panel">
      <div className="settings-page__panel-header">
        <h2 className="settings-page__panel-title">General</h2>
      </div>

      <div className="settings-page__form">
        <div className="settings-page__section">
          <h3 className="settings-page__section-title">About</h3>
          <dl className="settings-page__meta-grid settings-page__meta-grid--two-col">
            <div className="settings-page__meta-item">
              <dt className="settings-page__meta-term">Version</dt>
              <dd className="settings-page__meta-value">{version}</dd>
            </div>
            <div className="settings-page__meta-item">
              <dt className="settings-page__meta-term">Documentation</dt>
              <dd className="settings-page__meta-value">
                <a
                  href="https://aurral.github.io/Aurral/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="settings-page__link"
                >
                  Aurral docs
                </a>
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
