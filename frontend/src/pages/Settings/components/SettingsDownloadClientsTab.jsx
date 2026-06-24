import { SettingsDownloadClientsSection } from "./SettingsDownloadClientsSection";

export function SettingsDownloadClientsTab({
  settings,
  updateSettings,
  health,
  handleSaveSettings,
  showSuccess,
  showError,
  showInfo,
}) {
  return (
    <div className="arr-page">
      <form onSubmit={handleSaveSettings} className="arr-form" autoComplete="off">
        <SettingsDownloadClientsSection
          settings={settings}
          updateSettings={updateSettings}
          health={health}
          handleSaveSettings={handleSaveSettings}
          showSuccess={showSuccess}
          showError={showError}
          showInfo={showInfo}
        />
      </form>
    </div>
  );
}
