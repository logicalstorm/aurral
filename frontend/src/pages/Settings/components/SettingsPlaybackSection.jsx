import { useEffect, useState } from "react";
import { CheckCircle, RefreshCw } from "lucide-react";
import { SettingsInput, SettingsSelect } from "./SettingsField";
import {
  IntegrationCard,
  SettingsIntegrationModal,
} from "./SettingsIntegrationCards";
import {
  SettingsModalActions,
  SettingsModalField,
  SettingsModalIntro,
  SettingsModalSection,
  SettingsModalToggle,
} from "./SettingsModalLayout";
import {
  startPlexAuth,
  checkPlexAuth,
  getPlexResources,
  testPlexConnection,
  syncPlexNow,
  browsePaths,
  testNavidromeOnboarding,
} from "../../../utils/api";
import { getConfiguredStatus } from "../utils/integrationStatus";

export function SettingsPlaybackSection({
  settings,
  updateSettings,
  hasUnsavedChanges,
  handleSaveSettings,
  showSuccess,
  showError,
  showInfo,
}) {
  const [activeModal, setActiveModal] = useState(null);
  const [plexConnecting, setPlexConnecting] = useState(false);
  const [testingPlex, setTestingPlex] = useState(false);
  const [testingNavidrome, setTestingNavidrome] = useState(false);
  const [syncingPlex, setSyncingPlex] = useState(false);
  const [plexServers, setPlexServers] = useState([]);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseState, setBrowseState] = useState({
    path: "/",
    parent: null,
    directories: [],
  });

  const navidrome = settings.integrations?.navidrome || {};
  const plex = settings.integrations?.plex || {};
  const navidromeConfigured = Boolean(navidrome.url);
  const plexConfigured = Boolean(plex.token && plex.url);
  const plexToken = plex.token;

  const closeModal = () => {
    setActiveModal(null);
    setBrowseOpen(false);
  };

  const updateNavidrome = (patch) =>
    updateSettings({
      ...settings,
      integrations: {
        ...settings.integrations,
        navidrome: { ...navidrome, ...patch },
      },
    });

  const updatePlex = (patch) =>
    updateSettings({
      ...settings,
      integrations: {
        ...settings.integrations,
        plex: { ...plex, ...patch },
      },
    });

  const loadPlexServers = async (token) => {
    const { servers } = await getPlexResources(token);
    const list = Array.isArray(servers) ? servers : [];
    setPlexServers(list);
    return list;
  };

  useEffect(() => {
    if (!plexToken) {
      setPlexServers([]);
      return;
    }
    let cancelled = false;
    getPlexResources(plexToken)
      .then(({ servers }) => {
        if (!cancelled) setPlexServers(Array.isArray(servers) ? servers : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [plexToken]);

  const loadBrowse = async (path) => {
    setBrowseLoading(true);
    try {
      const result = await browsePaths(path);
      setBrowseState(result);
    } catch (err) {
      const errorMsg =
        err.response?.data?.message || err.response?.data?.error || err.message;
      showError(`Cannot read path: ${errorMsg}`);
    } finally {
      setBrowseLoading(false);
    }
  };

  const handleToggleBrowse = () => {
    if (browseOpen) {
      setBrowseOpen(false);
      return;
    }
    setBrowseOpen(true);
    loadBrowse(plex.downloadsPath || "/");
  };

  const handleUseBrowsedFolder = () => {
    updatePlex({ downloadsPath: browseState.path });
    setBrowseOpen(false);
  };

  const pickBestConnection = (server) => {
    const conns = server.connections || [];
    return conns.find((c) => c.local) || conns.find((c) => c.uri) || conns[0];
  };

  const handleConnectPlex = async () => {
    setPlexConnecting(true);
    try {
      const { pinId, code, authUrl, clientId } = await startPlexAuth();
      const popup = window.open(
        authUrl,
        "plex-auth",
        "width=600,height=700",
      );
      const deadline = Date.now() + 3 * 60 * 1000;
      let token = null;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const res = await checkPlexAuth(pinId, code);
          if (res.token) {
            token = res.token;
            break;
          }
        } catch {}
      }
      if (popup && !popup.closed) popup.close();
      if (!token) {
        showError("Plex authentication timed out. Please try again.");
        return;
      }
      const servers = await loadPlexServers(token);
      const owned = (servers || []).filter((s) => s.owned);
      const patch = { token, ...(clientId ? { clientId } : {}) };
      if (owned.length === 1) {
        const best = pickBestConnection(owned[0]);
        if (best?.uri) {
          patch.url = best.uri;
          patch.machineIdentifier = owned[0].clientIdentifier;
        }
      }
      updatePlex(patch);
      showSuccess(
        owned.length === 1 && patch.url
          ? `Signed in and selected "${owned[0].name}". Remember to Save settings.`
          : "Signed in to Plex. Select your server below.",
      );
    } catch (err) {
      const errorMsg =
        err.response?.data?.message || err.response?.data?.error || err.message;
      showError(`Plex sign-in failed: ${errorMsg}`);
    } finally {
      setPlexConnecting(false);
    }
  };

  const handleSelectPlexServer = (server) => {
    const best = pickBestConnection(server);
    if (!best?.uri) {
      showError("Selected Plex server has no usable connection.");
      return;
    }
    updatePlex({ url: best.uri, machineIdentifier: server.clientIdentifier });
    showInfo(`Selected "${server.name}". Remember to Save settings.`);
  };

  const handleTestPlex = async () => {
    if (!plex.url || !plex.token) {
      showError("Connect to Plex and select a server first");
      return;
    }
    setTestingPlex(true);
    try {
      const result = await testPlexConnection(plex.url, plex.token);
      if (result.success) {
        showSuccess(
          `Plex connection successful!${result.version ? ` (v${result.version})` : ""}`,
        );
        if (result.machineIdentifier) {
          updatePlex({ machineIdentifier: result.machineIdentifier });
        }
      } else {
        showError(`Connection failed: ${result.message || result.error}`);
      }
    } catch (err) {
      const errorMsg =
        err.response?.data?.message || err.response?.data?.error || err.message;
      showError(`Connection failed: ${errorMsg}`);
    } finally {
      setTestingPlex(false);
    }
  };

  const handleTestNavidrome = async () => {
    if (!navidrome.url || !navidrome.username) {
      showError("Enter Navidrome URL and username first");
      return;
    }
    setTestingNavidrome(true);
    try {
      if (handleSaveSettings) {
        await handleSaveSettings();
      }
      await testNavidromeOnboarding(
        navidrome.url,
        navidrome.username,
        navidrome.password || "",
      );
      showSuccess("Navidrome connection OK");
    } catch (err) {
      const errorMsg =
        err.response?.data?.message || err.response?.data?.error || err.message;
      showError(`Navidrome connection failed: ${errorMsg}`);
    } finally {
      setTestingNavidrome(false);
    }
  };

  const handleSyncPlex = async () => {
    if (hasUnsavedChanges) {
      showError("Save settings first, then sync to Plex.");
      return;
    }
    setSyncingPlex(true);
    try {
      const result = await syncPlexNow();
      const built = (result.playlists || []).length;
      if (result.scanInProgress) {
        showInfo(
          "Library ready and a Plex scan is running. Playlists will fill in automatically over the next few minutes as Plex indexes the tracks — no need to click again.",
        );
      } else {
        showSuccess(
          `Synced to Plex: ${built} playlist(s) from ${result.indexedTracks} indexed track(s).`,
        );
      }
    } catch (err) {
      const errorMsg =
        err.response?.data?.message || err.response?.data?.error || err.message;
      showError(`Plex sync failed: ${errorMsg}`);
    } finally {
      setSyncingPlex(false);
    }
  };

  const selectedPlexServer = plexServers.find(
    (server) => server.clientIdentifier === plex.machineIdentifier,
  );
  const navidromeMeta = navidrome.username || navidrome.url || "Subsonic API";
  const plexMeta = selectedPlexServer?.name || (plex.token ? "Signed in" : "Flow playlists");

  return (
    <>
      <div className="settings-page__section">
        <div className="settings-page__section-header">
          <div className="settings-page__section-intro">
            <h3 className="settings-page__section-title">Playback servers</h3>
            <p className="settings-page__section-note">
              Servers Aurral writes playlists to for in-app and external playback.
            </p>
          </div>
        </div>
        <div className="settings-page__integration-card-grid">
          <IntegrationCard
            title="Navidrome"
            subtitle="Subsonic"
            status={getConfiguredStatus(navidromeConfigured)}
            meta={navidromeMeta}
            onClick={() => setActiveModal("navidrome")}
          />
          <IntegrationCard
            title="Plex"
            subtitle="Plexamp"
            status={getConfiguredStatus(plexConfigured)}
            meta={plexMeta}
            onClick={() => setActiveModal("plex")}
          />
        </div>
      </div>

      {activeModal === "navidrome" && (
        <SettingsIntegrationModal
          title="Subsonic / Navidrome"
          onClose={closeModal}
          footerActions={
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleTestNavidrome}
              disabled={
                testingNavidrome || !navidrome.url || !navidrome.username
              }
            >
              <RefreshCw
                className={`artist-icon-sm${testingNavidrome ? " animate-spin" : ""}`}
              />
              {testingNavidrome ? "Testing…" : "Test connection"}
            </button>
          }
        >
          <SettingsModalSection title="Connection">
            <SettingsModalField label="Server URL">
              <SettingsInput
                type="url"
                placeholder="https://music.example.com"
                autoComplete="off"
                value={navidrome.url || ""}
                onChange={(event) =>
                  updateNavidrome({ url: event.target.value })
                }
              />
            </SettingsModalField>
            <SettingsModalField label="Username">
              <SettingsInput
                type="text"
                autoComplete="off"
                value={navidrome.username || ""}
                onChange={(event) =>
                  updateNavidrome({ username: event.target.value })
                }
              />
            </SettingsModalField>
            <SettingsModalField label="Password">
              <SettingsInput
                type="password"
                autoComplete="off"
                value={navidrome.password || ""}
                onChange={(event) =>
                  updateNavidrome({ password: event.target.value })
                }
              />
            </SettingsModalField>
          </SettingsModalSection>

          <SettingsModalSection title="Playlists">
            <SettingsModalToggle
              label="Use Navidrome-visible paths in playlist files"
              checked={navidrome.m3uPathMode === "remote"}
              onChange={(event) =>
                updateNavidrome({
                  m3uPathMode: event.target.checked ? "remote" : "local",
                })
              }
            />
            <p className="settings-modal__hint">
              Enable when Navidrome cannot open Aurral&apos;s container paths,
              including native Navidrome or Docker containers with different
              mounts. Playlist M3U files will use mapped paths such as{" "}
              <code>/data/media/music/...</code> or <code>N:\Music\...</code>.
            </p>
            <p className="settings-modal__hint">
              When using Weekly Flow: set Navidrome&apos;s{" "}
              <code>Scanner.PurgeMissing</code> to <code>always</code> or{" "}
              <code>full</code> (e.g. <code>ND_SCANNER_PURGEMISSING=always</code>)
              so turning off a flow removes those tracks from the library.
            </p>
          </SettingsModalSection>
        </SettingsIntegrationModal>
      )}

      {activeModal === "plex" && (
        <SettingsIntegrationModal
          title="Plex"
          onClose={closeModal}
          footerActions={
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleTestPlex}
              disabled={testingPlex || !plex.url || !plex.token}
            >
              <RefreshCw
                className={`artist-icon-sm${testingPlex ? " animate-spin" : ""}`}
              />
              {testingPlex ? "Testing…" : "Test connection"}
            </button>
          }
        >
          <SettingsModalIntro>
            Sign in with your Plex account to let Aurral create a dedicated
            music library pointed at your flow downloads and build a playlist
            for each flow. Playlists appear in Plex and Plexamp.
          </SettingsModalIntro>

          <SettingsModalSection title="Account">
            <SettingsModalActions>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleConnectPlex}
                disabled={plexConnecting}
              >
                {plexConnecting
                  ? "Waiting for Plex…"
                  : plex.token
                    ? "Reconnect Plex account"
                    : "Connect Plex account"}
              </button>
              {plex.token && (
                <span className="settings-page__status">
                  <CheckCircle className="settings-page__status-icon" />
                  Signed in
                </span>
              )}
            </SettingsModalActions>
          </SettingsModalSection>

          <SettingsModalSection title="Connection">
            {plex.token && (
              <SettingsModalField label="Plex server">
                <SettingsSelect
                  value={plex.machineIdentifier || ""}
                  onChange={(event) => {
                    const server = plexServers.find(
                      (entry) => entry.clientIdentifier === event.target.value,
                    );
                    if (server) handleSelectPlexServer(server);
                  }}
                >
                  <option value="" disabled>
                    {plexServers.length ? "Select a server…" : "Loading servers…"}
                  </option>
                  {plexServers.map((server) => (
                    <option
                      key={server.clientIdentifier}
                      value={server.clientIdentifier}
                    >
                      {server.name}
                      {server.owned ? "" : " (shared)"}
                    </option>
                  ))}
                </SettingsSelect>
              </SettingsModalField>
            )}
            <SettingsModalField
              label="Server URL"
              hint="Auto-filled when you select a server, or enter it manually."
            >
              <SettingsInput
                type="url"
                placeholder="http://localhost:32400"
                autoComplete="off"
                value={plex.url || ""}
                onChange={(event) => updatePlex({ url: event.target.value })}
              />
            </SettingsModalField>
          </SettingsModalSection>

          <SettingsModalSection title="Library path">
            <SettingsModalField
              label="Plex downloads path (optional)"
              hint={
                <>
                  Only needed if Plex runs in a different container/host than
                  Aurral. Enter the downloads folder path as the{" "}
                  <strong>Plex server</strong> sees it — Aurral appends{" "}
                  <code>/aurral-weekly-flow</code>. Leave blank to use
                  Aurral&apos;s own download path.
                </>
              }
            >
              <SettingsInput
                type="text"
                placeholder="/data/aurral_downloads"
                autoComplete="off"
                value={plex.downloadsPath || ""}
                onChange={(event) =>
                  updatePlex({ downloadsPath: event.target.value })
                }
              />
              <SettingsModalActions>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleToggleBrowse}
                >
                  {browseOpen ? "Close folder browser" : "Browse folders"}
                </button>
              </SettingsModalActions>
            </SettingsModalField>

            {browseOpen && (
              <div className="settings-modal__panel">
                <code className="settings-modal__panel-path">
                  {browseState.path}
                </code>
                <SettingsModalActions>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleUseBrowsedFolder}
                  >
                    Use this folder
                  </button>
                </SettingsModalActions>
                <div className="settings-modal__browse-list-wrap">
                  {browseLoading ? (
                    <p className="settings-modal__hint">Loading…</p>
                  ) : (
                    <ul className="settings-modal__browse-list">
                      {browseState.parent && (
                        <li>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => loadBrowse(browseState.parent)}
                          >
                            ..
                          </button>
                        </li>
                      )}
                      {browseState.directories.length === 0 && (
                        <li className="settings-modal__hint">
                          No subfolders here.
                        </li>
                      )}
                      {browseState.directories.map((dir) => (
                        <li key={dir.path}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => loadBrowse(dir.path)}
                          >
                            {dir.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </SettingsModalSection>

          <SettingsModalSection title="Sync">
            <SettingsModalActions>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSyncPlex}
                disabled={syncingPlex || !plex.url || !plex.token}
              >
                {syncingPlex ? "Syncing…" : "Sync to Plex now"}
              </button>
            </SettingsModalActions>
            <p className="settings-modal__hint">
              Creates an &quot;Aurral&quot; music library pointed at your
              downloads, scans it, and builds a playlist per flow. The Plex server
              must be able to read the same downloads path Aurral writes to. Save
              settings before syncing.
            </p>
          </SettingsModalSection>
        </SettingsIntegrationModal>
      )}
    </>
  );
}
