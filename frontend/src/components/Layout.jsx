import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import { Link, useLocation } from "react-router-dom";
import {
  Menu,
  Sparkles,
  Library,
  Activity,
  Ellipsis,
  Ticket,
  AudioWaveform,
  Settings,
  LogOut,
  User,
} from "lucide-react";
import Sidebar from "./Sidebar";
import GlobalSearch from "./GlobalSearch";
import GlobalPlayerBar from "./GlobalPlayerBar";
import UserProfileMenu from "./UserProfileMenu";
import { useAuth } from "../contexts/AuthContext";
import { useAudioQueue } from "../hooks/useAudioQueue";
import { DEFAULT_SETTINGS_TAB } from "../pages/Settings/settingsTabsConfig";

const SIDEBAR_THRESHOLD = 100;
const SIDEBAR_MIN = 56;
const SIDEBAR_MAX = 400;

function Layout({ children }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [scrollbar, setScrollbar] = useState({
    visible: false,
    active: false,
    top: 0,
    height: 0,
  });
  const mainScrollRef = useRef(null);
  const scrollbarFadeTimeoutRef = useRef(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const w = parseInt(localStorage.getItem("sidebarWidth"), 10);
      return w >= SIDEBAR_MIN && w <= SIDEBAR_MAX ? w : 208;
    } catch {
      return 208;
    }
  });
  const [lastFullWidth, setLastFullWidth] = useState(() => {
    try {
      const w = parseInt(localStorage.getItem("sidebarFullWidth"), 10);
      return w >= SIDEBAR_THRESHOLD && w <= SIDEBAR_MAX ? w : 208;
    } catch {
      return 208;
    }
  });
  const [isResizing, setIsResizing] = useState(false);
  const location = useLocation();
  const { authRequired, logout, user } = useAuth();
  const { isActive: isPlayerActive } = useAudioQueue();
  const isArtistDetailsRoute = /^\/artist\/[^/]+(\/(albums|appears-on|release\/[^/]+))?$/.test(
    location.pathname,
  );
  const isSettingsRoute = location.pathname.startsWith("/settings");

  const sidebarMode = sidebarWidth < SIDEBAR_THRESHOLD ? "icons" : "full";

  const updateMainScrollbar = useCallback(() => {
    const node = mainScrollRef.current;
    if (!node) return;
    const { scrollTop, scrollHeight, clientHeight } = node;
    const scrollable = scrollHeight > clientHeight + 1;
    if (!scrollable) {
      setScrollbar((current) =>
        current.visible ? { visible: false, active: false, top: 0, height: 0 } : current,
      );
      return;
    }
    const minThumbHeight = 48;
    const thumbHeight = Math.max(minThumbHeight, (clientHeight / scrollHeight) * clientHeight);
    const maxTop = Math.max(clientHeight - thumbHeight, 0);
    const top =
      scrollHeight === clientHeight ? 0 : (scrollTop / (scrollHeight - clientHeight)) * maxTop;
    setScrollbar((current) => ({
      visible: true,
      active: current.active,
      top,
      height: thumbHeight,
    }));
  }, []);

  const showScrollbarTemporarily = useCallback(() => {
    setScrollbar((current) => (current.visible ? { ...current, active: true } : current));
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
      if (path.startsWith("/settings")) {
        return location.pathname.startsWith("/settings");
      }
      if (path.startsWith("/shows")) {
        return location.pathname.startsWith("/shows");
      }
      if (path.startsWith("/activity")) {
        return location.pathname.startsWith("/activity");
      }
      if (path.startsWith("/history")) {
        return location.pathname.startsWith("/activity");
      }
      return location.pathname === path;
    },
    [location.pathname],
  );

  const mobilePrimaryItems = useMemo(() => {
    const items = [
      { path: "/discover", label: "Discover", icon: Sparkles },
      { path: "/library", label: "Library", icon: Library },
      {
        path: "/playlists",
        label: "Playlists",
        icon: AudioWaveform,
        permission: "accessFlow",
      },
    ];
    return items.filter(
      (item) =>
        !item.permission || user?.role === "admin" || !!user?.permissions?.[item.permission],
    );
  }, [user]);

  const mobileOverflowItems = useMemo(() => {
    const items = [
      { path: "/shows/all", label: "Shows", icon: Ticket },
      { path: "/activity/queue", label: "Activity", icon: Activity },
      { path: "/profile", label: "Profile", icon: User },
      {
        path: `/settings/${DEFAULT_SETTINGS_TAB}`,
        label: "Settings",
        icon: Settings,
        permission: "accessSettings",
      },
    ];
    return items.filter(
      (item) =>
        !item.permission || user?.role === "admin" || !!user?.permissions?.[item.permission],
    );
  }, [user]);

  const handleResizeStart = useCallback((event) => {
    event.preventDefault();
    setIsResizing(true);
    const sidebar = document.querySelector(".sidebar-shell");
    const leftOffset = sidebar ? sidebar.getBoundingClientRect().left : 4;

    const handleMouseMove = (e) => {
      const newWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, e.clientX - leftOffset));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      setSidebarWidth((current) => {
        if (current >= SIDEBAR_THRESHOLD) {
          try {
            localStorage.setItem("sidebarFullWidth", String(current));
          } catch {}
        }
        try {
          localStorage.setItem("sidebarWidth", String(current));
        } catch {}
        return current;
      });
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  const toggleSidebarPin = useCallback(() => {
    if (sidebarWidth < SIDEBAR_THRESHOLD) {
      const restoreTo = lastFullWidth;
      setSidebarWidth(restoreTo);
      try {
        localStorage.setItem("sidebarWidth", String(restoreTo));
      } catch {}
    } else {
      setLastFullWidth(sidebarWidth);
      try {
        localStorage.setItem("sidebarFullWidth", String(sidebarWidth));
      } catch {}
      setSidebarWidth(SIDEBAR_MIN);
      try {
        localStorage.setItem("sidebarWidth", String(SIDEBAR_MIN));
      } catch {}
    }
  }, [sidebarWidth, lastFullWidth]);

  useEffect(() => {
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
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
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
    <div
      className="app-shell"
      data-sidebar-mode={sidebarMode}
      data-resizing={isResizing || undefined}
      style={{ "--sidebar-width": `${sidebarWidth}px` }}
    >
      <Sidebar mode={sidebarMode} width={sidebarWidth} />

      <div
        className={`sidebar-resize-handle${isResizing ? " is-active" : ""}`}
        onMouseDown={handleResizeStart}
      />

      <div
        className={`app-content${
          sidebarMode === "full"
            ? " app-content--sidebar-full"
            : sidebarMode === "icons"
              ? " app-content--sidebar-icons"
              : ""
        }${isPlayerActive ? " app-content--player-active" : ""}`}
      >
        <header className="app-topbar">
          <button
            type="button"
            onClick={toggleSidebarPin}
            className="app-nav-toggle"
            aria-label={sidebarMode === "icons" ? "Expand sidebar" : "Collapse to icons"}
            title={sidebarMode === "icons" ? "Expand sidebar" : "Collapse to icons"}
          >
            <Menu aria-hidden="true" />
          </button>

          <GlobalSearch />

          <div className="app-header-actions">
            <UserProfileMenu />
          </div>
        </header>

        <div className="app-main-wrap">
          <main
            className={`app-main${
              isArtistDetailsRoute ? " app-main--artist-details" : ""
            }${isSettingsRoute ? " app-main--settings" : ""}${
              isPlayerActive ? " app-main--player-active" : ""
            }`}
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

        <GlobalPlayerBar />

        {isMobileMenuOpen && (
          <>
            <button
              type="button"
              className="app-mobile-backdrop app-mobile-only"
              onClick={() => setIsMobileMenuOpen(false)}
              aria-label="Close navigation menu"
            />
            <div className="app-mobile-menu app-mobile-only">
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
                      <Icon aria-hidden="true" />
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
                    <LogOut aria-hidden="true" />
                    <span>Log out</span>
                  </button>
                )}
              </nav>
            </div>
          </>
        )}

        <nav className="app-mobile-nav app-mobile-only" aria-label="Mobile navigation">
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
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen((open) => !open)}
              className={`app-mobile-nav__item${
                isMobileMenuOpen || mobileOverflowItems.some((item) => isActive(item.path))
                  ? " is-active"
                  : ""
              }`}
              aria-label="More navigation options"
              aria-expanded={isMobileMenuOpen}
            >
              <Ellipsis aria-hidden="true" />
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
};

export default Layout;
