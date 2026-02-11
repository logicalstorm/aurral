import { useState } from "react";
import { CheckCircle, Pencil, RefreshCw, Trash2 } from "lucide-react";
import FlipSaveButton from "../../../components/FlipSaveButton";

export function SettingsMetadataTab({
  settings,
  updateSettings,
  health,
  hasUnsavedChanges,
  saving,
  handleSaveSettings,
  refreshingDiscovery,
  clearingCache,
  handleRefreshDiscovery,
  handleClearCache,
}) {
  const [musicbrainzEditing, setMusicbrainzEditing] = useState(false);
  const [lastfmEditing, setLastfmEditing] = useState(false);

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
            <div className="flex items-center gap-2">
              {health?.musicbrainzConfigured && (
                <span className="flex items-center text-sm text-green-400">
                  <CheckCircle className="w-4 h-4 mr-1" />
                  Configured
                </span>
              )}
              <button
                type="button"
                className={`btn ${
                  musicbrainzEditing ? "btn-primary" : "btn-secondary"
                } px-2 py-1`}
                onClick={() => setMusicbrainzEditing((value) => !value)}
                aria-label={
                  musicbrainzEditing
                    ? "Lock MusicBrainz settings"
                    : "Edit MusicBrainz settings"
                }
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          </div>
          <fieldset
            disabled={!musicbrainzEditing}
            className={`${musicbrainzEditing ? "" : "opacity-60"}`}
          >
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
          </fieldset>
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
            <div className="flex items-center gap-2">
              {health?.lastfmConfigured && (
                <span className="flex items-center text-sm text-green-400">
                  <CheckCircle className="w-4 h-4 mr-1" />
                  Configured
                </span>
              )}
              <button
                type="button"
                className={`btn ${
                  lastfmEditing ? "btn-primary" : "btn-secondary"
                } px-2 py-1`}
                onClick={() => setLastfmEditing((value) => !value)}
                aria-label={
                  lastfmEditing ? "Lock Last.fm settings" : "Edit Last.fm settings"
                }
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          </div>
          <fieldset
            disabled={!lastfmEditing}
            className={`space-y-4 ${lastfmEditing ? "" : "opacity-60"}`}
          >
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
                Your Last.fm username for personalized recommendations based on
                your listening history.
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
                  settings.integrations?.lastfm?.discoveryPeriod || "1month"
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
              API key is required for high-quality images, better recommendations,
              and weekly flow. Username enables personalized recommendations from
              your Last.fm listening history.
            </p>
          </fieldset>
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
}
