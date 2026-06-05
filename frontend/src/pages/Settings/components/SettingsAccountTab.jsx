import FlipSaveButton from "../../../components/FlipSaveButton";
import { SettingsInput, SettingsSelect } from "./SettingsField";

export function SettingsAccountTab({
  listenHistoryProvider,
  setListenHistoryProvider,
  listenHistoryUsername,
  setListenHistoryUsername,
  lidarrConfigured,
  lidarrRootFolders,
  lidarrQualityProfiles,
  lidarrRootFolderPath,
  setLidarrRootFolderPath,
  lidarrQualityProfileId,
  setLidarrQualityProfileId,
  hasUnsavedChanges,
  loading,
  saving,
  handleSave,
}) {
  if (loading) {
    return (
      <div className="settings-page__panel">
        <p >Loading...</p>
      </div>
    );
  }

  return (
    <div className="settings-page__panel">
      <div className="settings-page__panel-header">
        <h2
          className="settings-page__panel-title"
          
        >
          Profile
        </h2>
        <FlipSaveButton
          saving={saving}
          disabled={!hasUnsavedChanges}
          onClick={handleSave}
        />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
        className="settings-page__form"
        autoComplete="off"
      >
        <div
          className="settings-page__section"
        >
          <div className="settings-page__section-header">
            <h3
              className="settings-page__section-title"
              
            >
              Listening History
            </h3>
            <div className="flex items-center gap-2">
              {listenHistoryUsername && (
                <span className="text-sm" >
                  {listenHistoryProvider === "listenbrainz"
                    ? `ListenBrainz: ${listenHistoryUsername}`
                    : `Last.fm: ${listenHistoryUsername}`}
                </span>
              )}
            </div>
          </div>
          <fieldset className="settings-page__fields">
            <div>
              <label
                className="artist-field-label"
              >
                Provider
              </label>
              <SettingsSelect
                value={listenHistoryProvider}
                onChange={(e) => setListenHistoryProvider(e.target.value)}
              >
                <option value="lastfm">Last.fm</option>
                <option value="listenbrainz">ListenBrainz</option>
              </SettingsSelect>
            </div>
            <div>
              <label
                className="artist-field-label"
              >
                Username
              </label>
              <SettingsInput type="text"

                placeholder={
                  listenHistoryProvider === "listenbrainz"
                    ? "Your ListenBrainz username"
                    : "Your Last.fm username"
                }
                autoComplete="off"
                value={listenHistoryUsername}
                onChange={(e) => setListenHistoryUsername(e.target.value)}
              />
              <p className="settings-page__hint">
                Connect Last.fm or ListenBrainz for personalized discovery
                recommendations based on your listening history.
              </p>
            </div>
          </fieldset>
        </div>

        <div
          className="settings-page__section"
        >
          <div className="mb-2">
            <h3
              className="settings-page__section-title"
              
            >
              Library Defaults
            </h3>
            <p className="mt-1 text-sm" >
              These defaults apply to one-click artist adds unless you override
              them from the Customize action on the artist page.
            </p>
          </div>

          <fieldset
            disabled={!lidarrConfigured}
            className={`space-y-4 ${lidarrConfigured ? "" : "opacity-60"}`}
          >
            <div>
              <label
                className="artist-field-label"
              >
                Default Root Folder
              </label>
              <SettingsSelect
                value={lidarrRootFolderPath}
                onChange={(e) => setLidarrRootFolderPath(e.target.value)}
              >
                <option value="">Use automatic default</option>
                {lidarrRootFolders.map((folder) => (
                  <option key={folder.path} value={folder.path}>
                    {folder.path}
                  </option>
                ))}
              </SettingsSelect>
            </div>

            <div>
              <label
                className="artist-field-label"
              >
                Default Quality Profile
              </label>
              <SettingsSelect
                value={lidarrQualityProfileId}
                onChange={(e) => setLidarrQualityProfileId(e.target.value)}
              >
                <option value="">Use automatic default</option>
                {lidarrQualityProfiles.map((profile) => (
                  <option key={profile.id} value={String(profile.id)}>
                    {profile.name}
                  </option>
                ))}
              </SettingsSelect>
            </div>
          </fieldset>

          {!lidarrConfigured && (
            <p className="text-xs" >
              Lidarr must be configured by an admin before personal library
              defaults can be saved.
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
