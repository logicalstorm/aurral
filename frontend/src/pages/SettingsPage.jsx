import { useState, useEffect } from "react";
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
  Zap,
  ExternalLink,
} from "lucide-react";
import api, {
  checkHealth,
  getLidarrRootFolders,
  getLidarrQualityProfiles,
  getLidarrMetadataProfiles,
  getAppSettings,
  updateAppSettings,
  applyLidarrOptimizations,
} from "../utils/api";
import { useToast } from "../contexts/ToastContext";

function SettingsPage() {
  const [health, setHealth] = useState(null);
  const [rootFolders, setRootFolders] = useState([]);
  const [qualityProfiles, setQualityProfiles] = useState([]);
  const [metadataProfiles, setMetadataProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshingDiscovery, setRefreshingDiscovery] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const allReleaseTypes = ["Album", "EP", "Single", "Broadcast", "Soundtrack", "Spokenword", "Remix", "Live", "Compilation", "Demo"];
  
  const { showSuccess, showError, showInfo } = useToast();

  const [settings, setSettings] = useState({
    rootFolderPath: "",
    qualityProfileId: "",
    metadataProfileId: "",
    monitored: true,
    searchForMissingAlbums: false,
    albumFolders: true,
    metadataProfileReleaseTypes: allReleaseTypes,
    integrations: {
      navidrome: { url: "", username: "", password: "" },
      lastfm: { username: "" },
      lidarr: { url: "", apiKey: "" },
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
      
      // Ensure we have release types even if DB is older
      const updatedSettings = {
          ...savedSettings,
          metadataProfileReleaseTypes: savedSettings.metadataProfileReleaseTypes || allReleaseTypes
      };
      setSettings(updatedSettings);

      if (healthData.lidarrConfigured) {
        const [folders, quality, metadata] = await Promise.all([
          getLidarrRootFolders(),
          getLidarrQualityProfiles(),
          getLidarrMetadataProfiles(),
        ]);
        setRootFolders(folders);
        setQualityProfiles(quality);
        setMetadataProfiles(metadata);
      }
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
      
      if (activeTab === 'integrations') {
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

  const handleReleaseTypeToggle = (type) => {
    const current = settings.metadataProfileReleaseTypes || [];
    const updated = current.includes(type)
      ? current.filter(t => t !== type)
      : [...current, type];
    setSettings({ ...settings, metadataProfileReleaseTypes: updated });
  };

  const handleOptimizeLidarr = async () => {
    if (
      !window.confirm(
        "This will configure Lidarr with the Community Guide settings:\n\n1. Create/Update 'Aurral - HQ' Profile\n2. Add 5 Custom Formats & Scoring\n3. Update 'Aurral - Standard' Metadata Profile (with selected types)\n4. Apply Recommended Naming Standard\n\nContinue?",
      )
    )
      return;

    setOptimizing(true);
    try {
      // First save the current selection to app settings
      await updateAppSettings(settings);

      const result = await applyLidarrOptimizations({
        enableMetadataProfile: true,
        releaseTypes: settings.metadataProfileReleaseTypes
      });
      showSuccess(result.message);
      await fetchSettings();
    } catch (err) {
      showError(
        "Failed to apply optimizations: " +
          (err.response?.data?.message || err.message),
      );
    } finally {
      setOptimizing(false);
    }
  };

  const [activeTab, setActiveTab] = useState('general');

  const tabs = [
    { id: 'general', label: 'General', icon: Database },
    { id: 'integrations', label: 'Integrations', icon: Link },
    { id: 'optimization', label: 'Optimization', icon: Zap },
    { id: 'system', label: 'System', icon: Activity },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return (
          <div className="card animate-fade-in">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6 flex items-center">
              <Database className="w-6 h-6 mr-2 text-primary-500" />
              Default Artist Options
            </h2>
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Root Folder
                </label>
                <select
                  className="input"
                  value={settings.rootFolderPath || ""}
                  onChange={(e) =>
                    setSettings({ ...settings, rootFolderPath: e.target.value })
                  }
                >
                  <option value="">Select a default folder...</option>
                  {rootFolders.map((f) => (
                    <option key={f.id} value={f.path}>
                      {f.path} (
                      {f.freeSpace
                        ? `${(f.freeSpace / 1024 / 1024 / 1024).toFixed(2)} GB free`
                        : "unknown"}
                      )
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Quality Profile
                  </label>
                  <select
                    className="input"
                    value={settings.qualityProfileId || ""}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        qualityProfileId: parseInt(e.target.value) || "",
                      })
                    }
                  >
                    <option value="">Select default...</option>
                    {qualityProfiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Metadata Profile
                  </label>
                  <select
                    className="input"
                    value={settings.metadataProfileId || ""}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        metadataProfileId: parseInt(e.target.value) || "",
                      })
                    }
                  >
                    <option value="">Select default...</option>
                    {metadataProfiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <label className="flex items-center space-x-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    className="form-checkbox h-5 w-5 text-primary-600 rounded border-gray-300 dark:border-gray-700 dark:bg-gray-800"
                    checked={settings.monitored}
                    onChange={(e) =>
                      setSettings({ ...settings, monitored: e.target.checked })
                    }
                  />
                  <span className="text-gray-700 dark:text-gray-300">
                    Monitor Artist
                  </span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    className="form-checkbox h-5 w-5 text-primary-600 rounded border-gray-300 dark:border-gray-700 dark:bg-gray-800"
                    checked={settings.searchForMissingAlbums}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        searchForMissingAlbums: e.target.checked,
                      })
                    }
                  />
                  <span className="text-gray-700 dark:text-gray-300">
                    Search for missing albums on add
                  </span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    className="form-checkbox h-5 w-5 text-primary-600 rounded border-gray-300 dark:border-gray-700 dark:bg-gray-800"
                    checked={settings.albumFolders}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        albumFolders: e.target.checked,
                      })
                    }
                  />
                  <span className="text-gray-700 dark:text-gray-300">
                    Create album folders
                  </span>
                </label>
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

      case 'integrations':
        return (
          <div className="card animate-fade-in">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6 flex items-center">
              <Link className="w-6 h-6 mr-2 text-primary-500" />
              Integrations & Security
            </h2>
            <form onSubmit={handleSaveSettings} className="space-y-6">
              
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center">
                  <Server className="w-5 h-5 mr-2" /> Lidarr
                </h3>
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Server URL
                    </label>
                    <input
                      type="url"
                      className="input"
                      placeholder="http://localhost:8686"
                      value={settings.integrations?.lidarr?.url || ""}
                      onChange={(e) =>
                        setSettings({
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
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      API Key
                    </label>
                    <input
                      type="password"
                      className="input"
                      placeholder="Enter Lidarr API Key"
                      value={settings.integrations?.lidarr?.apiKey || ""}
                      onChange={(e) =>
                        setSettings({
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
                    Required for high-quality images, better recommendations, and weekly flow.
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

      case 'optimization':
        return (
          <div className="space-y-6 animate-fade-in">
            <div className="card">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center">
                <Zap className="w-6 h-6 mr-2 text-yellow-500" />
                Lidarr Community Optimization
              </h2>
              
              <div className="prose dark:prose-invert max-w-none mb-6">
                <p className="text-gray-600 dark:text-gray-300">
                  This tool automatically configures your Lidarr instance with settings recommended by the 
                  <a 
                    href="https://wiki.servarr.com/lidarr/community-guide" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary-600 dark:text-primary-400 hover:underline mx-1 inline-flex items-center"
                  >
                    Servarr Community Guide <ExternalLink className="w-3 h-3 ml-0.5" />
                  </a>
                  for high-quality music libraries.
                </p>
                
                <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500 p-4 my-4">
                  <h4 className="font-bold text-blue-900 dark:text-blue-100 mb-1">Why apply these settings?</h4>
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    Lidarr's default settings are basic. These optimizations help Lidarr better identify high-quality releases (Lossless/FLAC) and ensure your files are named consistently and correctly.
                  </p>
                </div>

                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-6 mb-2">What will change?</h3>
                <ul className="list-disc pl-5 space-y-3 text-gray-600 dark:text-gray-300 text-sm">
                  <li>
                    <span className="font-medium text-gray-900 dark:text-gray-200">Quality Profile:</span> Creates or updates a <span className="font-semibold">"Aurral - HQ"</span> profile:
                    <ul className="list-disc pl-5 mt-1 text-xs space-y-1 text-gray-500 dark:text-gray-400">
                       <li>Enables <span className="font-mono">FLAC</span> and <span className="font-mono">MP3 320kbps</span></li>
                       <li>Sets Cutoff to <span className="font-mono">FLAC</span></li>
                       <li>Applies scores: Preferred Groups (+100), Lossless/WEB/CD (+1), Vinyl (-10000)</li>
                    </ul>
                  </li>
                  <li>
                    <span className="font-medium text-gray-900 dark:text-gray-200">Custom Formats:</span> Adds 5 custom formats for scoring:
                    <ul className="list-disc pl-5 mt-1 text-xs space-y-1 text-gray-500 dark:text-gray-400">
                      <li><span className="font-mono">Preferred Groups</span> (DeVOiD, PERFECT, ENRiCH)</li>
                      <li><span className="font-mono">CD</span>, <span className="font-mono">WEB</span>, <span className="font-mono">Lossless</span> (FLAC), and <span className="font-mono">Vinyl</span></li>
                    </ul>
                  </li>
                  <li>
                    <span className="font-medium text-gray-900 dark:text-gray-200">Metadata Profile:</span> Updates <span className="font-semibold">"Aurral - Standard"</span> profile to include the release types selected below.
                  </li>
                  <li>
                    <span className="font-medium text-gray-900 dark:text-gray-200">Naming Configuration:</span> Updates track and folder naming patterns to the standard convention:
                    <div className="mt-2 p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono overflow-x-auto whitespace-nowrap">
                      {`{Album Title} {(Album Disambiguation)}/{Artist Name}_{Album Title}_{track:00}_{Track Title}`}
                    </div>
                  </li>
                </ul>

                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-4">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
                    Release Types to Enable (Metadata Profile)
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                    {allReleaseTypes.map(type => (
                      <label key={type} className="flex items-center space-x-2 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={(settings.metadataProfileReleaseTypes || []).includes(type)}
                          onChange={() => handleReleaseTypeToggle(type)}
                          className="form-checkbox h-4 w-4 text-primary-600 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                        />
                        <span className="text-xs text-gray-700 dark:text-gray-300">{type}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {!health?.lidarrConfigured ? (
                 <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-500/20 rounded-lg p-4 flex items-center">
                   <AlertCircle className="w-5 h-5 text-red-500 mr-3" />
                   <span className="text-red-700 dark:text-red-300">Lidarr is not configured. Please check your integrations tab.</span>
                 </div>
              ) : health?.lidarrStatus !== "connected" ? (
                 <div className="bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-500/20 rounded-lg p-4 flex items-center">
                   <AlertCircle className="w-5 h-5 text-yellow-500 mr-3" />
                   <span className="text-yellow-700 dark:text-yellow-300">Lidarr is unreachable. Please check your connection.</span>
                 </div>
              ) : (
                <div className="border-t border-gray-200 dark:border-gray-800 pt-6">
                  <button
                    onClick={handleOptimizeLidarr}
                    disabled={optimizing}
                    className="btn btn-primary w-full sm:w-auto flex items-center justify-center"
                  >
                    {optimizing ? (
                      <>
                        <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
                        Applying Settings...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5 mr-2" />
                        Apply Recommended Settings
                      </>
                    )}
                  </button>
                  <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 text-center sm:text-left">
                    Note: This will not overwrite existing Custom Formats with different names, but may update existing ones if they match.
                  </p>
                </div>
              )}
            </div>
          </div>
        );

      case 'system':
        return (
          <div className="space-y-8 animate-fade-in">
            <div className="card">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center">
                <Info className="w-6 h-6 mr-2" />
                System Status
              </h2>
              {loading ? (
                <div className="text-gray-500 dark:text-gray-400">Loading...</div>
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
                      Lidarr Connection
                    </span>
                    <div className="flex items-center">
                      {health.lidarrConfigured && health.lidarrStatus === "connected" ? (
                        <>
                          <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                          <span className="text-green-700 dark:text-green-400 font-medium">
                            Connected
                          </span>
                        </>
                      ) : health.lidarrConfigured ? (
                         <>
                          <AlertCircle className="w-5 h-5 text-orange-500 mr-2" />
                          <span className="text-orange-700 dark:text-orange-400 font-medium">
                            Unreachable
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
                  simplify expanding your Lidarr music library.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                      Data Sources
                    </h4>
                    <ul className="text-sm space-y-1">
                      <li>MusicBrainz (Artist Discovery)</li>
                      <li>Last.fm (Metadata & Images)</li>
                      <li>Lidarr API (Library Management)</li>
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

      <div className="flex flex-wrap gap-2 mb-8 border-b border-gray-200 dark:border-gray-800 pb-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center px-6 py-3 text-sm font-medium rounded-t-lg transition-all relative top-[1px] ${
                isActive
                  ? "bg-white dark:bg-gray-900 text-primary-600 dark:text-primary-400 border border-gray-200 dark:border-gray-800 border-b-white dark:border-b-gray-900"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"
              }`}
            >
              <Icon className={`w-4 h-4 mr-2 ${isActive ? "text-primary-500" : ""}`} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div>
        {renderTabContent()}
      </div>
    </div>
  );
}

export default SettingsPage;

