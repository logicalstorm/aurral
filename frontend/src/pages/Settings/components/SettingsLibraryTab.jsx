import { useState } from "react";
import {
  IntegrationCard,
} from "./SettingsIntegrationCards";
import { SettingsArrCardGrid, SettingsArrFieldSet } from "./arr/SettingsArrLayout";
import { LidarrSettingsModal } from "./LidarrSettingsModalContent";
import { getConfiguredStatus } from "../utils/integrationStatus";

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
  hasUnsavedChanges,
  saving,
  handleSaveSettings,
  fetchSettings,
  showSuccess,
  showError,
  showInfo,
}) {
  const [activeModal, setActiveModal] = useState(null);
  const lidarr = settings.integrations?.lidarr || {};
  const lidarrConfigured = Boolean(health?.lidarrConfigured);
  const qualityProfile = lidarr.qualityProfileId
    ? lidarrProfiles?.find((p) => p.id === lidarr.qualityProfileId)?.name
    : null;
  const lidarrMeta = qualityProfile
    ? `Quality: ${qualityProfile}`
    : lidarr.url
      ? lidarr.url.replace(/^https?:\/\//, "")
      : "Music library";

  return (
    <div className="arr-page">
      <form
        onSubmit={handleSaveSettings}
        className="arr-form"
        autoComplete="off"
      >
        <SettingsArrFieldSet legend="Music Library">
          <SettingsArrCardGrid>
            <IntegrationCard
              title="Lidarr"
              subtitle="Music library manager"
              status={getConfiguredStatus(lidarrConfigured)}
              meta={lidarrMeta}
              onClick={() => setActiveModal("lidarr")}
            />
          </SettingsArrCardGrid>
        </SettingsArrFieldSet>
      </form>

      {activeModal === "lidarr" && (
        <LidarrSettingsModal
          onClose={() => setActiveModal(null)}
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
            fetchSettings={fetchSettings}
            showSuccess={showSuccess}
            showError={showError}
            showInfo={showInfo}
        />
      )}
    </div>
  );
}
