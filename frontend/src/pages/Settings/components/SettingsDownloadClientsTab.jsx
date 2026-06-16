import FlipSaveButton from "../../../components/FlipSaveButton";
import { SettingsDownloadClientsSection } from "./SettingsDownloadClientsSection";

export function SettingsDownloadClientsTab({
  settings,
  updateSettings,
  health,
  hasUnsavedChanges,
  saving,
  handleSaveSettings,
  showSuccess,
  showError,
  showInfo,
}) {
  return (
    <div className="settings-page__panel">
      <div className="settings-page__panel-header">
        <h2 className="settings-page__panel-title">Download Clients</h2>
        <FlipSaveButton
          saving={saving}
          disabled={!hasUnsavedChanges}
          onClick={handleSaveSettings}
        />
      </div>

      <form
        onSubmit={handleSaveSettings}
        className="settings-page__form"
        autoComplete="off"
      >
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
