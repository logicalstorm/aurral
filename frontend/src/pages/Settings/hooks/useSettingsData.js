import { useState, useEffect, useRef, useCallback } from "react";
import api, {
  checkHealth,
  getAppSettings,
  updateAppSettings,
  getLidarrProfiles,
  testLidarrConnection,
  testGotifyConnection,
  applyLidarrCommunityGuide,
} from "../../../utils/api";
import { allReleaseTypes } from "../constants";
import { normalizeSettings, checkForChanges } from "../utils";

const defaultSettings = {
  rootFolderPath: "",
  quality: "standard",
  releaseTypes: allReleaseTypes,
  integrations: {
    navidrome: { url: "", username: "", password: "" },
    lastfm: { username: "" },
    slskd: { url: "", apiKey: "" },
    lidarr: {
      url: "",
      apiKey: "",
      qualityProfileId: null,
      searchOnAdd: false,
    },
    musicbrainz: { email: "" },
    general: { authUser: "", authPassword: "" },
    gotify: {
      url: "",
      token: "",
      notifyDiscoveryUpdated: false,
      notifyWeeklyFlowDone: false,
    },
  },
};

export function useSettingsData(showSuccess, showError, showInfo) {
  const [health, setHealth] = useState(null);
  const [settings, setSettingsState] = useState(defaultSettings);
  const [originalSettings, setOriginalSettings] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshingDiscovery, setRefreshingDiscovery] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [lidarrProfiles, setLidarrProfiles] = useState([]);
  const [loadingLidarrProfiles, setLoadingLidarrProfiles] = useState(false);
  const [testingLidarr, setTestingLidarr] = useState(false);
  const [testingGotify, setTestingGotify] = useState(false);
  const [applyingCommunityGuide, setApplyingCommunityGuide] = useState(false);
  const [showCommunityGuideModal, setShowCommunityGuideModal] = useState(false);
  const comparisonEnabledRef = useRef(false);

  const fetchSettings = useCallback(async () => {
    comparisonEnabledRef.current = false;
    try {
      const [healthData, savedSettings] = await Promise.all([
        checkHealth(),
        getAppSettings(),
      ]);
      setHealth(healthData);
      const updatedSettings = normalizeSettings(savedSettings);
      setSettingsState(updatedSettings);
      setOriginalSettings(JSON.parse(JSON.stringify(updatedSettings)));
      setHasUnsavedChanges(false);
      setTimeout(() => {
        comparisonEnabledRef.current = true;
      }, 600);

      const lidarr = updatedSettings.integrations?.lidarr || {};
      if (lidarr.url && lidarr.apiKey) {
        setLoadingLidarrProfiles(true);
        try {
          const profiles = await getLidarrProfiles(lidarr.url, lidarr.apiKey);
          setLidarrProfiles(profiles);
        } catch {
        } finally {
          setLoadingLidarrProfiles(false);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSettings = useCallback(
    (newSettings) => {
      setSettingsState(newSettings);
      if (comparisonEnabledRef.current && originalSettings) {
        setHasUnsavedChanges(checkForChanges(newSettings, originalSettings));
      }
    },
    [originalSettings]
  );

  const handleSaveSettings = useCallback(
    async (e) => {
      e?.preventDefault();
      setSaving(true);
      try {
        await updateAppSettings(settings);
        setOriginalSettings(JSON.parse(JSON.stringify(settings)));
        setHasUnsavedChanges(false);
        showSuccess("Settings saved successfully!");
      } catch (err) {
        showError("Failed to save settings: " + err.message);
      } finally {
        setSaving(false);
      }
    },
    [settings, showSuccess, showError]
  );

  const handleRefreshDiscovery = useCallback(async () => {
    if (refreshingDiscovery) return;
    setRefreshingDiscovery(true);
    try {
      await api.post("/discover/refresh");
      showInfo(
        "Discovery refresh started in background. This may take a few minutes to fully hydrate images."
      );
      const healthData = await checkHealth();
      setHealth(healthData);
    } catch (err) {
      showError(
        "Failed to start refresh: " +
          (err.response?.data?.message || err.response?.data?.error || err.message)
      );
    } finally {
      setRefreshingDiscovery(false);
    }
  }, [refreshingDiscovery, showInfo, showError]);

  const handleClearCache = useCallback(async () => {
    if (
      !window.confirm(
        "Are you sure you want to clear the discovery and image cache? This will reset all recommendations until the next refresh."
      )
    )
      return;
    setClearingCache(true);
    try {
      await api.post("/discover/clear");
      showSuccess("Cache cleared successfully.");
      const healthData = await checkHealth();
      setHealth(healthData);
    } catch (err) {
      showError(
        "Failed to clear cache: " +
          (err.response?.data?.message || err.response?.data?.error || err.message)
      );
    } finally {
      setClearingCache(false);
    }
  }, [showSuccess, showError]);

  const handleApplyCommunityGuide = useCallback(async () => {
    setShowCommunityGuideModal(false);
    setApplyingCommunityGuide(true);
    try {
      const result = await applyLidarrCommunityGuide();
      showSuccess("Community guide settings applied successfully!");

      if (result.results?.qualityProfile) {
        const url = settings.integrations?.lidarr?.url;
        const apiKey = settings.integrations?.lidarr?.apiKey;
        setLoadingLidarrProfiles(true);
        try {
          const profiles = await getLidarrProfiles(url, apiKey);
          setLidarrProfiles(profiles);
          if (result.results.qualityProfile.id) {
            updateSettings({
              ...settings,
              integrations: {
                ...settings.integrations,
                lidarr: {
                  ...(settings.integrations?.lidarr || {}),
                  qualityProfileId: result.results.qualityProfile.id,
                },
              },
            });
            showInfo(
              `Default quality profile set to '${result.results.qualityProfile.name}'`
            );
          }
        } catch {
        } finally {
          setLoadingLidarrProfiles(false);
        }
      }
    } catch (err) {
      const errorMsg =
        err.response?.data?.message || err.response?.data?.error || err.message;
      showError(`Failed to apply community guide: ${errorMsg}`);
    } finally {
      setApplyingCommunityGuide(false);
    }
  }, [settings, updateSettings, showSuccess, showError, showInfo]);

  const refreshHealth = useCallback(async () => {
    try {
      const healthData = await checkHealth();
      setHealth(healthData);
    } catch {}
  }, []);

  return {
    health,
    settings,
    updateSettings,
    originalSettings,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    saving,
    handleSaveSettings,
    fetchSettings,
    refreshHealth,
    refreshingDiscovery,
    clearingCache,
    handleRefreshDiscovery,
    handleClearCache,
    lidarrProfiles,
    setLidarrProfiles,
    loadingLidarrProfiles,
    setLoadingLidarrProfiles,
    testingLidarr,
    setTestingLidarr,
    testingGotify,
    setTestingGotify,
    applyingCommunityGuide,
    showCommunityGuideModal,
    setShowCommunityGuideModal,
    handleApplyCommunityGuide,
    getLidarrProfiles,
    testLidarrConnection,
    testGotifyConnection,
  };
}
