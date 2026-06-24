import { LidarrSettingsSection } from "./LidarrSettingsModalContent";

export function SettingsLibraryTab({
  settings,
  updateSettings,
  health,
  lidarrProfiles,
  loadingLidarrProfiles,
  setLoadingLidarrProfiles,
  setLidarrProfiles,
  lidarrMetadataProfiles,
  loadingLidarrMetadataProfiles,
  setLoadingLidarrMetadataProfiles,
  setLidarrMetadataProfiles,
  lidarrTags,
  loadingLidarrTags,
  setLoadingLidarrTags,
  setLidarrTags,
  testingLidarr,
  setTestingLidarr,
  applyingCommunityGuide,
  setShowCommunityGuideModal,
  handleSaveSettings,
  showSuccess,
  showError,
  showInfo,
}) {
  return (
    <div className="arr-page">
      <form onSubmit={handleSaveSettings} className="arr-form" autoComplete="off">
        <LidarrSettingsSection
          settings={settings}
          updateSettings={updateSettings}
          health={health}
          lidarrProfiles={lidarrProfiles}
          loadingLidarrProfiles={loadingLidarrProfiles}
          setLoadingLidarrProfiles={setLoadingLidarrProfiles}
          setLidarrProfiles={setLidarrProfiles}
          lidarrMetadataProfiles={lidarrMetadataProfiles}
          loadingLidarrMetadataProfiles={loadingLidarrMetadataProfiles}
          setLoadingLidarrMetadataProfiles={setLoadingLidarrMetadataProfiles}
          setLidarrMetadataProfiles={setLidarrMetadataProfiles}
          lidarrTags={lidarrTags}
          loadingLidarrTags={loadingLidarrTags}
          setLoadingLidarrTags={setLoadingLidarrTags}
          setLidarrTags={setLidarrTags}
          testingLidarr={testingLidarr}
          setTestingLidarr={setTestingLidarr}
          applyingCommunityGuide={applyingCommunityGuide}
          setShowCommunityGuideModal={setShowCommunityGuideModal}
          showSuccess={showSuccess}
          showError={showError}
          showInfo={showInfo}
        />
      </form>
    </div>
  );
}
