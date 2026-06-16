import { useState, useRef } from "react";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { Link } from "react-router-dom";
import FlipSaveButton from "../../../components/FlipSaveButton";
import { SettingsInput, SettingsTextarea } from "./SettingsField";
import {
  IntegrationCard,
  SettingsIntegrationModal,
} from "./SettingsIntegrationCards";
import {
  SettingsModalCallout,
  SettingsModalField,
  SettingsModalIntro,
  SettingsModalSection,
  SettingsModalToggle,
  SettingsModalToggleGroup,
} from "./SettingsModalLayout";
import PillToggle from "../../../components/PillToggle";
import { getConfiguredStatus } from "../utils/integrationStatus";
import { testGotifyConnection } from "../../../utils/api";

export function SettingsConnectTab({
  settings,
  updateSettings,
  health,
  hasUnsavedChanges,
  saving,
  handleSaveSettings,
  testingGotify,
  setTestingGotify,
  showSuccess,
  showError,
}) {
  const [activeModal, setActiveModal] = useState(null);
  const gotify = settings.integrations?.gotify || {};
  const lastfm = settings.integrations?.lastfm || {};
  const ticketmaster = settings.integrations?.ticketmaster || {};
  const gotifyConfigured = Boolean(gotify.url && gotify.token);
  const lastfmConfigured = Boolean(health?.lastfmConfigured);
  const ticketmasterConfigured = Boolean(health?.ticketmasterConfigured);

  const webhooks = settings.integrations?.webhooks || [];
  const webhookEvents = settings.integrations?.webhookEvents || {};

  const updateWebhooks = (newWebhooks) => {
    updateSettings({
      ...settings,
      integrations: {
        ...settings.integrations,
        webhooks: newWebhooks,
      },
    });
  };

  const updateWebhookEvents = (patch) => {
    updateSettings({
      ...settings,
      integrations: {
        ...settings.integrations,
        webhookEvents: { ...webhookEvents, ...patch },
      },
    });
  };

  const updateGotify = (patch) =>
    updateSettings({
      ...settings,
      integrations: {
        ...settings.integrations,
        gotify: { ...gotify, ...patch },
      },
    });

  const updateLastfm = (patch) =>
    updateSettings({
      ...settings,
      integrations: {
        ...settings.integrations,
        lastfm: { ...lastfm, ...patch },
      },
    });

  const updateTicketmaster = (patch) =>
    updateSettings({
      ...settings,
      integrations: {
        ...settings.integrations,
        ticketmaster: { ...ticketmaster, ...patch },
      },
    });

  const [dragIdx, setDragIdx] = useState(null);
  const allowDragRef = useRef(null);

  const handleTestGotify = async () => {
    const url = gotify.url;
    const token = gotify.token;
    if (!url || !token) {
      showError("Enter Gotify URL and token first");
      return;
    }
    setTestingGotify(true);
    try {
      await testGotifyConnection(url, token);
      showSuccess("Test notification sent.");
    } catch (err) {
      const msg =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message;
      showError(`Gotify test failed: ${msg}`);
    } finally {
      setTestingGotify(false);
    }
  };

  const addWebhook = () => {
    if (webhooks.length >= 5) return;
    updateWebhooks([...webhooks, { url: "", body: null, headers: [] }]);
  };

  const removeWebhook = (index) => {
    updateWebhooks(webhooks.filter((_, i) => i !== index));
  };

  const moveWebhook = (from, to) => {
    const next = [...webhooks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    updateWebhooks(next);
  };

  const updateWebhook = (index, patch) => {
    updateWebhooks(
      webhooks.map((wh, i) => (i === index ? { ...wh, ...patch } : wh)),
    );
  };

  const addHeader = (whIndex) => {
    const wh = webhooks[whIndex];
    if ((wh.headers || []).length >= 10) return;
    updateWebhook(whIndex, {
      headers: [...(wh.headers || []), { key: "", value: "" }],
    });
  };

  const removeHeader = (whIndex, hIndex) => {
    const wh = webhooks[whIndex];
    updateWebhook(whIndex, {
      headers: (wh.headers || []).filter((_, i) => i !== hIndex),
    });
  };

  const updateHeader = (whIndex, hIndex, patch) => {
    const wh = webhooks[whIndex];
    updateWebhook(whIndex, {
      headers: (wh.headers || []).map((h, i) =>
        i === hIndex ? { ...h, ...patch } : h,
      ),
    });
  };

  const handleSave = (e) => {
    const cleanedWebhooks = webhooks.map((wh) => ({
      ...wh,
      headers: (wh.headers || []).filter(
        (h) => (h.key || "").trim() && (h.value || "").trim(),
      ),
    }));
    const settingsToSave = {
      ...settings,
      integrations: {
        ...settings.integrations,
        webhooks: cleanedWebhooks,
      },
    };
    updateWebhooks(cleanedWebhooks);
    handleSaveSettings(e, settingsToSave);
  };

  return (
    <div className="settings-page__panel">
      <div className="settings-page__panel-header">
        <h2 className="settings-page__panel-title">Connect</h2>
        <FlipSaveButton
          saving={saving}
          disabled={!hasUnsavedChanges}
          onClick={handleSave}
        />
      </div>

      <form
        onSubmit={handleSave}
        className="settings-page__form"
        autoComplete="off"
      >
        <div className="settings-page__section">
          <div className="settings-page__section-header">
            <div className="settings-page__section-intro">
              <h3 className="settings-page__section-title">Connections</h3>
              <p className="settings-page__section-note">
                External services Aurral integrates with for notifications and
                discovery data.
              </p>
            </div>
          </div>
          <div className="settings-page__integration-card-grid">
            <IntegrationCard
              title="Gotify"
              subtitle="Push notifications"
              status={getConfiguredStatus(gotifyConfigured)}
              meta={gotify.url ? gotify.url.replace(/^https?:\/\//, "") : "Mobile alerts"}
              onClick={() => setActiveModal("gotify")}
            />
            <IntegrationCard
              title="Last.fm"
              subtitle="Listening history API"
              status={getConfiguredStatus(lastfmConfigured)}
              meta={lastfm.username || "Admin default"}
              onClick={() => setActiveModal("lastfm")}
            />
            <IntegrationCard
              title="Ticketmaster"
              subtitle="Local shows"
              status={getConfiguredStatus(ticketmasterConfigured)}
              meta={`${ticketmaster.searchRadiusMiles ?? 250} mi radius`}
              onClick={() => setActiveModal("ticketmaster")}
            />
          </div>
        </div>

        <div className="settings-page__section">
          <div className="settings-page__section-header">
            <h3 className="settings-page__section-title">Webhooks</h3>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={addWebhook}
              disabled={webhooks.length >= 5}
            >
              <Plus className="artist-icon-xs" />
              Add webhook
            </button>
          </div>

          {!webhooks.length && (
            <p className="settings-page__muted-copy">
              No webhooks configured. Click &ldquo;Add webhook&rdquo; to create
              one.
            </p>
          )}

          <div className="settings-page__fields">
            {webhooks.map((wh, index) => (
              <div
                key={index}
                draggable
                onDragStart={(e) => {
                  if (allowDragRef.current !== index) {
                    e.preventDefault();
                    return;
                  }
                  setDragIdx(index);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragIdx !== null && dragIdx !== index) {
                    moveWebhook(dragIdx, index);
                    setDragIdx(index);
                  }
                }}
                onDragEnd={() => {
                  setDragIdx(null);
                  allowDragRef.current = null;
                }}
                className={`settings-page__webhook-card${dragIdx === index ? " is-dragging" : ""}`}
              >
                <div className="settings-page__webhook-header">
                  <div className="settings-page__webhook-title">
                    <GripVertical
                      className="settings-page__drag-handle artist-icon-xs"
                      onMouseDown={() => {
                        allowDragRef.current = index;
                      }}
                      onMouseUp={() => {
                        allowDragRef.current = null;
                      }}
                    />
                    <span>Webhook #{index + 1}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost-danger"
                    onClick={() => removeWebhook(index)}
                    aria-label="Remove webhook"
                  >
                    <Trash2 className="artist-icon-xs" />
                  </button>
                </div>
                <div>
                  <label className="artist-field-label">URL</label>
                  <SettingsInput
                    type="url"
                    placeholder="https://example.com/webhook"
                    value={wh.url || ""}
                    onChange={(e) => updateWebhook(index, { url: e.target.value })}
                  />
                </div>
                <div>
                  <div className="settings-page__section-header">
                    <label className="artist-field-label">Body</label>
                    {wh.body === null ? (
                      <button
                        type="button"
                        className="btn btn-secondary settings-page__btn--compact"
                        onClick={() => updateWebhook(index, { body: "" })}
                      >
                        <Plus />
                        Add body
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost-danger"
                        onClick={() => updateWebhook(index, { body: null })}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  {wh.body !== null && (
                    <SettingsTextarea
                      rows={3}
                      maxLength={1000}
                      value={wh.body || ""}
                      onChange={(e) =>
                        updateWebhook(index, { body: e.target.value })
                      }
                      spellCheck={false}
                      autoComplete="off"
                    />
                  )}
                </div>
                <div>
                  <div className="settings-page__section-header">
                    <label className="artist-field-label">Headers</label>
                    <button
                      type="button"
                      className="btn btn-secondary settings-page__btn--compact"
                      onClick={() => addHeader(index)}
                      disabled={(wh.headers || []).length >= 10}
                    >
                      <Plus />
                      Add header
                    </button>
                  </div>
                  {(wh.headers || []).length > 0 && (
                    <div className="settings-page__field-stack--md">
                      {(wh.headers || []).map((header, hIndex) => (
                        <div
                          key={hIndex}
                          className="settings-page__header-fields-row"
                        >
                          <SettingsInput
                            wrapperClassName="settings-page__field-grow"
                            className="settings-page__mono-input"
                            placeholder="Header-Name"
                            spellCheck={false}
                            value={header.key || ""}
                            onChange={(e) =>
                              updateHeader(index, hIndex, {
                                key: e.target.value,
                              })
                            }
                          />
                          <SettingsInput
                            wrapperClassName="settings-page__field-grow"
                            className="settings-page__mono-input"
                            placeholder="value"
                            spellCheck={false}
                            value={header.value || ""}
                            onChange={(e) =>
                              updateHeader(index, hIndex, {
                                value: e.target.value,
                              })
                            }
                          />
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost-danger"
                            onClick={() => removeHeader(index, hIndex)}
                            aria-label="Remove header"
                          >
                            <Trash2 className="artist-icon-xs" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="settings-page__section">
          <h3 className="settings-page__section-title">Notification events</h3>
          <div className="settings-page__split settings-page__fields">
            <div className="settings-page__inline-row settings-page__inline-row--between">
              <span className="artist-field-label">
                Notify when daily Discover is updated
              </span>
              <PillToggle
                checked={webhookEvents.notifyDiscoveryUpdated || false}
                onChange={(e) =>
                  updateWebhookEvents({
                    notifyDiscoveryUpdated: e.target.checked,
                  })
                }
              />
            </div>
            <div className="settings-page__inline-row settings-page__inline-row--between">
              <span className="artist-field-label">
                Notify when weekly flow finishes
              </span>
              <PillToggle
                checked={webhookEvents.notifyWeeklyFlowDone || false}
                onChange={(e) =>
                  updateWebhookEvents({
                    notifyWeeklyFlowDone: e.target.checked,
                  })
                }
              />
            </div>
            <div className="settings-page__inline-row settings-page__inline-row--between">
              <span className="artist-field-label">
                Gotify: daily Discover updated
              </span>
              <PillToggle
                checked={gotify.notifyDiscoveryUpdated || false}
                onChange={(e) =>
                  updateGotify({ notifyDiscoveryUpdated: e.target.checked })
                }
              />
            </div>
            <div className="settings-page__inline-row settings-page__inline-row--between">
              <span className="artist-field-label">
                Gotify: weekly flow finished
              </span>
              <PillToggle
                checked={gotify.notifyWeeklyFlowDone || false}
                onChange={(e) =>
                  updateGotify({ notifyWeeklyFlowDone: e.target.checked })
                }
              />
            </div>
          </div>
        </div>
      </form>

      {activeModal === "gotify" && (
        <SettingsIntegrationModal
          title="Gotify"
          onClose={() => setActiveModal(null)}
          footerActions={
            <button
              type="button"
              onClick={handleTestGotify}
              disabled={testingGotify || !gotify.url || !gotify.token}
              className="btn btn-secondary"
            >
              {testingGotify ? "Sending..." : "Test notification"}
            </button>
          }
        >
          <SettingsModalSection title="Connection">
            <SettingsModalField label="Server URL">
              <SettingsInput
                type="url"
                placeholder="https://gotify.example.com"
                autoComplete="off"
                value={gotify.url || ""}
                onChange={(e) => updateGotify({ url: e.target.value })}
              />
            </SettingsModalField>
            <SettingsModalField label="Application token">
              <SettingsInput
                type="password"
                placeholder="Gotify app token"
                autoComplete="off"
                value={gotify.token || ""}
                onChange={(e) => updateGotify({ token: e.target.value })}
              />
            </SettingsModalField>
          </SettingsModalSection>
        </SettingsIntegrationModal>
      )}

      {activeModal === "lastfm" && (
        <SettingsIntegrationModal
          title="Last.fm"
          onClose={() => setActiveModal(null)}
        >
          <SettingsModalIntro>
            Admin default API key and username. Users can override listening
            history in{" "}
            <Link to="/profile" className="settings-page__link">
              Profile
            </Link>
            .
          </SettingsModalIntro>
          <SettingsModalSection title="Credentials">
            <SettingsModalField label="API key">
              <SettingsInput
                type="password"
                placeholder="Last.fm API key"
                autoComplete="off"
                value={lastfm.apiKey || ""}
                onChange={(e) => updateLastfm({ apiKey: e.target.value })}
              />
            </SettingsModalField>
            <SettingsModalField label="Default username">
              <SettingsInput
                type="text"
                placeholder="Your Last.fm username"
                autoComplete="off"
                value={lastfm.username || ""}
                onChange={(e) => updateLastfm({ username: e.target.value })}
              />
            </SettingsModalField>
          </SettingsModalSection>
        </SettingsIntegrationModal>
      )}

      {activeModal === "ticketmaster" && (
        <SettingsIntegrationModal
          title="Ticketmaster"
          onClose={() => setActiveModal(null)}
        >
          <SettingsModalCallout>
            <a
              href="https://developer-acct.ticketmaster.com/user/login"
              target="_blank"
              rel="noopener noreferrer"
              className="settings-page__link"
            >
              Open the Ticketmaster developer portal
            </a>
          </SettingsModalCallout>
          <SettingsModalSection title="API">
            <SettingsModalField label="Consumer key">
              <SettingsInput
                type="password"
                placeholder="Ticketmaster consumer key"
                autoComplete="off"
                value={ticketmaster.apiKey || ""}
                onChange={(e) => updateTicketmaster({ apiKey: e.target.value })}
              />
            </SettingsModalField>
            <SettingsModalField label="Search radius (miles)">
              <SettingsInput
                type="number"
                min={5}
                max={250}
                step={5}
                value={ticketmaster.searchRadiusMiles ?? 250}
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  const value = Number.isFinite(raw)
                    ? Math.max(5, Math.min(250, Math.floor(raw)))
                    : 250;
                  updateTicketmaster({ searchRadiusMiles: value });
                }}
              />
            </SettingsModalField>
          </SettingsModalSection>
          <SettingsModalSection title="Local discovery">
            <SettingsModalToggleGroup>
              <SettingsModalToggle
                label="Include recommended artists in local shows"
                checked={
                  ticketmaster.localDiscoveryIncludeRecommendations !== false
                }
                onChange={(e) =>
                  updateTicketmaster({
                    localDiscoveryIncludeRecommendations: e.target.checked,
                  })
                }
              />
              <SettingsModalToggle
                label="Include trending artists in local shows"
                checked={ticketmaster.localDiscoveryIncludeTrending !== false}
                onChange={(e) =>
                  updateTicketmaster({
                    localDiscoveryIncludeTrending: e.target.checked,
                  })
                }
              />
            </SettingsModalToggleGroup>
          </SettingsModalSection>
        </SettingsIntegrationModal>
      )}
    </div>
  );
}
