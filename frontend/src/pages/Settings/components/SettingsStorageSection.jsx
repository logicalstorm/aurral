import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Trash2, Wrench } from "lucide-react";
import DownloadFolderField from "../../../components/DownloadFolderField";
import { StorageHealthDashboard } from "./StorageHealthDashboard";
import { getStorageHealth } from "../../../utils/api";
import { setStorageHealthResult } from "../../../hooks/storageHealthStatus";
import {
  SettingsArrFieldSet,
  SettingsArrFormGroup,
} from "./arr/SettingsArrLayout";
import {
  PATH_MAPPING_SOURCE_OPTIONS,
  PathMappingModal,
} from "./PathMappingModal";

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

function sourceLabel(source) {
  return (
    PATH_MAPPING_SOURCE_OPTIONS.find((option) => option.value === source)?.label ||
    source
  );
}

export function SettingsStorageSection({
  settings,
  updateSettings,
  hasUnsavedChanges,
  handleSaveSettings,
  health,
  showSuccess,
  showError,
}) {
  const [healthResult, setHealthResult] = useState(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [autoChecked, setAutoChecked] = useState(false);
  const [mappingModal, setMappingModal] = useState(null);

  const pathMappings = coercePathMappings(settings.pathMappings).filter(
    (entry) => entry.remote || entry.local,
  );

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

  const openAddMapping = () => {
    setMappingModal({ mode: "add", index: null });
  };

  const openEditMapping = (index) => {
    setMappingModal({ mode: "edit", index });
  };

  const closeMappingModal = () => {
    setMappingModal(null);
  };

  const saveMapping = (mapping) => {
    if (mappingModal?.mode === "edit" && mappingModal.index != null) {
      const nextMappings = [...pathMappings];
      nextMappings[mappingModal.index] = mapping;
      updatePathMappings(nextMappings);
    } else {
      updatePathMappings([...pathMappings, mapping]);
    }
    closeMappingModal();
  };

  const deleteMapping = (index) => {
    updatePathMappings(pathMappings.filter((_entry, entryIndex) => entryIndex !== index));
  };

  return (
    <>
      <SettingsArrFieldSet
        legend="Storage Health"
        actions={
          <button
            type="button"
            className="arr-btn"
            onClick={() => runHealthCheck({ notify: true })}
            disabled={checkingHealth}
          >
            <RefreshCw
              className={`artist-icon-sm${checkingHealth ? " animate-spin" : ""}`}
            />
            {checkingHealth ? "Checking…" : "Run Checks"}
          </button>
        }
      >
        <p className="arr-form-help">
          Verifies Aurral, Lidarr, download clients, and Navidrome all see the
          same files on disk. Mount one shared host folder at the same container
          path in every app, such as <code>/mnt/user/data:/data</code>.
        </p>
        <StorageHealthDashboard result={healthResult} loading={checkingHealth} />
      </SettingsArrFieldSet>

      <SettingsArrFieldSet legend="Downloads Folder">
        <SettingsArrFormGroup
          label="Path"
          labelFor="storage-download-folder"
          help="Example: /data/media/aurral_flow or /data/downloads/aurral"
        >
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
          />
        </SettingsArrFormGroup>
      </SettingsArrFieldSet>

      <SettingsArrFieldSet legend="Remote Path Mappings">
        <div className="arr-info">
          Remote path mappings are rarely required. If Aurral and your download
          clients share the same container mounts, match paths instead of adding
          mappings here.
        </div>

        <div className="arr-table-wrap">
          <table className="arr-table">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Remote Path</th>
                <th scope="col">Local Path</th>
                <th scope="col" className="arr-table__actions-head">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pathMappings.length === 0 ? (
                <tr className="arr-table__empty-row">
                  <td colSpan={4}>No path mappings configured.</td>
                </tr>
              ) : (
                pathMappings.map((mapping, index) => (
                  <tr key={`path-mapping-${index}`}>
                    <td>{sourceLabel(mapping.source)}</td>
                    <td>
                      <code className="arr-table__path">{mapping.remote}</code>
                    </td>
                    <td>
                      <code className="arr-table__path">{mapping.local}</code>
                    </td>
                    <td className="arr-table__actions">
                      <div className="arr-table__actions-inner">
                        <button
                          type="button"
                          className="arr-btn arr-btn--ghost arr-btn--icon"
                          aria-label={`Edit path mapping ${index + 1}`}
                          onClick={() => openEditMapping(index)}
                        >
                          <Wrench className="artist-icon-sm" aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="arr-btn arr-btn--ghost arr-btn--icon"
                          aria-label={`Delete path mapping ${index + 1}`}
                          onClick={() => deleteMapping(index)}
                        >
                          <Trash2 className="artist-icon-sm" aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="arr-table-footer">
          <button
            type="button"
            className="arr-btn arr-btn--ghost arr-btn--icon"
            aria-label="Add path mapping"
            onClick={openAddMapping}
          >
            <Plus className="artist-icon-sm" aria-hidden />
          </button>
        </div>
      </SettingsArrFieldSet>

      {mappingModal ? (
        <PathMappingModal
          title={
            mappingModal.mode === "edit"
              ? "Edit Remote Path Mapping"
              : "Add Remote Path Mapping"
          }
          initialValue={
            mappingModal.mode === "edit" && mappingModal.index != null
              ? pathMappings[mappingModal.index]
              : undefined
          }
          onClose={closeMappingModal}
          onSave={saveMapping}
        />
      ) : null}

      <SettingsArrFieldSet legend="About">
        <dl className="arr-meta-grid arr-meta-grid--two-col">
          <div>
            <dt className="arr-meta-term">Version</dt>
            <dd className="arr-meta-value">{health?.appVersion || "—"}</dd>
          </div>
          <div>
            <dt className="arr-meta-term">Documentation</dt>
            <dd className="arr-meta-value">
              <a
                href="https://aurral.github.io/Aurral/"
                target="_blank"
                rel="noopener noreferrer"
                className="arr-link"
              >
                Aurral docs
              </a>
            </dd>
          </div>
        </dl>
      </SettingsArrFieldSet>
    </>
  );
}
