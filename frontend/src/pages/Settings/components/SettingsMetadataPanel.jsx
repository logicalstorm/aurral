import SettingsMetadataSponsorSection from "../../../components/SettingsMetadataSponsorSection";
import { SettingsMetadataTab } from "./SettingsMetadataTab";

export function SettingsMetadataPanel({
  settings,
  updateSettings,
  health,
  hasUnsavedChanges,
  saving,
  handleSaveSettings,
}) {
  return (
    <>
      <SettingsMetadataSponsorSection />
      <SettingsMetadataTab
        settings={settings}
        updateSettings={updateSettings}
        health={health}
        hasUnsavedChanges={hasUnsavedChanges}
        saving={saving}
        handleSaveSettings={handleSaveSettings}
        hidePanelHeader
      />
    </>
  );
}
