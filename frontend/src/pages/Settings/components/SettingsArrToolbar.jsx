import PropTypes from "prop-types";
import { Loader2, Save } from "lucide-react";

export function SettingsArrToolbar({
  hasPendingChanges = false,
  isSaving = false,
  onSave,
  showSave = true,
  children = null,
}) {
  const handleSave = (event) => {
    event.preventDefault();
    if (!hasPendingChanges || isSaving || !onSave) return;
    onSave(event);
  };

  return (
    <div className="settings-arr__toolbar">
      <div className="settings-arr__toolbar-section">
        {showSave ? (
          <button
            type="button"
            className={`settings-arr__toolbar-button${
              !hasPendingChanges || isSaving ? " is-disabled" : ""
            }`}
            disabled={!hasPendingChanges || isSaving}
            onClick={handleSave}
          >
            {isSaving ? (
              <Loader2
                className="settings-arr__toolbar-icon settings-arr__toolbar-icon--spin"
                aria-hidden
              />
            ) : (
              <Save className="settings-arr__toolbar-icon" aria-hidden />
            )}
            <span className="settings-arr__toolbar-label">
              {hasPendingChanges ? "Save Changes" : "No Changes"}
            </span>
          </button>
        ) : null}
        {children}
      </div>
    </div>
  );
}

SettingsArrToolbar.propTypes = {
  children: PropTypes.node,
  hasPendingChanges: PropTypes.bool,
  isSaving: PropTypes.bool,
  onSave: PropTypes.func,
  showSave: PropTypes.bool,
};
