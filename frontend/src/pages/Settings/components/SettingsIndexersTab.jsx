import { SettingsIndexersSection } from "./SettingsIndexersSection";

export function SettingsIndexersTab({
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
      <form
        onSubmit={handleSaveSettings}
        className="arr-form"
        autoComplete="off"
      >
        <SettingsIndexersSection
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
