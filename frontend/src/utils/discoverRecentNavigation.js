const DISCOVER_HOME_PATHS = new Set(["/", "/discover"]);

export const DISCOVER_RECENT_PAGES_KEY = "aurral.discover.recentPages";
export const DISCOVER_FLOW_ACTIVE_KEY = "aurral.discover.flowActive";
export const DISCOVERY_MANUAL_REFRESH_KEY =
  "aurral.discovery.manualRefreshPending";
export const DISCOVER_RECENT_PAGES_LIMIT = 5;

export function isDiscoverHomePath(pathname) {
  return DISCOVER_HOME_PATHS.has(pathname);
}

export function isDiscoverBrowsePath(pathname) {
  if (!pathname) return false;
  if (pathname.startsWith("/artist/")) return true;
  if (pathname === "/search") return true;
  return false;
}

export function getDiscoverArtistPath(path) {
  if (!path || typeof path !== "string") return "";
  const pathname = path.split("?")[0];
  const match = pathname.match(/^\/artist\/([^/]+)/);
  return match ? `/artist/${match[1]}` : "";
}

export function isDiscoverRecentArtistPath(path) {
  if (!path || typeof path !== "string") return false;
  return path.split("?")[0] === getDiscoverArtistPath(path);
}

export function isDiscoverExitPath(pathname) {
  if (!pathname) return false;
  if (pathname.startsWith("/library")) return true;
  if (pathname.startsWith("/shows")) return true;
  if (pathname.startsWith("/playlists")) return true;
  if (pathname.startsWith("/activity")) return true;
  if (pathname.startsWith("/history")) return true;
  if (pathname.startsWith("/settings")) return true;
  if (pathname === "/profile") return true;
  return false;
}

export function getDiscoverPathFromLocation(location) {
  if (!location) return "";
  return `${location.pathname || ""}${location.search || ""}`;
}

export function shouldRecordDiscoverNavigation(location, recentPages, flowActive) {
  const pathname = location?.pathname || "";
  const path = getDiscoverPathFromLocation(location);
  if (isDiscoverHomePath(pathname)) return true;
  if (flowActive && isDiscoverBrowsePath(pathname)) return true;
  return recentPages.some((entry) => entry.path === path);
}

export function shouldKeepDiscoverSectionActive(
  location,
  recentPages,
  flowActive,
) {
  const pathname = location?.pathname || "";
  const path = getDiscoverPathFromLocation(location);
  if (isDiscoverHomePath(pathname)) return true;
  if (isDiscoverExitPath(pathname)) return false;
  if (recentPages.some((entry) => entry.path === path)) return true;
  return flowActive && isDiscoverBrowsePath(pathname);
}

export function readDiscoverFlowActive() {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(DISCOVER_FLOW_ACTIVE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDiscoverFlowActive(active) {
  if (typeof window === "undefined") return;
  try {
    if (active) {
      sessionStorage.setItem(DISCOVER_FLOW_ACTIVE_KEY, "1");
    } else {
      sessionStorage.removeItem(DISCOVER_FLOW_ACTIVE_KEY);
    }
  } catch {}
}

export function shouldTrackDiscoverPath(path) {
  if (!path || typeof path !== "string") return false;
  return Boolean(getDiscoverArtistPath(path));
}

export function normalizeDiscoverPath(path) {
  if (!path || typeof path !== "string") return "";
  const [pathname, search = ""] = path.split("?");
  const artistPath = getDiscoverArtistPath(pathname);
  if (artistPath) return artistPath;
  let normalizedPathname = pathname;
  if (normalizedPathname === "/shows") normalizedPathname = "/shows/all";
  if (normalizedPathname === "/history") {
    normalizedPathname = "/activity/history/all";
  }
  if (normalizedPathname === "/activity") {
    normalizedPathname = "/activity/queue/all";
  }
  if (!search) return normalizedPathname;
  const params = new URLSearchParams(search);
  const normalizedSearch = params.toString();
  return normalizedSearch
    ? `${normalizedPathname}?${normalizedSearch}`
    : normalizedPathname;
}

const MBID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function pickDiscoverRecentPageState(state) {
  if (!state || typeof state !== "object") return {};
  const next = {};
  if (state.artistName) next.artistName = String(state.artistName);
  if (typeof state.inLibrary === "boolean") next.inLibrary = state.inLibrary;
  if (state.libraryArtist) next.libraryArtist = state.libraryArtist;
  return next;
}

export function getDiscoverRecentPageLinkState(entry) {
  const storedState = pickDiscoverRecentPageState(entry?.state);
  if (storedState.artistName) return storedState;
  const label = String(entry?.label || "").trim();
  if (!label || label === "Artist" || MBID_REGEX.test(label)) {
    return storedState;
  }
  return { ...storedState, artistName: label };
}

export function buildDiscoverRecentLabel(path, state = {}) {
  const pathname = path.split("?")[0];
  const params = new URLSearchParams(path.includes("?") ? path.split("?")[1] : "");

  if (pathname.startsWith("/artist/")) {
    const isReleaseRoute = /\/release\/[^/]+$/.test(pathname);
    if (isReleaseRoute) {
      const releaseTitle =
        state?.focusReleaseGroup?.title || state?.focusTrackTitle || "";
      if (releaseTitle) {
        return state?.artistName
          ? `${releaseTitle} · ${state.artistName}`
          : releaseTitle;
      }
    }
    if (/\/albums$/.test(pathname)) {
      return state?.artistName ? `${state.artistName} albums` : "Albums";
    }
    if (/\/appears-on$/.test(pathname)) {
      return state?.artistName ? `${state.artistName} appears on` : "Appears on";
    }
    if (state?.artistName) return state.artistName;
    const segment = pathname.split("/")[2];
    if (segment) {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    }
    return "Artist";
  }

  if (pathname === "/search") {
    const type = params.get("type");
    if (type === "recommended") return "Recommended";
    if (type === "trending") return "Trending";
    if (type === "tag") {
      const query = params.get("q") || "";
      const tag = query.startsWith("#") ? query.slice(1) : query;
      return tag ? `#${tag}` : "Tag search";
    }
    const query = params.get("q");
    if (query) {
      try {
        return decodeURIComponent(query);
      } catch {
        return query;
      }
    }
    return "Search";
  }

  if (pathname.startsWith("/shows")) return "Shows";
  if (pathname.startsWith("/playlists")) return "Playlist";
  if (pathname === "/library") return "Library";

  const segment = pathname.split("/").filter(Boolean).pop();
  if (!segment) return "Page";
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function filterDiscoverRecentPages(pages) {
  if (!Array.isArray(pages)) return [];
  return pages.filter((entry) => isDiscoverRecentArtistPath(entry?.path));
}

export function readDiscoverRecentPages() {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(DISCOVER_RECENT_PAGES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return filterDiscoverRecentPages(parsed)
      .filter((entry) => entry?.label)
      .slice(0, DISCOVER_RECENT_PAGES_LIMIT)
      .map((entry) => ({
        id: entry.id || entry.path,
        path: normalizeDiscoverPath(entry.path),
        label: String(entry.label),
        state: pickDiscoverRecentPageState(entry.state),
      }));
  } catch {
    return [];
  }
}

export function writeDiscoverRecentPages(pages) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      DISCOVER_RECENT_PAGES_KEY,
      JSON.stringify(pages.slice(0, DISCOVER_RECENT_PAGES_LIMIT)),
    );
  } catch {}
}
