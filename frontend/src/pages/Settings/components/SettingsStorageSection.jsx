import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import DownloadFolderField from "../../../components/DownloadFolderField";
import { SettingsInput, SettingsSelect } from "./SettingsField";
import { StorageHealthDashboard } from "./StorageHealthDashboard";
import { getStorageHealth } from "../../../utils/api";
import { setStorageHealthResult } from "../../../hooks/storageHealthStatus";

const PATH_MAPPING_SOURCE_OPTIONS = [
  { value: "all", label: "All sources" },
  { value: "lidarr", label: "Lidarr" },
  { value: "slskd", label: "slskd" },
  { value: "nzbget", label: "NZBGet" },
];

const PATH_MAPPING_SOURCE_VALUES = new Set(
  PATH_MAPPING_SOURCE_OPTIONS.map((option) => option.value),
);

function normalizePathMappingSource(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return PATH_MAPPING_SOURCE_VALUES.has(normalized) ? normalized : "all";
}

function coercePathMappings(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => ({
    source: normalizePathMappingSource(entry?.source),
    remote: String(entry?.remote || "").trim(),
    local: String(entry?.local || "").trim(),
  }));
}

function withDraftPathMappingRow(pathMappings) {
  return pathMappings.length
    ? pathMappings
    : [{ source: "all", remote: "", local: "" }];
}

