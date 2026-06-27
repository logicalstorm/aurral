import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";import { useLocation } from "react-router-dom";
import { DiscoverRecentContext } from "./discoverRecentContext";
import {
  buildDiscoverRecentLabel,
  DISCOVER_FLOW_ACTIVE_KEY,
  DISCOVER_RECENT_PAGES_KEY,
  DISCOVER_RECENT_PAGES_LIMIT,
  filterDiscoverRecentPages,
  getDiscoverPathFromLocation,
  isDiscoverBrowsePath,
  isDiscoverExitPath,
  isDiscoverHomePath,
  normalizeDiscoverPath,
  pickDiscoverRecentPageState,
  readDiscoverFlowActive,
  readDiscoverRecentPages,
  shouldRecordDiscoverNavigation,
  shouldKeepDiscoverSectionActive,
  shouldTrackDiscoverPath,
  writeDiscoverFlowActive,
  writeDiscoverRecentPages,
} from "../utils/discoverRecentNavigation";

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
    const normalizedPath = normalizeDiscoverPath(path);

    if (isDiscoverExitPath(pathname)) {
      setDiscoverFlowActive(false);
      return;
    }

    if (isDiscoverHomePath(pathname)) {
      return;
    }

    if (recentPages.some((entry) => entry.path === normalizedPath)) {
      setDiscoverFlowActive(true);
      return;
    }

    if (isDiscoverBrowsePath(pathname) && shouldTrackDiscoverPath(path)) {
      addRecentPage(normalizedPath, location.state || {});
    }
  }, [addRecentPage, discoverFlowActive, location, recentPages, setDiscoverFlowActive]);

  return null;
}

export function DiscoverRecentProvider({ children }) {
  const location = useLocation();
  const [recentPages, setRecentPages] = useState(() => readDiscoverRecentPages());
  const [discoverFlowActive, setDiscoverFlowActiveState] = useState(() => readDiscoverFlowActive());

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

  const addRecentPage = useCallback(
    (path, state = {}) => {
      const normalizedPath = normalizeDiscoverPath(path);
      if (!normalizedPath || !shouldTrackDiscoverPath(normalizedPath)) return;

      const label = buildDiscoverRecentLabel(normalizedPath, state);
      const pageState = pickDiscoverRecentPageState(state);
      setRecentPages((current) => {
        if (
          current[0]?.path === normalizedPath &&
          current[0]?.label === label &&
          JSON.stringify(current[0]?.state || {}) === JSON.stringify(pageState) &&
          current.length <= DISCOVER_RECENT_PAGES_LIMIT
        ) {
          return current;
        }
        const next = [
          {
            id: normalizedPath,
            path: normalizedPath,
            label,
            state: pageState,
          },
          ...current.filter((entry) => entry.path !== normalizedPath),
        ].slice(0, DISCOVER_RECENT_PAGES_LIMIT);
        writeDiscoverRecentPages(next);
        return next;
      });
      setDiscoverFlowActive(true);
    },
    [setDiscoverFlowActive],
  );

  const clearRecentPages = useCallback(() => {
    writeDiscoverRecentPages([]);
    setRecentPages([]);
    setDiscoverFlowActive(false);
  }, [setDiscoverFlowActive]);

  const visibleRecentPages = useMemo(() => filterDiscoverRecentPages(recentPages), [recentPages]);

  const shouldRecordNavigation = useCallback(
    (fromLocation = location) =>
      shouldRecordDiscoverNavigation(fromLocation, visibleRecentPages, discoverFlowActive),
    [discoverFlowActive, location, visibleRecentPages],
  );

  const isDiscoverDiscoverSubnavPage = useMemo(() => {
    const sp = new URLSearchParams(location.search);
    const type = sp.get("type");
    return location.pathname === "/search" && (type === "recommended" || type === "trending");
  }, [location.pathname, location.search]);

  const isDiscoverSectionActive = useMemo(
    () =>
      isDiscoverDiscoverSubnavPage ||
      isDiscoverBrowsePath(location.pathname) ||
      shouldKeepDiscoverSectionActive(location, visibleRecentPages, discoverFlowActive),
    [discoverFlowActive, isDiscoverDiscoverSubnavPage, location, visibleRecentPages],
  );

  const value = useMemo(
    () => ({
      recentPages: visibleRecentPages,
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
      visibleRecentPages,
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
