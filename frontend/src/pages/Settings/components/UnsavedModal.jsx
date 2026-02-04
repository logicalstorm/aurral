import { AlertTriangle } from "lucide-react";

export function UnsavedModal({ show, onCancel, onConfirm }) {
  if (!show) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.75)" }}
      onClick={onCancel}
    >
      <div
        className="card max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start mb-4">
          <AlertTriangle className="w-6 h-6 text-yellow-500 mr-3 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3
              className="text-xl font-bold mb-2"
              style={{ color: "#fff" }}
            >
              Unsaved Changes
            </h3>
            <p style={{ color: "#c1c1c3" }}>
              You have unsaved changes. Are you sure you want to leave? Your
              changes will be lost.
            </p>
          </div>
        </div>
        <div className="flex gap-3 justify-end mt-6">
          <button onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="btn btn-primary"
            style={{ backgroundColor: "#ef4444" }}
          >
            Leave Without Saving
          </button>
        </div>
      </div>
    </div>
  );
}
