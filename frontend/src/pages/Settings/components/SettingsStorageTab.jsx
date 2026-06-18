import FlipSaveButton from "../../../components/FlipSaveButton";
import { SettingsStorageSection } from "./SettingsStorageSection";

export function SettingsStorageTab({
  settings,
  updateSettings,
  hasUnsavedChanges,
  saving,
  handleSaveSettings,
  showSuccess,
  showError,
}) {
  return (
    <div className="settings-page__panel">
      <div className="settings-page__panel-header">
        <h2 className="settings-page__panel-title">Storage</h2>
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
        <SettingsStorageSection
          settings={settings}
          updateSettings={updateSettings}
          hasUnsavedChanges={hasUnsavedChanges}
          handleSaveSettings={handleSaveSettings}
          showSuccess={showSuccess}
          showError={showError}
        />
      </form>
    </div>
  );
}
