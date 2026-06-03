import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import { Link, useLocation } from "react-router-dom";
import {
  Menu,
  Heart,
  Sparkles,
  Library,
  History,
  Ellipsis,
  Ticket,
  AudioWaveform,
  Ban,
  Settings,
  LogOut,
} from "lucide-react";
import Sidebar from "./Sidebar";
import GlobalSearch from "./GlobalSearch";
import { useAuth } from "../contexts/AuthContext";

const VALID_SIDEBAR_MODES = ["full", "icons", "hidden"];

function GitHubIcon({ className = "" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M12 .5C5.649.5.5 5.649.5 12c0 5.084 3.292 9.398 7.861 10.919.575.106.786-.25.786-.556 0-.274-.01-1-.016-1.962-3.197.695-3.872-1.541-3.872-1.541-.523-1.328-1.277-1.682-1.277-1.682-1.044-.714.079-.699.079-.699 1.154.081 1.761 1.185 1.761 1.185 1.026 1.758 2.692 1.25 3.348.956.104-.743.402-1.251.731-1.539-2.552-.291-5.236-1.276-5.236-5.681 0-1.255.449-2.282 1.184-3.086-.119-.291-.513-1.462.112-3.048 0 0 .966-.309 3.165 1.179A10.98 10.98 0 0 1 12 6.033c.973.004 1.954.132 2.87.388 2.197-1.488 3.162-1.179 3.162-1.179.627 1.586.233 2.757.114 3.048.737.804 1.182 1.831 1.182 3.086 0 4.416-2.688 5.387-5.249 5.673.413.355.781 1.055.781 2.126 0 1.535-.014 2.772-.014 3.149 0 .309.207.668.792.555C20.211 21.394 23.5 17.082 23.5 12 23.5 5.649 18.351.5 12 .5Z" />
    </svg>
  );
}

GitHubIcon.propTypes = {
  className: PropTypes.string,
};

