import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { useAccountSettings } from "./Settings/hooks/useAccountSettings";
import { SettingsAccountTab } from "./Settings/components/SettingsAccountTab";

function ProfilePage() {
  const { showSuccess, showError } = useToast();
  const { user: authUser } = useAuth();
  const account = useAccountSettings(authUser, showSuccess, showError);

  return (
    <div className="animate-fade-in max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2" style={{ color: "#fff" }}>
          Profile
        </h1>
        <p style={{ color: "#c1c1c3" }}>
          Personal listening history and library defaults
        </p>
      </div>

      <SettingsAccountTab
        listenHistoryProvider={account.listenHistoryProvider}
        setListenHistoryProvider={account.setListenHistoryProvider}
        listenHistoryUsername={account.listenHistoryUsername}
        setListenHistoryUsername={account.setListenHistoryUsername}
        lidarrConfigured={account.lidarrConfigured}
        lidarrRootFolders={account.lidarrRootFolders}
        lidarrQualityProfiles={account.lidarrQualityProfiles}
        lidarrRootFolderPath={account.lidarrRootFolderPath}
        setLidarrRootFolderPath={account.setLidarrRootFolderPath}
        lidarrQualityProfileId={account.lidarrQualityProfileId}
        setLidarrQualityProfileId={account.setLidarrQualityProfileId}
        hasUnsavedChanges={account.hasUnsavedChanges}
        loading={account.loading}
        saving={account.saving}
        handleSave={account.handleSave}
      />
    </div>
  );
}

export default ProfilePage;
