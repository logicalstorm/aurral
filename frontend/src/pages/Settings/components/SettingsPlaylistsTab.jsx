import { ListMusic } from "lucide-react";
import FlipSaveButton from "../../../components/FlipSaveButton";
import { SettingsSelect } from "./SettingsField";

const PLAYLIST_ARTWORK_STYLE_OPTIONS = [
  { value: "photo", label: "Photo texture" },
  { value: "aurral", label: "Aurral generated" },
];

export function SettingsPlaylistsTab({
  settings,
  updateSettings,
  hasUnsavedChanges,
  saving,
  handleSaveSettings,
}) {
  const playlistArtworkStyle =
    settings.playlistArtwork?.style === "aurral" ? "aurral" : "photo";

  return (
    <div className="settings-page__panel">
      <div className="settings-page__panel-header">
        <h2 className="settings-page__panel-title">
          <ListMusic className="settings-page__panel-title-icon" />
          Playlists
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
                onChange={(e) =>
                  updateSettings({
                    ...settings,
                    playlistArtwork: {
                      ...(settings.playlistArtwork || {}),
                      style: e.target.value,
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
                Applies to recommended flows, user flows, flow drafts, and
                shared playlists. Photo texture uses a random image or
                related-artist photo with stylized typography. Aurral generated
                uses abstract palette covers.
              </p>
            </div>
          </fieldset>
        </div>
      </form>
    </div>
  );
}
