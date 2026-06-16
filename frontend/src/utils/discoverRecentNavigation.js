const DISCOVER_HOME_PATHS = new Set(["/", "/discover"]);

export const DISCOVER_RECENT_PAGES_KEY = "aurral.discover.recentPages";
export const DISCOVER_FLOW_ACTIVE_KEY = "aurral.discover.flowActive";
export const DISCOVER_RECENT_PAGES_LIMIT = 5;

export function isDiscoverHomePath(pathname) {
  return DISCOVER_HOME_PATHS.has(pathname);
}

export function isDiscoverBrowsePath(pathname) {
  if (!pathname) return false;
  if (pathname.startsWith("/artist/")) return true;
  if (pathname === "/search") return true;
  if (pathname.startsWith("/shows/")) return true;
  return false;
}

export function isDiscoverExitPath(pathname) {
  if (!pathname) return false;
  if (pathname.startsWith("/library")) return true;
  if (pathname.startsWith("/playlists")) return true;
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
  const pathname = path.split("?")[0];
  if (DISCOVER_HOME_PATHS.has(pathname)) return false;
  if (pathname.startsWith("/settings")) return false;
  return true;
}

export function normalizeDiscoverPath(path) {
  if (!path || typeof path !== "string") return "";
  const [pathname, search = ""] = path.split("?");
  let normalizedPathname = pathname;
  if (normalizedPathname === "/shows") normalizedPathname = "/shows/all";
  if (normalizedPathname === "/history") normalizedPathname = "/history/all";
  if (!search) return normalizedPathname;
  const params = new URLSearchParams(search);
  const normalizedSearch = params.toString();
  return normalizedSearch
    ? `${normalizedPathname}?${normalizedSearch}`
    : normalizedPathname;
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

export function readDiscoverRecentPages() {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(DISCOVER_RECENT_PAGES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry?.path && entry?.label)
      .slice(0, DISCOVER_RECENT_PAGES_LIMIT)
      .map((entry) => ({
        id: entry.id || entry.path,
        path: normalizeDiscoverPath(entry.path),
        label: String(entry.label),
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
