import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CheckCircle,
  RefreshCw,
  TrendingUp,
  Save,
  Music,
  Shield,
  Server,
  AlertTriangle,
} from "lucide-react";
import api, {
  checkHealth,
  getAppSettings,
  updateAppSettings,
  getLidarrProfiles,
  testLidarrConnection,
  applyLidarrCommunityGuide,
} from "../utils/api";
import { useToast } from "../contexts/ToastContext";

function SettingsPage() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshingDiscovery, setRefreshingDiscovery] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [saving, setSaving] = useState(false);

  const allReleaseTypes = [
    "Album",
    "EP",
    "Single",
    "Broadcast",
    "Soundtrack",
    "Spokenword",
    "Remix",
    "Live",
    "Compilation",
    "Demo",
  ];

  const { showSuccess, showError, showInfo } = useToast();

  const [settings, setSettings] = useState({
    rootFolderPath: "",
    quality: "standard",
    releaseTypes: allReleaseTypes,
    integrations: {
      navidrome: { url: "", username: "", password: "" },
      lastfm: { username: "" },
      slskd: { url: "", apiKey: "" },
      lidarr: { url: "", apiKey: "", qualityProfileId: null },
      musicbrainz: { email: "" },
      general: { authUser: "", authPassword: "" },
    },
  });
  const [lidarrProfiles, setLidarrProfiles] = useState([]);
  const [loadingLidarrProfiles, setLoadingLidarrProfiles] = useState(false);
  const [testingLidarr, setTestingLidarr] = useState(false);
  const [applyingCommunityGuide, setApplyingCommunityGuide] = useState(false);
  const [originalSettings, setOriginalSettings] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [showCommunityGuideModal, setShowCommunityGuideModal] = useState(false);
  const location = useLocation();
  const navigateBase = useNavigate();
  const previousLocationRef = useRef("/settings");
  const hasUnsavedChangesRef = useRef(false);

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const [healthData, savedSettings] = await Promise.all([
        checkHealth(),
        getAppSettings(),
      ]);
      setHealth(healthData);

      const updatedSettings = {
        ...savedSettings,
        releaseTypes: savedSettings.releaseTypes || allReleaseTypes,
        quality: savedSettings.quality || "standard",
        integrations: {
          lidarr: {
            url: "",
            apiKey: "",
            qualityProfileId: null,
            ...(savedSettings.integrations?.lidarr || {}),
          },
          navidrome: {
            url: "",
            username: "",
            password: "",
            ...(savedSettings.integrations?.navidrome || {}),
          },
          lastfm: {
            username: "",
            ...(savedSettings.integrations?.lastfm || {}),
          },
          slskd: {
            url: "",
            apiKey: "",
            ...(savedSettings.integrations?.slskd || {}),
          },
          musicbrainz: {
            email: "",
            ...(savedSettings.integrations?.musicbrainz || {}),
          },
          spotify: {
            clientId: "",
            clientSecret: "",
            ...(savedSettings.integrations?.spotify || {}),
          },
          general: {
            authUser: "",
            authPassword: "",
            ...(savedSettings.integrations?.general || {}),
          },
        },
      };
      setSettings(updatedSettings);
      setOriginalSettings(JSON.parse(JSON.stringify(updatedSettings)));
      setHasUnsavedChanges(false);

      if (
        updatedSettings.integrations?.lidarr?.url &&
        updatedSettings.integrations?.lidarr?.apiKey
      ) {
        setLoadingLidarrProfiles(true);
        try {
          const profiles = await getLidarrProfiles(
            updatedSettings.integrations.lidarr.url,
            updatedSettings.integrations.lidarr.apiKey,
          );
          setLidarrProfiles(profiles);
        } catch (profileErr) {
          console.error(
            "Failed to load profiles on settings fetch:",
            profileErr,
          );
        } finally {
          setLoadingLidarrProfiles(false);
        }
      }
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
    previousLocationRef.current = location.pathname;
  }, []);
  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateAppSettings(settings);
      setOriginalSettings(JSON.parse(JSON.stringify(settings)));
      setHasUnsavedChanges(false);
      showSuccess("Settings saved successfully!");
      setSaving(false);
    } catch (err) {
      showError("Failed to save settings: " + err.message);
      setSaving(false);
    }
  };

  const checkForChanges = (newSettings) => {
    if (!originalSettings) return false;
    return JSON.stringify(newSettings) !== JSON.stringify(originalSettings);
  };

  const updateSettings = (newSettings) => {
    setSettings(newSettings);
    setHasUnsavedChanges(checkForChanges(newSettings));
  };

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      previousLocationRef.current = location.pathname;
      return;
    }

    const handleClick = (e) => {
      const link = e.target.closest("a[href]");
      if (
        link &&
        link.getAttribute("href")?.startsWith("/") &&
        link.getAttribute("href") !== "/settings"
      ) {
        e.preventDefault();
        e.stopPropagation();
        const targetPath = link.getAttribute("href");
        setShowUnsavedModal(true);
        setPendingNavigation(() => () => {
          navigateBase(targetPath);
          setHasUnsavedChanges(false);
        });
        return false;
      }
    };

    const handlePopState = (e) => {
      if (location.pathname === "/settings") {
        e.preventDefault();
        window.history.pushState(null, "", "/settings");
        setShowUnsavedModal(true);
        setPendingNavigation(() => () => {
          window.history.back();
          setHasUnsavedChanges(false);
        });
      }
    };

    document.addEventListener("click", handleClick, true);
    window.addEventListener("popstate", handlePopState);

    return () => {
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [hasUnsavedChanges, location.pathname, navigateBase]);

  const handleConfirmLeave = () => {
    if (pendingNavigation) {
      pendingNavigation();
    }
    setShowUnsavedModal(false);
    setPendingNavigation(null);
    setHasUnsavedChanges(false);
  };

  const handleCancelLeave = () => {
    setShowUnsavedModal(false);
    setPendingNavigation(null);
  };

  const handleApplyCommunityGuide = async () => {
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
              `Default quality profile set to '${result.results.qualityProfile.name}'`,
            );
          }
        } catch (profileErr) {
          console.error("Failed to refresh profiles:", profileErr);
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
  };

  const handleRefreshDiscovery = async () => {
    if (refreshingDiscovery) return;
    setRefreshingDiscovery(true);
    try {
      await api.post("/discover/refresh");
      showInfo(
        "Discovery refresh started in background. This may take a few minutes to fully hydrate images.",
      );
      const healthData = await checkHealth();
      setHealth(healthData);
    } catch (err) {
      showError(
        "Failed to start refresh: " +
          (err.response?.data?.message || err.message),
      );
    } finally {
      setRefreshingDiscovery(false);
    }
  };

  const handleClearCache = async () => {
    if (
      !window.confirm(
        "Are you sure you want to clear the discovery and image cache? This will reset all recommendations until the next refresh.",
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
          (err.response?.data?.message || err.message),
      );
    } finally {
      setClearingCache(false);
    }
  };

  // Removed - now handled inline in the release types section

  const [activeTab, setActiveTab] = useState("integrations");
  const [hoveredTabIndex, setHoveredTabIndex] = useState(null);
  const tabsRef = useRef(null);
  const activeBubbleRef = useRef(null);
  const hoverBubbleRef = useRef(null);
  const tabRefs = useRef({});

  const tabs = [
    { id: "integrations", label: "Integrations", icon: Server },
    { id: "metadata", label: "Metadata", icon: TrendingUp },
    { id: "auth", label: "Authentication", icon: Shield },
  ];

  // Update active bubble position
  useEffect(() => {
    const updateActiveBubble = () => {
      if (!tabsRef.current || !activeBubbleRef.current) return;

      const activeIndex = tabs.findIndex((tab) => tab.id === activeTab);
      if (activeIndex === -1) {
        activeBubbleRef.current.style.opacity = "0";
        return;
      }

      const activeTabEl = tabRefs.current[activeIndex];
      if (!activeTabEl) {
        setTimeout(updateActiveBubble, 50);
        return;
      }

      const tabsRect = tabsRef.current.getBoundingClientRect();
      const tabRect = activeTabEl.getBoundingClientRect();

      activeBubbleRef.current.style.left = `${tabRect.left - tabsRect.left}px`;
      activeBubbleRef.current.style.top = `${tabRect.top - tabsRect.top}px`;
      activeBubbleRef.current.style.width = `${tabRect.width}px`;
      activeBubbleRef.current.style.height = `${tabRect.height}px`;
      activeBubbleRef.current.style.opacity = "1";
    };

    const timeoutId = setTimeout(updateActiveBubble, 10);
    window.addEventListener("resize", updateActiveBubble);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("resize", updateActiveBubble);
    };
  }, [activeTab, tabs]);

  // Update hover bubble position
  useEffect(() => {
    const updateHoverBubble = () => {
      if (!tabsRef.current || !hoverBubbleRef.current) return;

      if (hoveredTabIndex === null) {
        hoverBubbleRef.current.style.left = "0px";
        hoverBubbleRef.current.style.top = "0px";
        hoverBubbleRef.current.style.width = "100%";
        hoverBubbleRef.current.style.height = "100%";
        hoverBubbleRef.current.style.opacity = "0.6";
        return;
      }

      const hoveredTabEl = tabRefs.current[hoveredTabIndex];
      if (!hoveredTabEl) return;

      const tabsRect = tabsRef.current.getBoundingClientRect();
      const tabRect = hoveredTabEl.getBoundingClientRect();

      hoverBubbleRef.current.style.left = `${tabRect.left - tabsRect.left}px`;
      hoverBubbleRef.current.style.top = `${tabRect.top - tabsRect.top}px`;
      hoverBubbleRef.current.style.width = `${tabRect.width}px`;
      hoverBubbleRef.current.style.height = `${tabRect.height}px`;
      hoverBubbleRef.current.style.opacity = "1";
    };

    updateHoverBubble();
  }, [hoveredTabIndex]);

  const renderTabContent = () => {
    switch (activeTab) {
      case "integrations":
        return (
          <div className="card animate-fade-in">
            <div className="flex items-center justify-between mb-6">
              <h2
                className="text-2xl font-bold flex items-center"
                style={{ color: "#fff" }}
              >
                Integrations
              </h2>
              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={!hasUnsavedChanges || saving}
                className={`btn flex items-center ${
                  hasUnsavedChanges
                    ? "btn-primary"
                    : "btn-secondary opacity-50 cursor-not-allowed"
                }`}
              >
                <Save className="w-4 h-4 mr-2" />
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
            <form onSubmit={handleSaveSettings} className="space-y-6">
              <div
                className="p-6 rounded-lg space-y-4"
                style={{
                  backgroundColor: "#1a1a1e",
                  border: "1px solid #2a2a2e",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3
                    className="text-lg font-medium flex items-center"
                    style={{ color: "#fff" }}
                  >
                    <Server className="w-5 h-5 mr-2" /> Lidarr
                  </h3>
                  {health?.lidarrConfigured && (
                    <span className="flex items-center text-sm text-green-400">
                      <CheckCircle className="w-4 h-4 mr-1" />
                      Connected
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label
                      className="block text-sm font-medium mb-1"
                      style={{ color: "#fff" }}
                    >
                      Server URL
                    </label>
                    <input
                      type="url"
                      className="input"
                      placeholder="http://lidarr:8686"
                      value={settings.integrations?.lidarr?.url || ""}
                      onChange={(e) =>
                        updateSettings({
                          ...settings,
                          integrations: {
                            ...settings.integrations,
                            lidarr: {
                              ...(settings.integrations?.lidarr || {}),
                              url: e.target.value,
                            },
                          },
                        })
                      }
                    />
                  </div>
                  <div>
                    <label
                      className="block text-sm font-medium mb-1"
                      style={{ color: "#fff" }}
                    >
                      API Key
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        className="input flex-1"
                        placeholder="Enter Lidarr API Key"
                        value={settings.integrations?.lidarr?.apiKey || ""}
                        onChange={(e) =>
                          updateSettings({
                            ...settings,
                            integrations: {
                              ...settings.integrations,
                              lidarr: {
                                ...(settings.integrations?.lidarr || {}),
                                apiKey: e.target.value,
                              },
                            },
                          })
                        }
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          setTestingLidarr(true);
                          try {
                            const url = settings.integrations?.lidarr?.url;
                            const apiKey =
                              settings.integrations?.lidarr?.apiKey;
                            if (!url || !apiKey) {
                              showError("Please enter both URL and API key");
                              return;
                            }
                            const result = await testLidarrConnection(
                              url,
                              apiKey,
                            );
                            if (result.success) {
                              showSuccess(
                                `Lidarr connection successful! (${result.instanceName || "Lidarr"})`,
                              );
                              setLoadingLidarrProfiles(true);
                              try {
                                const profiles = await getLidarrProfiles(
                                  url,
                                  apiKey,
                                );
                                setLidarrProfiles(profiles);
                                if (profiles.length > 0) {
                                  showInfo(
                                    `Loaded ${profiles.length} quality profile(s)`,
                                  );
                                }
                              } catch (profileErr) {
                                console.error(
                                  "Failed to load profiles:",
                                  profileErr,
                                );
                              } finally {
                                setLoadingLidarrProfiles(false);
                              }
                            } else {
                              showError(
                                `Connection failed: ${result.message || result.error}${result.details ? `\n${result.details}` : ""}`,
                              );
                            }
                          } catch (err) {
                            const errorMsg =
                              err.response?.data?.message ||
                              err.response?.data?.error ||
                              err.message;
                            showError(`Connection failed: ${errorMsg}`);
                          } finally {
                            setTestingLidarr(false);
                          }
                        }}
                        disabled={
                          testingLidarr ||
                          !settings.integrations?.lidarr?.url ||
                          !settings.integrations?.lidarr?.apiKey
                        }
                        className="btn btn-secondary"
                      >
                        {testingLidarr ? "Testing..." : "Test"}
                      </button>
                    </div>
                    <p className="mt-1 text-xs" style={{ color: "#c1c1c3" }}>
                      Found in Settings &rarr; General &rarr; Security.
                    </p>
                  </div>
                  <div>
                    <label
                      className="block text-sm font-medium mb-1"
                      style={{ color: "#fff" }}
                    >
                      Default Quality Profile
                    </label>
                    <div className="flex gap-2">
                      <select
                        className="input flex-1"
                        value={
                          settings.integrations?.lidarr?.qualityProfileId
                            ? String(
                                settings.integrations.lidarr.qualityProfileId,
                              )
                            : ""
                        }
                        onChange={(e) =>
                          updateSettings({
                            ...settings,
                            integrations: {
                              ...settings.integrations,
                              lidarr: {
                                ...(settings.integrations?.lidarr || {}),
                                qualityProfileId: e.target.value
                                  ? parseInt(e.target.value)
                                  : null,
                              },
                            },
                          })
                        }
                        disabled={loadingLidarrProfiles}
                      >
                        <option value="">
                          {loadingLidarrProfiles
                            ? "Loading profiles..."
                            : lidarrProfiles.length === 0
                              ? "No profiles available (test connection first)"
                              : "Select a profile"}
                        </option>
                        {lidarrProfiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={async () => {
                          const url = settings.integrations?.lidarr?.url;
                          const apiKey = settings.integrations?.lidarr?.apiKey;

                          if (!url || !apiKey) {
                            showError(
                              "Please enter Lidarr URL and API key first",
                            );
                            return;
                          }

                          setLoadingLidarrProfiles(true);
                          try {
                            const profiles = await getLidarrProfiles(
                              url,
                              apiKey,
                            );
                            setLidarrProfiles(profiles);
                            if (profiles.length > 0) {
                              showSuccess(
                                `Loaded ${profiles.length} quality profile(s)`,
                              );
                            } else {
                              showInfo("No quality profiles found in Lidarr");
                            }
                          } catch (err) {
                            const errorMsg =
                              err.response?.data?.message ||
                              err.response?.data?.error ||
                              err.message;
                            showError(`Failed to load profiles: ${errorMsg}`);
                          } finally {
                            setLoadingLidarrProfiles(false);
                          }
                        }}
                        disabled={
                          loadingLidarrProfiles ||
                          !settings.integrations?.lidarr?.url ||
                          !settings.integrations?.lidarr?.apiKey
                        }
                        className="btn btn-secondary"
                      >
                        <RefreshCw
                          className={`w-4 h-4 ${loadingLidarrProfiles ? "animate-spin" : ""}`}
                        />
                      </button>
                    </div>
                    <p className="mt-1 text-xs" style={{ color: "#c1c1c3" }}>
                      Quality profile used when adding artists and albums to
                      Lidarr.
                    </p>
                  </div>

                  <div
                    className="pt-4 border-t"
                    style={{ borderColor: "#2a2a2e" }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          !settings.integrations?.lidarr?.url ||
                          !settings.integrations?.lidarr?.apiKey
                        ) {
                          showError(
                            "Please configure Lidarr URL and API key first",
                          );
                          return;
                        }

                        setShowCommunityGuideModal(true);
                      }}
                      disabled={
                        applyingCommunityGuide || !health?.lidarrConfigured
                      }
                      className="btn btn-primary w-full"
                    >
                      {applyingCommunityGuide
                        ? "Applying..."
                        : "Apply Davo's Recommended Settings"}
                    </button>
                    <p className="mt-2 text-xs" style={{ color: "#c1c1c3" }}>
                      Creates quality profile, updates quality definitions, adds
                      custom formats, and updates naming scheme.{" "}
                      <a
                        href="https://wiki.servarr.com/lidarr/community-guide"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                        style={{ color: "#60a5fa" }}
                      >
                        Read more
                      </a>
                    </p>
                  </div>
                </div>
              </div>

              <div
                className="p-6 rounded-lg space-y-4"
                style={{
                  backgroundColor: "#1a1a1e",
                  border: "1px solid #2a2a2e",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3
                    className="text-lg font-medium flex items-center"
                    style={{ color: "#fff" }}
                  >
                    <Music className="w-5 h-5 mr-2" /> Subsonic / Navidrome
                  </h3>
                  {settings.integrations?.navidrome?.url && (
                    <span className="flex items-center text-sm text-green-400">
                      <CheckCircle className="w-4 h-4 mr-1" />
                      Configured
                    </span>
                  )}
                </div>
                <div>
                  <label
                    className="block text-sm font-medium mb-1"
                    style={{ color: "#fff" }}
                  >
                    Server URL
                  </label>
                  <input
                    type="url"
                    className="input"
                    placeholder="https://music.example.com"
                    value={settings.integrations?.navidrome?.url || ""}
                    onChange={(e) =>
                      updateSettings({
                        ...settings,
                        integrations: {
                          ...settings.integrations,
                          navidrome: {
                            ...(settings.integrations?.navidrome || {}),
                            url: e.target.value,
                          },
                        },
                      })
                    }
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      className="block text-sm font-medium mb-1"
                      style={{ color: "#fff" }}
                    >
                      Username
                    </label>
                    <input
                      type="text"
                      className="input"
                      value={settings.integrations?.navidrome?.username || ""}
                      onChange={(e) =>
                        updateSettings({
                          ...settings,
                          integrations: {
                            ...settings.integrations,
                            navidrome: {
                              ...(settings.integrations?.navidrome || {}),
                              username: e.target.value,
                            },
                          },
                        })
                      }
                    />
                  </div>
                  <div>
                    <label
                      className="block text-sm font-medium mb-1"
                      style={{ color: "#fff" }}
                    >
                      Password
                    </label>
                    <input
                      type="password"
                      className="input"
                      value={settings.integrations?.navidrome?.password || ""}
                      onChange={(e) =>
                        updateSettings({
                          ...settings,
                          integrations: {
                            ...settings.integrations,
                            navidrome: {
                              ...(settings.integrations?.navidrome || {}),
                              password: e.target.value,
                            },
                          },
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            </form>
          </div>
        );

      case "metadata":
        return (
          <div className="card animate-fade-in">
            <div className="flex items-center justify-between mb-6">
              <h2
                className="text-2xl font-bold flex items-center"
                style={{ color: "#fff" }}
              >
                Metadata Services
              </h2>
              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={!hasUnsavedChanges || saving}
                className={`btn flex items-center ${
                  hasUnsavedChanges
                    ? "btn-primary"
                    : "btn-secondary opacity-50 cursor-not-allowed"
                }`}
              >
                <Save className="w-4 h-4 mr-2" />
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
            <form onSubmit={handleSaveSettings} className="space-y-6">
              <div
                className="p-6 rounded-lg space-y-4"
                style={{
                  backgroundColor: "#1a1a1e",
                  border: "1px solid #2a2a2e",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3
                    className="text-lg font-medium flex items-center"
                    style={{ color: "#fff" }}
                  >
                    <TrendingUp className="w-5 h-5 mr-2" /> MusicBrainz
                  </h3>
                  {health?.musicbrainzConfigured && (
                    <span className="flex items-center text-sm text-green-400">
                      <CheckCircle className="w-4 h-4 mr-1" />
                      Configured
                    </span>
                  )}
                </div>
                <div>
                  <label
                    className="block text-sm font-medium mb-1"
                    style={{ color: "#fff" }}
                  >
                    Contact Email (Required)
                  </label>
                  <input
                    type="email"
                    className="input"
                    placeholder="contact@example.com"
                    value={settings.integrations?.musicbrainz?.email || ""}
                    onChange={(e) =>
                      updateSettings({
                        ...settings,
                        integrations: {
                          ...settings.integrations,
                          musicbrainz: {
                            ...(settings.integrations?.musicbrainz || {}),
                            email: e.target.value,
                          },
                        },
                      })
                    }
                  />
                  <p className="mt-1 text-xs" style={{ color: "#c1c1c3" }}>
                    Required by MusicBrainz API to identify the application.
                  </p>
                </div>
              </div>

              <div
                className="p-6 rounded-lg space-y-4"
                style={{
                  backgroundColor: "#1a1a1e",
                  border: "1px solid #2a2a2e",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3
                    className="text-lg font-medium flex items-center"
                    style={{ color: "#fff" }}
                  >
                    <TrendingUp className="w-5 h-5 mr-2" /> Last.fm API
                  </h3>
                  {health?.lastfmConfigured && (
                    <span className="flex items-center text-sm text-green-400">
                      <CheckCircle className="w-4 h-4 mr-1" />
                      Configured
                    </span>
                  )}
                </div>
                <div className="space-y-4">
                  <div>
                    <label
                      className="block text-sm font-medium mb-1"
                      style={{ color: "#fff" }}
                    >
                      API Key
                    </label>
                    <input
                      type="password"
                      className="input"
                      placeholder="Last.fm API Key"
                      value={settings.integrations?.lastfm?.apiKey || ""}
                      onChange={(e) =>
                        updateSettings({
                          ...settings,
                          integrations: {
                            ...settings.integrations,
                            lastfm: {
                              ...(settings.integrations?.lastfm || {}),
                              apiKey: e.target.value,
                            },
                          },
                        })
                      }
                    />
                  </div>
                  <div>
                    <label
                      className="block text-sm font-medium mb-1"
                      style={{ color: "#fff" }}
                    >
                      Username
                    </label>
                    <input
                      type="text"
                      className="input"
                      placeholder="Your Last.fm username"
                      value={settings.integrations?.lastfm?.username || ""}
                      onChange={(e) =>
                        updateSettings({
                          ...settings,
                          integrations: {
                            ...settings.integrations,
                            lastfm: {
                              ...(settings.integrations?.lastfm || {}),
                              username: e.target.value,
                            },
                          },
                        })
                      }
                    />
                    <p className="mt-1 text-xs" style={{ color: "#c1c1c3" }}>
                      Your Last.fm username for personalized recommendations
                      based on your listening history.
                    </p>
                  </div>
                  <p className="text-xs" style={{ color: "#c1c1c3" }}>
                    API key is required for high-quality images, better
                    recommendations, and weekly flow. Username enables
                    personalized recommendations from your Last.fm listening
                    history.
                  </p>
                </div>
              </div>

              <div
                className="p-6 rounded-lg space-y-4"
                style={{
                  backgroundColor: "#1a1a1e",
                  border: "1px solid #2a2a2e",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3
                    className="text-lg font-medium flex items-center"
                    style={{ color: "#fff" }}
                  >
                    <TrendingUp className="w-5 h-5 mr-2" /> Spotify API
                  </h3>
                  {health?.spotifyConfigured && (
                    <span className="flex items-center text-sm text-green-400">
                      <CheckCircle className="w-4 h-4 mr-1" />
                      Configured
                    </span>
                  )}
                </div>
                <div className="space-y-4">
                  <div>
                    <label
                      className="block text-sm font-medium mb-1"
                      style={{ color: "#fff" }}
                    >
                      Client ID
                    </label>
                    <input
                      type="text"
                      className="input"
                      placeholder="Spotify Client ID"
                      value={settings.integrations?.spotify?.clientId || ""}
                      onChange={(e) =>
                        updateSettings({
                          ...settings,
                          integrations: {
                            ...settings.integrations,
                            spotify: {
                              ...(settings.integrations?.spotify || {}),
                              clientId: e.target.value,
                            },
                          },
                        })
                      }
                    />
                  </div>
                  <div>
                    <label
                      className="block text-sm font-medium mb-1"
                      style={{ color: "#fff" }}
                    >
                      Client Secret
                    </label>
                    <input
                      type="password"
                      className="input"
                      placeholder="Spotify Client Secret"
                      value={settings.integrations?.spotify?.clientSecret || ""}
                      onChange={(e) =>
                        updateSettings({
                          ...settings,
                          integrations: {
                            ...settings.integrations,
                            spotify: {
                              ...(settings.integrations?.spotify || {}),
                              clientSecret: e.target.value,
                            },
                          },
                        })
                      }
                    />
                  </div>
                  <p className="text-xs" style={{ color: "#c1c1c3" }}>
                    Optional but recommended. Provides faster, higher-quality
                    artist images. Get credentials from{" "}
                    <a
                      href="https://developer.spotify.com/dashboard"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                      style={{ color: "#60a5fa" }}
                    >
                      Spotify Developer Dashboard
                    </a>
                    . Create an app and use Client Credentials flow.
                  </p>
                </div>
              </div>
            </form>
          </div>
        );

      case "auth":
        return (
          <div className="card animate-fade-in">
            <div className="flex items-center justify-between mb-6">
              <h2
                className="text-2xl font-bold flex items-center"
                style={{ color: "#fff" }}
              >
                Authentication
              </h2>
              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={!hasUnsavedChanges || saving}
                className={`btn flex items-center ${
                  hasUnsavedChanges
                    ? "btn-primary"
                    : "btn-secondary opacity-50 cursor-not-allowed"
                }`}
              >
                <Save className="w-4 h-4 mr-2" />
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
            <form onSubmit={handleSaveSettings} className="space-y-6">
              <div
                className="p-6 rounded-lg space-y-4"
                style={{
                  backgroundColor: "#1a1a1e",
                  border: "1px solid #2a2a2e",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3
                    className="text-lg font-medium flex items-center"
                    style={{ color: "#fff" }}
                  >
                    <Shield className="w-5 h-5 mr-2" /> App Authentication
                  </h3>
                  {settings.integrations?.general?.authPassword && (
                    <span className="flex items-center text-sm text-green-400">
                      <CheckCircle className="w-4 h-4 mr-1" />
                      Enabled
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      className="block text-sm font-medium mb-1"
                      style={{ color: "#fff" }}
                    >
                      App Username
                    </label>
                    <input
                      type="text"
                      className="input"
                      placeholder="admin"
                      value={settings.integrations?.general?.authUser || ""}
                      onChange={(e) =>
                        updateSettings({
                          ...settings,
                          integrations: {
                            ...settings.integrations,
                            general: {
                              ...(settings.integrations?.general || {}),
                              authUser: e.target.value,
                            },
                          },
                        })
                      }
                    />
                  </div>
                  <div>
                    <label
                      className="block text-sm font-medium mb-1"
                      style={{ color: "#fff" }}
                    >
                      App Password
                    </label>
                    <input
                      type="password"
                      className="input"
                      placeholder="Leave empty to disable auth"
                      value={settings.integrations?.general?.authPassword || ""}
                      onChange={(e) =>
                        updateSettings({
                          ...settings,
                          integrations: {
                            ...settings.integrations,
                            general: {
                              ...(settings.integrations?.general || {}),
                              authPassword: e.target.value,
                            },
                          },
                        })
                      }
                    />
                  </div>
                </div>
                <p className="text-xs" style={{ color: "#c1c1c3" }}>
                  Leave password empty to disable authentication. When enabled,
                  all API requests will require these credentials.
                </p>
              </div>
            </form>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      {showUnsavedModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.75)" }}
          onClick={handleCancelLeave}
        >
          <div
            className="card max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start mb-4">
              <AlertTriangle className="w-6 h-6 text-yellow-500 mr-3 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3
                  className="text-xl font-bold mb-2"
                  style={{ color: "#fff" }}
                >
                  Unsaved Changes
                </h3>
                <p style={{ color: "#c1c1c3" }}>
                  You have unsaved changes. Are you sure you want to leave? Your
                  changes will be lost.
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button onClick={handleCancelLeave} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleConfirmLeave}
                className="btn btn-primary"
                style={{ backgroundColor: "#ef4444" }}
              >
                Leave Without Saving
              </button>
            </div>
          </div>
        </div>
      )}

      {showCommunityGuideModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.75)" }}
          onClick={() => setShowCommunityGuideModal(false)}
        >
          <div
            className="card max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4">
              <h3 className="text-xl font-bold mb-2" style={{ color: "#fff" }}>
                Apply Davo's Recommended Settings
              </h3>
              <p className="mb-4" style={{ color: "#c1c1c3" }}>
                This will apply Davo's Community Lidarr Guide settings to your
                Lidarr instance:
              </p>
              <ul className="space-y-2 mb-4" style={{ color: "#c1c1c3" }}>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>
                    Update quality definitions for FLAC and FLAC 24bit
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>
                    Add custom formats (Preferred Groups, CD, WEB, Lossless,
                    Vinyl)
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Update naming scheme</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>
                    Create <strong>"Aurral - HQ"</strong> quality profile (FLAC
                    + MP3-320)
                  </span>
                </li>
              </ul>
              <p className="text-xs" style={{ color: "#c1c1c3" }}>
                <a
                  href="https://wiki.servarr.com/lidarr/community-guide"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                  style={{ color: "#60a5fa" }}
                >
                  Read the full guide
                </a>{" "}
                for more details on these settings.
              </p>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button
                onClick={() => setShowCommunityGuideModal(false)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyCommunityGuide}
                className="btn btn-primary"
              >
                Apply Settings
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="animate-fade-in max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "#fff" }}>
            Settings
          </h1>
          <p style={{ color: "#c1c1c3" }}>
            Configure application preferences and integrations
          </p>
        </div>

        <div className="mb-8 flex justify-center">
          <div
            ref={tabsRef}
            className="relative p-1.5 inline-flex"
            style={{ backgroundColor: "#0f0f12" }}
          >
            {/* Active bubble */}
            <div
              ref={activeBubbleRef}
              className="absolute transition-all duration-300 ease-out z-10 opacity-0"
              style={{ backgroundColor: "#211f27" }}
            />

            {/* Hover bubble - covers entire nav by default, shrinks to hovered tab */}
            <div
              ref={hoverBubbleRef}
              className="absolute transition-all duration-200 ease-out z-0"
              style={{ backgroundColor: "#1a1a1e" }}
            />

            <div
              className="relative flex gap-1"
              onMouseLeave={() => setHoveredTabIndex(null)}
            >
              {tabs.map((tab, index) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    ref={(el) => {
                      if (el) tabRefs.current[index] = el;
                    }}
                    onClick={() => setActiveTab(tab.id)}
                    onMouseEnter={() => setHoveredTabIndex(index)}
                    className="relative z-20 flex items-center space-x-2 px-4 py-2.5 font-medium transition-all duration-200 text-sm"
                    style={{ color: "#fff" }}
                  >
                    <Icon
                      className="w-4 h-4 transition-transform flex-shrink-0"
                      style={{ color: "#fff" }}
                    />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div>{renderTabContent()}</div>
      </div>
    </>
  );
}

export default SettingsPage;
