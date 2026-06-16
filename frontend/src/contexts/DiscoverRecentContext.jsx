import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import PropTypes from "prop-types";
import { useLocation } from "react-router-dom";
import {
  buildDiscoverRecentLabel,
  DISCOVER_FLOW_ACTIVE_KEY,
  DISCOVER_RECENT_PAGES_KEY,
  DISCOVER_RECENT_PAGES_LIMIT,
  getDiscoverPathFromLocation,
  isDiscoverBrowsePath,
  isDiscoverExitPath,
  isDiscoverHomePath,
  normalizeDiscoverPath,
  readDiscoverFlowActive,
  readDiscoverRecentPages,
  shouldRecordDiscoverNavigation,
  shouldKeepDiscoverSectionActive,
  shouldTrackDiscoverPath,
  writeDiscoverFlowActive,
  writeDiscoverRecentPages,
} from "../utils/discoverRecentNavigation";

const DiscoverRecentContext = createContext(null);

function DiscoverFlowLocationSync({
  recentPages,
  discoverFlowActive,
  setDiscoverFlowActive,
  addRecentPage,
}) {
  const location = useLocation();

  useEffect(() => {
    const pathname = location.pathname;
    const path = getDiscoverPathFromLocation(location);

    if (isDiscoverExitPath(pathname)) {
      setDiscoverFlowActive(false);
      return;
    }

    if (isDiscoverHomePath(pathname)) {
      return;
    }

    if (recentPages.some((entry) => entry.path === path)) {
      setDiscoverFlowActive(true);
      return;
    }

    if (
      discoverFlowActive &&
      isDiscoverBrowsePath(pathname) &&
      shouldTrackDiscoverPath(path)
    ) {
      addRecentPage(path, location.state || {});
    }
  }, [
    addRecentPage,
    discoverFlowActive,
    location,
    recentPages,
    setDiscoverFlowActive,
  ]);

  return null;
}

DiscoverFlowLocationSync.propTypes = {
  recentPages: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      path: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
    }),
  ).isRequired,
  discoverFlowActive: PropTypes.bool.isRequired,
  setDiscoverFlowActive: PropTypes.func.isRequired,
  addRecentPage: PropTypes.func.isRequired,
};

export function DiscoverRecentProvider({ children }) {
  const location = useLocation();
  const [recentPages, setRecentPages] = useState(() => readDiscoverRecentPages());
  const [discoverFlowActive, setDiscoverFlowActiveState] = useState(() =>
    readDiscoverFlowActive(),
  );

  const setDiscoverFlowActive = useCallback((active) => {
    writeDiscoverFlowActive(active);
    setDiscoverFlowActiveState(active);
  }, []);

  const syncFromStorage = useCallback(() => {
    setRecentPages(readDiscoverRecentPages());
    setDiscoverFlowActiveState(readDiscoverFlowActive());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onStorage = (event) => {
      if (
        event.key === null ||
        event.key === DISCOVER_RECENT_PAGES_KEY ||
        event.key === DISCOVER_FLOW_ACTIVE_KEY
      ) {
        syncFromStorage();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [syncFromStorage]);

  const addRecentPage = useCallback((path, state = {}) => {
    const normalizedPath = normalizeDiscoverPath(path);
    if (!normalizedPath || !shouldTrackDiscoverPath(normalizedPath)) return;

    const label = buildDiscoverRecentLabel(normalizedPath, state);
    setRecentPages((current) => {
      const next = [
        {
          id: normalizedPath,
          path: normalizedPath,
          label,
        },
        ...current.filter((entry) => entry.path !== normalizedPath),
      ].slice(0, DISCOVER_RECENT_PAGES_LIMIT);
      writeDiscoverRecentPages(next);
      return next;
    });
    setDiscoverFlowActive(true);
  }, [setDiscoverFlowActive]);

  const clearRecentPages = useCallback(() => {
    writeDiscoverRecentPages([]);
    setRecentPages([]);
    setDiscoverFlowActive(false);
  }, [setDiscoverFlowActive]);

  const shouldRecordNavigation = useCallback(
    (fromLocation = location) =>
      shouldRecordDiscoverNavigation(
        fromLocation,
        recentPages,
        discoverFlowActive,
      ),
    [discoverFlowActive, location, recentPages],
  );

  const isDiscoverSectionActive = useMemo(
    () =>
      shouldKeepDiscoverSectionActive(
        location,
        recentPages,
        discoverFlowActive,
      ),
    [discoverFlowActive, location, recentPages],
  );

  const value = useMemo(
    () => ({
      recentPages,
      discoverFlowActive,
      isDiscoverSectionActive,
      addRecentPage,
      clearRecentPages,
      shouldRecordNavigation,
    }),
    [
      addRecentPage,
      clearRecentPages,
      discoverFlowActive,
      isDiscoverSectionActive,
      recentPages,
      shouldRecordNavigation,
    ],
  );

  return (
    <DiscoverRecentContext.Provider value={value}>
      <DiscoverFlowLocationSync
        recentPages={recentPages}
        discoverFlowActive={discoverFlowActive}
        setDiscoverFlowActive={setDiscoverFlowActive}
        addRecentPage={addRecentPage}
      />
      {children}
    </DiscoverRecentContext.Provider>
  );
}

DiscoverRecentProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export function useDiscoverRecent() {
  const context = useContext(DiscoverRecentContext);
  if (!context) {
    throw new Error("useDiscoverRecent must be used within DiscoverRecentProvider");
  }
  return context;
}
