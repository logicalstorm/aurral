import { useState } from "react";
import { Pencil } from "lucide-react";
import FlipSaveButton from "../../../components/FlipSaveButton";

export function SettingsAccountTab({
  lastfmUsername,
  setLastfmUsername,
  hasUnsavedChanges,
  loading,
  saving,
  handleSave,
}) {
  const [editing, setEditing] = useState(false);

  if (loading) {
    return (
      <div className="card animate-fade-in">
        <p style={{ color: "#c1c1c3" }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className="card animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h2
          className="text-2xl font-bold flex items-center"
          style={{ color: "#fff" }}
        >
          My Account
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
        className="space-y-6"
        autoComplete="off"
      >
        <div
          className="p-6 rounded-lg space-y-4"
          style={{
            backgroundColor: "#1a1a1e",
            border: "1px solid #2a2a2e",
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <h3
              className="text-lg font-medium flex items-center"
              style={{ color: "#fff" }}
            >
              Last.fm
            </h3>
            <div className="flex items-center gap-2">
              {lastfmUsername && !editing && (
                <span className="text-sm" style={{ color: "#c1c1c3" }}>
                  {lastfmUsername}
                </span>
              )}
              <button
                type="button"
                className={`btn ${
                  editing ? "btn-primary" : "btn-secondary"
                } px-2 py-1`}
                onClick={() => setEditing((v) => !v)}
                aria-label={
                  editing
                    ? "Lock Last.fm settings"
                    : "Edit Last.fm settings"
                }
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          </div>
          <fieldset
            disabled={!editing}
            className={`space-y-4 ${editing ? "" : "opacity-60"}`}
          >
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: "#fff" }}
              >
                Username
              </label>
              <input
                type="text"
                className="input"
                placeholder="Your Last.fm username"
                autoComplete="off"
                value={lastfmUsername}
                onChange={(e) => setLastfmUsername(e.target.value)}
              />
              <p className="mt-1 text-xs" style={{ color: "#c1c1c3" }}>
                Connect your Last.fm account for personalized discovery
                recommendations based on your listening history.
              </p>
            </div>
          </fieldset>
        </div>
      </form>
    </div>
  );
}
