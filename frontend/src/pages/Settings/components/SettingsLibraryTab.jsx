import { useState } from "react";
import { CheckCircle } from "lucide-react";
import FlipSaveButton from "../../../components/FlipSaveButton";
import {
  IntegrationCard,
} from "./SettingsIntegrationCards";
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
    <div className="settings-page__panel">
      <div className="settings-page__panel-header">
        <h2 className="settings-page__panel-title">Library</h2>
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
        <div className="settings-page__section">
          <div className="settings-page__section-header">
            <div className="settings-page__section-intro">
              <h3 className="settings-page__section-title">Music library</h3>
              <p className="settings-page__section-note">
                Connect Lidarr to add artists and albums from Aurral.
              </p>
            </div>
            {lidarrConfigured && (
              <span className="settings-page__status">
                <CheckCircle className="settings-page__status-icon" />
                Connected
              </span>
            )}
          </div>
          <div className="settings-page__integration-card-grid">
            <IntegrationCard
              title="Lidarr"
              subtitle="Music library manager"
              status={getConfiguredStatus(lidarrConfigured)}
              meta={lidarrMeta}
              onClick={() => setActiveModal("lidarr")}
            />
          </div>
        </div>
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
