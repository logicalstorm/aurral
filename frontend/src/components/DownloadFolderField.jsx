import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { Folder } from "lucide-react";
import { browseFilesystem } from "../utils/api";
import DownloadFolderPickerModal from "./DownloadFolderPickerModal";

export default function DownloadFolderField({
  value = "",
  onChange,
  disabled = false,
  id,
  helperText = "",
}) {
  const [draft, setDraft] = useState(value);
  const [showPicker, setShowPicker] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    setDraft(value || "");
  }, [value]);

  useEffect(() => {
    if (prefilled || value || disabled) return;
    let cancelled = false;
    browseFilesystem()
      .then((result) => {
        if (cancelled) return;
        const suggested = String(result.suggestedDownloadFolder || "").trim();
        if (suggested) {
          setDraft(suggested);
          onChange?.(suggested);
        }
        setPrefilled(true);
      })
      .catch(() => {
        if (!cancelled) setPrefilled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [disabled, onChange, prefilled, value]);

  const commitDraft = (nextValue) => {
    const trimmed = String(nextValue ?? draft).trim();
    setDraft(trimmed);
    onChange?.(trimmed);
  };

  return (
    <>
      <div className="download-folder-field">
        <div className="download-folder-field__group">
          <input
            id={id}
            type="text"
            className="download-folder-field__input"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commitDraft(draft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitDraft(draft);
              }
            }}
          />
          <button
            type="button"
            className="download-folder-field__folder-btn"
            onClick={() => setShowPicker(true)}
            disabled={disabled}
            aria-label="Browse folders"
          >
            <Folder className="artist-icon-xs" />
          </button>
        </div>
        {helperText ? (
          <p className="download-folder-field__helper">{helperText}</p>
        ) : null}
      </div>

      {showPicker ? (
        <DownloadFolderPickerModal
          initialPath={draft || value}
          onConfirm={(path) => {
            commitDraft(path);
            setShowPicker(false);
          }}
          onCancel={() => setShowPicker(false)}
        />
      ) : null}
    </>
  );
}

DownloadFolderField.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func,
  disabled: PropTypes.bool,
  id: PropTypes.string,
  helperText: PropTypes.string,
};
