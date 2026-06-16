import FlipSaveButton from "../../../components/FlipSaveButton";
import { SettingsPlaybackSection } from "./SettingsPlaybackSection";

export function SettingsPlaybackTab({
  settings,
  updateSettings,
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
        <h2 className="settings-page__panel-title">Playback</h2>
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
        <SettingsPlaybackSection
          settings={settings}
          updateSettings={updateSettings}
          hasUnsavedChanges={hasUnsavedChanges}
          showSuccess={showSuccess}
          showError={showError}
          showInfo={showInfo}
        />
      </form>
    </div>
  );
}
