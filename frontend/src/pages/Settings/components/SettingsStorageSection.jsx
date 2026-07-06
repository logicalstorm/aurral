import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { StorageHealthDashboard } from "./StorageHealthDashboard";
import {
  getStorageHealthCache,
  refreshStorageHealth,
  subscribeStorageHealth,
} from "../../../hooks/useStorageHealth";
import { SettingsArrFieldSet } from "./arr/SettingsArrLayout";

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const decimals = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatUptime(seconds) {
  if (!Number.isFinite(Number(seconds))) return null;
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

function healthMessages(healthResult, health) {
  const messages = [];
  if (health?.onboardingRequired) {
    messages.push({
      status: "warn",
      text: "Onboarding is not complete.",
    });
  }
  if (!healthResult) {
    messages.push({
      status: "warn",
      text: "Storage checks have not run in this session.",
    });
    return messages;
  }
  if (healthResult.failedCount > 0) {
    messages.push({
      status: "fail",
      text: `${healthResult.failedCount} storage check${healthResult.failedCount === 1 ? "" : "s"} failed.`,
    });
  }
  if (healthResult.warningCount > 0) {
    messages.push({
      status: "warn",
      text: `${healthResult.warningCount} storage warning${healthResult.warningCount === 1 ? "" : "s"} found.`,
    });
  }
  return messages;
}

function DiskSpaceTable({ entries = [] }) {
  if (!entries.length) {
    return <p className="arr-form-help">Disk space data is not available.</p>;
  }

  return (
    <div className="arr-table-wrap">
      <table className="arr-table arr-table--disk">
        <thead>
          <tr>
            <th scope="col">Location</th>
            <th scope="col">Role</th>
            <th scope="col">Free Space</th>
            <th scope="col">Total Space</th>
            <th scope="col">Used</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const usedPercent = Number(entry.usedPercent || 0);
            return (
              <tr key={`${entry.role || "disk"}-${entry.location}`}>
                <td>
                  <code className="arr-table__path">{entry.location}</code>
                  {entry.statTarget && entry.statTarget !== entry.location ? (
                    <span className="arr-table__subtle">Stats from {entry.statTarget}</span>
                  ) : null}
                </td>
                <td>{entry.role || "—"}</td>
                <td>{entry.available ? formatBytes(entry.freeBytes) : "—"}</td>
                <td>{entry.available ? formatBytes(entry.totalBytes) : "—"}</td>
                <td>
                  {entry.available ? (
                    <div className="arr-disk-meter">
                      <div className="arr-disk-meter__bar" aria-hidden>
                        <span
                          className="arr-disk-meter__fill"
                          style={{ width: `${usedPercent}%` }}
                        />
                      </div>
                      <span className="arr-disk-meter__label">{usedPercent}%</span>
                    </div>
                  ) : (
                    <span className="arr-table__subtle">{entry.error || "Unavailable"}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MetaRow({ label, children }) {
  return (
    <div>
      <dt className="arr-meta-term">{label}</dt>
      <dd className="arr-meta-value">{children || "—"}</dd>
    </div>
  );
}

export function SettingsStorageSection({
  hasUnsavedChanges,
  handleSaveSettings,
  health,
  showSuccess,
  showError,
}) {
  const [healthResult, setHealthResult] = useState(() => getStorageHealthCache().result);
  const [checkingHealth, setCheckingHealth] = useState(false);

  useEffect(
    () =>
      subscribeStorageHealth((cache) => {
        setHealthResult(cache.result);
      }),
    [],
  );

  const runHealthCheck = useCallback(
    async ({ notify = true } = {}) => {
      setCheckingHealth(true);
      try {
        if (hasUnsavedChanges) {
          await handleSaveSettings();
        }
        const result = await refreshStorageHealth({ force: true });
        if (notify) {
          if (result.ok && !result.partial) {
            showSuccess("Storage checks passed");
          } else if (result.ok) {
            showSuccess("Storage checks finished with warnings");
          } else {
            showError("Storage checks found problems. Review the results below.");
          }
        }
        return result;
      } catch (error) {
        const message =
          error.response?.data?.message ||
          error.response?.data?.error ||
          error.message ||
          "Storage health check failed";
        if (notify) {
          showError(message);
        }
        return null;
      } finally {
        setCheckingHealth(false);
      }
    },
    [hasUnsavedChanges, handleSaveSettings, showError, showSuccess],
  );

  useEffect(() => {
    if (getStorageHealthCache().result) return undefined;
    let cancelled = false;
    setCheckingHealth(true);
    refreshStorageHealth()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCheckingHealth(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const system = health?.system || {};
  const messages = healthMessages(healthResult, health);

  return (
    <>
      <SettingsArrFieldSet legend="Health">
        {messages.length === 0 ? (
          <p className="arr-health-line">No issues with your configuration</p>
        ) : (
          <ul className="arr-health-list">
            {messages.map((message, index) => (
              <li
                key={`${message.status}-${index}`}
                className={`arr-health-list__item is-${message.status}`}
              >
                {message.text}
              </li>
            ))}
          </ul>
        )}
      </SettingsArrFieldSet>

      <SettingsArrFieldSet legend="Disk Space">
        <DiskSpaceTable entries={system.diskSpace || []} />
      </SettingsArrFieldSet>

      <SettingsArrFieldSet
        legend="Storage Health"
        actions={
          <button
            type="button"
            className="arr-btn"
            onClick={() => runHealthCheck({ notify: true })}
            disabled={checkingHealth}
          >
            <RefreshCw className={`artist-icon-sm${checkingHealth ? " animate-spin" : ""}`} />
            {checkingHealth ? "Checking…" : "Run Checks"}
          </button>
        }
      >
        <p className="arr-form-help">
          Verifies Aurral, Lidarr, download clients, and Navidrome all see the same files on disk.
          Mount one shared host folder at the same container path in every app, such as{" "}
          <code>/mnt/user/data:/data</code>.
        </p>
        <StorageHealthDashboard result={healthResult} loading={checkingHealth} />
      </SettingsArrFieldSet>

      <SettingsArrFieldSet legend="About">
        <dl className="arr-meta-grid arr-meta-grid--two-col">
          <MetaRow label="Version">{system.version || health?.appVersion}</MetaRow>
          <MetaRow label="Node">{system.nodeVersion}</MetaRow>
          <MetaRow label="Platform">
            {system.platform && system.arch ? `${system.platform} ${system.arch}` : null}
          </MetaRow>
          <MetaRow label="Docker">
            {system.docker == null ? null : system.docker ? "Yes" : "No"}
          </MetaRow>
          <MetaRow label="Database">{system.database?.label}</MetaRow>
          <MetaRow label="App Data Directory">{system.dataDir}</MetaRow>
          <MetaRow label="Database Path">{system.databasePath}</MetaRow>
          <MetaRow label="Startup Directory">{system.startupDirectory}</MetaRow>
          <MetaRow label="Mode">{system.mode}</MetaRow>
          <MetaRow label="Uptime">{formatUptime(system.uptimeSeconds)}</MetaRow>
          <MetaRow label="Hostname">{system.hostname}</MetaRow>
        </dl>
      </SettingsArrFieldSet>

      <SettingsArrFieldSet legend="More Info">
        <dl className="arr-meta-grid arr-meta-grid--two-col">
          {(system.links || []).map((link) => (
            <MetaRow key={link.label} label={link.label}>
              <a href={link.url} target="_blank" rel="noopener noreferrer" className="arr-link">
                {link.value || link.url}
              </a>
            </MetaRow>
          ))}
        </dl>
      </SettingsArrFieldSet>
    </>
  );
}
