import PropTypes from "prop-types";
import { Loader } from "lucide-react";

export function AddArtistCustomizeModal({
  show,
  artistName,
  loading,
  preferences,
  rootFolderPath,
  setRootFolderPath,
  qualityProfileId,
  setQualityProfileId,
  tagId,
  setTagId,
  onClose,
  onConfirm,
  confirming,
}) {
  if (!show) return null;

  const rootFolders = Array.isArray(preferences?.rootFolders)
    ? preferences.rootFolders
    : [];
  const qualityProfiles = Array.isArray(preferences?.qualityProfiles)
    ? preferences.qualityProfiles
    : [];
  const tags = Array.isArray(preferences?.tags) ? preferences.tags : [];
  const configured = preferences?.configured === true;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.75)" }}
      onClick={confirming ? undefined : onClose}
    >
      <div
        className="card max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4">
          <h3 className="text-xl font-bold mb-2" style={{ color: "#fff" }}>
            Customize Add
          </h3>
          <p style={{ color: "#c1c1c3" }}>
            Choose where <strong>{artistName}</strong> should go for this add
            only.
          </p>
        </div>

        {loading ? (
          <div className="py-10 flex items-center justify-center">
            <Loader
              className="w-8 h-8 animate-spin"
              style={{ color: "#c1c1c3" }}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: "#fff" }}
              >
                Root Folder
              </label>
              <select
                className="input"
                value={rootFolderPath}
                onChange={(e) => setRootFolderPath(e.target.value)}
                disabled={!configured || confirming}
              >
                <option value="">
                  {configured
                    ? "Use automatic default"
                    : "Lidarr is not configured"}
                </option>
                {rootFolders.map((folder) => (
                  <option key={folder.path} value={folder.path}>
                    {folder.path}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: "#fff" }}
              >
                Quality Profile
              </label>
              <select
                className="input"
                value={qualityProfileId}
                onChange={(e) => setQualityProfileId(e.target.value)}
                disabled={!configured || confirming}
              >
                <option value="">
                  {configured
                    ? "Use automatic default"
                    : "Lidarr is not configured"}
                </option>
                {qualityProfiles.map((profile) => (
                  <option key={profile.id} value={String(profile.id)}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: "#fff" }}
              >
                Tag
              </label>
              <select
                className="input"
                value={tagId}
                onChange={(e) => setTagId(e.target.value)}
                disabled={!configured || confirming}
              >
                <option value="">
                  {configured
                    ? "Use saved global default"
                    : "Lidarr is not configured"}
                </option>
                {tags.map((tag) => (
                  <option key={tag.id} value={String(tag.id)}>
                    {tag.label}
                  </option>
                ))}
              </select>
            </div>

            <p className="text-xs" style={{ color: "#c1c1c3" }}>
              Leaving a field on automatic uses your saved Library Defaults, or
              the global Lidarr fallback when you do not have a saved default.
              Leaving tag on automatic uses the global Lidarr tag setting.
            </p>
          </div>
        )}

        <div className="flex gap-3 justify-end mt-6">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary"
            disabled={confirming}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="btn btn-primary"
            disabled={loading || !configured || confirming}
          >
            {confirming ? "Adding..." : "Add Artist"}
          </button>
        </div>
      </div>
    </div>
  );
}

AddArtistCustomizeModal.propTypes = {
  show: PropTypes.bool,
  artistName: PropTypes.string,
  loading: PropTypes.bool,
  preferences: PropTypes.shape({
    configured: PropTypes.bool,
    rootFolders: PropTypes.arrayOf(
      PropTypes.shape({
        path: PropTypes.string,
      }),
    ),
    qualityProfiles: PropTypes.arrayOf(
      PropTypes.shape({
        id: PropTypes.number,
        name: PropTypes.string,
      }),
    ),
    tags: PropTypes.arrayOf(
      PropTypes.shape({
        id: PropTypes.number,
        label: PropTypes.string,
      }),
    ),
  }),
  rootFolderPath: PropTypes.string,
  setRootFolderPath: PropTypes.func,
  qualityProfileId: PropTypes.string,
  setQualityProfileId: PropTypes.func,
  tagId: PropTypes.string,
  setTagId: PropTypes.func,
  onClose: PropTypes.func,
  onConfirm: PropTypes.func,
  confirming: PropTypes.bool,
};
