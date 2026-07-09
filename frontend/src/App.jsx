import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect, Suspense, lazy, useRef } from "react";
import Layout from "./components/Layout";
import { clearAuthStorage, checkHealthLive, getBootstrapStatus, getStoredAuth, completeSpotifyOAuth } from "./utils/api";
import { getAppBasePath } from "./utils/basePath.js";
import {
  PROXY_RELOAD_TS_KEY,
  clearAuthRecoveryFlags,
  hardNavigateHome,
  isProxyAuthActive,
  resetClientCache,
} from "./utils/authRecovery.js";
import { DISCOVERY_MANUAL_REFRESH_KEY } from "./utils/discoverRecentNavigation.js";
import { AudioPlayerProvider } from "react-use-audio-player";
import { ToastProvider, useToast } from "./contexts/ToastContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { DiscoverRecentProvider } from "./contexts/DiscoverRecentProvider";
import { AudioQueueProvider } from "./contexts/AudioQueueProvider";
import { AlertTriangle, XCircle } from "lucide-react";
import ReloadPrompt from "./components/ReloadPrompt";
import UpdateBanner from "./components/UpdateBanner";
import { useWebSocketChannel } from "./hooks/useWebSocket";
import { consumePendingSpotifyOAuth } from "./utils/spotifyOAuthHandoff.js";
import {
  ActivitySourceRedirect,
  ActivityRootRedirect,
  LegacyHistoryRedirect,
} from "./navigation/ActivityRedirects";

