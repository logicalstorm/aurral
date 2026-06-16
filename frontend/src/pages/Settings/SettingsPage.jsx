import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useToast } from "../../contexts/ToastContext";
import { useAuth } from "../../contexts/AuthContext";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useSettingsData } from "./hooks/useSettingsData";
import { useUnsavedGuard } from "./hooks/useUnsavedGuard";
import { useSettingsTabs } from "./hooks/useSettingsTabs";
import { useSettingsUsers } from "./hooks/useSettingsUsers";
import { UnsavedModal } from "./components/UnsavedModal";
import { CommunityGuideModal } from "./components/CommunityGuideModal";
import { SettingsMobileNav } from "./components/SettingsMobileNav";
import { SettingsLibraryTab } from "./components/SettingsLibraryTab";
import { SettingsIndexersTab } from "./components/SettingsIndexersTab";
import { SettingsDownloadClientsTab } from "./components/SettingsDownloadClientsTab";
import { SettingsPlaybackTab } from "./components/SettingsPlaybackTab";
import { SettingsConnectTab } from "./components/SettingsConnectTab";
import { SettingsDiscoverTab } from "./components/SettingsDiscoverTab";
import { SettingsUsersTab } from "./components/SettingsUsersTab";
import { SettingsMetadataPanel } from "./components/SettingsMetadataPanel";
import { SettingsGeneralTab } from "./components/SettingsGeneralTab";
import SettingsSponsorBanner from "../../components/SettingsSponsorBanner";
import FlipSaveButton from "../../components/FlipSaveButton";
import {
  DEFAULT_SETTINGS_TAB,
  normalizeSettingsTabId,
} from "./settingsTabsConfig";

