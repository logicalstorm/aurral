import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { useState, useEffect, useRef, Suspense, lazy } from "react";
import PropTypes from "prop-types";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import { checkHealth } from "./utils/api";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ToastProvider, useToast } from "./contexts/ToastContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import ReloadPrompt from "./components/ReloadPrompt";

const SearchResultsPage = lazy(() => import("./pages/SearchResultsPage"));
const DiscoverPage = lazy(() => import("./pages/DiscoverPage"));
const LibraryPage = lazy(() => import("./pages/LibraryPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const ArtistDetailsPage = lazy(() => import("./pages/ArtistDetailsPage"));
const RequestsPage = lazy(() => import("./pages/RequestsPage"));
const FlowPage = lazy(() => import("./pages/FlowPage"));

const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[200px]">
    <div
      className="animate-spin h-8 w-8"
      style={{ borderBottom: "2px solid #707e61" }}
    ></div>
  </div>
);

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading, authRequired, onboardingRequired } =
    useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div
          className="animate-spin h-12 w-12"
          style={{ borderBottom: "2px solid #707e61" }}
        ></div>
      </div>
    );
  }

  if (onboardingRequired) {
    return <Onboarding />;
  }

  if (authRequired && !isAuthenticated) {
    return <Login />;
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

PermissionRoute.propTypes = {
  children: PropTypes.node.isRequired,
  permission: PropTypes.string,
};

ProtectedRoute.propTypes = {
  children: PropTypes.node.isRequired,
};

function AppContent() {
  const [isHealthy, setIsHealthy] = useState(null);
  const [rootFolderConfigured, setRootFolderConfigured] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const { isAuthenticated } = useAuth();
  const { showInfo } = useToast();
  const updateNotifiedRef = useRef(null);

  useEffect(() => {
    const checkApiHealth = async () => {
      try {
        const health = await checkHealth();
        setIsHealthy(health.status === "ok");
        setRootFolderConfigured(health.rootFolderConfigured || false);
      } catch {
        setIsHealthy(false);
      }
    };

    checkApiHealth();
    const interval = setInterval(checkApiHealth, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  useEffect(() => {
    const currentVersion = import.meta.env.VITE_APP_VERSION;
    const repo = import.meta.env.VITE_GITHUB_REPO || "lklynet/aurral";
    if (!currentVersion || currentVersion === "unknown" || !repo) {
      return;
    }
    let active = true;
    const checkForUpdate = async () => {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${repo}/releases/latest`,
        );
        if (!res.ok) {
          return;
        }
        const data = await res.json();
        const latest = (data.tag_name || "").replace(/^v/, "");
        if (!latest || latest === currentVersion) {
          return;
        }
        if (updateNotifiedRef.current === latest) {
          return;
        }
        if (!active) {
          return;
        }
        setUpdateInfo({
          current: currentVersion,
          latest,
          url: data.html_url || `https://github.com/${repo}/releases/latest`,
        });
        updateNotifiedRef.current = latest;
        showInfo(`Update available: ${currentVersion} → ${latest}`, 10000);
      } catch {}
    };
    checkForUpdate();
    const intervalId = setInterval(checkForUpdate, 60 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [showInfo]);

  return (
    <Router>
      <ProtectedRoute>
        <Layout
          isHealthy={isHealthy}
          rootFolderConfigured={rootFolderConfigured}
        >
          {updateInfo && (
            <div className="mb-6 bg-blue-500/20 border border-blue-500/30 p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center">
                  <svg
                    className="w-5 h-5 text-blue-300 mr-3"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M18 10A8 8 0 112 10a8 8 0 0116 0zm-8-4a1 1 0 00-.894.553l-3 6a1 1 0 101.788.894L7.618 12h4.764l.724 1.447a1 1 0 101.788-.894l-3-6A1 1 0 0010 6zm0 3a1 1 0 00-.894.553l-.5 1A1 1 0 009.5 12h1a1 1 0 00.894-1.447l-.5-1A1 1 0 0010 9z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <p className="text-blue-200 font-medium">
                    Update available: {updateInfo.current} →{" "}
                    {updateInfo.latest}
                  </p>
                </div>
                <a
                  href={updateInfo.url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary btn-sm"
                >
                  View on GitHub
                </a>
              </div>
            </div>
          )}
          {isHealthy === false && (
            <div className="mb-6 bg-red-500/20 border border-red-500/30 p-4">
              <div className="flex items-center">
                <svg
                  className="w-5 h-5 text-red-400 mr-3"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                <p className="text-red-400 font-medium">
                  Unable to connect to the backend API. Please check your
                  configuration.
                </p>
              </div>
            </div>
          )}

          {isHealthy && !rootFolderConfigured && (
            <div className="mb-6 bg-yellow-500/20 p-4">
              <div className="flex items-center">
                <svg
                  className="w-5 h-5 text-yellow-400 mr-3"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                <p className="text-yellow-400 font-medium">
                  Root folder is not configured. Please configure your music
                  library root folder in settings.
                </p>
              </div>
            </div>
          )}

          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<DiscoverPage />} />
              <Route path="/search" element={<SearchResultsPage />} />
              <Route path="/discover" element={<Navigate to="/" replace />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route
                path="/flow"
                element={
                  <PermissionRoute permission="accessFlow">
                    <FlowPage />
                  </PermissionRoute>
                }
              />
              <Route path="/requests" element={<RequestsPage />} />
              <Route path="/artist/:mbid" element={<ArtistDetailsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </Suspense>
        </Layout>
      </ProtectedRoute>
    </Router>
  );
}

function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <AppContent />
          <ReloadPrompt />
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