const Login = lazy(() => import("./pages/Login"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const SearchResultsPage = lazy(() => import("./pages/SearchResultsPage"));
const DiscoverPage = lazy(() => import("./pages/DiscoverPage"));
const ShowsPage = lazy(() => import("./pages/ShowsPage"));
const LibraryPage = lazy(() => import("./pages/LibraryPage"));
const SettingsPage = lazy(() => import("./pages/Settings/SettingsPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const ArtistDetailsPage = lazy(() => import("./pages/ArtistDetails/ArtistDetailsPage"));
const ArtistAlbumsPage = lazy(() => import("./pages/ArtistDetails/ArtistAlbumsPage"));
const ReleasePage = lazy(() => import("./pages/ArtistDetails/ReleasePage"));
const ArtistAppearsOnPage = lazy(() => import("./pages/ArtistDetails/ArtistAppearsOnPage"));
const ActivityPage = lazy(() => import("./pages/ActivityPage"));
const FlowPage = lazy(() => import("./pages/FlowPage"));
const DiscoverPlaylistsPage = lazy(() => import("./pages/DiscoverPlaylistsPage"));
const DiscoverPlaylistDetailPage = lazy(() => import("./pages/DiscoverPlaylistDetailPage"));

const PageLoader = () => (
  <div className="app-loading">
    <div className="app-loading__spinner" />
  </div>
);

const ScreenLoader = () => (
  <div className="app-loading app-loading--screen">
    <div className="app-loading__spinner app-loading__spinner--lg" />
  </div>
);

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading, authRequired, onboardingRequired } = useAuth();

  if (isLoading) {
    return <ScreenLoader />;
  }

  if (onboardingRequired) {
    return (
      <Suspense fallback={<ScreenLoader />}>
        <Onboarding />
      </Suspense>
    );
  }

  if (authRequired && !isAuthenticated) {
    return (
      <Suspense fallback={<ScreenLoader />}>
        <Login />
      </Suspense>
    );
  }

  return children;
};

const PermissionRoute = ({ children, permission }) => {
  const { hasPermission } = useAuth();
  if (permission && !hasPermission(permission)) {
    return <Navigate to="/" replace />;
  }
  return children;
};

function AppContent() {
  const basePath = getAppBasePath();
  const [isHealthy, setIsHealthy] = useState(null);
  const [healthIssue, setHealthIssue] = useState(null);
  const [rootFolderConfigured, setRootFolderConfigured] = useState(false);
  const [appVersion, setAppVersion] = useState(null);
  const discoveryToastShownRef = useRef(false);
  const healthCheckInFlightRef = useRef(false);
  const { isAuthenticated, user, bootstrap, authRequired, logout, refreshAuth } = useAuth();
  const { showSuccess, showError } = useToast();

  useEffect(() => {
    const pending = consumePendingSpotifyOAuth();
    if (!pending) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const status = await completeSpotifyOAuth(pending);
        if (cancelled) return;
        showSuccess(
          status?.displayName
            ? `Spotify connected as ${status.displayName}`
            : "Spotify connected",
        );
      } catch (error) {
        if (cancelled) return;
        showError(
          error?.response?.data?.message ||
            error?.message ||
            "Failed to connect Spotify",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showError, showSuccess]);

  const RELOAD_COOLDOWN_MS = 10000;

  useWebSocketChannel("discovery", (msg) => {
    if (msg.type !== "discovery_update") return;

    const hasPendingManualRefresh = localStorage.getItem(DISCOVERY_MANUAL_REFRESH_KEY) === "1";
    if (!hasPendingManualRefresh) return;

    if (msg.phase === "error") {
      localStorage.removeItem(DISCOVERY_MANUAL_REFRESH_KEY);
      discoveryToastShownRef.current = false;
      showError(msg.error ? `Discovery refresh failed: ${msg.error}` : "Discovery refresh failed");
      return;
    }

    if (msg.phase === "completed" || Array.isArray(msg.recommendations)) {
      if (discoveryToastShownRef.current) return;
      discoveryToastShownRef.current = true;
      localStorage.removeItem(DISCOVERY_MANUAL_REFRESH_KEY);
      showSuccess("Discovery refresh completed. Recommendations are now updated.");
      setTimeout(() => {
        discoveryToastShownRef.current = false;
      }, 1000);
    }
  });

  const applyBootstrapHealth = (payload) => {
    setIsHealthy(payload.status === "ok");
    setRootFolderConfigured(payload.rootFolderConfigured || false);
    setAppVersion(payload.appVersion || null);
    setHealthIssue(payload.lidarr?.circuitOpen ? "lidarr" : null);
  };

  useEffect(() => {
    if (!bootstrap) return;
    applyBootstrapHealth(bootstrap);
  }, [bootstrap]);

  useEffect(() => {
    const checkApiHealth = async () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      if (healthCheckInFlightRef.current) return;
      healthCheckInFlightRef.current = true;
      try {
        const bootstrap = await getBootstrapStatus();
        applyBootstrapHealth(bootstrap);
      } catch {
        try {
          await checkHealthLive();
          setIsHealthy(true);
          setHealthIssue("degraded");
          setAppVersion(null);
        } catch {
          setIsHealthy(false);
          setHealthIssue("backend");
          setAppVersion(null);
        }
        refreshAuth();
      } finally {
        healthCheckInFlightRef.current = false;
      }
    };

    checkApiHealth();
    const interval = setInterval(checkApiHealth, 30000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkApiHealth();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isAuthenticated, refreshAuth]);

  const handleReauth = async () => {
    await resetClientCache();
    clearAuthStorage();
    clearAuthRecoveryFlags();
    try {
      await logout();
    } catch {}
    hardNavigateHome(basePath);
  };

  useEffect(() => {
    if (isHealthy === null) return;
    if (isHealthy !== false || healthIssue === "degraded") {
      if (isHealthy === true) clearAuthRecoveryFlags();
      return;
    }

    const hasStoredToken = !!getStoredAuth().token;
    if (!isAuthenticated && !isProxyAuthActive() && !hasStoredToken) return;

    const lastReload = Number(globalThis?.sessionStorage?.getItem(PROXY_RELOAD_TS_KEY) || 0);
    if (Date.now() - lastReload < RELOAD_COOLDOWN_MS) return;

    globalThis?.sessionStorage?.setItem(PROXY_RELOAD_TS_KEY, String(Date.now()));
    void resetClientCache().then(() => hardNavigateHome(basePath));
  }, [basePath, healthIssue, isHealthy, isAuthenticated]);

  return (
    <Router
      basename={basePath}
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <DiscoverRecentProvider>
        <ProtectedRoute>
          <Layout>
          <UpdateBanner
            currentVersion={appVersion}
            visible={!user || user.role === "admin"}
          />
          {healthIssue === "lidarr" && isHealthy && (
            <div className="app-status-banner app-status-banner--warning">
              <AlertTriangle className="app-status-banner__icon app-status-banner__icon--warning" />
              <p className="app-status-banner__text app-status-banner__text--warning">
                Lidarr is busy. Library data may be stale until it catches up.
              </p>
            </div>
          )}

          {healthIssue === "degraded" && (
            <div className="app-status-banner app-status-banner--warning">
              <AlertTriangle className="app-status-banner__icon app-status-banner__icon--warning" />
              <p className="app-status-banner__text app-status-banner__text--warning">
                Aurral is responding slowly. Lidarr may be busy — try again in a minute.
              </p>
            </div>
          )}

          {healthIssue === "backend" && isHealthy === false && (
            <div className="app-status-banner app-status-banner--error">
              <XCircle className="app-status-banner__icon app-status-banner__icon--error" />
              <p className="app-status-banner__text app-status-banner__text--error">
                Unable to connect to the Aurral backend. Your session may have expired.
              </p>
              {authRequired && (
                <button type="button" className="btn btn-primary btn--sm" onClick={handleReauth}>
                  Sign in again
                </button>
              )}
            </div>
          )}

          {isHealthy && !rootFolderConfigured && (
            <div className="app-status-banner app-status-banner--warning">
              <AlertTriangle className="app-status-banner__icon app-status-banner__icon--warning" />
              <p className="app-status-banner__text app-status-banner__text--warning">
                Root folder is not configured. Please configure your music
                library root folder in settings.
              </p>
            </div>
          )}
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<DiscoverPage />} />
                <Route path="/shows" element={<Navigate to="/shows/all" replace />} />
                <Route path="/shows/:filter" element={<ShowsPage />} />
                <Route path="/search" element={<SearchResultsPage />} />
                <Route path="/discover" element={<Navigate to="/" replace />} />
                <Route path="/discover/playlists/:presetId" element={<DiscoverPlaylistDetailPage />} />
                <Route path="/discover/playlists" element={<DiscoverPlaylistsPage />} />
                <Route path="/library" element={<LibraryPage />} />
                <Route
                  path="/playlists"
                  element={
                    <PermissionRoute permission="accessFlow">
                      <FlowPage />
                    </PermissionRoute>
                  }
                />
                <Route path="/flow" element={<Navigate to="/playlists" replace />} />
                <Route path="/downloads" element={<Navigate to="/activity/queue" replace />} />
                <Route path="/requests" element={<Navigate to="/activity/queue" replace />} />
                <Route path="/history" element={<Navigate to="/activity/history" replace />} />
                <Route path="/history/:legacyTab" element={<LegacyHistoryRedirect />} />
                <Route path="/activity" element={<ActivityRootRedirect />} />
                <Route path="/activity/:view" element={<ActivityPage />} />
                <Route path="/activity/:view/:source" element={<ActivitySourceRedirect />} />
                <Route path="/artist/:mbid/albums" element={<ArtistAlbumsPage />} />
                <Route path="/artist/:mbid/release/:releaseMbid" element={<ReleasePage />} />
                <Route path="/artist/:mbid/appears-on" element={<ArtistAppearsOnPage />} />
                <Route path="/artist/:mbid" element={<ArtistDetailsPage />} />
                <Route
                  path="/settings/:tab?"
                  element={
                    <PermissionRoute permission="accessSettings">
                      <SettingsPage />
                    </PermissionRoute>
                  }
                />
                <Route path="/profile" element={<ProfilePage />} />
              </Routes>
            </Suspense>
          </Layout>
        </ProtectedRoute>
      </DiscoverRecentProvider>
    </Router>
  );
}

function App() {
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light");
    root.classList.add("dark");
  }, []);

  return (
    <ToastProvider>
        <AuthProvider>
          <AudioPlayerProvider>
            <AudioQueueProvider>
              <AppContent />
              <ReloadPrompt />
            </AudioQueueProvider>
          </AudioPlayerProvider>
        </AuthProvider>
      </ToastProvider>
  );
}

export default App;
