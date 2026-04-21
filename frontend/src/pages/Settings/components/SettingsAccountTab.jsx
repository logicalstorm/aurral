import { useState } from "react";
import { Pencil } from "lucide-react";
import FlipSaveButton from "../../../components/FlipSaveButton";

export function SettingsAccountTab({
  listenHistoryProvider,
  setListenHistoryProvider,
  listenHistoryUsername,
  setListenHistoryUsername,
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
              Listening History
            </h3>
            <div className="flex items-center gap-2">
              {listenHistoryUsername && !editing && (
                <span className="text-sm" style={{ color: "#c1c1c3" }}>
                  {listenHistoryProvider === "listenbrainz"
                    ? `ListenBrainz: ${listenHistoryUsername}`
                    : `Last.fm: ${listenHistoryUsername}`}
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
                    ? "Lock listening history settings"
                    : "Edit listening history settings"
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
                Provider
              </label>
              <select
                className="input"
                value={listenHistoryProvider}
                onChange={(e) => setListenHistoryProvider(e.target.value)}
              >
                <option value="lastfm">Last.fm</option>
                <option value="listenbrainz">ListenBrainz</option>
              </select>
            </div>
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
                placeholder={
                  listenHistoryProvider === "listenbrainz"
                    ? "Your ListenBrainz username"
                    : "Your Last.fm username"
                }
                autoComplete="off"
                value={listenHistoryUsername}
                onChange={(e) => setListenHistoryUsername(e.target.value)}
              />
              <p className="mt-1 text-xs" style={{ color: "#c1c1c3" }}>
                Connect Last.fm or ListenBrainz for personalized discovery
                recommendations based on your listening history.
              </p>
            </div>
          </fieldset>
        </div>
      </form>
    </div>
  );
}
