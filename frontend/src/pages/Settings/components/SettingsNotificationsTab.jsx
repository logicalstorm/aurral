import { useState } from "react";
import { CheckCircle, Pencil } from "lucide-react";
import FlipSaveButton from "../../../components/FlipSaveButton";
import PillToggle from "../../../components/PillToggle";
import { testGotifyConnection } from "../../../utils/api";

export function SettingsNotificationsTab({
  settings,
  updateSettings,
  hasUnsavedChanges,
  saving,
  handleSaveSettings,
  testingGotify,
  setTestingGotify,
  showSuccess,
  showError,
}) {
  const [gotifyEditing, setGotifyEditing] = useState(false);

  const handleTestGotify = async () => {
    const url = settings.integrations?.gotify?.url;
    const token = settings.integrations?.gotify?.token;
    if (!url || !token) {
      showError("Enter Gotify URL and token first");
      return;
    }
    setTestingGotify(true);
    try {
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
  };

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
            <div className="flex items-center gap-2">
              {settings.integrations?.gotify?.url &&
                settings.integrations?.gotify?.token && (
                  <span className="flex items-center text-sm text-green-400">
                    <CheckCircle className="w-4 h-4 mr-1" />
                    Configured
                  </span>
                )}
              <button
                type="button"
                className={`btn ${
                  gotifyEditing ? "btn-primary" : "btn-secondary"
                } px-2 py-1`}
                onClick={() => setGotifyEditing((value) => !value)}
                aria-label={
                  gotifyEditing ? "Lock Gotify settings" : "Edit Gotify settings"
                }
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          </div>
          <fieldset
            disabled={!gotifyEditing}
            className={`grid grid-cols-1 gap-4 ${
              gotifyEditing ? "" : "opacity-60"
            }`}
          >
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
                  onClick={handleTestGotify}
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
                    settings.integrations?.gotify?.notifyDiscoveryUpdated ||
                    false
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
                    settings.integrations?.gotify?.notifyWeeklyFlowDone || false
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
          </fieldset>
        </div>
      </form>
    </div>
  );
}
