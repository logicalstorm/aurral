import { CheckCircle, RefreshCw } from "lucide-react";
import FlipSaveButton from "../../../components/FlipSaveButton";
import { getLidarrProfiles, testLidarrConnection } from "../../../utils/api";

export function SettingsIntegrationsTab({
  settings,
  updateSettings,
  health,
  lidarrProfiles,
  loadingLidarrProfiles,
  setLoadingLidarrProfiles,
  setLidarrProfiles,
  testingLidarr,
  setTestingLidarr,
  applyingCommunityGuide,
  setShowCommunityGuideModal,
  hasUnsavedChanges,
  saving,
  handleSaveSettings,
  showSuccess,
  showError,
  showInfo,
}) {
  const handleTestLidarr = async () => {
    const url = settings.integrations?.lidarr?.url;
    const apiKey = settings.integrations?.lidarr?.apiKey;
    if (!url || !apiKey) {
      showError("Please enter both URL and API key");
      return;
    }
    setTestingLidarr(true);
    try {
      const result = await testLidarrConnection(url, apiKey);
      if (result.success) {
        showSuccess(
          `Lidarr connection successful! (${result.instanceName || "Lidarr"})`
        );
        setLoadingLidarrProfiles(true);
        try {
          const profiles = await getLidarrProfiles(url, apiKey);
          setLidarrProfiles(profiles);
          if (profiles.length > 0) {
            showInfo(`Loaded ${profiles.length} quality profile(s)`);
          }
        } catch {
        } finally {
          setLoadingLidarrProfiles(false);
        }
      } else {
        showError(
          `Connection failed: ${result.message || result.error}${result.details ? `\n${result.details}` : ""}`
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
  };

  const handleRefreshProfiles = async () => {
    const url = settings.integrations?.lidarr?.url;
    const apiKey = settings.integrations?.lidarr?.apiKey;
    if (!url || !apiKey) {
      showError("Please enter Lidarr URL and API key first");
      return;
    }
    setLoadingLidarrProfiles(true);
    try {
      const profiles = await getLidarrProfiles(url, apiKey);
      setLidarrProfiles(profiles);
      if (profiles.length > 0) {
        showSuccess(`Loaded ${profiles.length} quality profile(s)`);
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
  };

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
                  onClick={handleTestLidarr}
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
                      ? String(settings.integrations.lidarr.qualityProfileId)
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
                  onClick={handleRefreshProfiles}
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
                Quality profile used when adding artists and albums to Lidarr.
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
                Automatically search for albums when adding them to library
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
            <code>ND_SCANNER_PURGEMISSING=always</code>) so turning off a flow
            removes those tracks from the library.
          </p>
        </div>
      </form>
    </div>
  );
}