function Layout({ children, appVersion }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [scrollbar, setScrollbar] = useState({
    visible: false,
    active: false,
    top: 0,
    height: 0,
  });
  const mainScrollRef = useRef(null);
  const scrollbarFadeTimeoutRef = useRef(null);
  const [sidebarMode, setSidebarMode] = useState(() => {
    try {
      const stored = localStorage.getItem("sidebarMode");
      return VALID_SIDEBAR_MODES.includes(stored) ? stored : "full";
    } catch {
      return "full";
    }
  });
  const prevVisibleMode = useRef(
    sidebarMode !== "hidden"
      ? sidebarMode
      : (() => { try { const s = localStorage.getItem("sidebarVisibleMode"); return s === "full" || s === "icons" ? s : "full"; } catch { return "full"; } })()
  );
  const location = useLocation();
  const { authRequired, logout, user } = useAuth();
  const isArtistDetailsRoute = /^\/artist\/[^/]+$/.test(location.pathname);

  const updateMainScrollbar = useCallback(() => {
    const node = mainScrollRef.current;
    if (!node) return;
    const { scrollTop, scrollHeight, clientHeight } = node;
    const scrollable = scrollHeight > clientHeight + 1;
    if (!scrollable) {
      setScrollbar((current) =>
        current.visible
          ? { visible: false, active: false, top: 0, height: 0 }
          : current,
      );
      return;
    }
    const minThumbHeight = 48;
    const thumbHeight = Math.max(
      minThumbHeight,
      (clientHeight / scrollHeight) * clientHeight,
    );
    const maxTop = Math.max(clientHeight - thumbHeight, 0);
    const top =
      scrollHeight === clientHeight
        ? 0
        : (scrollTop / (scrollHeight - clientHeight)) * maxTop;
    setScrollbar((current) => ({
      visible: true,
      active: current.active,
      top,
      height: thumbHeight,
    }));
  }, []);

  const showScrollbarTemporarily = useCallback(() => {
    setScrollbar((current) =>
      current.visible ? { ...current, active: true } : current,
    );
    if (scrollbarFadeTimeoutRef.current) {
      clearTimeout(scrollbarFadeTimeoutRef.current);
    }
    scrollbarFadeTimeoutRef.current = window.setTimeout(() => {
      setScrollbar((current) => ({ ...current, active: false }));
    }, 900);
  }, []);

  const isActive = useCallback(
    (path) => {
      if (path === "/discover" && location.pathname === "/") return true;
      return location.pathname === path;
    },
    [location.pathname],
  );

  const mobilePrimaryItems = useMemo(
    () => [
      { path: "/discover", label: "Discover", icon: Sparkles },
      { path: "/library", label: "Library", icon: Library },
      { path: "/requests", label: "Requests", icon: History },
    ],
    [],
  );

  const mobileOverflowItems = useMemo(() => {
    const items = [
      { path: "/shows", label: "Shows", icon: Ticket },
      {
        path: "/flow",
        label: "Flow",
        icon: AudioWaveform,
        permission: "accessFlow",
      },
      { path: "/blocklist", label: "Blocklist", icon: Ban },
      { path: "/settings", label: "Settings", icon: Settings },
    ];
    return items.filter(
      (item) =>
        !item.permission ||
        user?.role === "admin" ||
        !!user?.permissions?.[item.permission],
    );
  }, [user]);

  const handleSetSidebarMode = useCallback((newMode) => {
    if (newMode !== "hidden") {
      prevVisibleMode.current = newMode;
    }
    setSidebarMode(newMode);
    try {
      localStorage.setItem("sidebarMode", newMode);
      if (newMode !== "hidden") {
        localStorage.setItem("sidebarVisibleMode", newMode);
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  useEffect(() => {
    setIsSidebarOpen(false);
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    mainScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    window.requestAnimationFrame(updateMainScrollbar);
  }, [location.pathname, location.search, updateMainScrollbar]);

  useEffect(() => {
    const update = () => updateMainScrollbar();
    update();
    window.addEventListener("resize", update);
    const node = mainScrollRef.current;
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(update)
        : null;
    if (node && observer) {
      observer.observe(node);
      if (node.firstElementChild) {
        observer.observe(node.firstElementChild);
      }
    }
    return () => {
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [children, updateMainScrollbar]);

  useEffect(
    () => () => {
      if (scrollbarFadeTimeoutRef.current) {
        clearTimeout(scrollbarFadeTimeoutRef.current);
      }
    },
    [],
  );

  return (
    <div className="app-shell">
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        appVersion={appVersion}
        mode={sidebarMode}
        onSetMode={handleSetSidebarMode}
      />

      <div
        className={`app-content ${
          sidebarMode === "full"
            ? "app-content--sidebar-full"
            : sidebarMode === "icons"
              ? "app-content--sidebar-icons"
              : ""
        }`}
      >
        <header className="app-topbar">
          <button
            onClick={() => {
              const isDesktop = window.matchMedia("(min-width: 768px)").matches;
              if (isDesktop) {
                handleSetSidebarMode(sidebarMode === "hidden" ? prevVisibleMode.current : "hidden");
              } else {
                setIsMobileMenuOpen((open) => !open);
              }
            }}
            className="app-nav-toggle"
            aria-label="Toggle navigation"
          >
            <Menu className="w-5 h-5" />
          </button>

          <GlobalSearch />

          <div className="app-header-actions">
            <a
              href="https://github.com/lklynet/aurral"
              target="_blank"
              rel="noopener noreferrer"
              className="app-header-link"
              aria-label="GitHub Repository"
            >
              <GitHubIcon className="w-5 h-5" />
            </a>
            <a
              href="https://github.com/sponsors/lklynet/"
              target="_blank"
              rel="noopener noreferrer"
              className="app-header-link"
              aria-label="GitHub Sponsors"
            >
              <Heart className="w-5 h-5" />
            </a>
          </div>
        </header>

        <div className="app-main-wrap">
          <main
            className={`app-main${isArtistDetailsRoute ? " app-main--artist-details" : ""}`}
            ref={mainScrollRef}
            onScroll={() => {
              updateMainScrollbar();
              showScrollbarTemporarily();
            }}
          >
            <div className="app-main__content">{children}</div>
          </main>
          <div
            className={`app-main-scrollbar${scrollbar.visible ? " is-visible" : ""}${
              scrollbar.active ? " is-active" : ""
            }`}
            aria-hidden="true"
          >
            <div
              className="app-main-scrollbar__thumb"
              style={{
                height: `${scrollbar.height}px`,
                transform: `translateY(${scrollbar.top}px)`,
              }}
            />
          </div>
        </div>

        {isMobileMenuOpen && (
          <>
            <button
              type="button"
              className="app-mobile-backdrop md:hidden"
              onClick={() => setIsMobileMenuOpen(false)}
              aria-label="Close navigation menu"
            />
            <div className="app-mobile-menu md:hidden">
              <nav className="app-mobile-menu__nav">
                {mobileOverflowItems.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.path);
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`app-mobile-menu__item${active ? " is-active" : ""}`}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
                {authRequired && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      logout();
                    }}
                    className="app-mobile-menu__item"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Log out</span>
                  </button>
                )}
              </nav>
            </div>
          </>
        )}

        <nav
          className="app-mobile-nav md:hidden"
          aria-label="Mobile navigation"
        >
          <div className="app-mobile-nav__grid">
            {mobilePrimaryItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`app-mobile-nav__item${active ? " is-active" : ""}`}
                >
                  <Icon className="h-6 w-6" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen((open) => !open)}
              className={`app-mobile-nav__item${
                isMobileMenuOpen ||
                mobileOverflowItems.some((item) => isActive(item.path))
                  ? " is-active"
                  : ""
              }`}
              aria-label="More navigation options"
              aria-expanded={isMobileMenuOpen}
            >
              <Ellipsis className="h-6 w-6" />
              <span>More</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}

Layout.propTypes = {
  children: PropTypes.node.isRequired,
  appVersion: PropTypes.string,
};

export default Layout;
