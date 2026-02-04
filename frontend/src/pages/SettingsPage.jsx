import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CheckCircle,
  RefreshCw,
  Trash2,
  TrendingUp,
  Server,
  AlertTriangle,
  Bell,
  Users,
  UserPlus,
  Lock,
  Pencil,
  X,
} from "lucide-react";
import PillToggle from "../components/PillToggle";
import FlipSaveButton from "../components/FlipSaveButton";
import api, {
  checkHealth,
  getAppSettings,
  updateAppSettings,
  getLidarrProfiles,
  testLidarrConnection,
  testGotifyConnection,
  applyLidarrCommunityGuide,
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  changeMyPassword,
} from "../utils/api";
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "../contexts/AuthContext";

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

function SettingsPage() {
  const [health, setHealth] = useState(null);
  const [refreshingDiscovery, setRefreshingDiscovery] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [saving, setSaving] = useState(false);

  const { showSuccess, showError, showInfo } = useToast();
  const { user: authUser, hasPermission } = useAuth();

  const [settings, setSettings] = useState({
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
  });
  const [lidarrProfiles, setLidarrProfiles] = useState([]);
  const [loadingLidarrProfiles, setLoadingLidarrProfiles] = useState(false);
  const [testingLidarr, setTestingLidarr] = useState(false);
  const [applyingCommunityGuide, setApplyingCommunityGuide] = useState(false);
  const [testingGotify, setTestingGotify] = useState(false);
  const [originalSettings, setOriginalSettings] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [showCommunityGuideModal, setShowCommunityGuideModal] = useState(false);
  const [usersList, setUsersList] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [newUserUsername, setNewUserUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const GRANULAR_PERMISSIONS = {
    addArtist: true,
    addAlbum: true,
    changeMonitoring: false,
    deleteArtist: false,
    deleteAlbum: false,
  };
  const [newUserPermissions, setNewUserPermissions] = useState({
    ...GRANULAR_PERMISSIONS,
  });
  const [creatingUser, setCreatingUser] = useState(false);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [editPassword, setEditPassword] = useState("");
  const [editCurrentPassword, setEditCurrentPassword] = useState("");
  const [editPermissions, setEditPermissions] = useState({
    ...GRANULAR_PERMISSIONS,
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [changePwCurrent, setChangePwCurrent] = useState("");
  const [changePwNew, setChangePwNew] = useState("");
  const [changePwConfirm, setChangePwConfirm] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [deleteUserTarget, setDeleteUserTarget] = useState(null);
  const [deletingUser, setDeletingUser] = useState(false);
  const location = useLocation();
  const navigateBase = useNavigate();
  const previousLocationRef = useRef("/settings");
  const hasUnsavedChangesRef = useRef(false);
  const comparisonEnabledRef = useRef(false);

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  const fetchSettings = useCallback(async () => {
    comparisonEnabledRef.current = false;
    try {
      const [healthData, savedSettings] = await Promise.all([
        checkHealth(),
        getAppSettings(),
      ]);
      setHealth(healthData);

      const lidarr = savedSettings.integrations?.lidarr || {};
      const updatedSettings = {
        ...savedSettings,
        releaseTypes: savedSettings.releaseTypes || allReleaseTypes,
        quality: savedSettings.quality || "standard",
        integrations: {
          lidarr: {
            url: "",
            apiKey: "",
            searchOnAdd: false,
            ...lidarr,
            qualityProfileId:
              lidarr.qualityProfileId != null
                ? parseInt(lidarr.qualityProfileId, 10)
                : null,
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
          general: {
            authUser: "",
            authPassword: "",
            ...(savedSettings.integrations?.general || {}),
          },
          gotify: {
            url: "",
            token: "",
            notifyDiscoveryUpdated: false,
            notifyWeeklyFlowDone: false,
            ...(savedSettings.integrations?.gotify || {}),
          },
        },
      };
      setSettings(updatedSettings);
      setOriginalSettings(JSON.parse(JSON.stringify(updatedSettings)));
      setHasUnsavedChanges(false);
      setTimeout(() => {
        comparisonEnabledRef.current = true;
      }, 600);

      if (
        updatedSettings.integrations?.lidarr?.url &&
        updatedSettings.integrations?.lidarr?.apiKey
      ) {
        setLoadingLidarrProfiles(true);
        try {
          const profiles = await getLidarrProfiles(
            updatedSettings.integrations.lidarr.url,
            updatedSettings.integrations.lidarr.apiKey
          );
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
    previousLocationRef.current = location.pathname;
  }, [fetchSettings, location.pathname]);
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
    if (comparisonEnabledRef.current) {
      setHasUnsavedChanges(checkForChanges(newSettings));
    }
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
  };

  const handleRefreshDiscovery = async () => {
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
          (err.response?.data?.message || err.message)
      );
    } finally {
      setRefreshingDiscovery(false);
    }
  };

  const handleClearCache = async () => {
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
        "Failed to clear cache: " + (err.response?.data?.message || err.message)
      );
    } finally {
      setClearingCache(false);
    }
  };

  const [activeTab, setActiveTab] = useState("integrations");
  const [hoveredTabIndex, setHoveredTabIndex] = useState(null);
  const tabsRef = useRef(null);
  const activeBubbleRef = useRef(null);
  const hoverBubbleRef = useRef(null);
  const tabRefs = useRef({});

  const tabs = useMemo(() => {
    const all = [
      { id: "integrations", label: "Integrations", icon: Server },
      { id: "metadata", label: "Metadata", icon: TrendingUp },
      { id: "notifications", label: "Notifications", icon: Bell },
      { id: "users", label: "Users", icon: Users },
    ];
    if (authUser?.role !== "admin") {
      return all.filter((t) => t.id === "users");
    }
    return all;
  }, [authUser?.role]);

  useEffect(() => {
    const validIds = tabs.map((t) => t.id);
    if (!validIds.includes(activeTab)) {
      setActiveTab(validIds[0] || "users");
    }
  }, [tabs, activeTab]);

  useEffect(() => {
    if (activeTab === "metadata") {
      checkHealth()
        .then(setHealth)
        .catch(() => {});
    }
    if (activeTab === "users" && authUser?.role === "admin") {
      setLoadingUsers(true);
      getUsers()
        .then(setUsersList)
        .catch(() => setUsersList([]))
        .finally(() => setLoadingUsers(false));
    }
  }, [activeTab, authUser?.role]);

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
              <FlipSaveButton
                saving={saving}
                disabled={!hasUnsavedChanges}
                onClick={handleSaveSettings}
              />
            </div>
            <form
              onSubmit={handleSaveSettings}
              className="space-y-6"
              autoComplete="off"
            >
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
                    Lidarr
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
                      autoComplete="off"
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
                        autoComplete="off"
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
                              apiKey
                            );
                            if (result.success) {
                              showSuccess(
                                `Lidarr connection successful! (${
                                  result.instanceName || "Lidarr"
                                })`
                              );
                              setLoadingLidarrProfiles(true);
                              try {
                                const profiles = await getLidarrProfiles(
                                  url,
                                  apiKey
                                );
                                setLidarrProfiles(profiles);
                                if (profiles.length > 0) {
                                  showInfo(
                                    `Loaded ${profiles.length} quality profile(s)`
                                  );
                                }
                              } catch {
                              } finally {
                                setLoadingLidarrProfiles(false);
                              }
                            } else {
                              showError(
                                `Connection failed: ${
                                  result.message || result.error
                                }${result.details ? `\n${result.details}` : ""}`
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
                                settings.integrations.lidarr.qualityProfileId
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
                              "Please enter Lidarr URL and API key first"
                            );
                            return;
                          }

                          setLoadingLidarrProfiles(true);
                          try {
                            const profiles = await getLidarrProfiles(
                              url,
                              apiKey
                            );
                            setLidarrProfiles(profiles);
                            if (profiles.length > 0) {
                              showSuccess(
                                `Loaded ${profiles.length} quality profile(s)`
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
                          className={`w-4 h-4 ${
                            loadingLidarrProfiles ? "animate-spin" : ""
                          }`}
                        />
                      </button>
                    </div>
                    <p className="mt-1 text-xs" style={{ color: "#c1c1c3" }}>
                      Quality profile used when adding artists and albums to
                      Lidarr.
                    </p>
                  </div>
                  <div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={
                          settings.integrations?.lidarr?.searchOnAdd || false
                        }
                        onChange={(e) =>
                          updateSettings({
                            ...settings,
                            integrations: {
                              ...settings.integrations,
                              lidarr: {
                                ...(settings.integrations?.lidarr || {}),
                                searchOnAdd: e.target.checked,
                              },
                            },
                          })
                        }
                      />
                      <span
                        className="text-sm font-medium"
                        style={{ color: "#fff" }}
                      >
                        Search on Add
                      </span>
                    </label>
                    <p
                      className="mt-1 text-xs ml-6"
                      style={{ color: "#c1c1c3" }}
                    >
                      Automatically search for albums when adding them to
                      library
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
                            "Please configure Lidarr URL and API key first"
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
                    Subsonic / Navidrome
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
                    autoComplete="off"
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
                      autoComplete="off"
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
                      autoComplete="off"
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
                <p className="mt-3 text-xs" style={{ color: "#8a8a8e" }}>
                  When using Weekly Flow: set Navidrome&apos;s{" "}
                  <code>Scanner.PurgeMissing</code> to <code>always</code> or{" "}
                  <code>full</code> (e.g.{" "}
                  <code>ND_SCANNER_PURGEMISSING=always</code>) so turning off a
                  flow removes those tracks from the library.
                </p>
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
              <FlipSaveButton
                saving={saving}
                disabled={!hasUnsavedChanges}
                onClick={handleSaveSettings}
              />
            </div>
            <form
              onSubmit={handleSaveSettings}
              className="space-y-6"
              autoComplete="off"
            >
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
                    MusicBrainz
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
                    autoComplete="off"
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
                    Last.fm API
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
                      autoComplete="off"
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
                      autoComplete="off"
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
                  <div>
                    <label
                      className="block text-sm font-medium mb-1"
                      style={{ color: "#fff" }}
                    >
                      Discovery period
                    </label>
                    <select
                      className="input"
                      value={
                        settings.integrations?.lastfm?.discoveryPeriod ||
                        "1month"
                      }
                      onChange={(e) =>
                        updateSettings({
                          ...settings,
                          integrations: {
                            ...settings.integrations,
                            lastfm: {
                              ...(settings.integrations?.lastfm || {}),
                              discoveryPeriod: e.target.value,
                            },
                          },
                        })
                      }
                    >
                      <option value="none">None (Library only)</option>
                      <option value="7day">Last 7 days</option>
                      <option value="1month">This month</option>
                      <option value="3month">3 months</option>
                      <option value="6month">6 months</option>
                      <option value="12month">12 months</option>
                      <option value="overall">All time</option>
                    </select>
                    <p className="mt-1 text-xs" style={{ color: "#c1c1c3" }}>
                      Which Last.fm listening period to use for discovery seeds.
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
                <h3
                  className="text-lg font-medium flex items-center"
                  style={{ color: "#fff" }}
                >
                  Cache status
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-start">
                  <div className="space-y-3 min-w-0">
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt style={{ color: "#c1c1c3" }}>Last updated</dt>
                        <dd style={{ color: "#fff" }}>
                          {health?.discovery?.lastUpdated
                            ? new Date(
                                health.discovery.lastUpdated
                              ).toLocaleString()
                            : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt style={{ color: "#c1c1c3" }}>Recommendations</dt>
                        <dd style={{ color: "#fff" }}>
                          {health?.discovery?.recommendationsCount ?? "—"}
                        </dd>
                      </div>
                      <div>
                        <dt style={{ color: "#c1c1c3" }}>Global trending</dt>
                        <dd style={{ color: "#fff" }}>
                          {health?.discovery?.globalTopCount ?? "—"}
                        </dd>
                      </div>
                      <div>
                        <dt style={{ color: "#c1c1c3" }}>Cached images</dt>
                        <dd style={{ color: "#fff" }}>
                          {health?.discovery?.cachedImagesCount ?? "—"}
                        </dd>
                      </div>
                    </dl>
                    {health?.discovery?.isUpdating && (
                      <p
                        className="text-sm flex items-center gap-2"
                        style={{ color: "#c1c1c3" }}
                      >
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Updating…
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 w-full md:w-auto md:min-w-[180px]">
                    <button
                      type="button"
                      onClick={handleRefreshDiscovery}
                      disabled={refreshingDiscovery}
                      className="btn btn-primary flex items-center justify-center gap-2 py-2.5 px-4 font-medium shadow-md hover:opacity-90"
                    >
                      <RefreshCw
                        className={`w-4 h-4 flex-shrink-0 ${
                          refreshingDiscovery ? "animate-spin" : ""
                        }`}
                      />
                      {refreshingDiscovery
                        ? "Refreshing..."
                        : "Refresh Discovery"}
                    </button>
                    <button
                      type="button"
                      onClick={handleClearCache}
                      disabled={clearingCache}
                      className="btn btn-secondary flex items-center justify-center gap-2 py-2.5 px-4 font-medium shadow-md"
                    >
                      <Trash2
                        className={`w-4 h-4 flex-shrink-0 ${
                          clearingCache ? "animate-spin" : ""
                        }`}
                      />
                      {clearingCache ? "Clearing..." : "Clear Cache"}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        );

      case "notifications":
        return (
          <div className="card animate-fade-in">
            <div className="flex items-center justify-between mb-6">
              <h2
                className="text-2xl font-bold flex items-center"
                style={{ color: "#fff" }}
              >
                Notifications
              </h2>
              <FlipSaveButton
                saving={saving}
                disabled={!hasUnsavedChanges}
                onClick={handleSaveSettings}
              />
            </div>
            <form
              onSubmit={handleSaveSettings}
              className="space-y-6"
              autoComplete="off"
            >
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
                    Gotify
                  </h3>
                  {settings.integrations?.gotify?.url &&
                    settings.integrations?.gotify?.token && (
                      <span className="flex items-center text-sm text-green-400">
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Configured
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
                      placeholder="https://gotify.example.com"
                      autoComplete="off"
                      value={settings.integrations?.gotify?.url || ""}
                      onChange={(e) =>
                        updateSettings({
                          ...settings,
                          integrations: {
                            ...settings.integrations,
                            gotify: {
                              ...(settings.integrations?.gotify || {}),
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
                      Application Token
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        className="input flex-1"
                        placeholder="Gotify app token"
                        autoComplete="off"
                        value={settings.integrations?.gotify?.token || ""}
                        onChange={(e) =>
                          updateSettings({
                            ...settings,
                            integrations: {
                              ...settings.integrations,
                              gotify: {
                                ...(settings.integrations?.gotify || {}),
                                token: e.target.value,
                              },
                            },
                          })
                        }
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          setTestingGotify(true);
                          try {
                            const url = settings.integrations?.gotify?.url;
                            const token = settings.integrations?.gotify?.token;
                            if (!url || !token) {
                              showError("Enter Gotify URL and token first");
                              return;
                            }
                            await testGotifyConnection(url, token);
                            showSuccess("Test notification sent.");
                          } catch (err) {
                            const msg =
                              err.response?.data?.message ||
                              err.response?.data?.error ||
                              err.message;
                            showError(`Gotify test failed: ${msg}`);
                          } finally {
                            setTestingGotify(false);
                          }
                        }}
                        disabled={
                          testingGotify ||
                          !settings.integrations?.gotify?.url ||
                          !settings.integrations?.gotify?.token
                        }
                        className="btn btn-secondary"
                      >
                        {testingGotify ? "Sending..." : "Test"}
                      </button>
                    </div>
                    <p className="mt-1 text-xs" style={{ color: "#c1c1c3" }}>
                      Create an application in Gotify to get a token.
                    </p>
                  </div>
                  <div
                    className="pt-4 border-t space-y-4"
                    style={{ borderColor: "#2a2a2e" }}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className="text-sm font-medium"
                        style={{ color: "#fff" }}
                      >
                        Notify when daily Discover is updated
                      </span>
                      <PillToggle
                        checked={
                          settings.integrations?.gotify
                            ?.notifyDiscoveryUpdated || false
                        }
                        onChange={(e) =>
                          updateSettings({
                            ...settings,
                            integrations: {
                              ...settings.integrations,
                              gotify: {
                                ...(settings.integrations?.gotify || {}),
                                notifyDiscoveryUpdated: e.target.checked,
                              },
                            },
                          })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span
                        className="text-sm font-medium"
                        style={{ color: "#fff" }}
                      >
                        Notify when weekly flow finishes
                      </span>
                      <PillToggle
                        checked={
                          settings.integrations?.gotify?.notifyWeeklyFlowDone ||
                          false
                        }
                        onChange={(e) =>
                          updateSettings({
                            ...settings,
                            integrations: {
                              ...settings.integrations,
                              gotify: {
                                ...(settings.integrations?.gotify || {}),
                                notifyWeeklyFlowDone: e.target.checked,
                              },
                            },
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>
        );

      case "users":
        const isSelfEdit = editUser && editUser.id === authUser?.id;
        const granularPerms = [
          { key: "addArtist", label: "Add artist" },
          { key: "addAlbum", label: "Add album" },
          { key: "changeMonitoring", label: "Change artist monitoring" },
          { key: "deleteArtist", label: "Delete artists" },
          { key: "deleteAlbum", label: "Delete albums" },
        ];
        return (
          <div className="card animate-fade-in space-y-6">
            <div className="flex items-center justify-between">
              <h2
                className="text-2xl font-bold flex items-center"
                style={{ color: "#fff" }}
              >
                Users
              </h2>
              {authUser?.role === "admin" && (
                <button
                  type="button"
                  className="btn btn-primary flex items-center gap-2"
                  onClick={() => {
                    setNewUserUsername("");
                    setNewUserPassword("");
                    setNewUserPermissions({ ...GRANULAR_PERMISSIONS });
                    setShowAddUserModal(true);
                  }}
                >
                  <UserPlus className="w-4 h-4" />
                  Add user
                </button>
              )}
            </div>

            {authUser?.role !== "admin" ? (
              <div
                className="p-6 rounded-lg space-y-5 max-w-md"
                style={{
                  backgroundColor: "#1a1a1e",
                  boxShadow: "0 0 0 1px #2a2a2e",
                }}
              >
                <h3 className="text-lg font-medium flex items-center gap-2 text-main">
                  <Lock className="w-5 h-5 text-[#707e61]" />
                  Change my password
                </h3>
                <form
                  className="space-y-4"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (changePwNew !== changePwConfirm) {
                      showError("New passwords do not match");
                      return;
                    }
                    setChangingPassword(true);
                    try {
                      await changeMyPassword(changePwCurrent, changePwNew);
                      showSuccess("Password changed");
                      setChangePwCurrent("");
                      setChangePwNew("");
                      setChangePwConfirm("");
                    } catch (err) {
                      showError(
                        err.response?.data?.error ||
                          err.message ||
                          "Failed to change password"
                      );
                    } finally {
                      setChangingPassword(false);
                    }
                  }}
                >
                  <div className="space-y-1">
                    <label htmlFor="change-pw-current" className="label">
                      Current password
                    </label>
                    <input
                      id="change-pw-current"
                      type="password"
                      className="input w-full"
                      placeholder="Current password"
                      autoComplete="current-password"
                      value={changePwCurrent}
                      onChange={(e) => setChangePwCurrent(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="change-pw-new" className="label">
                      New password
                    </label>
                    <input
                      id="change-pw-new"
                      type="password"
                      className="input w-full"
                      placeholder="New password"
                      autoComplete="new-password"
                      value={changePwNew}
                      onChange={(e) => setChangePwNew(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="change-pw-confirm" className="label">
                      Confirm new password
                    </label>
                    <input
                      id="change-pw-confirm"
                      type="password"
                      className="input w-full"
                      placeholder="Confirm new password"
                      autoComplete="new-password"
                      value={changePwConfirm}
                      onChange={(e) => setChangePwConfirm(e.target.value)}
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={
                      changingPassword ||
                      !changePwCurrent ||
                      !changePwNew ||
                      changePwNew !== changePwConfirm
                    }
                  >
                    {changingPassword ? "Changing…" : "Change password"}
                  </button>
                </form>
              </div>
            ) : (
              <>
                <div className="rounded-lg overflow-hidden">
                  {loadingUsers ? (
                    <div className="p-8 text-center">
                      <p className="text-sub">Loading…</p>
                    </div>
                  ) : (
                    <ul>
                      {usersList.map((u, i) => (
                        <li
                          key={u.id}
                          className={`flex items-center justify-between gap-4 px-5 py-4 ${
                            i % 2 === 1 ? "bg-[#1a1a1e]" : ""
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="font-medium text-main truncate">
                              {u.username}
                            </span>
                            <span
                              className={`badge shrink-0 ${
                                u.role === "admin"
                                  ? "badge-primary"
                                  : "badge-neutral"
                              }`}
                              style={{
                                backgroundColor:
                                  u.role === "admin" ? "#2a2a2e" : undefined,
                                color: "#c1c1c3",
                              }}
                            >
                              {u.role}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost gap-1.5"
                              onClick={() => {
                                setEditUser(u);
                                setEditPassword("");
                                setEditCurrentPassword("");
                                setEditPermissions(
                                  u.permissions
                                    ? {
                                        ...GRANULAR_PERMISSIONS,
                                        ...u.permissions,
                                      }
                                    : { ...GRANULAR_PERMISSIONS }
                                );
                              }}
                            >
                              <Pencil className="w-4 h-4" />
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                              style={{
                                backgroundColor: "transparent",
                                color: "#ef4444",
                              }}
                              disabled={u.role === "admin"}
                              onClick={() =>
                                u.role !== "admin" && setDeleteUserTarget(u)
                              }
                            >
                              <Trash2 className="w-4 h-4" />
                              Delete
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {deleteUserTarget && (
                  <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
                    onClick={() => !deletingUser && setDeleteUserTarget(null)}
                  >
                    <div
                      className="card max-w-md w-full shadow-xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xl font-bold text-main">
                          Delete user
                        </h3>
                        <button
                          type="button"
                          className="p-2 rounded transition-colors hover:bg-[#2a2a2e] text-sub disabled:opacity-50"
                          onClick={() =>
                            !deletingUser && setDeleteUserTarget(null)
                          }
                          aria-label="Close"
                          disabled={deletingUser}
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                      <p className="text-sub mb-6">
                        Are you sure you want to delete{" "}
                        <span className="font-medium text-main">
                          {deleteUserTarget.username}
                        </span>
                        ? This cannot be undone.
                      </p>
                      <div
                        className="flex gap-3 justify-end pt-4"
                        style={{ boxShadow: "inset 0 1px 0 #2a2a2e" }}
                      >
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() =>
                            !deletingUser && setDeleteUserTarget(null)
                          }
                          disabled={deletingUser}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger"
                          disabled={deletingUser}
                          onClick={async () => {
                            setDeletingUser(true);
                            try {
                              await deleteUser(deleteUserTarget.id);
                              showSuccess("User deleted");
                              setDeleteUserTarget(null);
                              setUsersList(await getUsers());
                            } catch (err) {
                              showError(
                                err.response?.data?.error || "Failed to delete"
                              );
                            } finally {
                              setDeletingUser(false);
                            }
                          }}
                        >
                          {deletingUser ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {showAddUserModal && (
                  <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
                    onClick={() => setShowAddUserModal(false)}
                  >
                    <div
                      className="card max-w-md w-full max-h-[90vh] overflow-y-auto shadow-xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-xl font-bold text-main">
                          Add user
                        </h3>
                        <button
                          type="button"
                          className="p-2 rounded transition-colors hover:bg-[#2a2a2e] text-sub"
                          onClick={() => setShowAddUserModal(false)}
                          aria-label="Close"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                      <form
                        className="space-y-6"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (!newUserUsername.trim() || !newUserPassword) {
                            showError("Username and password required");
                            return;
                          }
                          setCreatingUser(true);
                          try {
                            await createUser(
                              newUserUsername.trim(),
                              newUserPassword,
                              "user",
                              newUserPermissions
                            );
                            showSuccess("User created");
                            setShowAddUserModal(false);
                            setNewUserUsername("");
                            setNewUserPassword("");
                            setNewUserPermissions({ ...GRANULAR_PERMISSIONS });
                            setUsersList(await getUsers());
                          } catch (err) {
                            showError(
                              err.response?.data?.error ||
                                err.message ||
                                "Failed to create user"
                            );
                          } finally {
                            setCreatingUser(false);
                          }
                        }}
                      >
                        <div className="space-y-4">
                          <label className="label text-sub font-normal text-xs uppercase tracking-wider">
                            Account
                          </label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1">
                              <label
                                htmlFor="add-user-username"
                                className="label text-sm normal-case tracking-normal"
                              >
                                Username
                              </label>
                              <input
                                id="add-user-username"
                                type="text"
                                className="input"
                                placeholder="Username"
                                autoComplete="off"
                                value={newUserUsername}
                                onChange={(e) =>
                                  setNewUserUsername(e.target.value)
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <label
                                htmlFor="add-user-password"
                                className="label text-sm normal-case tracking-normal"
                              >
                                Password
                              </label>
                              <input
                                id="add-user-password"
                                type="password"
                                className="input"
                                placeholder="Password"
                                autoComplete="new-password"
                                value={newUserPassword}
                                onChange={(e) =>
                                  setNewUserPassword(e.target.value)
                                }
                              />
                            </div>
                          </div>
                        </div>
                        <div className="space-y-3">
                          <label className="label text-sub font-normal text-xs uppercase tracking-wider">
                            Permissions
                          </label>
                          <div
                            className="p-4 rounded-lg space-y-3"
                            style={{
                              backgroundColor: "#1a1a1e",
                              boxShadow: "0 0 0 1px #2a2a2e",
                            }}
                          >
                            {granularPerms.map(({ key, label }) => (
                              <label
                                key={key}
                                className="flex items-center gap-3 cursor-pointer text-sub hover:text-main transition-colors"
                              >
                                <input
                                  type="checkbox"
                                  className="rounded border-gray-600 text-[#707e61] focus:ring-[#707e61]"
                                  checked={!!newUserPermissions[key]}
                                  onChange={(e) =>
                                    setNewUserPermissions((p) => ({
                                      ...p,
                                      [key]: e.target.checked,
                                    }))
                                  }
                                />
                                <span className="text-sm">{label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <div
                          className="flex gap-3 justify-end pt-4 mt-4"
                          style={{ boxShadow: "inset 0 1px 0 #2a2a2e" }}
                        >
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => setShowAddUserModal(false)}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={creatingUser}
                          >
                            {creatingUser ? "Creating…" : "Create user"}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}

                {editUser && (
                  <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
                    onClick={() => setEditUser(null)}
                  >
                    <div
                      className="card max-w-md w-full max-h-[90vh] overflow-y-auto shadow-xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-xl font-bold text-main">
                          Edit {editUser.username}
                        </h3>
                        <button
                          type="button"
                          className="p-2 rounded transition-colors hover:bg-[#2a2a2e] text-sub"
                          onClick={() => setEditUser(null)}
                          aria-label="Close"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                      <form
                        className="space-y-6"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (isSelfEdit) {
                            if (!editPassword) {
                              setEditUser(null);
                              return;
                            }
                            if (!editCurrentPassword) {
                              showError("Current password required");
                              return;
                            }
                            setSavingEdit(true);
                            try {
                              await updateUser(editUser.id, {
                                currentPassword: editCurrentPassword,
                                password: editPassword,
                              });
                              showSuccess("Password changed");
                              setEditUser(null);
                            } catch (err) {
                              showError(
                                err.response?.data?.error ||
                                  err.message ||
                                  "Failed to update"
                              );
                            } finally {
                              setSavingEdit(false);
                            }
                            return;
                          }
                          setSavingEdit(true);
                          try {
                            await updateUser(editUser.id, {
                              ...(editPassword
                                ? { password: editPassword }
                                : {}),
                              permissions: editPermissions,
                            });
                            showSuccess("User updated");
                            setEditUser(null);
                            setUsersList(await getUsers());
                          } catch (err) {
                            showError(
                              err.response?.data?.error ||
                                err.message ||
                                "Failed to update"
                            );
                          } finally {
                            setSavingEdit(false);
                          }
                        }}
                      >
                        <div className="space-y-4">
                          <label className="label text-sub font-normal text-xs uppercase tracking-wider">
                            {isSelfEdit
                              ? "Change password"
                              : "Password (optional)"}
                          </label>
                          {isSelfEdit ? (
                            <div className="space-y-3">
                              <div className="space-y-1">
                                <label
                                  htmlFor="edit-current-password"
                                  className="label text-sm normal-case tracking-normal"
                                >
                                  Current password
                                </label>
                                <input
                                  id="edit-current-password"
                                  type="password"
                                  className="input w-full"
                                  placeholder="Current password"
                                  autoComplete="current-password"
                                  value={editCurrentPassword}
                                  onChange={(e) =>
                                    setEditCurrentPassword(e.target.value)
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <label
                                  htmlFor="edit-new-password"
                                  className="label text-sm normal-case tracking-normal"
                                >
                                  New password
                                </label>
                                <input
                                  id="edit-new-password"
                                  type="password"
                                  className="input w-full"
                                  placeholder="New password"
                                  autoComplete="new-password"
                                  value={editPassword}
                                  onChange={(e) =>
                                    setEditPassword(e.target.value)
                                  }
                                />
                              </div>
                            </div>
                          ) : (
                            <input
                              type="password"
                              className="input w-full"
                              placeholder="Leave blank to keep current password"
                              autoComplete="new-password"
                              value={editPassword}
                              onChange={(e) => setEditPassword(e.target.value)}
                            />
                          )}
                        </div>
                        {!isSelfEdit && (
                          <div className="space-y-3">
                            <label className="label text-sub font-normal text-xs uppercase tracking-wider">
                              Permissions
                            </label>
                            <div
                              className="p-4 rounded-lg space-y-3"
                              style={{
                                backgroundColor: "#1a1a1e",
                                boxShadow: "0 0 0 1px #2a2a2e",
                              }}
                            >
                              {granularPerms.map(({ key, label }) => (
                                <label
                                  key={key}
                                  className="flex items-center gap-3 cursor-pointer text-sub hover:text-main transition-colors"
                                >
                                  <input
                                    type="checkbox"
                                    className="rounded border-gray-600 text-[#707e61] focus:ring-[#707e61]"
                                    checked={!!editPermissions[key]}
                                    onChange={(e) =>
                                      setEditPermissions((p) => ({
                                        ...p,
                                        [key]: e.target.checked,
                                      }))
                                    }
                                  />
                                  <span className="text-sm">{label}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                        <div
                          className="flex gap-3 justify-end pt-4 mt-4"
                          style={{ boxShadow: "inset 0 1px 0 #2a2a2e" }}
                        >
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => setEditUser(null)}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={savingEdit}
                          >
                            {savingEdit ? "Saving…" : "Save"}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </>
            )}
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
                Apply Davo&apos;s Recommended Settings
              </h3>
              <p className="mb-4" style={{ color: "#c1c1c3" }}>
                This will apply Davo&apos;s Community Lidarr Guide settings to
                your Lidarr instance:
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
                    Create <strong>&quot;Aurral - HQ&quot;</strong> quality
                    profile (FLAC + MP3-320)
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
        <div className="mb-6">
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
            <div
              ref={activeBubbleRef}
              className="absolute transition-all duration-300 ease-out z-10 opacity-0"
              style={{ backgroundColor: "#211f27" }}
            />

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