function SettingsPage() {
  const { showSuccess, showError, showInfo } = useToast();
  const { user: authUser } = useAuth();
  const navigate = useNavigate();
  const { tab: tabParam } = useParams();
  const [pendingTab, setPendingTab] = useState(null);

  const data = useSettingsData(showSuccess, showError, showInfo);
  const guard = useUnsavedGuard(
    data.hasUnsavedChanges,
    data.setHasUnsavedChanges,
  );

  const tabs = useSettingsTabs(authUser);

  const users = useSettingsUsers(
    authUser,
    showSuccess,
    showError,
    tabs.activeTab,
  );

  const normalizedParam = normalizeSettingsTabId(tabParam);
  const shouldRedirect =
    authUser?.role === "admin" &&
    tabParam &&
    normalizedParam !== tabParam;

  const settingsTitle = useMemo(() => {
    return tabs.activeTabMeta
      ? `${tabs.activeTabMeta.label} - Settings`
      : "Settings";
  }, [tabs.activeTabMeta]);
  useDocumentTitle(settingsTitle);

  useEffect(() => {
    if (tabs.activeTab === "discover" || tabs.activeTab === "general") {
      data.refreshHealth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.activeTab]);

  const handleTabSelect = (tabId) => {
    if (data.hasUnsavedChanges && tabId !== tabs.activeTab) {
      setPendingTab(tabId);
      return;
    }
    tabs.setActiveTab(tabId);
  };

  const handleConfirmLeave = () => {
    data.setHasUnsavedChanges(false);
    if (pendingTab) {
      navigate(`/settings/${pendingTab}`);
      setPendingTab(null);
      return;
    }
    guard.handleConfirmLeave();
  };

  const showUnsavedModal = guard.showUnsavedModal || Boolean(pendingTab);

  const renderTabContent = () => {
    switch (tabs.activeTab) {
      case "library":
        return (
          <SettingsLibraryTab
            key="settings-library"
            settings={data.settings}
            updateSettings={data.updateSettings}
            health={data.health}
            lidarrProfiles={data.lidarrProfiles}
            loadingLidarrProfiles={data.loadingLidarrProfiles}
            setLoadingLidarrProfiles={data.setLoadingLidarrProfiles}
            setLidarrProfiles={data.setLidarrProfiles}
            lidarrMetadataProfiles={data.lidarrMetadataProfiles}
            loadingLidarrMetadataProfiles={data.loadingLidarrMetadataProfiles}
            setLoadingLidarrMetadataProfiles={
              data.setLoadingLidarrMetadataProfiles
            }
            setLidarrMetadataProfiles={data.setLidarrMetadataProfiles}
            lidarrTags={data.lidarrTags}
            loadingLidarrTags={data.loadingLidarrTags}
            setLoadingLidarrTags={data.setLoadingLidarrTags}
            setLidarrTags={data.setLidarrTags}
            testingLidarr={data.testingLidarr}
            setTestingLidarr={data.setTestingLidarr}
            applyingCommunityGuide={data.applyingCommunityGuide}
            setShowCommunityGuideModal={data.setShowCommunityGuideModal}
            hasUnsavedChanges={data.hasUnsavedChanges}
            saving={data.saving}
            handleSaveSettings={data.handleSaveSettings}
            fetchSettings={data.fetchSettings}
            showSuccess={showSuccess}
            showError={showError}
            showInfo={showInfo}
          />
        );
      case "indexers":
        return (
          <SettingsIndexersTab
            settings={data.settings}
            updateSettings={data.updateSettings}
            health={data.health}
            hasUnsavedChanges={data.hasUnsavedChanges}
            saving={data.saving}
            handleSaveSettings={data.handleSaveSettings}
            showSuccess={showSuccess}
            showError={showError}
            showInfo={showInfo}
          />
        );
      case "download-clients":
        return (
          <SettingsDownloadClientsTab
            settings={data.settings}
            updateSettings={data.updateSettings}
            health={data.health}
            hasUnsavedChanges={data.hasUnsavedChanges}
            saving={data.saving}
            handleSaveSettings={data.handleSaveSettings}
            showSuccess={showSuccess}
            showError={showError}
            showInfo={showInfo}
          />
        );
      case "playback":
        return (
          <SettingsPlaybackTab
            settings={data.settings}
            updateSettings={data.updateSettings}
            hasUnsavedChanges={data.hasUnsavedChanges}
            saving={data.saving}
            handleSaveSettings={data.handleSaveSettings}
            showSuccess={showSuccess}
            showError={showError}
            showInfo={showInfo}
          />
        );
      case "connect":
        return (
          <SettingsConnectTab
            settings={data.settings}
            updateSettings={data.updateSettings}
            health={data.health}
            hasUnsavedChanges={data.hasUnsavedChanges}
            saving={data.saving}
            handleSaveSettings={data.handleSaveSettings}
            testingGotify={data.testingGotify}
            setTestingGotify={data.setTestingGotify}
            showSuccess={showSuccess}
            showError={showError}
          />
        );
      case "discover":
        return (
          <SettingsDiscoverTab
            settings={data.settings}
            updateSettings={data.updateSettings}
            health={data.health}
            hasUnsavedChanges={data.hasUnsavedChanges}
            saving={data.saving}
            handleSaveSettings={data.handleSaveSettings}
            refreshingDiscovery={data.refreshingDiscovery}
            discoveryProgress={data.discoveryProgress}
            discoveryProgressMessage={data.discoveryProgressMessage}
            clearingCache={data.clearingCache}
            handleRefreshDiscovery={data.handleRefreshDiscovery}
            handleClearCache={data.handleClearCache}
          />
        );
      case "metadata":
        return (
          <div className="settings-page__panel">
            <div className="settings-page__panel-header">
              <h2 className="settings-page__panel-title">Metadata</h2>
              <FlipSaveButton
                saving={data.saving}
                disabled={!data.hasUnsavedChanges}
                onClick={data.handleSaveSettings}
              />
            </div>
            <SettingsMetadataPanel
              settings={data.settings}
              updateSettings={data.updateSettings}
              health={data.health}
              hasUnsavedChanges={data.hasUnsavedChanges}
              saving={data.saving}
              handleSaveSettings={data.handleSaveSettings}
            />
          </div>
        );
      case "users":
        return (
          <SettingsUsersTab
            authUser={authUser}
            usersList={users.usersList}
            loadingUsers={users.loadingUsers}
            newUserUsername={users.newUserUsername}
            setNewUserUsername={users.setNewUserUsername}
            newUserPassword={users.newUserPassword}
            setNewUserPassword={users.setNewUserPassword}
            newUserPermissions={users.newUserPermissions}
            setNewUserPermissions={users.setNewUserPermissions}
            creatingUser={users.creatingUser}
            setCreatingUser={users.setCreatingUser}
            showAddUserModal={users.showAddUserModal}
            setShowAddUserModal={users.setShowAddUserModal}
            editUser={users.editUser}
            setEditUser={users.setEditUser}
            editPassword={users.editPassword}
            setEditPassword={users.setEditPassword}
            editCurrentPassword={users.editCurrentPassword}
            setEditCurrentPassword={users.setEditCurrentPassword}
            editPermissions={users.editPermissions}
            setEditPermissions={users.setEditPermissions}
            savingEdit={users.savingEdit}
            setSavingEdit={users.setSavingEdit}
            changePwCurrent={users.changePwCurrent}
            setChangePwCurrent={users.setChangePwCurrent}
            changePwNew={users.changePwNew}
            setChangePwNew={users.setChangePwNew}
            changePwConfirm={users.changePwConfirm}
            setChangePwConfirm={users.setChangePwConfirm}
            changingPassword={users.changingPassword}
            setChangingPassword={users.setChangingPassword}
            deleteUserTarget={users.deleteUserTarget}
            setDeleteUserTarget={users.setDeleteUserTarget}
            deletingUser={users.deletingUser}
            setDeletingUser={users.setDeletingUser}
            refreshUsers={users.refreshUsers}
            createUser={users.createUser}
            updateUser={users.updateUser}
            deleteUser={users.deleteUser}
            changeMyPassword={users.changeMyPassword}
            settings={data.settings}
            updateSettings={data.updateSettings}
            handleSaveSettings={data.handleSaveSettings}
            health={data.health}
            refreshSettingsData={data.fetchSettings}
            showSuccess={showSuccess}
            showError={showError}
          />
        );
      case "general":
        return <SettingsGeneralTab health={data.health} />;
      default:
        return null;
    }
  };

  if (tabs.tabs.length === 0) {
    return <Navigate to="/profile" replace />;
  }

  if (!tabParam) {
    return <Navigate to={`/settings/${DEFAULT_SETTINGS_TAB}`} replace />;
  }

  if (shouldRedirect) {
    return <Navigate to={`/settings/${normalizedParam}`} replace />;
  }

  return (
    <>
      <UnsavedModal
        show={showUnsavedModal}
        onCancel={() => {
          setPendingTab(null);
          guard.handleCancelLeave();
        }}
        onConfirm={handleConfirmLeave}
      />

      <CommunityGuideModal
        show={data.showCommunityGuideModal}
        onClose={() => data.setShowCommunityGuideModal(false)}
        onApply={data.handleApplyCommunityGuide}
      />

      <div className="settings-page">
        <header className="settings-page__header">
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">
            Configure library, indexers, download clients, playback, and
            connections
          </p>
        </header>

        <SettingsSponsorBanner />

        <SettingsMobileNav
          tabs={tabs.tabs}
          activeTab={tabs.activeTab}
          onSelectTab={handleTabSelect}
        />

        <div className="settings-page__content">{renderTabContent()}</div>
      </div>
    </>
  );
}

export default SettingsPage;
