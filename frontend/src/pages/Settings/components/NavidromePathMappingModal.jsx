import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Folder, X } from "lucide-react";
import DownloadFolderPickerModal from "../../../components/DownloadFolderPickerModal";
import { SettingsInput } from "./SettingsField";
import { SettingsArrFormGroup } from "./arr/SettingsArrLayout";

const EMPTY_MAPPING = { local: "", remote: "" };

export function NavidromePathMappingModal({
  title,
  initialValue,
  onClose,
  onSave,
}) {
  const [draft, setDraft] = useState(() => ({
    ...EMPTY_MAPPING,
    ...initialValue,
  }));
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    setDraft({ ...EMPTY_MAPPING, ...initialValue });
  }, [initialValue]);

  const handleSave = () => {
    const mapping = {
      local: String(draft.local || "").trim(),
      remote: String(draft.remote || "").trim(),
    };
    if (!mapping.local || !mapping.remote) return;
    onSave(mapping);
  };

  const canSave =
    Boolean(String(draft.local || "").trim()) &&
    Boolean(String(draft.remote || "").trim());

  return createPortal(
    <div className="arr-portal">
      <div className="arr-modal-backdrop" onClick={onClose}>
        <div
          className="arr-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="navidrome-path-mapping-modal-title"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="arr-modal__header">
            <h3
              id="navidrome-path-mapping-modal-title"
              className="arr-modal__title"
            >
              {title}
            </h3>
            <button
              type="button"
              className="arr-btn arr-btn--ghost arr-btn--icon"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="artist-icon-md" />
            </button>
          </div>
          <div className="arr-modal__body">
            <SettingsArrFormGroup
              label="Aurral Path"
              help="Path Aurral uses inside its container for downloaded tracks."
            >
              <div className="arr-path-input">
                <SettingsInput
                  className="arr-path-input__field"
                  value={draft.local}
                  placeholder="/data/media/aurral_flow"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      local: event.target.value,
                    }))
                  }
                />
                <button
                  type="button"
                  className="arr-path-input__browse"
                  onClick={() => setShowPicker(true)}
                  aria-label="Browse folders"
                >
                  <Folder className="artist-icon-xs" />
                </button>
              </div>
            </SettingsArrFormGroup>
            <SettingsArrFormGroup
              label="Navidrome Path"
              help="Path Navidrome uses to open the same folder in generated M3U files."
            >
              <SettingsInput
                value={draft.remote}
                placeholder="/music/aurral"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    remote: event.target.value,
                  }))
                }
              />
            </SettingsArrFormGroup>
          </div>
          <div className="arr-modal__footer">
            <button type="button" className="arr-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="arr-btn arr-btn--primary"
              onClick={handleSave}
              disabled={!canSave}
            >
              Save
            </button>
          </div>
        </div>
      </div>

      {showPicker ? (
        <DownloadFolderPickerModal
          initialPath={draft.local}
          createOnConfirm={false}
          onConfirm={(path) => {
            setDraft((current) => ({
              ...current,
              local: String(path || "").trim(),
            }));
            setShowPicker(false);
          }}
          onCancel={() => setShowPicker(false)}
        />
      ) : null}
    </div>,
    document.body,
  );
}
