import FlipSaveButton from "../../../components/FlipSaveButton";
import { SettingsSelect } from "./SettingsField";
import { SettingsPlaybackSection } from "./SettingsPlaybackSection";

const PLAYLIST_ARTWORK_STYLE_OPTIONS = [
  { value: "photo", label: "Photo texture" },
  { value: "aurral", label: "Aurral generated" },
];

export function SettingsPlaybackTab({
  settings,
  updateSettings,
  hasUnsavedChanges,
  saving,
  handleSaveSettings,
  showSuccess,
  showError,
  showInfo,
}) {
  const playlistArtworkStyle =
    settings.playlistArtwork?.style === "aurral" ? "aurral" : "photo";

  return (
    <div className="settings-page__panel">
      <div className="settings-page__panel-header">
        <h2 className="settings-page__panel-title">Playback</h2>
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
        <SettingsPlaybackSection
          settings={settings}
          updateSettings={updateSettings}
          hasUnsavedChanges={hasUnsavedChanges}
          handleSaveSettings={handleSaveSettings}
          showSuccess={showSuccess}
          showError={showError}
          showInfo={showInfo}
        />

        <div className="settings-page__section">
          <div className="settings-page__section-intro">
            <h3 className="settings-page__section-title">Cover art</h3>
            <p className="settings-page__section-note">
              Style for generated flow and playlist artwork.
            </p>
          </div>
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
                Photo texture uses a random image from picsum with stylized
                typography. Aurral generated uses abstract palette covers.
              </p>
            </div>
          </fieldset>
        </div>
      </form>
    </div>
  );
}
