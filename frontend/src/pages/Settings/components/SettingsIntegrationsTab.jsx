import { useState } from "react";
import { CheckCircle, ChevronDown, RefreshCw } from "lucide-react";
import FlipSaveButton from "../../../components/FlipSaveButton";
import { SettingsInput, SettingsSelect } from "./SettingsField";
import { LidarrLibraryAccessCheck } from "./LidarrLibraryAccessCheck";
import {
  getLidarrMetadataProfiles,
  getLidarrProfiles,
  getLidarrTags,
  testLidarrConnection,
  testLidarrLibraryAccess,
} from "../../../utils/api";

export function SettingsIntegrationsTab({
  settings,
  updateSettings,
  health,
  lidarrProfiles,
  loadingLidarrProfiles,
  setLoadingLidarrProfiles,
  setLidarrProfiles,
  lidarrMetadataProfiles,
  loadingLidarrMetadataProfiles,
  setLoadingLidarrMetadataProfiles,
  setLidarrMetadataProfiles,
  lidarrTags,
  loadingLidarrTags,
  setLoadingLidarrTags,
  setLidarrTags,
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
  const [collapsedSections, setCollapsedSections] = useState({
    lidarr: false,
    lastfm: true,
    ticketmaster: true,
    navidrome: true,
  });
  const [lidarrTestLatencyMs, setLidarrTestLatencyMs] = useState(null);
  const [testingLidarrLibraryAccess, setTestingLidarrLibraryAccess] =
    useState(false);
  const [lidarrLibraryAccessResult, setLidarrLibraryAccessResult] =
    useState(null);
  const safeLidarrProfiles = Array.isArray(lidarrProfiles)
    ? lidarrProfiles
    : [];
  const localDiscoveryIncludeRecommendations =
    settings.integrations?.ticketmaster
      ?.localDiscoveryIncludeRecommendations !== false;
  const localDiscoveryIncludeTrending =
    settings.integrations?.ticketmaster?.localDiscoveryIncludeTrending !==
    false;
  const safeLidarrMetadataProfiles = Array.isArray(lidarrMetadataProfiles)
    ? lidarrMetadataProfiles
    : [];
  const safeLidarrTags = Array.isArray(lidarrTags) ? lidarrTags : [];
  const toggleSection = (section) => {
    setCollapsedSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  };

  const handleTestLidarrLibraryAccess = async () => {
    const url = settings.integrations?.lidarr?.url;
    const apiKey = settings.integrations?.lidarr?.apiKey;
    if (!url || !apiKey) {
      showError("Please enter both URL and API key");
      return;
    }
    setTestingLidarrLibraryAccess(true);
    setLidarrLibraryAccessResult(null);
    try {
      const result = await testLidarrLibraryAccess(url, apiKey);
      setLidarrLibraryAccessResult(result);
      if (result.ok) {
        if (result.partial) {
          showInfo(
            "Folders are reachable, but no downloaded tracks were found to verify yet.",
          );
        } else {
          showSuccess("Library access looks good.");
        }
      } else {
        showError("Library access check failed. See the results below.");
      }
    } catch (error) {
      const message =
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message ||
        "Library access check failed";
      showError(message);
    } finally {
      setTestingLidarrLibraryAccess(false);
    }
  };

  const handleTestLidarr = async () => {
    const url = settings.integrations?.lidarr?.url;
    const apiKey = settings.integrations?.lidarr?.apiKey;
    if (!url || !apiKey) {
      showError("Please enter both URL and API key");
      return;
    }
    setTestingLidarr(true);
    setLidarrTestLatencyMs(null);
    const startTime = performance.now();
    try {
      const result = await testLidarrConnection(url, apiKey);
      setLidarrTestLatencyMs(Math.round(performance.now() - startTime));
      if (result.success) {
        showSuccess(
          `Lidarr connection successful! (${result.instanceName || "Lidarr"})`,
        );
        setLoadingLidarrProfiles(true);
        setLoadingLidarrMetadataProfiles(true);
        setLoadingLidarrTags(true);
        try {
          const [profiles, metadataProfiles, tags] = await Promise.all([
            getLidarrProfiles(url, apiKey),
            getLidarrMetadataProfiles(url, apiKey),
            getLidarrTags(url, apiKey),
          ]);
          const nextProfiles = Array.isArray(profiles) ? profiles : [];
          const nextMetadataProfiles = Array.isArray(metadataProfiles)
            ? metadataProfiles
            : [];
          const nextTags = Array.isArray(tags) ? tags : [];
          setLidarrProfiles(nextProfiles);
          setLidarrMetadataProfiles(nextMetadataProfiles);
          setLidarrTags(nextTags);
          if (nextProfiles.length > 0) {
            showInfo(`Loaded ${nextProfiles.length} quality profile(s)`);
          }
          if (nextMetadataProfiles.length > 0) {
            showInfo(
              `Loaded ${nextMetadataProfiles.length} metadata profile(s)`,
            );
          }
          if (nextTags.length > 0) {
            showInfo(`Loaded ${nextTags.length} tag(s)`);
          }
        } catch {
        } finally {
          setLoadingLidarrProfiles(false);
          setLoadingLidarrMetadataProfiles(false);
          setLoadingLidarrTags(false);
        }
      } else {
        showError(
          `Connection failed: ${result.message || result.error}${result.details ? `\n${result.details}` : ""}`,
        );
      }
    } catch (err) {
      setLidarrTestLatencyMs(Math.round(performance.now() - startTime));
      const errorMsg =
        err.response?.data?.message || err.response?.data?.error || err.message;
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
      const nextProfiles = Array.isArray(profiles) ? profiles : [];
      setLidarrProfiles(nextProfiles);
      if (nextProfiles.length > 0) {
        showSuccess(`Loaded ${nextProfiles.length} quality profile(s)`);
      } else {
        showInfo("No quality profiles found in Lidarr");
      }
    } catch (err) {
      const errorMsg =
        err.response?.data?.message || err.response?.data?.error || err.message;
      showError(`Failed to load profiles: ${errorMsg}`);
    } finally {
      setLoadingLidarrProfiles(false);
    }
  };

  const handleRefreshMetadataProfiles = async () => {
    const url = settings.integrations?.lidarr?.url;
    const apiKey = settings.integrations?.lidarr?.apiKey;
    if (!url || !apiKey) {
      showError("Please enter Lidarr URL and API key first");
      return;
    }
    setLoadingLidarrMetadataProfiles(true);
    try {
      const profiles = await getLidarrMetadataProfiles(url, apiKey);
      const nextProfiles = Array.isArray(profiles) ? profiles : [];
      setLidarrMetadataProfiles(nextProfiles);
      if (nextProfiles.length > 0) {
        showSuccess(`Loaded ${nextProfiles.length} metadata profile(s)`);
      } else {
        showInfo("No metadata profiles found in Lidarr");
      }
    } catch (err) {
      const errorMsg =
        err.response?.data?.message || err.response?.data?.error || err.message;
      showError(`Failed to load metadata profiles: ${errorMsg}`);
    } finally {
      setLoadingLidarrMetadataProfiles(false);
    }
  };

  const handleRefreshTags = async () => {
    const url = settings.integrations?.lidarr?.url;
    const apiKey = settings.integrations?.lidarr?.apiKey;
    if (!url || !apiKey) {
      showError("Please enter Lidarr URL and API key first");
      return;
    }
    setLoadingLidarrTags(true);
    try {
      const tags = await getLidarrTags(url, apiKey);
      const nextTags = Array.isArray(tags) ? tags : [];
      setLidarrTags(nextTags);
      if (nextTags.length > 0) {
        showSuccess(`Loaded ${nextTags.length} tag(s)`);
      } else {
        showInfo("No tags found in Lidarr");
      }
    } catch (err) {
      const errorMsg =
        err.response?.data?.message || err.response?.data?.error || err.message;
      showError(`Failed to load tags: ${errorMsg}`);
    } finally {
      setLoadingLidarrTags(false);
    }
  };

  return (
    <div className="settings-page__panel">
      <div className="settings-page__panel-header">
        <h2
          className="settings-page__panel-title">
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
        className="settings-page__form"
        autoComplete="off"
      >
        <div
          className="settings-page__section"
        >
          <div className="settings-page__section-header">
            <button
                type="button"
                onClick={() => toggleSection("lidarr")}
                className="settings-page__section-toggle"
                aria-expanded={!collapsedSections.lidarr}
              >
                <ChevronDown
                  className={`settings-page__section-toggle-icon${collapsedSections.lidarr ? " is-collapsed" : ""}`}
                />
                <span>Lidarr</span>
              </button>
            <div className="settings-page__inline-row">
              {health?.lidarrConfigured && (
                <span className="settings-page__status">
                  <CheckCircle className="settings-page__status-icon" />
                  Connected
                </span>
              )}
            </div>
          </div>
          {!collapsedSections.lidarr && (
            <fieldset className="settings-page__fields">
              <div>
                <label
                  className="artist-field-label"
                >
                  Server URL
                </label>
                <SettingsInput type="url"

                  placeholder="http://lidarr:8686"
                  autoComplete="off"
                  value={settings.integrations?.lidarr?.url || ""}
                    onChange={(e) => {
                      setLidarrTestLatencyMs(null);
                      setLidarrLibraryAccessResult(null);
                      updateSettings({
                        ...settings,
                        integrations: {
                          ...settings.integrations,
                          lidarr: {
                            ...(settings.integrations?.lidarr || {}),
                            url: e.target.value,
                          },
                        },
                      });
                    }}
                />
              </div>
              <div>
                <label
                  className="artist-field-label"
                >
                  API Key
                </label>
                <div className="settings-page__field-row">
                  <SettingsInput
                    wrapperClassName="settings-page__field-grow"
                    type="password"
                    placeholder="Enter Lidarr API Key"
                    autoComplete="off"
                    value={settings.integrations?.lidarr?.apiKey || ""}
                    onChange={(e) => {
                      setLidarrTestLatencyMs(null);
                      setLidarrLibraryAccessResult(null);
                      updateSettings({
                        ...settings,
                        integrations: {
                          ...settings.integrations,
                          lidarr: {
                            ...(settings.integrations?.lidarr || {}),
                            apiKey: e.target.value,
                          },
                        },
                      });
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleTestLidarr}
                    disabled={
                      testingLidarr ||
                      testingLidarrLibraryAccess ||
                      !settings.integrations?.lidarr?.url ||
                      !settings.integrations?.lidarr?.apiKey
                    }
                    className="btn btn-secondary"
                  >
                    {testingLidarr ? "Testing..." : "Test connection"}
                  </button>
                </div>
                <p className="settings-page__hint">
                  Found in Settings &rarr; General &rarr; Security.
                </p>
                {lidarrTestLatencyMs !== null && (
                  <p className="settings-page__hint">
                    Last test response time: {lidarrTestLatencyMs} ms
                  </p>
                )}
                <div className="settings-page__lidarr-access-row">
                  <button
                    type="button"
                    onClick={handleTestLidarrLibraryAccess}
                    disabled={
                      testingLidarrLibraryAccess ||
                      testingLidarr ||
                      !settings.integrations?.lidarr?.url ||
                      !settings.integrations?.lidarr?.apiKey
                    }
                    className="btn btn-secondary"
                  >
                    {testingLidarrLibraryAccess
                      ? "Checking library access..."
                      : "Test library access"}
                  </button>
                  <p className="settings-page__hint">
                    Verifies Aurral can read files from Lidarr&apos;s music
                    folders for playback and playlist reuse.
                  </p>
                </div>
                <LidarrLibraryAccessCheck result={lidarrLibraryAccessResult} />
              </div>
              <div>
                <label
                  className="artist-field-label"
                >
                  External URL
                </label>
                <SettingsInput type="url"

                  placeholder="https://lidarr.example.com"
                  autoComplete="off"
                  value={settings.integrations?.lidarr?.externalUrl || ""}
                  onChange={(e) =>
                    updateSettings({
                      ...settings,
                      integrations: {
                        ...settings.integrations,
                        lidarr: {
                          ...(settings.integrations?.lidarr || {}),
                          externalUrl: e.target.value,
                        },
                      },
                    })
                  }
                />
                <p className="settings-page__hint">
                  Optional. Used only for browser-facing &quot;View on
                  Lidarr&quot; links. Leave blank to use the server URL above.
                </p>
              </div>
              <div>
                <label
                  className="artist-field-label"
                >
                  Default Quality Profile
                </label>
                <div className="settings-page__field-row">
                  <SettingsSelect
                    wrapperClassName="settings-page__field-grow"
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
                        : safeLidarrProfiles.length === 0
                          ? "No profiles available (test connection first)"
                          : "Select a profile"}
                    </option>
                    {safeLidarrProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </SettingsSelect>
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
                      className={`artist-icon-sm${
                        loadingLidarrProfiles ? " animate-spin" : ""
                      }`}
                    />
                  </button>
                </div>
                <p className="settings-page__hint">
                  Quality profile used when adding artists and albums to Lidarr.
                </p>
              </div>
              <div>
                <label
                  className="artist-field-label"
                >
                  Default Metadata Profile
                </label>
                <div className="settings-page__field-row">
                  <SettingsSelect
                    wrapperClassName="settings-page__field-grow"
                    value={
                      settings.integrations?.lidarr?.metadataProfileId
                        ? String(settings.integrations.lidarr.metadataProfileId)
                        : ""
                    }
                    onChange={(e) =>
                      updateSettings({
                        ...settings,
                        integrations: {
                          ...settings.integrations,
                          lidarr: {
                            ...(settings.integrations?.lidarr || {}),
                            metadataProfileId: e.target.value
                              ? parseInt(e.target.value)
                              : null,
                          },
                        },
                      })
                    }
                    disabled={loadingLidarrMetadataProfiles}
                  >
                    <option value="">
                      {loadingLidarrMetadataProfiles
                        ? "Loading profiles..."
                        : safeLidarrMetadataProfiles.length === 0
                          ? "No profiles available (test connection first)"
                          : "Select a profile"}
                    </option>
                    {safeLidarrMetadataProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </SettingsSelect>
                  <button
                    type="button"
                    onClick={handleRefreshMetadataProfiles}
                    disabled={
                      loadingLidarrMetadataProfiles ||
                      !settings.integrations?.lidarr?.url ||
                      !settings.integrations?.lidarr?.apiKey
                    }
                    className="btn btn-secondary"
                  >
                    <RefreshCw
                      className={`artist-icon-sm${
                        loadingLidarrMetadataProfiles ? " animate-spin" : ""
                      }`}
                    />
                  </button>
                </div>
                <p className="settings-page__hint">
                  Metadata profile used when adding artists to Lidarr.
                </p>
              </div>
              <div>
                <label
                  className="artist-field-label"
                >
                  Tag
                </label>
                <div className="settings-page__field-row">
                  <SettingsSelect
                    wrapperClassName="settings-page__field-grow"
                    value={
                      settings.integrations?.lidarr?.tagId
                        ? String(settings.integrations.lidarr.tagId)
                        : ""
                    }
                    onChange={(e) =>
                      updateSettings({
                        ...settings,
                        integrations: {
                          ...settings.integrations,
                          lidarr: {
                            ...(settings.integrations?.lidarr || {}),
                            tagId: e.target.value
                              ? parseInt(e.target.value)
                              : null,
                          },
                        },
                      })
                    }
                    disabled={loadingLidarrTags}
                  >
                    <option value="">
                      {loadingLidarrTags
                        ? "Loading tags..."
                        : safeLidarrTags.length === 0
                          ? "No tags available (test connection first)"
                          : "None"}
                    </option>
                    {safeLidarrTags.map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        {tag.label}
                      </option>
                    ))}
                  </SettingsSelect>
                  <button
                    type="button"
                    onClick={handleRefreshTags}
                    disabled={
                      loadingLidarrTags ||
                      !settings.integrations?.lidarr?.url ||
                      !settings.integrations?.lidarr?.apiKey
                    }
                    className="btn btn-secondary"
                  >
                    <RefreshCw
                      className={`artist-icon-sm${
                        loadingLidarrTags ? " animate-spin" : ""
                      }`}
                    />
                  </button>
                </div>
                <p className="settings-page__hint">
                  Tag applied to artists added through Aurral.
                </p>
              </div>
              <div>
                <label
                  className="artist-field-label"
                >
                  Default Monitoring Option
                </label>
                <SettingsSelect
                  value={
                    settings.integrations?.lidarr?.defaultMonitorOption ||
                    "none"
                  }
                  onChange={(e) =>
                    updateSettings({
                      ...settings,
                      integrations: {
                        ...settings.integrations,
                        lidarr: {
                          ...(settings.integrations?.lidarr || {}),
                          defaultMonitorOption: e.target.value,
                        },
                      },
                    })
                  }
                >
                  <option value="none">None (Artist Only)</option>
                  <option value="existing">Existing Albums</option>
                  <option value="all">All Albums</option>
                  <option value="future">Future Albums</option>
                  <option value="missing">Missing Albums</option>
                  <option value="latest">Latest Album</option>
                  <option value="first">First Album</option>
                </SettingsSelect>
                <p className="settings-page__hint">
                  Default monitoring used when adding new artists.
                </p>
              </div>
              <div>
                <label className="artist-checkbox-label">
                  <input
                    type="checkbox"
                    className="artist-checkbox"
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
                    className="artist-field-label">
                    Search on Add
                  </span>
                </label>
                <p className="settings-page__hint settings-page__hint--indented">
                  Automatically search for albums when adding them to library
                </p>
              </div>
              <div className="settings-page__split">
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
                  disabled={applyingCommunityGuide || !health?.lidarrConfigured}
                  className="btn btn-primary btn--full"
                >
                  {applyingCommunityGuide
                    ? "Applying..."
                    : "Apply Davo's Recommended Settings"}
                </button>
                <p className="settings-page__hint">
                  Creates quality profile, updates quality definitions, adds
                  custom formats, and updates naming scheme.{" "}
                  <a
                    href="https://wiki.servarr.com/lidarr/community-guide"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="settings-page__link"
                    
                  >
                    Read more
                  </a>
                </p>
              </div>
            </fieldset>
          )}
        </div>
        <div
          className="settings-page__section"
        >
          <div className="settings-page__section-header">
            <button
                type="button"
                onClick={() => toggleSection("lastfm")}
                className="settings-page__section-toggle"
                aria-expanded={!collapsedSections.lastfm}
              >
                <ChevronDown
                  className={`settings-page__section-toggle-icon${collapsedSections.lastfm ? " is-collapsed" : ""}`}
                />
                <span>Last.fm</span>
              </button>
            <div className="settings-page__inline-row">
              {health?.lastfmConfigured && (
                <span className="settings-page__status">
                  <CheckCircle className="settings-page__status-icon" />
                  Configured
                </span>
              )}
            </div>
          </div>
          {!collapsedSections.lastfm && (
            <fieldset className="settings-page__fields">
              <div>
                <label
                  className="artist-field-label"
                >
                  API Key
                </label>
                <SettingsInput type="password"

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
                  className="artist-field-label"
                >
                  Default Username
                </label>
                <SettingsInput type="text"

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
                  Used as the app-wide fallback for users who have not set their
                  own Last.fm or ListenBrainz account in Profile.
                </p>
              </div>
            </fieldset>
          )}
        </div>
        <div
          className="settings-page__section"
        >
          <div className="settings-page__section-header">
            <button
                type="button"
                onClick={() => toggleSection("ticketmaster")}
                className="settings-page__section-toggle"
                aria-expanded={!collapsedSections.ticketmaster}
              >
                <ChevronDown
                  className={`settings-page__section-toggle-icon${collapsedSections.ticketmaster ? " is-collapsed" : ""}`}
                />
                <span>Ticketmaster</span>
              </button>
            <div className="settings-page__inline-row">
              {health?.ticketmasterConfigured && (
                <span className="settings-page__status">
                  <CheckCircle className="settings-page__status-icon" />
                  Configured
                </span>
              )}
            </div>
          </div>
          {!collapsedSections.ticketmaster && (
            <fieldset className="settings-page__fields">
              <div
                className="settings-page__callout"
              >
                <p className="artist-field-label">
                  Get an API key
                </p>
                <p className="settings-page__callout-copy">
                  Register on the developers portal. After the registration, the
                  default application will be created. The application contains
                  a Consumer Key that is used for authentication.
                </p>
                <a
                  href="https://developer-acct.ticketmaster.com/user/login"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="settings-page__link"
                >
                  Open the Ticketmaster developer portal
                </a>
              </div>
              <div>
                <label
                  className="artist-field-label"
                >
                  Consumer Key
                </label>
                <SettingsInput type="password"

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
                <p className="settings-page__hint">
                  Used for the Discover page&apos;s nearby shows section.
                </p>
              </div>
              <div>
                <label
                  className="artist-field-label"
                >
                  Search Radius (miles)
                </label>
                <SettingsInput type="number"
                  min={5}
                  max={250}
                  step={5}

                  value={
                    settings.integrations?.ticketmaster?.searchRadiusMiles ?? 50
                  }
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    const value = Number.isFinite(raw)
                      ? Math.max(5, Math.min(250, Math.floor(raw)))
                      : 50;
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
                <p className="settings-page__hint">
                  Controls how far from your selected area Ticketmaster events
                  are searched.
                </p>
              </div>
              <label className="settings-page__toggle-row">
                <span >
                  Include recommended artists in local shows
                </span>
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
                <span >
                  Include trending artists in local shows
                </span>
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
            </fieldset>
          )}
        </div>
        <div
          className="settings-page__section"
        >
          <div className="settings-page__section-header">
            <button
                type="button"
                onClick={() => toggleSection("navidrome")}
                className="settings-page__section-toggle"
                aria-expanded={!collapsedSections.navidrome}
              >
                <ChevronDown
                  className={`settings-page__section-toggle-icon${collapsedSections.navidrome ? " is-collapsed" : ""}`}
                />
                <span>Subsonic / Navidrome</span>
              </button>
            <div className="settings-page__inline-row">
              {settings.integrations?.navidrome?.url && (
                <span className="settings-page__status">
                  <CheckCircle className="settings-page__status-icon" />
                  Configured
                </span>
              )}
            </div>
          </div>
          {!collapsedSections.navidrome && (
            <fieldset>
              <div>
                <label
                  className="artist-field-label"
                >
                  Server URL
                </label>
                <SettingsInput type="url"

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
              <div className="settings-page__two-col-grid">
                <div>
                  <label
                    className="artist-field-label"
                  >
                    Username
                  </label>
                  <SettingsInput type="text"

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
                    className="artist-field-label"
                  >
                    Password
                  </label>
                  <SettingsInput type="password"

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
              <p className="settings-page__hint">
                When using Weekly Flow: set Navidrome&apos;s{" "}
                <code>Scanner.PurgeMissing</code> to <code>always</code> or{" "}
                <code>full</code> (e.g.{" "}
                <code>ND_SCANNER_PURGEMISSING=always</code>) so turning off a
                flow removes those tracks from the library.
              </p>
            </fieldset>
          )}
        </div>
      </form>
    </div>
  );
}
