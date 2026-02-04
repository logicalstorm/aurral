import { Loader } from "lucide-react";
import PropTypes from "prop-types";

export function DeleteArtistModal({
  show,
  artistName,
  libraryArtistName,
  deleteFiles,
  onDeleteFilesChange,
  onCancel,
  onConfirm,
  deleting,
}) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div
        className=" shadow-xl max-w-md w-full p-6"
        style={{ backgroundColor: "#211f27" }}
      >
        <h3 className="text-xl font-bold  mb-4" style={{ color: "#fff" }}>
          Remove Artist from Library
        </h3>
        <p className=" mb-6" style={{ color: "#fff" }}>
          Are you sure you want to remove{" "}
          <span className="font-semibold">
            {artistName || libraryArtistName}
          </span>{" "}
          from library?
        </p>

        <div className="mb-6">
          <label className="flex items-start space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={deleteFiles}
              onChange={(e) => onDeleteFilesChange(e.target.checked)}
              className="mt-1 form-checkbox h-5 w-5"
              style={{ color: "#c1c1c3" }}
            />
            <div className="flex-1">
              <span className=" font-medium" style={{ color: "#fff" }}>
                Delete artist folder and files
              </span>
              <p className="text-sm  mt-1" style={{ color: "#c1c1c3" }}>
                This will permanently delete the artist&apos;s folder and all
                music files from your disk. This action cannot be undone.
              </p>
            </div>
          </label>
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="btn btn-secondary"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="btn btn-danger"
          >
            {deleting ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" />
                Removing...
              </>
            ) : (
              "Remove Artist"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

DeleteArtistModal.propTypes = {
  show: PropTypes.bool,
  artistName: PropTypes.string,
  libraryArtistName: PropTypes.string,
  deleteFiles: PropTypes.bool,
  onDeleteFilesChange: PropTypes.func,
  onCancel: PropTypes.func,
  onConfirm: PropTypes.func,
  deleting: PropTypes.bool,
};
