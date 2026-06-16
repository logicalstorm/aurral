import { useState } from "react";
import { CheckCircle, RefreshCw, Trash2, X } from "lucide-react";
import FlipSaveButton from "../../../components/FlipSaveButton";
import { SettingsInput, SettingsSelect } from "./SettingsField";

const AUTO_REFRESH_OPTIONS = [
  { value: 24, label: "Daily" },
  { value: 168, label: "Weekly" },
  { value: 720, label: "Monthly" },
];

const DISCOVERY_MODE_OPTIONS = [
  { value: "safer", label: "Safer" },
  { value: "balanced", label: "Balanced" },
  { value: "deeper", label: "Deeper" },
];

const LASTFM_DISCOVER_BANNER_KEY = "aurral:lastfm-discover-settings-banner";

const readLastfmDiscoverBannerDismissed = () => {
  try {
    return localStorage.getItem(LASTFM_DISCOVER_BANNER_KEY) === "1";
  } catch {
    return false;
  }
};

const formatBytes = (value) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
};

export function SettingsDiscoverTab({
  settings,
  updateSettings,
  health,
  hasUnsavedChanges,
  saving,
  handleSaveSettings,
  refreshingDiscovery,
  discoveryProgress,
  discoveryProgressMessage,
  clearingCache,
  handleRefreshDiscovery,
  handleClearCache,
}) {
  const [lastfmBannerDismissed, setLastfmBannerDismissed] = useState(
    readLastfmDiscoverBannerDismissed,
  );
  const autoRefreshHours =
    settings.integrations?.lastfm?.discoveryAutoRefreshHours || 168;
  const discoveryMode =
    settings.integrations?.lastfm?.discoveryMode || "balanced";
  const discoveryRecommendationsPerRefresh =
    settings.integrations?.lastfm?.discoveryRecommendationsPerRefresh ?? 200;
  const discoveryFlowsPerRefresh =
    settings.integrations?.lastfm?.discoveryFlowsPerRefresh ?? 9;
  const baseDiscoverFlowCount = 5;
  const focusFlowCount = Math.max(
    0,
    discoveryFlowsPerRefresh - baseDiscoverFlowCount,
  );
  const discoveryProvider =
    health?.discovery?.provider === "listenbrainz-fallback"
      ? "ListenBrainz fallback"
      : "Last.fm";
  const isListenBrainzFallback =
    health?.discovery?.provider === "listenbrainz-fallback";
  const showLastfmDiscoverBanner =
    isListenBrainzFallback && !lastfmBannerDismissed;
  const localDiscoveryIncludeRecommendations =
    settings.integrations?.ticketmaster
      ?.localDiscoveryIncludeRecommendations !== false;
  const localDiscoveryIncludeTrending =
    settings.integrations?.ticketmaster?.localDiscoveryIncludeTrending !==
    false;

  return (
    <div className="settings-page__panel">
      <div className="settings-page__panel-header">
        <h2 className="settings-page__panel-title">Discover</h2>
        <FlipSaveButton
          saving={saving}
          disabled={!hasUnsavedChanges}
          onClick={handleSaveSettings}
        />
      </div>

      <form
        onSubmit={handleSaveSettings}
        className="settings-page__form"
        autoComplete="off"
      >
        {showLastfmDiscoverBanner && (
          <div className="settings-page__banner">
            <div className="settings-page__banner-copy">
              <p className="settings-page__banner-title">
                Optional Last.fm upgrade
              </p>
              <p className="settings-page__banner-text">
                Add a free Last.fm API key in Integrations to unlock
                personalized recommendations, similar artists, tag and genre
                search, and custom weekly flows.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-icon-square"
              onClick={() => {
                setLastfmBannerDismissed(true);
                try {
                  localStorage.setItem(LASTFM_DISCOVER_BANNER_KEY, "1");
                } catch {}
              }}
              aria-label="Dismiss Last.fm upgrade reminder"
            >
              <X className="settings-page__tab-icon" />
            </button>
          </div>
        )}

        <div className="settings-page__section">
          <div className="settings-page__section-header">
            <h3 className="settings-page__section-title">Listening history</h3>
            <div className="settings-page__inline-row">
              {health?.lastfmConfigured && (
                <span className="settings-page__status">
                  <CheckCircle className="settings-page__status-icon" />
                  Configured
                </span>
              )}
            </div>
          </div>
          <fieldset className="settings-page__fields">
            <div className="settings-page__two-col-grid">
              <div>
                <label className="artist-field-label">Last.fm API key</label>
                <SettingsInput
                  type="password"
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
                <label className="artist-field-label">Default username</label>
                <SettingsInput
                  type="text"
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
                <p className="settings-page__hint">
                  Used as the fallback for users who have not set their own
                  Last.fm, ListenBrainz, or Koito account in Profile.
                </p>
              </div>
            </div>
          </fieldset>
        </div>

        <div className="settings-page__section">
          <div className="settings-page__section-header">
            <h3 className="settings-page__section-title">Local shows</h3>
            <div className="settings-page__inline-row">
              {health?.ticketmasterConfigured && (
                <span className="settings-page__status">
                  <CheckCircle className="settings-page__status-icon" />
                  Configured
                </span>
              )}
            </div>
          </div>
          <fieldset className="settings-page__fields">
            <div className="settings-page__two-col-grid">
              <div>
                <label className="artist-field-label">Ticketmaster key</label>
                <SettingsInput
                  type="password"
                  placeholder="Enter Ticketmaster Consumer Key"
                  autoComplete="off"
                  value={settings.integrations?.ticketmaster?.apiKey || ""}
                  onChange={(e) =>
                    updateSettings({
                      ...settings,
                      integrations: {
                        ...settings.integrations,
                        ticketmaster: {
                          ...(settings.integrations?.ticketmaster || {}),
                          apiKey: e.target.value,
                        },
                      },
                    })
                  }
                />
              </div>
              <div>
                <label className="artist-field-label">
                  Search radius (miles)
                </label>
                <SettingsInput
                  type="number"
                  min={5}
                  max={250}
                  step={5}
                  value={
                    settings.integrations?.ticketmaster?.searchRadiusMiles ?? 250
                  }
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    const value = Number.isFinite(raw)
                      ? Math.max(5, Math.min(250, Math.floor(raw)))
                      : 250;
                    updateSettings({
                      ...settings,
                      integrations: {
                        ...settings.integrations,
                        ticketmaster: {
                          ...(settings.integrations?.ticketmaster || {}),
                          searchRadiusMiles: value,
                        },
                      },
                    });
                  }}
                />
              </div>
            </div>
            <div className="settings-page__field-stack--md">
              <label className="settings-page__toggle-row">
                <span>Include recommended artists in local shows</span>
                <input
                  type="checkbox"
                  className="artist-checkbox"
                  checked={localDiscoveryIncludeRecommendations}
                  onChange={(e) =>
                    updateSettings({
                      ...settings,
                      integrations: {
                        ...settings.integrations,
                        ticketmaster: {
                          ...(settings.integrations?.ticketmaster || {}),
                          localDiscoveryIncludeRecommendations:
                            e.target.checked,
                        },
                      },
                    })
                  }
                />
              </label>
              <label className="settings-page__toggle-row">
                <span>Include trending artists in local shows</span>
                <input
                  type="checkbox"
                  className="artist-checkbox"
                  checked={localDiscoveryIncludeTrending}
                  onChange={(e) =>
                    updateSettings({
                      ...settings,
                      integrations: {
                        ...settings.integrations,
                        ticketmaster: {
                          ...(settings.integrations?.ticketmaster || {}),
                          localDiscoveryIncludeTrending: e.target.checked,
                        },
                      },
                    })
                  }
                />
              </label>
            </div>
          </fieldset>
        </div>

        <div className="settings-page__section">
          <h3 className="settings-page__section-title">Discovery behavior</h3>
          <fieldset className="settings-page__fields">
            <div className="settings-page__field">
              <label className="artist-field-label" htmlFor="discover-refresh">
                Auto-refresh frequency
              </label>
              <SettingsSelect
                id="discover-refresh"
                value={String(autoRefreshHours)}
                onChange={(e) =>
                  updateSettings({
                    ...settings,
                    integrations: {
                      ...settings.integrations,
                      lastfm: {
                        ...(settings.integrations?.lastfm || {}),
                        discoveryAutoRefreshHours: parseInt(e.target.value, 10),
                      },
                    },
                  })
                }
              >
                {AUTO_REFRESH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SettingsSelect>
            </div>
            {!isListenBrainzFallback && (
              <>
                <div className="settings-page__field">
                  <label
                    className="artist-field-label"
                    htmlFor="discover-recommendations"
                  >
                    Recommended artists per refresh
                  </label>
                  <SettingsInput
                    id="discover-recommendations"
                    type="number"
                    min={50}
                    max={500}
                    step={10}
                    value={discoveryRecommendationsPerRefresh}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      const value = Number.isFinite(raw)
                        ? Math.max(50, Math.min(500, Math.floor(raw)))
                        : 200;
                      updateSettings({
                        ...settings,
                        integrations: {
                          ...settings.integrations,
                          lastfm: {
                            ...(settings.integrations?.lastfm || {}),
                            discoveryRecommendationsPerRefresh: value,
                          },
                        },
                      });
                    }}
                  />
                  <p className="settings-page__hint">
                    How many artist recommendations to generate on each
                    discovery refresh.
                  </p>
                </div>
                <div className="settings-page__field">
                  <label
                    className="artist-field-label"
                    htmlFor="discover-flows"
                  >
                    Generated flows per refresh
                  </label>
                  <SettingsInput
                    id="discover-flows"
                    type="number"
                    min={5}
                    max={32}
                    step={1}
                    value={discoveryFlowsPerRefresh}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      const value = Number.isFinite(raw)
                        ? Math.max(5, Math.min(32, Math.floor(raw)))
                        : 9;
                      updateSettings({
                        ...settings,
                        integrations: {
                          ...settings.integrations,
                          lastfm: {
                            ...(settings.integrations?.lastfm || {}),
                            discoveryFlowsPerRefresh: value,
                          },
                        },
                      });
                    }}
                  />
                  <p className="settings-page__hint">
                    Includes Discover Weekly, Trending Mix, Library Blend,
                    Listening History, and Release Radar, plus {focusFlowCount}{" "}
                    auto-generated focus playlists.
                  </p>
                </div>
                <div className="settings-page__field">
                  <label className="artist-field-label" htmlFor="discover-mode">
                    Discovery mode
                  </label>
                  <SettingsSelect
                    id="discover-mode"
                    value={discoveryMode}
                    onChange={(e) =>
                      updateSettings({
                        ...settings,
                        integrations: {
                          ...settings.integrations,
                          lastfm: {
                            ...(settings.integrations?.lastfm || {}),
                            discoveryMode: e.target.value,
                          },
                        },
                      })
                    }
                  >
                    {DISCOVERY_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </SettingsSelect>
                  <div className="settings-page__hint-list">
                    <p>
                      <strong>Safer:</strong> favors more obvious,
                      high-confidence recommendations.
                    </p>
                    <p>
                      <strong>Balanced:</strong> mixes familiar artists with
                      some exploration.
                    </p>
                    <p>
                      <strong>Deeper:</strong> pushes further beyond the most
                      obvious similar artists.
                    </p>
                  </div>
                </div>
              </>
            )}
          </fieldset>
        </div>

        <div className="settings-page__section">
          <h3 className="settings-page__section-title">Cache status</h3>
          <div className="settings-page__cache-layout">
            <div className="settings-page__meta-grid">
              <dl className="settings-page__meta-grid settings-page__meta-grid--two-col">
                <div className="settings-page__meta-item">
                  <dt className="settings-page__meta-term">Provider</dt>
                  <dd className="settings-page__meta-value">
                    {discoveryProvider}
                  </dd>
                </div>
                <div className="settings-page__meta-item">
                  <dt className="settings-page__meta-term">Last updated</dt>
                  <dd className="settings-page__meta-value">
                    {health?.discovery?.lastUpdated
                      ? new Date(health.discovery.lastUpdated).toLocaleString()
                      : "—"}
                  </dd>
                </div>
                <div className="settings-page__meta-item">
                  <dt className="settings-page__meta-term">Image cache size</dt>
                  <dd className="settings-page__meta-value">
                    {formatBytes(health?.discovery?.cachedImagesSizeBytes)}
                  </dd>
                </div>
                <div className="settings-page__meta-item">
                  <dt className="settings-page__meta-term">Cached images</dt>
                  <dd className="settings-page__meta-value">
                    {health?.discovery?.cachedImagesCount ?? "—"}
                  </dd>
                </div>
              </dl>
              {(health?.discovery?.isUpdating || refreshingDiscovery) && (
                <div className="settings-page__discovery-progress">
                  <p className="settings-page__progress-line">
                    <RefreshCw className="artist-icon-xs animate-spin" />
                    <span className="settings-page__progress-text">
                      {discoveryProgressMessage ||
                        health?.discovery?.updateProgressMessage ||
                        "Refreshing discovery"}
                    </span>
                    {typeof (
                      discoveryProgress ?? health?.discovery?.updateProgress
                    ) === "number" && (
                      <span className="settings-page__progress-pct">
                        {discoveryProgress ?? health?.discovery?.updateProgress}
                        %
                      </span>
                    )}
                  </p>
                  {typeof (
                    discoveryProgress ?? health?.discovery?.updateProgress
                  ) === "number" && (
                    <div className="settings-page__progress-bar">
                      <div
                        className="settings-page__progress-fill"
                        style={{
                          width: `${discoveryProgress ?? health?.discovery?.updateProgress}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
              {!refreshingDiscovery &&
                !health?.discovery?.isUpdating &&
                discoveryProgressMessage && (
                  <p className="settings-page__success-line">
                    {discoveryProgressMessage}
                  </p>
                )}
            </div>
            <div className="settings-page__cache-actions">
              <div className="settings-page__action-card">
                <p className="settings-page__action-card-label">
                  Discovery data
                </p>
                <button
                  type="button"
                  onClick={handleRefreshDiscovery}
                  disabled={refreshingDiscovery}
                  className="btn btn-primary btn--full"
                >
                  <RefreshCw
                    className={`artist-icon-xs${refreshingDiscovery ? " animate-spin" : ""}`}
                  />
                  {refreshingDiscovery ? "Refreshing..." : "Refresh Discovery"}
                </button>
              </div>
              <div className="settings-page__action-card">
                <p className="settings-page__action-card-label">Image cache</p>
                <button
                  type="button"
                  onClick={handleClearCache}
                  disabled={clearingCache}
                  className="btn btn-secondary btn--full"
                >
                  <Trash2
                    className={`artist-icon-xs${clearingCache ? " animate-spin" : ""}`}
                  />
                  {clearingCache ? "Clearing..." : "Clear Image Cache"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
