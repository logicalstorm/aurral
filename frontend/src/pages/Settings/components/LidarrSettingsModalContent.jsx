import { Link } from "react-router-dom";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { SettingsInput, SettingsSelect } from "./SettingsField";
import {
  SettingsArrFieldSet,
  SettingsArrFormGroup,
} from "./arr/SettingsArrLayout";
import {
  getLidarrMetadataProfiles,
  getLidarrProfiles,
  getLidarrTags,
  testLidarrConnection,
} from "../../../utils/api";

export function LidarrSettingsSection({
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
  showSuccess,
  showError,
  showInfo,
}) {
  const [lidarrTestLatencyMs, setLidarrTestLatencyMs] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const safeLidarrProfiles = Array.isArray(lidarrProfiles)
    ? lidarrProfiles
    : [];
  const safeLidarrMetadataProfiles = Array.isArray(lidarrMetadataProfiles)
    ? lidarrMetadataProfiles
    : [];
  const safeLidarrTags = Array.isArray(lidarrTags) ? lidarrTags : [];

  const updateLidarr = (patch) =>
    updateSettings({
      ...settings,
      integrations: {
        ...settings.integrations,
        lidarr: {
          ...(settings.integrations?.lidarr || {}),
          ...patch,
        },
      },
    });

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
    <>
      <SettingsArrFieldSet
        legend="Connection"
        actions={
          <button
            type="button"
            onClick={handleTestLidarr}
            disabled={
              testingLidarr ||
              !settings.integrations?.lidarr?.url ||
              !settings.integrations?.lidarr?.apiKey
            }
            className="arr-btn"
          >
            {testingLidarr ? "Testing..." : "Test connection"}
          </button>
        }
      >
        <div className="arr-info">
          Music library manager. File access, mounts, and path mappings are
          checked in{" "}
          <Link to="/settings/system" className="arr-link">
            System
          </Link>
          .
        </div>

        <SettingsArrFormGroup label="Server URL" labelFor="lidarr-url">
          <SettingsInput
            id="lidarr-url"
            type="url"
            placeholder="http://lidarr:8686"
            autoComplete="off"
            value={settings.integrations?.lidarr?.url || ""}
            onChange={(e) => {
              setLidarrTestLatencyMs(null);
              updateLidarr({ url: e.target.value });
            }}
          />
        </SettingsArrFormGroup>

        <SettingsArrFormGroup
          label="API Key"
          labelFor="lidarr-api-key"
          help={
            <>
              Found in Settings &rarr; General &rarr; Security.
              {lidarrTestLatencyMs !== null && (
                <>
                  {" "}
                  Last test response time: {lidarrTestLatencyMs} ms.
                </>
              )}
            </>
          }
        >
          <SettingsInput
            id="lidarr-api-key"
            type="password"
            placeholder="Enter Lidarr API Key"
            autoComplete="off"
            value={settings.integrations?.lidarr?.apiKey || ""}
            onChange={(e) => {
              setLidarrTestLatencyMs(null);
              updateLidarr({ apiKey: e.target.value });
            }}
          />
        </SettingsArrFormGroup>

        <SettingsArrFormGroup
          label="External URL"
          labelFor="lidarr-external-url"
          help='Optional. Used only for browser-facing "View on Lidarr" links.'
        >
          <SettingsInput
            id="lidarr-external-url"
            type="url"
            placeholder="https://lidarr.example.com"
            autoComplete="off"
            value={settings.integrations?.lidarr?.externalUrl || ""}
            onChange={(e) => updateLidarr({ externalUrl: e.target.value })}
          />
        </SettingsArrFormGroup>
      </SettingsArrFieldSet>

      <SettingsArrFieldSet legend="Defaults">
        <SettingsArrFormGroup
          label="Default Quality Profile"
          labelFor="lidarr-quality-profile"
        >
          <SettingsSelect
            id="lidarr-quality-profile"
            value={
              settings.integrations?.lidarr?.qualityProfileId
                ? String(settings.integrations.lidarr.qualityProfileId)
                : ""
            }
            onChange={(e) =>
              updateLidarr({
                qualityProfileId: e.target.value
                  ? parseInt(e.target.value, 10)
                  : null,
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
          <div className="arr-form-control-actions">
            <button
              type="button"
              onClick={handleRefreshProfiles}
              disabled={
                loadingLidarrProfiles ||
                !settings.integrations?.lidarr?.url ||
                !settings.integrations?.lidarr?.apiKey
              }
              className="arr-btn"
            >
              <RefreshCw
                className={`artist-icon-sm${
                  loadingLidarrProfiles ? " animate-spin" : ""
                }`}
              />
              Refresh profiles
            </button>
          </div>
        </SettingsArrFormGroup>

        <SettingsArrFormGroup
          label="Default Metadata Profile"
          labelFor="lidarr-metadata-profile"
        >
          <SettingsSelect
            id="lidarr-metadata-profile"
            value={
              settings.integrations?.lidarr?.metadataProfileId
                ? String(settings.integrations.lidarr.metadataProfileId)
                : ""
            }
            onChange={(e) =>
              updateLidarr({
                metadataProfileId: e.target.value
                  ? parseInt(e.target.value, 10)
                  : null,
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
          <div className="arr-form-control-actions">
            <button
              type="button"
              onClick={handleRefreshMetadataProfiles}
              disabled={
                loadingLidarrMetadataProfiles ||
                !settings.integrations?.lidarr?.url ||
                !settings.integrations?.lidarr?.apiKey
              }
              className="arr-btn"
            >
              <RefreshCw
                className={`artist-icon-sm${
                  loadingLidarrMetadataProfiles ? " animate-spin" : ""
                }`}
              />
              Refresh profiles
            </button>
          </div>
        </SettingsArrFormGroup>

        <SettingsArrFormGroup label="Tag" labelFor="lidarr-tag">
          <SettingsSelect
            id="lidarr-tag"
            value={
              settings.integrations?.lidarr?.tagId
                ? String(settings.integrations.lidarr.tagId)
                : ""
            }
            onChange={(e) =>
              updateLidarr({
                tagId: e.target.value ? parseInt(e.target.value, 10) : null,
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
          <div className="arr-form-control-actions">
            <button
              type="button"
              onClick={handleRefreshTags}
              disabled={
                loadingLidarrTags ||
                !settings.integrations?.lidarr?.url ||
                !settings.integrations?.lidarr?.apiKey
              }
              className="arr-btn"
            >
              <RefreshCw
                className={`artist-icon-sm${
                  loadingLidarrTags ? " animate-spin" : ""
                }`}
              />
              Refresh tags
            </button>
          </div>
        </SettingsArrFormGroup>

        <SettingsArrFormGroup
          label="Default Monitoring Option"
          labelFor="lidarr-monitor-option"
        >
          <SettingsSelect
            id="lidarr-monitor-option"
            value={
              settings.integrations?.lidarr?.defaultMonitorOption || "none"
            }
            onChange={(e) =>
              updateLidarr({ defaultMonitorOption: e.target.value })
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
        </SettingsArrFormGroup>

        <SettingsArrFormGroup label="Search on Add">
          <label className="artist-checkbox-label">
            <input
              type="checkbox"
              className="artist-checkbox"
              checked={settings.integrations?.lidarr?.searchOnAdd || false}
              onChange={(e) => updateLidarr({ searchOnAdd: e.target.checked })}
            />
            <span>Search for missing albums when artists are added</span>
          </label>
        </SettingsArrFormGroup>
      </SettingsArrFieldSet>

      <div className="arr-advanced-toggle">
        <button
          type="button"
          className="arr-link arr-link--button"
          onClick={() => setShowAdvanced((current) => !current)}
        >
          {showAdvanced ? "Hide advanced" : "Show advanced"}
        </button>
      </div>

      {showAdvanced ? (
        <SettingsArrFieldSet legend="Community guide">
          <button
            type="button"
            onClick={() => {
              if (
                !settings.integrations?.lidarr?.url ||
                !settings.integrations?.lidarr?.apiKey
              ) {
                showError("Please configure Lidarr URL and API key first");
                return;
              }
              setShowCommunityGuideModal(true);
            }}
            disabled={applyingCommunityGuide || !health?.lidarrConfigured}
            className="arr-btn arr-btn--primary"
          >
            {applyingCommunityGuide
              ? "Applying..."
              : "Apply Davo's Recommended Settings"}
          </button>
          <p className="arr-form-help arr-form-help--spaced">
            Creates quality profile, updates quality definitions, adds custom
            formats, and updates naming scheme.{" "}
            <a
              href="https://wiki.servarr.com/lidarr/community-guide"
              target="_blank"
              rel="noopener noreferrer"
              className="arr-link"
            >
              Read more
            </a>
          </p>
        </SettingsArrFieldSet>
      ) : null}
    </>
  );
}
