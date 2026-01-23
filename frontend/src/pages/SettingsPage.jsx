import { useState, useEffect, useRef } from "react";
import {
  Settings,
  Database,
  Info,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Image,
  Trash2,
  TrendingUp,
  Save,
  Music,
  Link,
  Shield,
  Server,
  Activity,
  ExternalLink,
} from "lucide-react";
import api, {
  checkHealth,
  getAppSettings,
  updateAppSettings,
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
      musicbrainz: { email: "" },
      general: { authUser: "", authPassword: "" },
    },
  });

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
        releaseTypes:
          savedSettings.releaseTypes ||
          allReleaseTypes,
        quality: savedSettings.quality || "standard",
      };
      setSettings(updatedSettings);
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);
  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateAppSettings(settings);

      if (activeTab === "integrations") {
        showSuccess("Settings saved. Refreshing...");
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        showSuccess("Default settings saved successfully!");
        setSaving(false);
      }
    } catch (err) {
      showError("Failed to save settings: " + err.message);
      setSaving(false);
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

  const [activeTab, setActiveTab] = useState("general");
  const [hoveredTabIndex, setHoveredTabIndex] = useState(null);
  const tabsRef = useRef(null);
  const activeBubbleRef = useRef(null);
  const hoverBubbleRef = useRef(null);
  const tabRefs = useRef({});

  const tabs = [
    { id: "general", label: "General", icon: Database },
    { id: "integrations", label: "Integrations", icon: Link },
    { id: "system", label: "System", icon: Activity },
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
      case "general":
        return (
          <div className="card animate-fade-in">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6 flex items-center">
              <Database className="w-6 h-6 mr-2 text-primary-500" />
              Default Artist Options
            </h2>
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Music Library Path
                </label>
                <div className="input bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 cursor-not-allowed">
                  /data
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Music library is stored at{" "}
                  <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">
                    /data
                  </code>
                  . In Docker, remap this path using volume mounts:{" "}
                  <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">
                    /your/path:/data
                  </code>
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Quality Preset
                </label>
                <select
                  className="input"
                  value={settings.quality || "standard"}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      quality: e.target.value,
                    })
                  }
                >
                  <option value="low">Low (MP3 192-320kbps)</option>
                  <option value="standard">
                    Standard (MP3 320kbps, FLAC) - Recommended
                  </option>
                  <option value="max">Max (FLAC only)</option>
                </select>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Standard uses optimization settings: Preferred Groups (DeVOiD,
                  PERFECT, ENRiCH), prefers CD/WEB, avoids Vinyl
                </p>
              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={saving}
                  className="btn btn-primary w-full flex items-center justify-center"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {saving ? "Saving..." : "Save Default Settings"}
                </button>
              </div>
            </form>
          </div>
        );

      case "integrations":
        return (
          <div className="card animate-fade-in">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6 flex items-center">
              <Link className="w-6 h-6 mr-2 text-primary-500" />
              Integrations & Security
            </h2>
            <form onSubmit={handleSaveSettings} className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center">
                  <Server className="w-5 h-5 mr-2" /> slskd
                </h3>
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Server URL
                    </label>
                    <input
                      type="url"
                      className="input"
                      placeholder="http://localhost:5000"
                      value={settings.integrations?.slskd?.url || ""}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          integrations: {
                            ...settings.integrations,
                            slskd: {
                              ...(settings.integrations?.slskd || {}),
                              url: e.target.value,
                            },
                          },
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      API Key
                    </label>
                    <input
                      type="password"
                      className="input"
                      placeholder="Enter slskd API Key"
                      value={settings.integrations?.slskd?.apiKey || ""}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          integrations: {
                            ...settings.integrations,
                            slskd: {
                              ...(settings.integrations?.slskd || {}),
                              apiKey: e.target.value,
                            },
                          },
                        })
                      }
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Found in Settings &rarr; General.
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 pt-6 space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center">
                  <Music className="w-5 h-5 mr-2" /> Subsonic / Navidrome
                </h3>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Server URL
                  </label>
                  <input
                    type="url"
                    className="input"
                    placeholder="https://music.example.com"
                    value={settings.integrations?.navidrome?.url || ""}
                    onChange={(e) =>
                      setSettings({
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
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Username
                    </label>
                    <input
                      type="text"
                      className="input"
                      value={settings.integrations?.navidrome?.username || ""}
                      onChange={(e) =>
                        setSettings({
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
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Password
                    </label>
                    <input
                      type="password"
                      className="input"
                      value={settings.integrations?.navidrome?.password || ""}
                      onChange={(e) =>
                        setSettings({
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

              <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center mb-4">
                  <TrendingUp className="w-5 h-5 mr-2" /> MusicBrainz
                </h3>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Contact Email (Required)
                  </label>
                  <input
                    type="email"
                    className="input"
                    placeholder="contact@example.com"
                    value={settings.integrations?.musicbrainz?.email || ""}
                    onChange={(e) =>
                      setSettings({
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
                  <p className="mt-1 text-xs text-gray-500">
                    Required by MusicBrainz API to identify the application.
                  </p>
                </div>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center mb-4">
                  <TrendingUp className="w-5 h-5 mr-2" /> Last.fm API
                </h3>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    API Key
                  </label>
                  <input
                    type="password"
                    className="input"
                    placeholder="Last.fm API Key"
                    value={settings.integrations?.lastfm?.apiKey || ""}
                    onChange={(e) =>
                      setSettings({
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
                  <p className="mt-1 text-xs text-gray-500">
                    Required for high-quality images, better recommendations,
                    and weekly flow.
                  </p>
                </div>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center mb-4">
                  <Shield className="w-5 h-5 mr-2" /> Authentication
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      App Username
                    </label>
                    <input
                      type="text"
                      className="input"
                      placeholder="admin"
                      value={settings.integrations?.general?.authUser || ""}
                      onChange={(e) =>
                        setSettings({
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
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      App Password
                    </label>
                    <input
                      type="password"
                      className="input"
                      placeholder="Leave empty to disable auth"
                      value={settings.integrations?.general?.authPassword || ""}
                      onChange={(e) =>
                        setSettings({
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
              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={saving}
                  className="btn btn-primary w-full flex items-center justify-center"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {saving ? "Saving..." : "Save Integration Settings"}
                </button>
              </div>
            </form>
          </div>
        );

      case "system":
        return (
          <div className="space-y-8 animate-fade-in">
            <div className="card">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center">
                <Info className="w-6 h-6 mr-2" />
                System Status
              </h2>
              {loading ? (
                <div className="text-gray-500 dark:text-gray-400">
                  Loading...
                </div>
              ) : health ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      Backend API
                    </span>
                    <div className="flex items-center">
                      {health.status === "ok" ? (
                        <>
                          <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                          <span className="text-green-700 dark:text-green-400 font-medium">
                            Connected
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                          <span className="text-red-700 dark:text-red-400 font-medium">
                            Disconnected
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      slskd Connection
                    </span>
                    <div className="flex items-center">
                      {health?.slskdConfigured ? (
                        <>
                          <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                          <span className="text-green-700 dark:text-green-400 font-medium">
                            Connected
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-5 h-5 text-yellow-500 mr-2" />
                          <span className="text-yellow-700 dark:text-yellow-400 font-medium">
                            Not Configured
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      MusicBrainz API
                    </span>
                    <div className="flex items-center">
                      {health.musicbrainzConfigured ? (
                        <>
                          <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                          <span className="text-green-700 dark:text-green-400 font-medium">
                            Configured
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                          <span className="text-red-700 dark:text-red-400 font-medium">
                            Missing Email
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      Last.fm API
                    </span>
                    <div className="flex items-center">
                      {health.lastfmConfigured ? (
                        <>
                          <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                          <span className="text-green-700 dark:text-green-400 font-medium">
                            Configured
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-5 h-5 text-gray-400 mr-2" />
                          <span className="text-gray-500 dark:text-gray-400 font-medium">
                            Optional
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {health.timestamp && (
                    <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        Last Checked
                      </span>
                      <span className="text-gray-600 dark:text-gray-400">
                        {new Date(health.timestamp).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-red-600 dark:text-red-400">
                  Failed to load health status
                </div>
              )}
            </div>

            {health?.discovery && (
              <div className="card">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                    Discovery Engine
                  </h3>
                  <div className="flex gap-2">
                    <button
                      onClick={handleClearCache}
                      disabled={clearingCache || health.discovery.isUpdating}
                      className="btn btn-secondary btn-sm text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-2" />
                      Clear Cache
                    </button>
                    <button
                      onClick={handleRefreshDiscovery}
                      disabled={
                        refreshingDiscovery || health.discovery.isUpdating
                      }
                      className="btn btn-secondary btn-sm"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 mr-2 ${refreshingDiscovery || health.discovery.isUpdating ? "animate-spin" : ""}`}
                      />
                      {health.discovery.isUpdating ? "Updating..." : "Refresh"}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <div className="flex items-center text-gray-500 dark:text-gray-400 text-xs mb-1">
                      <Sparkles className="w-3 h-3 mr-1" /> Recommendations
                    </div>
                    <div className="text-xl font-bold">
                      {health.discovery.recommendationsCount}
                    </div>
                  </div>

                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <div className="flex items-center text-gray-500 dark:text-gray-400 text-xs mb-1">
                      <TrendingUp className="w-3 h-3 mr-1" /> Global Top
                    </div>
                    <div className="text-xl font-bold">
                      {health.discovery.globalTopCount}
                    </div>
                  </div>

                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <div className="flex items-center text-gray-500 dark:text-gray-400 text-xs mb-1">
                      <Image className="w-3 h-3 mr-1" /> Cached Images
                    </div>
                    <div className="text-xl font-bold">
                      {health.discovery.cachedImagesCount}
                    </div>
                  </div>
                </div>

                {health.discovery.lastUpdated && (
                  <div className="text-xs text-gray-400 text-right">
                    Cache last built:{" "}
                    {new Date(health.discovery.lastUpdated).toLocaleString()}
                  </div>
                )}
              </div>
            )}

            <div className="card overflow-hidden">
              <div className="flex items-center space-x-4 mb-6">
                <img
                  src="/arralogo.svg"
                  alt="Aurral Logo"
                  className="w-12 h-12"
                />
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    About Aurral
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Version 1.0.0
                  </p>
                </div>
              </div>
              <div className="space-y-4 text-gray-700 dark:text-gray-300">
                <p>
                  Aurral is a streamlined artist request manager designed to
                  simplify expanding your music library.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                      Data Sources
                    </h4>
                    <ul className="text-sm space-y-1">
                      <li>MusicBrainz (Artist Discovery)</li>
                      <li>Last.fm (Metadata & Images)</li>
                      <li>In-house Library Management</li>
                      <li>slskd (Download Client)</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                      Stack
                    </h4>
                    <p className="text-sm">
                      Built with React, Tailwind CSS, and Node.js.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="animate-fade-in max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Settings
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Configure application preferences and integrations
        </p>
      </div>

      <div className="mb-8 flex justify-center">
        <div
          ref={tabsRef}
          className="relative bg-gray-100 dark:bg-gray-900 p-1.5 inline-flex"
        >
          {/* Outer border gradient effect */}
          <div className="absolute -inset-0.5 bg-gray-200 dark:bg-gray-700 -z-10" />

          {/* Active bubble */}
          <div
            ref={activeBubbleRef}
            className="absolute bg-gray-100 dark:bg-gray-400 transition-all duration-300 ease-out z-10 opacity-0"
          />

          {/* Hover bubble - covers entire nav by default, shrinks to hovered tab */}
          <div
            ref={hoverBubbleRef}
            className="absolute bg-gray-200 dark:bg-gray-800 transition-all duration-200 ease-out z-0"
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
                  className={`relative z-20 flex items-center space-x-2 px-4 py-2.5 rounded-lg font-medium transition-all duration-200 text-sm ${
                    isActive
                      ? "text-gray-800 dark:text-gray-800"
                      : "text-gray-400 dark:text-gray-500 hover:text-gray-300 dark:hover:text-gray-400"
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 transition-transform flex-shrink-0 ${
                      isActive
                        ? "text-gray-800 dark:text-gray-800"
                        : "text-gray-400 dark:text-gray-500"
                    }`}
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
  );
}

export default SettingsPage;
