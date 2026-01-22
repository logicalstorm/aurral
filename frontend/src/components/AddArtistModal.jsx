import { useState, useEffect } from "react";

import { X, Loader, CheckCircle, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import {
  getLidarrRootFolders,
  getLidarrQualityProfiles,
  getLidarrMetadataProfiles,
  addArtistToLidarr,
  getAppSettings,
} from "../utils/api";

function AddArtistModal({ artist, onClose, onSuccess }) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [showOptions, setShowOptions] = useState(false);
  const [rootFolders, setRootFolders] = useState([]);
  const [qualityProfiles, setQualityProfiles] = useState([]);
  const [metadataProfiles, setMetadataProfiles] = useState([]);
  const [selectedRootFolder, setSelectedRootFolder] = useState("");
  const [selectedQualityProfile, setSelectedQualityProfile] = useState("");
  const [selectedMetadataProfile, setSelectedMetadataProfile] = useState("");
  const [monitored, setMonitored] = useState(true);
  const [monitorOption, setMonitorOption] = useState("none");
  const [searchForMissingAlbums, setSearchForMissingAlbums] = useState(false);
  const [albumFolders, setAlbumFolders] = useState(true);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  useEffect(() => {
    const fetchOptions = async () => {
      setLoading(true);
      setError(null);

      try {
        const [folders, quality, metadata, savedSettings] = await Promise.all([
          getLidarrRootFolders(),
          getLidarrQualityProfiles(),
          getLidarrMetadataProfiles(),
          getAppSettings(),
        ]);

        setRootFolders(folders);
        setQualityProfiles(quality);
        setMetadataProfiles(metadata);

        setSelectedRootFolder(
          savedSettings.rootFolderPath || (folders[0]?.path ?? ""),
        );
        setSelectedQualityProfile(
          savedSettings.qualityProfileId || (quality[0]?.id ?? ""),
        );
        setSelectedMetadataProfile(
          savedSettings.metadataProfileId || (metadata[0]?.id ?? ""),
        );
        setMonitored(savedSettings.monitored ?? true);
        setSearchForMissingAlbums(savedSettings.searchForMissingAlbums ?? false);
        setAlbumFolders(savedSettings.albumFolders ?? true);
      } catch (err) {
        setError(
          err.response?.data?.message || "Failed to load configuration options",
        );
      } finally {
        setLoading(false);
      }
    };

    fetchOptions();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (
      !selectedRootFolder ||
      !selectedQualityProfile ||
      !selectedMetadataProfile
    ) {
      setError("Please select all required options");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await addArtistToLidarr({
        foreignArtistId: artist.id,
        artistName: artist.name,
        qualityProfileId: parseInt(selectedQualityProfile),
        metadataProfileId: parseInt(selectedMetadataProfile),
        rootFolderPath: selectedRootFolder,
        monitored,
        monitor: monitorOption,
        searchForMissingAlbums,
        albumFolders,
      });

      onSuccess(artist);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to add artist to Lidarr");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-xl z-10">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Add Artist to Lidarr
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {artist.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            disabled={submitting}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="px-6 py-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader className="w-12 h-12 text-primary-600 animate-spin mb-4" />
              <p className="text-gray-600 dark:text-gray-400">
                Loading configuration options...
              </p>
            </div>
          ) : error ? (
            <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-500/20 rounded-lg p-4 flex items-start">
              <AlertCircle className="w-5 h-5 text-red-500 mr-3 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-red-900 dark:text-red-400 font-semibold">
                  Error
                </h3>
                <p className="text-red-700 dark:text-red-300 mt-1">{error}</p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="btn btn-primary flex-1 disabled:opacity-50 h-12"
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader className="w-5 h-5 animate-spin mr-2" />
                      Adding to Lidarr...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-5 h-5 mr-2" />
                      Add to Lidarr
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowOptions(!showOptions)}
                  className="btn btn-secondary flex items-center justify-center px-4"
                  title="Advanced Options"
                  disabled={submitting}
                >
                  {showOptions ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
              </div>

              {showOptions && (
                <div className="space-y-6 pt-4 border-t border-gray-200 dark:border-gray-800">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Root Folder <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={selectedRootFolder}
                      onChange={(e) => setSelectedRootFolder(e.target.value)}
                      className="input"
                      required
                      disabled={submitting}
                    >
                      {rootFolders.map((folder) => (
                        <option key={folder.id} value={folder.path}>
                          {folder.path}
                          {folder.freeSpace &&
                            ` (${(folder.freeSpace / 1024 / 1024 / 1024).toFixed(2)} GB free)`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Quality Profile <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={selectedQualityProfile}
                      onChange={(e) => setSelectedQualityProfile(e.target.value)}
                      className="input"
                      required
                      disabled={submitting}
                    >
                      {qualityProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Metadata Profile <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={selectedMetadataProfile}
                      onChange={(e) => setSelectedMetadataProfile(e.target.value)}
                      className="input"
                      required
                      disabled={submitting}
                    >
                      {metadataProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-800">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                      Options
                    </h3>

                    <div className="flex items-start">
                      <div className="flex items-center h-5">
                        <input
                          type="checkbox"
                          id="monitored"
                          checked={monitored}
                          onChange={(e) => setMonitored(e.target.checked)}
                          className="w-4 h-4 text-primary-600 border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded focus:ring-primary-500"
                          disabled={submitting}
                        />
                      </div>
                      <div className="ml-3">
                        <label
                          htmlFor="monitored"
                          className="font-medium text-gray-700 dark:text-gray-300"
                        >
                          Monitor Artist
                        </label>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Lidarr will search for and download new releases
                        </p>
                      </div>
                    </div>

                    {monitored && (
                        <div className="ml-8 mb-4">
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Monitor Option
                          </label>
                          <select
                            value={monitorOption}
                            onChange={(e) => setMonitorOption(e.target.value)}
                            className="input text-sm"
                            disabled={submitting}
                          >
                             <option value="all">All Albums</option>
                             <option value="future">Future Albums</option>
                             <option value="missing">Missing Albums</option>
                             <option value="latest">Latest Album</option>
                             <option value="first">First Album</option>
                             <option value="none">None (Artist Only)</option>
                          </select>
                        </div>
                    )}

                    <div className="flex items-start">
                      <div className="flex items-center h-5">
                        <input
                          type="checkbox"
                          id="searchForMissingAlbums"
                          checked={searchForMissingAlbums}
                          onChange={(e) =>
                            setSearchForMissingAlbums(e.target.checked)
                          }
                          className="w-4 h-4 text-primary-600 border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded focus:ring-primary-500"
                          disabled={submitting}
                        />
                      </div>
                      <div className="ml-3">
                        <label
                          htmlFor="searchForMissingAlbums"
                          className="font-medium text-gray-700 dark:text-gray-300"
                        >
                          Search for Missing Albums on Add
                        </label>
                      </div>
                    </div>

                    <div className="flex items-start">
                      <div className="flex items-center h-5">
                        <input
                          type="checkbox"
                          id="albumFolders"
                          checked={albumFolders}
                          onChange={(e) => setAlbumFolders(e.target.checked)}
                          className="w-4 h-4 text-primary-600 border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded focus:ring-primary-500"
                          disabled={submitting}
                        />
                      </div>
                      <div className="ml-3">
                        <label
                          htmlFor="albumFolders"
                          className="font-medium text-gray-700 dark:text-gray-300"
                        >
                          Create Album Folders
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {!showOptions && (
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="btn btn-secondary flex-1"
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                </div>
              )}

              {showOptions && (
                 <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-800">
                    <button
                      type="button"
                      onClick={onClose}
                      className="btn btn-secondary flex-1"
                      disabled={submitting}
                    >
                      Cancel
                    </button>
                 </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default AddArtistModal;

