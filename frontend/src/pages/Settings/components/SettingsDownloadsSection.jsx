import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { SettingsInput, SettingsSelect } from "./SettingsField";
import {
  IntegrationCard,
  SettingsIntegrationModal,
} from "./SettingsIntegrationCards";
import {
  getProwlarrIndexers,
  testNzbgetConnection,
  testProwlarrConnection,
  testSlskdConnection,
} from "../../../utils/api";

function toNumber(value, fallback) {
  const next = parseInt(value, 10);
  return Number.isFinite(next) ? next : fallback;
}

function getProviderStatus(enabled, configured) {
  if (enabled && configured) return { label: "Enabled", className: "is-enabled" };
  if (enabled) return { label: "Needs setup", className: "is-warning" };
  if (configured) return { label: "Disabled", className: "is-muted" };
  return { label: "Not configured", className: "is-muted" };
}

function getIndexerStatus(indexer, enabled) {
  if (indexer?.enabledInProwlarr === false) {
    return { label: "Disabled in Prowlarr", className: "is-muted" };
  }
  if (enabled) return { label: "Enabled", className: "is-enabled" };
  return { label: "Disabled", className: "is-muted" };
}

export function SettingsDownloadsSection({
  settings,
  updateSettings,
  health,
  handleSaveSettings,
  showSuccess,
  showError,
  showInfo,
}) {
  const [activeModal, setActiveModal] = useState(null);
  const [testingSlskd, setTestingSlskd] = useState(false);
  const [testingProwlarr, setTestingProwlarr] = useState(false);
  const [loadingProwlarrIndexers, setLoadingProwlarrIndexers] =
    useState(false);
  const [prowlarrIndexers, setProwlarrIndexers] = useState([]);
  const [testingNzbget, setTestingNzbget] = useState(false);

  const integrations = settings.integrations || {};
  const slskd = integrations.slskd || {};
  const prowlarr = integrations.prowlarr || {};
  const nzbget = integrations.nzbget || {};

  const slskdConfigured = Boolean(slskd.url && slskd.apiKey);
  const prowlarrConfigured = Boolean(prowlarr.url && prowlarr.apiKey);
  const nzbgetConfigured = Boolean(nzbget.url);
  const slskdEnabled = slskd.enabled !== false;
  const prowlarrEnabled = prowlarr.enabled === true;
  const nzbgetEnabled = nzbget.enabled === true;

  const updateIntegration = (key, patch) =>
    updateSettings({
      ...settings,
      integrations: {
        ...settings.integrations,
        [key]: {
          ...(settings.integrations?.[key] || {}),
          ...patch,
        },
      },
    });

  const loadProwlarrIndexers = async ({ quiet = false } = {}) => {
    if (!health?.prowlarrConfigured) {
      setProwlarrIndexers([]);
      return;
    }
    setLoadingProwlarrIndexers(true);
    try {
      const result = await getProwlarrIndexers();
      const indexers = Array.isArray(result?.indexers) ? result.indexers : [];
      setProwlarrIndexers(indexers);
      if (!quiet && indexers.length > 0) {
        showSuccess(`Loaded ${indexers.length} Usenet indexer(s)`);
      }
      if (!quiet && indexers.length === 0) {
        showInfo("No usable Usenet indexers found in Prowlarr");
      }
    } catch (error) {
      if (!quiet) {
        showError(
          error.response?.data?.message ||
            error.response?.data?.error ||
            error.message ||
            "Failed to load Prowlarr indexers",
        );
      }
    } finally {
      setLoadingProwlarrIndexers(false);
    }
  };

  useEffect(() => {
    if (!health?.prowlarrConfigured) {
      setProwlarrIndexers([]);
      return;
    }
    let cancelled = false;
    setLoadingProwlarrIndexers(true);
    getProwlarrIndexers()
      .then((result) => {
        if (!cancelled) {
          setProwlarrIndexers(
            Array.isArray(result?.indexers) ? result.indexers : [],
          );
        }
      })
      .catch(() => {
        if (!cancelled) setProwlarrIndexers([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingProwlarrIndexers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [health?.prowlarrConfigured]);

  const updateProwlarrIndexer = (id, patch) => {
    const key = String(id);
    updateIntegration("prowlarr", {
      indexers: {
        ...(prowlarr.indexers || {}),
        [key]: {
          ...(prowlarr.indexers?.[key] || {}),
          ...patch,
        },
      },
    });
  };

  const getIndexerState = (indexer) => {
    const override = prowlarr.indexers?.[String(indexer.id)] || {};
    const aurralEnabled = override.enabled !== false;
    const effectiveEnabled = indexer.enabledInProwlarr !== false && aurralEnabled;
    return {
      aurralEnabled,
      effectiveEnabled,
      priority: override.priority ?? indexer.priority ?? 25,
    };
  };

  const handleTestProwlarr = async () => {
    if (!prowlarrEnabled || !prowlarr.url || !prowlarr.apiKey) {
      showError("Enable Prowlarr and enter URL and API key first");
      return;
    }
    setTestingProwlarr(true);
    try {
      await handleSaveSettings();
      const result = await testProwlarrConnection();
      setProwlarrIndexers(Array.isArray(result.indexers) ? result.indexers : []);
      showSuccess(result.message || "Prowlarr connection OK");
    } catch (error) {
      showError(
        error.response?.data?.message ||
          error.response?.data?.error ||
          error.message ||
          "Prowlarr connection failed",
      );
    } finally {
      setTestingProwlarr(false);
    }
  };

  const handleTestNzbget = async () => {
    if (!nzbgetEnabled || !nzbget.url) {
      showError("Enable NZBGet and enter the server URL first");
      return;
    }
    setTestingNzbget(true);
    try {
      await handleSaveSettings();
      const result = await testNzbgetConnection();
      showSuccess(result.message || "NZBGet connection OK");
    } catch (error) {
      showError(
        error.response?.data?.message ||
          error.response?.data?.error ||
          error.message ||
          "NZBGet connection failed",
      );
    } finally {
      setTestingNzbget(false);
    }
  };

  const handleTestSlskd = async () => {
    if (!slskd.url || !slskd.apiKey) {
      showError("Enter slskd URL and API key first");
      return;
    }
    setTestingSlskd(true);
    try {
      await handleSaveSettings();
      const result = await testSlskdConnection();
      if (result.success || result.ok) {
        if (result.warning || result.soulseekConnected === false) {
          showInfo(
            result.message ||
              "slskd API is reachable, but Soulseek is not connected",
          );
        } else {
          showSuccess(result.message || "slskd connection OK");
        }
      } else {
        showError(result.message || "slskd connection failed");
      }
    } catch (error) {
      showError(
        error.response?.data?.message ||
          error.response?.data?.error ||
          error.message ||
          "slskd connection failed",
      );
    } finally {
      setTestingSlskd(false);
    }
  };

  const activeIndexer = activeModal?.startsWith("indexer:")
    ? prowlarrIndexers.find(
        (indexer) => String(indexer.id) === activeModal.slice("indexer:".length),
      )
    : null;

  return (
    <>
      <div className="settings-page__section">
        <div className="settings-page__section-header">
          <h3 className="settings-page__section-title">Indexers</h3>
          {loadingProwlarrIndexers && (
            <span className="settings-page__status">
              <RefreshCw className="settings-page__status-icon animate-spin" />
              Loading
            </span>
          )}
        </div>
        <div className="settings-page__download-card-grid">
          <IntegrationCard
            title="Prowlarr"
            subtitle="Indexer manager"
            status={getProviderStatus(
              prowlarrEnabled,
              health?.prowlarrConfigured || prowlarrConfigured,
            )}
            meta={
              prowlarr.maxResults
                ? `Audio search · ${prowlarr.maxResults} results`
                : "Audio search"
            }
            onClick={() => setActiveModal("prowlarr")}
          />
          {prowlarrIndexers.map((indexer) => {
            const state = getIndexerState(indexer);
            return (
              <IntegrationCard
                key={indexer.id}
                title={indexer.name}
                subtitle="Usenet indexer"
                status={getIndexerStatus(indexer, state.effectiveEnabled)}
                meta={`Priority ${state.priority}`}
                onClick={() => setActiveModal(`indexer:${indexer.id}`)}
              />
            );
          })}
        </div>
        {health?.prowlarrConfigured &&
          !loadingProwlarrIndexers &&
          prowlarrIndexers.length === 0 && (
            <p className="settings-page__muted-copy">
              No Usenet audio indexers were returned by Prowlarr.
            </p>
          )}
      </div>

      <div className="settings-page__section">
        <div className="settings-page__section-header">
          <h3 className="settings-page__section-title">Download clients</h3>
        </div>
        <div className="settings-page__download-card-grid">
          <IntegrationCard
            title="slskd"
            subtitle="Soulseek"
            status={getProviderStatus(slskdEnabled, slskdConfigured)}
            meta={`Priority ${slskd.priority ?? 10}`}
            onClick={() => setActiveModal("slskd")}
          />
          <IntegrationCard
            title="NZBGet"
            subtitle="Usenet"
            status={getProviderStatus(
              nzbgetEnabled,
              health?.nzbgetConfigured || nzbgetConfigured,
            )}
            meta={`Priority ${nzbget.priority ?? 20}`}
            onClick={() => setActiveModal("nzbget")}
          />
        </div>
      </div>

      {activeModal === "prowlarr" && (
        <SettingsIntegrationModal
          title="Prowlarr"
          onClose={() => setActiveModal(null)}
        >
          <label className="artist-checkbox-label">
            <input
              type="checkbox"
              className="artist-checkbox"
              checked={prowlarrEnabled}
              onChange={(event) =>
                updateIntegration("prowlarr", { enabled: event.target.checked })
              }
            />
            <span className="artist-field-label">Enable Prowlarr</span>
          </label>

          <div className="settings-page__two-col-grid">
            <div>
              <label className="artist-field-label">Server URL</label>
              <SettingsInput
                type="url"
                placeholder="http://localhost:9696"
                autoComplete="off"
                value={prowlarr.url || ""}
                onChange={(event) =>
                  updateIntegration("prowlarr", { url: event.target.value })
                }
              />
            </div>
            <div>
              <label className="artist-field-label">API key</label>
              <SettingsInput
                type="password"
                autoComplete="off"
                value={prowlarr.apiKey || ""}
                onChange={(event) =>
                  updateIntegration("prowlarr", { apiKey: event.target.value })
                }
              />
            </div>
          </div>

          <div className="settings-page__two-col-grid">
            <div>
              <label className="artist-field-label">Music categories</label>
              <SettingsInput
                type="text"
                value={(prowlarr.categories || [3000]).join(",")}
                onChange={(event) =>
                  updateIntegration("prowlarr", {
                    categories: event.target.value
                      .split(",")
                      .map((entry) => parseInt(entry.trim(), 10))
                      .filter((entry) => Number.isFinite(entry)),
                  })
                }
              />
            </div>
            <div>
              <label className="artist-field-label">Result limit</label>
              <SettingsInput
                type="number"
                min="10"
                max="200"
                value={prowlarr.maxResults ?? 60}
                onChange={(event) =>
                  updateIntegration("prowlarr", {
                    maxResults: toNumber(event.target.value, 60),
                  })
                }
              />
            </div>
          </div>

          <div className="settings-page__download-editor-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={testingProwlarr || loadingProwlarrIndexers}
              onClick={handleTestProwlarr}
            >
              <RefreshCw
                className={`artist-icon-sm${testingProwlarr ? " animate-spin" : ""}`}
              />
              {testingProwlarr ? "Testing..." : "Test connection"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loadingProwlarrIndexers || !health?.prowlarrConfigured}
              onClick={() => loadProwlarrIndexers()}
            >
              <RefreshCw
                className={`artist-icon-sm${loadingProwlarrIndexers ? " animate-spin" : ""}`}
              />
              {loadingProwlarrIndexers ? "Refreshing..." : "Refresh indexers"}
            </button>
          </div>
        </SettingsIntegrationModal>
      )}

      {activeIndexer && (
        <SettingsIntegrationModal
          title={activeIndexer.name}
          onClose={() => setActiveModal(null)}
        >
          {(() => {
            const state = getIndexerState(activeIndexer);
            return (
              <>
                <label className="artist-checkbox-label">
                  <input
                    type="checkbox"
                    className="artist-checkbox"
                    checked={state.aurralEnabled}
                    onChange={(event) =>
                      updateProwlarrIndexer(activeIndexer.id, {
                        enabled: event.target.checked,
                        priority: state.priority,
                      })
                    }
                  />
                  <span className="artist-field-label">Enable in Aurral</span>
                </label>
                <div>
                  <label className="artist-field-label">Priority</label>
                  <SettingsInput
                    type="number"
                    min="1"
                    max="1000"
                    value={state.priority}
                    onChange={(event) =>
                      updateProwlarrIndexer(activeIndexer.id, {
                        enabled: state.aurralEnabled,
                        priority: toNumber(
                          event.target.value,
                          activeIndexer.priority || 25,
                        ),
                      })
                    }
                  />
                </div>
                <dl className="settings-page__download-modal-meta">
                  <div>
                    <dt>Protocol</dt>
                    <dd>{activeIndexer.protocol || "usenet"}</dd>
                  </div>
                  <div>
                    <dt>Prowlarr status</dt>
                    <dd>
                      {activeIndexer.enabledInProwlarr === false
                        ? "Disabled"
                        : "Enabled"}
                    </dd>
                  </div>
                </dl>
              </>
            );
          })()}
        </SettingsIntegrationModal>
      )}

      {activeModal === "slskd" && (
        <SettingsIntegrationModal title="slskd" onClose={() => setActiveModal(null)}>
          <label className="artist-checkbox-label">
            <input
              type="checkbox"
              className="artist-checkbox"
              checked={slskdEnabled}
              onChange={(event) =>
                updateIntegration("slskd", { enabled: event.target.checked })
              }
            />
            <span className="artist-field-label">Enable slskd</span>
          </label>

          <div className="settings-page__two-col-grid">
            <div>
              <label className="artist-field-label">Server URL</label>
              <SettingsInput
                type="url"
                placeholder="http://localhost:5030"
                autoComplete="off"
                value={slskd.url || ""}
                onChange={(event) =>
                  updateIntegration("slskd", { url: event.target.value })
                }
              />
            </div>
            <div>
              <label className="artist-field-label">API key</label>
              <SettingsInput
                type="password"
                autoComplete="off"
                value={slskd.apiKey || ""}
                onChange={(event) =>
                  updateIntegration("slskd", { apiKey: event.target.value })
                }
              />
            </div>
          </div>

          <div className="settings-page__two-col-grid">
            <div>
              <label className="artist-field-label">Source priority</label>
              <SettingsInput
                type="number"
                min="1"
                max="1000"
                value={slskd.priority ?? 10}
                onChange={(event) =>
                  updateIntegration("slskd", {
                    priority: toNumber(event.target.value, 10),
                  })
                }
              />
            </div>
            <div>
              <label className="artist-field-label">Preferred format</label>
              <SettingsSelect
                value={slskd.preferredFormat || "flac"}
                onChange={(event) =>
                  updateIntegration("slskd", {
                    preferredFormat: event.target.value,
                  })
                }
              >
                <option value="flac">FLAC</option>
                <option value="mp3">MP3</option>
              </SettingsSelect>
            </div>
          </div>

          <div className="settings-page__field-stack--md">
            <label className="artist-checkbox-label">
              <input
                type="checkbox"
                className="artist-checkbox"
                checked={slskd.preferredFormatStrict === true}
                onChange={(event) =>
                  updateIntegration("slskd", {
                    preferredFormatStrict: event.target.checked,
                  })
                }
              />
              <span className="artist-field-label">Strict format only</span>
            </label>
            <p className="settings-page__hint settings-page__hint--indented">
              Used when ranking slskd search results for flows and playlists.
            </p>
            <label className="artist-checkbox-label">
              <input
                type="checkbox"
                className="artist-checkbox"
                checked={slskd.cleanupAfterRuns === true}
                onChange={(event) =>
                  updateIntegration("slskd", {
                    cleanupAfterRuns: event.target.checked,
                  })
                }
              />
              <span className="artist-field-label">Clean up after runs</span>
            </label>
            <p className="settings-page__hint settings-page__hint--indented">
              Clear completed searches and downloads from slskd when a flow or
              playlist run finishes.
            </p>
          </div>

          <div className="settings-page__download-editor-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={testingSlskd}
              onClick={handleTestSlskd}
            >
              <RefreshCw
                className={`artist-icon-sm${testingSlskd ? " animate-spin" : ""}`}
              />
              {testingSlskd ? "Testing..." : "Test connection"}
            </button>
          </div>
        </SettingsIntegrationModal>
      )}

      {activeModal === "nzbget" && (
        <SettingsIntegrationModal title="NZBGet" onClose={() => setActiveModal(null)}>
          <label className="artist-checkbox-label">
            <input
              type="checkbox"
              className="artist-checkbox"
              checked={nzbgetEnabled}
              onChange={(event) =>
                updateIntegration("nzbget", { enabled: event.target.checked })
              }
            />
            <span className="artist-field-label">Enable NZBGet</span>
          </label>

          <div>
            <label className="artist-field-label">Server URL</label>
            <SettingsInput
              type="url"
              placeholder="http://localhost:6789"
              autoComplete="off"
              value={nzbget.url || ""}
              onChange={(event) =>
                updateIntegration("nzbget", { url: event.target.value })
              }
            />
          </div>

          <div className="settings-page__two-col-grid">
            <div>
              <label className="artist-field-label">Username</label>
              <SettingsInput
                type="text"
                autoComplete="off"
                value={nzbget.username || ""}
                onChange={(event) =>
                  updateIntegration("nzbget", { username: event.target.value })
                }
              />
            </div>
            <div>
              <label className="artist-field-label">Password</label>
              <SettingsInput
                type="password"
                autoComplete="off"
                value={nzbget.password || ""}
                onChange={(event) =>
                  updateIntegration("nzbget", { password: event.target.value })
                }
              />
            </div>
          </div>

          <div className="settings-page__two-col-grid">
            <div>
              <label className="artist-field-label">Category</label>
              <SettingsInput
                type="text"
                value={nzbget.category || "aurral"}
                onChange={(event) =>
                  updateIntegration("nzbget", { category: event.target.value })
                }
              />
            </div>
            <div>
              <label className="artist-field-label">Source priority</label>
              <SettingsInput
                type="number"
                min="1"
                max="1000"
                value={nzbget.priority ?? 20}
                onChange={(event) =>
                  updateIntegration("nzbget", {
                    priority: toNumber(event.target.value, 20),
                  })
                }
              />
            </div>
          </div>

          <div>
            <label className="artist-field-label">NZB priority</label>
            <SettingsInput
              type="number"
              min="-100"
              max="900"
              value={nzbget.nzbPriority ?? 0}
              onChange={(event) =>
                updateIntegration("nzbget", {
                  nzbPriority: toNumber(event.target.value, 0),
                })
              }
            />
          </div>

          <div>
            <label className="artist-field-label">Completed download path</label>
            <SettingsInput
              type="text"
              placeholder="/downloads/completed"
              autoComplete="off"
              value={nzbget.completedPath || ""}
              onChange={(event) =>
                updateIntegration("nzbget", { completedPath: event.target.value })
              }
            />
            <p className="settings-page__hint">
              Optional override for where NZBGet stores finished downloads. Leave
              blank to use the path reported by NZBGet.
            </p>
          </div>

          <label className="artist-checkbox-label">
            <input
              type="checkbox"
              className="artist-checkbox"
              checked={nzbget.addPaused === true}
              onChange={(event) =>
                updateIntegration("nzbget", { addPaused: event.target.checked })
              }
            />
            <span className="artist-field-label">Add NZBs paused</span>
          </label>

          <div className="settings-page__download-editor-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={testingNzbget}
              onClick={handleTestNzbget}
            >
              <RefreshCw
                className={`artist-icon-sm${testingNzbget ? " animate-spin" : ""}`}
              />
              {testingNzbget ? "Testing..." : "Test connection"}
            </button>
          </div>
        </SettingsIntegrationModal>
      )}
    </>
  );
}
