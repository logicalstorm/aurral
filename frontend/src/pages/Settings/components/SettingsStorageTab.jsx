import { SettingsStorageSection } from "./SettingsStorageSection";

export function SettingsStorageTab({
  hasUnsavedChanges,
  handleSaveSettings,
  health,
  showSuccess,
  showError,
}) {
  return (
    <div className="arr-page">
      <form
        onSubmit={handleSaveSettings}
        className="arr-form"
        autoComplete="off"
      >
        <SettingsStorageSection
          hasUnsavedChanges={hasUnsavedChanges}
          handleSaveSettings={handleSaveSettings}
          health={health}
          showSuccess={showSuccess}
          showError={showError}
        />
      </form>
    </div>
  );
}
