import { useState } from "react";
import FlipSaveButton from "../../../components/FlipSaveButton";
import DownloadFolderField from "../../../components/DownloadFolderField";
import { SettingsInput, SettingsSelect } from "./SettingsField";
import { SettingsDownloadsSection } from "./SettingsDownloadsSection";
import { detectPathMappings } from "../../../utils/api";

const PLAYLIST_ARTWORK_STYLE_OPTIONS = [
  { value: "photo", label: "Photo texture" },
  { value: "aurral", label: "Aurral generated" },
];

function coercePathMappings(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => ({
    remote: String(entry?.remote || "").trim(),
    local: String(entry?.local || "").trim(),
  }));
}

function withDraftPathMappingRow(pathMappings) {
  return pathMappings.length ? pathMappings : [{ remote: "", local: "" }];
}

export function SettingsDownloadsTab({
  settings,
  updateSettings,
  health,
  hasUnsavedChanges,
  saving,
  handleSaveSettings,
  showSuccess,
  showError,
  showInfo,
}) {
  const [detectingMappings, setDetectingMappings] = useState(false);
  const playlistArtworkStyle =
    settings.playlistArtwork?.style === "aurral" ? "aurral" : "photo";
  const pathMappings = coercePathMappings(settings.pathMappings);
  const displayedPathMappings = withDraftPathMappingRow(pathMappings);

  const updatePathMappings = (nextMappings) => {
    updateSettings({
      ...settings,
      pathMappings: coercePathMappings(nextMappings),
    });
  };

  const handleDetectPathMappings = async () => {
    setDetectingMappings(true);
    try {
      const result = await detectPathMappings();
      if (!result?.mappings?.length) {
        showInfo(
          "No path mapping was detected. Mount your shared music folder into Aurral first.",
        );
        return;
      }
      updatePathMappings(result.mappings);
      if (result.verified) {
        showSuccess("Detected a working path mapping. Save settings to keep it.");
      } else {
        showInfo(
          "Detected a possible path mapping. Verify the local path, then save settings.",
        );
      }
    } catch (error) {
      showError(
        error.response?.data?.message ||
          error.response?.data?.error ||
          error.message ||
          "Path mapping detection failed",
      );
    } finally {
      setDetectingMappings(false);
    }
  };

  return (
    <div className="settings-page__panel">
      <div className="settings-page__panel-header">
        <h2 className="settings-page__panel-title">Downloads</h2>
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
        <SettingsDownloadsSection
          settings={settings}
          updateSettings={updateSettings}
          health={health}
          handleSaveSettings={handleSaveSettings}
          showSuccess={showSuccess}
          showError={showError}
          showInfo={showInfo}
        />

        <div className="settings-page__section">
          <h3 className="settings-page__section-title">Storage</h3>
          <fieldset className="settings-page__fields">
            <div className="settings-page__field">
              <label
                className="artist-field-label"
                htmlFor="download-folder-path"
              >
                Downloads folder
              </label>
              <DownloadFolderField
                id="download-folder-path"
                value={settings.downloadFolderPath || ""}
                autoApplySuggestion={false}
                onChange={(nextPath) =>
                  updateSettings({
                    ...settings,
                    downloadFolderPath: nextPath,
                  })
                }
                helperText="Folder where Aurral stores imported tracks and generated playlist files. Use a path your playback server can also read."
              />
            </div>
          </fieldset>
        </div>

        <div className="settings-page__section">
          <h3 className="settings-page__section-title">Path mappings</h3>
          <fieldset className="settings-page__fields">
            <p className="settings-page__hint">
              Translate paths reported by Lidarr or native download clients into
              paths Aurral can read. Example:{" "}
              <code>N:\ServerFolders\Music</code> to <code>/music</code>.
            </p>
            {displayedPathMappings.map((mapping, index) => (
              <div className="settings-page__mapping-row" key={`path-mapping-${index}`}>
                <div className="settings-page__field">
                  <label className="artist-field-label">Remote path</label>
                  <SettingsInput
                    value={mapping.remote}
                    placeholder="N:\ServerFolders\Music"
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
                  <label className="artist-field-label">Local path</label>
                  <SettingsInput
                    value={mapping.local}
                    placeholder="/music"
                    onChange={(event) => {
                      const nextMappings = [...displayedPathMappings];
                      nextMappings[index] = {
                        ...nextMappings[index],
                        local: event.target.value,
                      };
                      updatePathMappings(nextMappings);
                    }}
                  />
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
                    { remote: "", local: "" },
                  ])
                }
              >
                Add mapping
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={detectingMappings}
                onClick={handleDetectPathMappings}
              >
                {detectingMappings ? "Detecting..." : "Detect from Lidarr"}
              </button>
            </div>
            <p className="settings-page__hint">
              Fill in both paths, then save settings. Empty rows are ignored.
            </p>
          </fieldset>
        </div>

        <div className="settings-page__section">
          <h3 className="settings-page__section-title">Cover art</h3>
          <fieldset className="settings-page__fields">
            <div className="settings-page__field">
              <label
                className="artist-field-label"
                htmlFor="playlist-artwork-style"
              >
                Generated cover style
              </label>
              <SettingsSelect
                id="playlist-artwork-style"
                value={playlistArtworkStyle}
                onChange={(event) =>
                  updateSettings({
                    ...settings,
                    playlistArtwork: {
                      ...(settings.playlistArtwork || {}),
                      style: event.target.value,
                    },
                  })
                }
              >
                {PLAYLIST_ARTWORK_STYLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SettingsSelect>
              <p className="settings-page__hint">
                Applies to all flows and playlists. Photo texture uses a random
                image from picsum with stylized typography. Aurral generated
                uses abstract palette covers.
              </p>
            </div>
          </fieldset>
        </div>
      </form>
    </div>
  );
}
