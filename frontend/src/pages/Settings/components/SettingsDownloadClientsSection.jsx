import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { SettingsInput, SettingsSelect } from "./SettingsField";
import {
  IntegrationCard,
  SettingsIntegrationModal,
} from "./SettingsIntegrationCards";
import {
  SettingsModalField,
  SettingsModalSection,
  SettingsModalToggle,
  SettingsModalToggleGroup,
} from "./SettingsModalLayout";
import { getProviderStatus } from "../utils/integrationStatus";
import {
  testNzbgetConnection,
  testSlskdConnection,
} from "../../../utils/api";

function toNumber(value, fallback) {
  const next = parseInt(value, 10);
  return Number.isFinite(next) ? next : fallback;
}

const CLIENT_MODALS = {
  slskd: "slskd",
  nzbget: "nzbget",
};

export function SettingsDownloadClientsSection({
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
  const [testingNzbget, setTestingNzbget] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const integrations = settings.integrations || {};
  const slskd = integrations.slskd || {};
  const nzbget = integrations.nzbget || {};

  const slskdConfigured = Boolean(slskd.url && slskd.apiKey);
  const nzbgetConfigured = Boolean(nzbget.url);
  const slskdEnabled = slskd.enabled !== false;
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

  return (
    <>
      <div className="settings-page__section">
        <div className="settings-page__section-header">
          <div className="settings-page__section-intro">
            <h3 className="settings-page__section-title">Download clients</h3>
            <p className="settings-page__section-note">
              Clients Aurral sends playlist and flow downloads to.
            </p>
          </div>
        </div>
        <div className="settings-page__integration-card-grid">
          <IntegrationCard
            title="slskd"
            subtitle="Soulseek"
            status={getProviderStatus(slskdEnabled, slskdConfigured)}
            meta={`Priority ${slskd.priority ?? 10}`}
            onClick={() => setActiveModal(CLIENT_MODALS.slskd)}
          />
          <IntegrationCard
            title="NZBGet"
            subtitle="Usenet"
            status={getProviderStatus(
              nzbgetEnabled,
              health?.nzbgetConfigured || nzbgetConfigured,
            )}
            meta={`Priority ${nzbget.priority ?? 20}`}
            onClick={() => setActiveModal(CLIENT_MODALS.nzbget)}
          />
        </div>
      </div>

      {activeModal === CLIENT_MODALS.slskd && (
        <SettingsIntegrationModal
          title="slskd"
          onClose={() => setActiveModal(null)}
          footerActions={
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
          }
        >
          <SettingsModalSection title="General">
            <SettingsModalToggle
              label="Enable slskd"
              checked={slskdEnabled}
              onChange={(event) =>
                updateIntegration("slskd", { enabled: event.target.checked })
              }
            />
          </SettingsModalSection>

          <SettingsModalSection title="Connection">
            <SettingsModalField label="Server URL">
              <SettingsInput
                type="url"
                placeholder="http://localhost:5030"
                autoComplete="off"
                value={slskd.url || ""}
                onChange={(event) =>
                  updateIntegration("slskd", { url: event.target.value })
                }
              />
            </SettingsModalField>
            <SettingsModalField label="API key">
              <SettingsInput
                type="password"
                autoComplete="off"
                value={slskd.apiKey || ""}
                onChange={(event) =>
                  updateIntegration("slskd", { apiKey: event.target.value })
                }
              />
            </SettingsModalField>
          </SettingsModalSection>

          <SettingsModalSection title="Behavior">
            <SettingsModalField label="Source priority">
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
            </SettingsModalField>
            <SettingsModalField label="Preferred format">
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
            </SettingsModalField>
            <SettingsModalToggleGroup>
              <SettingsModalToggle
                label="Strict format only"
                checked={slskd.preferredFormatStrict === true}
                onChange={(event) =>
                  updateIntegration("slskd", {
                    preferredFormatStrict: event.target.checked,
                  })
                }
              />
              <SettingsModalToggle
                label="Clean up after runs"
                checked={slskd.cleanupAfterRuns === true}
                onChange={(event) =>
                  updateIntegration("slskd", {
                    cleanupAfterRuns: event.target.checked,
                  })
                }
              />
            </SettingsModalToggleGroup>
          </SettingsModalSection>
        </SettingsIntegrationModal>
      )}

      {activeModal === CLIENT_MODALS.nzbget && (
        <SettingsIntegrationModal
          title="NZBGet"
          onClose={() => setActiveModal(null)}
          footerActions={
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
          }
        >
          <SettingsModalSection title="General">
            <SettingsModalToggle
              label="Enable NZBGet"
              checked={nzbgetEnabled}
              onChange={(event) =>
                updateIntegration("nzbget", { enabled: event.target.checked })
              }
            />
          </SettingsModalSection>

          <SettingsModalSection title="Connection">
            <SettingsModalField label="Server URL">
              <SettingsInput
                type="url"
                placeholder="http://localhost:6789"
                autoComplete="off"
                value={nzbget.url || ""}
                onChange={(event) =>
                  updateIntegration("nzbget", { url: event.target.value })
                }
              />
            </SettingsModalField>
            <SettingsModalField label="Username">
              <SettingsInput
                type="text"
                autoComplete="off"
                value={nzbget.username || ""}
                onChange={(event) =>
                  updateIntegration("nzbget", { username: event.target.value })
                }
              />
            </SettingsModalField>
            <SettingsModalField label="Password">
              <SettingsInput
                type="password"
                autoComplete="off"
                value={nzbget.password || ""}
                onChange={(event) =>
                  updateIntegration("nzbget", { password: event.target.value })
                }
              />
            </SettingsModalField>
          </SettingsModalSection>

          <SettingsModalSection title="Downloads">
            <SettingsModalField label="Category">
              <SettingsInput
                type="text"
                value={nzbget.category || "aurral"}
                onChange={(event) =>
                  updateIntegration("nzbget", { category: event.target.value })
                }
              />
            </SettingsModalField>
            <SettingsModalField label="Source priority">
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
            </SettingsModalField>
          </SettingsModalSection>

          <div className="settings-page__advanced-toggle-row">
            <button
              type="button"
              className="settings-page__advanced-toggle"
              onClick={() => setShowAdvanced((current) => !current)}
            >
              {showAdvanced ? "Hide advanced" : "Show advanced"}
            </button>
          </div>

          {showAdvanced && (
            <SettingsModalSection title="Advanced">
              <SettingsModalField label="NZB priority">
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
              </SettingsModalField>
              <SettingsModalField label="Completed download path">
                <SettingsInput
                  type="text"
                  placeholder="/downloads/completed"
                  autoComplete="off"
                  value={nzbget.completedPath || ""}
                  onChange={(event) =>
                    updateIntegration("nzbget", {
                      completedPath: event.target.value,
                    })
                  }
                />
              </SettingsModalField>
              <SettingsModalToggle
                label="Add NZBs paused"
                checked={nzbget.addPaused === true}
                onChange={(event) =>
                  updateIntegration("nzbget", {
                    addPaused: event.target.checked,
                  })
                }
              />
            </SettingsModalSection>
          )}
        </SettingsIntegrationModal>
      )}
    </>
  );
}