export function SettingsStorageSection({
  settings,
  updateSettings,
  hasUnsavedChanges,
  handleSaveSettings,
  showSuccess,
  showError,
}) {
  const [healthResult, setHealthResult] = useState(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [showPathMappings, setShowPathMappings] = useState(false);
  const [autoChecked, setAutoChecked] = useState(false);

  const pathMappings = coercePathMappings(settings.pathMappings);
  const displayedPathMappings = withDraftPathMappingRow(pathMappings);
  const hasSavedPathMappings = pathMappings.some(
    (entry) => entry.remote || entry.local,
  );
  const pathMappingsVisible = showPathMappings || hasSavedPathMappings;

  const updatePathMappings = (nextMappings) => {
    updateSettings({
      ...settings,
      pathMappings: coercePathMappings(nextMappings),
    });
  };

  const runHealthCheck = useCallback(
    async ({ notify = true } = {}) => {
      setCheckingHealth(true);
      try {
        if (hasUnsavedChanges) {
          await handleSaveSettings();
        }
        const result = await getStorageHealth();
        setHealthResult(result);
        setStorageHealthResult(result);
        if (notify) {
          if (result.ok && !result.partial) {
            showSuccess("Storage checks passed");
          } else if (result.ok) {
            showSuccess("Storage checks finished with warnings");
          } else {
            showError(
              "Storage checks found problems. Review the results below.",
            );
          }
        }
        return result;
      } catch (error) {
        const message =
          error.response?.data?.message ||
          error.response?.data?.error ||
          error.message ||
          "Storage health check failed";
        if (notify) {
          showError(message);
        }
        setHealthResult(null);
        return null;
      } finally {
        setCheckingHealth(false);
      }
    },
    [hasUnsavedChanges, handleSaveSettings, showError, showSuccess],
  );

  useEffect(() => {
    if (autoChecked) return;
    setAutoChecked(true);
    runHealthCheck({ notify: false });
  }, [autoChecked, runHealthCheck]);

  return (
    <>
      <div className="settings-page__section">
        <div className="settings-page__section-header">
          <div className="settings-page__section-intro">
            <h3 className="settings-page__section-title">Storage health</h3>
            <p className="settings-page__section-note">
              Verifies Aurral, Lidarr, download clients, and Navidrome all see
              the same files on disk. Mount one shared host folder at the same
              container path, such as <code>/mnt/user/data:/data</code>.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => runHealthCheck({ notify: true })}
            disabled={checkingHealth}
          >
            <RefreshCw
              className={`artist-icon-sm${checkingHealth ? " animate-spin" : ""}`}
            />
            {checkingHealth ? "Checking…" : "Run checks"}
          </button>
        </div>
        <StorageHealthDashboard result={healthResult} loading={checkingHealth} />
      </div>

      <div className="settings-page__section">
        <div className="settings-page__section-intro">
          <h3 className="settings-page__section-title">Downloads folder</h3>
          <p className="settings-page__section-note">
            Aurral writes generated playlists and imported tracks here. Navidrome
            and your download clients should use paths under the same shared
            mount.
          </p>
        </div>
        <fieldset className="settings-page__fields">
          <div className="settings-page__field">
            <label className="artist-field-label" htmlFor="storage-download-folder">
              Path
            </label>
            <DownloadFolderField
              id="storage-download-folder"
              value={settings.downloadFolderPath || ""}
              autoApplySuggestion={false}
              onChange={(nextPath) =>
                updateSettings({
                  ...settings,
                  downloadFolderPath: nextPath,
                })
              }
              helperText="Example: /data/media/aurral_flow or /data/downloads/aurral"
            />
          </div>
        </fieldset>
      </div>

      <div className="settings-page__section">
        <div className="settings-page__section-intro">
          <h3 className="settings-page__section-title">
            Advanced path mappings
          </h3>
          <p className="settings-page__section-note">
            Only needed when another app reports a path Aurral cannot read
            directly. Prefer fixing Docker mounts first.
          </p>
        </div>
        {!pathMappingsVisible ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowPathMappings(true)}
          >
            Show path mappings
          </button>
        ) : (
          <fieldset className="settings-page__fields">
            {displayedPathMappings.map((mapping, index) => (
              <div
                className="settings-page__mapping-row"
                key={`path-mapping-${index}`}
              >
                <div className="settings-page__field">
                  <label className="artist-field-label">Applies to</label>
                  <SettingsSelect
                    value={mapping.source}
                    onChange={(event) => {
                      const nextMappings = [...displayedPathMappings];
                      nextMappings[index] = {
                        ...nextMappings[index],
                        source: event.target.value,
                      };
                      updatePathMappings(nextMappings);
                    }}
                  >
                    {PATH_MAPPING_SOURCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </SettingsSelect>
                </div>
                <div className="settings-page__field">
                  <label className="artist-field-label">Reported path</label>
                  <SettingsInput
                    value={mapping.remote}
                    placeholder="/data/media/music"
                    onChange={(event) => {
                      const nextMappings = [...displayedPathMappings];
                      nextMappings[index] = {
                        ...nextMappings[index],
                        remote: event.target.value,
                      };
                      updatePathMappings(nextMappings);
                    }}
                  />
                </div>
                <div className="settings-page__field">
                  <label className="artist-field-label">Aurral path</label>
                  <DownloadFolderField
                    id={`storage-path-mapping-local-${index}`}
                    value={mapping.local}
                    autoApplySuggestion={false}
                    createOnConfirm={false}
                    onChange={(nextPath) => {
                      const nextMappings = [...displayedPathMappings];
                      nextMappings[index] = {
                        ...nextMappings[index],
                        local: nextPath,
                      };
                      updatePathMappings(nextMappings);
                    }}
                  />
                </div>
                <div className="settings-page__mapping-row-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon-square"
                    aria-label="Remove path mapping"
                    onClick={() => {
                      updatePathMappings(
                        displayedPathMappings.filter(
                          (_entry, entryIndex) => entryIndex !== index,
                        ),
                      );
                    }}
                  >
                    <Trash2 className="artist-icon-sm" aria-hidden />
                  </button>
                </div>
              </div>
            ))}
            <div className="settings-page__lidarr-access-row">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() =>
                  updatePathMappings([
                    ...displayedPathMappings,
                    { source: "all", remote: "", local: "" },
                  ])
                }
              >
                Add mapping
              </button>
              {!hasSavedPathMappings ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowPathMappings(false)}
                >
                  Hide mappings
                </button>
              ) : null}
            </div>
          </fieldset>
        )}
      </div>
    </>
  );
}
