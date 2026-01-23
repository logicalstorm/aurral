import { useState, useEffect } from "react";

import { X, Loader, CheckCircle, AlertCircle } from "lucide-react";
import {
  addArtistToLibrary,
  getAppSettings,
} from "../utils/api";

function AddArtistModal({ artist, onClose, onSuccess }) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [selectedQuality, setSelectedQuality] = useState("standard");

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
        const savedSettings = await getAppSettings();
        setSelectedQuality(savedSettings.quality || "standard");
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

    setSubmitting(true);
    setError(null);

    try {
      await addArtistToLibrary({
        foreignArtistId: artist.id,
        artistName: artist.name,
        quality: selectedQuality,
      });

      onSuccess(artist);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to add artist to library");
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
              Add Artist to Library
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
            <form onSubmit={handleSubmit} className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Music Library Path
                    </label>
                    <div className="input bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 cursor-not-allowed">
                      /data
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Music library is stored at <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">/data</code>. 
                      In Docker, remap this path using volume mounts: <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">/your/path:/data</code>
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Quality Preset
                    </label>
                    <select
                      value={selectedQuality}
                      onChange={(e) => setSelectedQuality(e.target.value)}
                      className="input"
                      disabled={submitting}
                    >
                      <option value="low">Low (MP3 192-320kbps)</option>
                      <option value="standard">Standard (MP3 320kbps, FLAC) - Recommended</option>
                      <option value="max">Max (FLAC only)</option>
                    </select>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Standard uses optimization settings: Preferred Groups (DeVOiD, PERFECT, ENRiCH), prefers CD/WEB, avoids Vinyl
                    </p>
                  </div>

              <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-800">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn btn-secondary flex-1"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary flex-1"
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader className="w-4 h-4 mr-2 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    "Add Artist"
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default AddArtistModal;

