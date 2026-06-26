import { useState, useEffect, useCallback } from "react";
import { Copy, RotateCcw, Check, AlertCircle } from "lucide-react";
import { SettingsStorageSection } from "./SettingsStorageSection";
import { getApiKey, rotateApiKey } from "../../../utils/api/endpoints/auth";

export function SettingsStorageTab({
  hasUnsavedChanges,
  handleSaveSettings,
  health,
  showSuccess,
  showError,
}) {
  const [apiKey, setApiKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchKey = useCallback(async () => {
    try {
      const res = await getApiKey();
      setApiKey(res?.apiKey || null);
    } catch {
      setApiKey(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKey();
  }, [fetchKey]);

  const handleCopy = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRotate = async () => {
    setRotating(true);
    try {
      const res = await rotateApiKey();
      setApiKey(res?.apiKey || null);
      showSuccess("API key rotated");
    } catch {
      showError("Failed to rotate API key");
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="arr-page">
      <form onSubmit={handleSaveSettings} className="arr-form" autoComplete="off">
        <SettingsStorageSection
          hasUnsavedChanges={hasUnsavedChanges}
          handleSaveSettings={handleSaveSettings}
          health={health}
          showSuccess={showSuccess}
          showError={showError}
        />
      </form>

      <fieldset className="arr-fieldset">
        <div className="arr-fieldset__head">
          <legend className="arr-fieldset__legend">API Key</legend>
        </div>
        <div className="arr-fieldset__body">
          <div className="arr-info" style={{ marginBottom: "1rem" }}>
            Authenticate API requests with an <code>X-Api-Key</code> header or{" "}
            <code>api_key</code> query parameter.
          </div>
          {loading ? (
            <p className="arr-info">Loading…</p>
          ) : apiKey ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <code
                className="arr-input arr-input--mono"
                style={{
                  flex: 1,
                  minWidth: "20ch",
                  padding: "0.5rem 0.75rem",
                  background: "var(--aurral-surface)",
                  borderRadius: "4px",
                  fontSize: "0.875rem",
                  userSelect: "all",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {apiKey}
              </code>
              <button
                type="button"
                className="btn btn-secondary btn--icon"
                onClick={handleCopy}
                title={copied ? "Copied" : "Copy to clipboard"}
              >
                {copied ? (
                  <Check className="artist-icon-xs" />
                ) : (
                  <Copy className="artist-icon-xs" />
                )}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn--icon"
                onClick={handleRotate}
                disabled={rotating}
                title="Rotate API key"
              >
                <RotateCcw className={`artist-icon-xs${rotating ? " animate-spin" : ""}`} />
              </button>
            </div>
          ) : (
            <div className="arr-info" style={{ color: "var(--aurral-danger)" }}>
              <AlertCircle className="artist-icon-xs" style={{ marginRight: "0.25rem" }} />
              Unable to load API key
            </div>
          )}
        </div>
      </fieldset>
    </div>
  );
}
