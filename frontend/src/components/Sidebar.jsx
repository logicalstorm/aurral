import { Link, useLocation } from "react-router-dom";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import {
  Library,
  Settings,
  Sparkles,
  History,
  AudioWaveform,
  Pin,
  PinOff,
  Ticket,
  Ban,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import LogoutButton from "./LogoutButton";
import { getBootstrapStatus } from "../utils/api";

function Sidebar({ isOpen, onClose, appVersion, mode, onSetMode }) {
  const location = useLocation();
  const { authRequired, logout, user } = useAuth();
  const resolvedVersion =
    appVersion || import.meta.env.VITE_APP_VERSION || "unknown";
  const navRef = useRef(null);
  const activeBubbleRef = useRef(null);
  const hoverBubbleRef = useRef(null);
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const linkRefs = useRef({});
  const asideRef = useRef(null);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(min-width: 768px)").matches
      : true,
  );
  const [ticketmasterConfigured, setTicketmasterConfigured] = useState(true);

  const prevModeRef = useRef(mode);
  useEffect(() => {
    if (mode !== "hidden") {
      prevModeRef.current = mode;
    }
  }, [mode]);
  const isIcons =
    (mode === "icons" ||
      (mode === "hidden" && prevModeRef.current === "icons")) &&
    isDesktop;

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mediaQuery = window.matchMedia("(min-width: 768px)");
    const onChange = (event) => setIsDesktop(event.matches);
    setIsDesktop(mediaQuery.matches);
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", onChange);
      return () => mediaQuery.removeEventListener("change", onChange);
    }
    mediaQuery.addListener(onChange);
    return () => mediaQuery.removeListener(onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadBootstrapStatus = async () => {
      try {
        const bootstrap = await getBootstrapStatus();
        if (!cancelled) {
          setTicketmasterConfigured(!!bootstrap.ticketmasterConfigured);
        }
      } catch {
        if (!cancelled) {
          setTicketmasterConfigured(true);
        }
      }
    };
    loadBootstrapStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  const isActive = useCallback(
    (path) => {
      if (path === "/discover" && location.pathname === "/") return true;
      return location.pathname === path;
    },
    [location.pathname],
  );

  const navItems = useMemo(() => {
    const items = [
      { path: "/discover", label: "Discover", icon: Sparkles },
      { path: "/library", label: "Library", icon: Library },
      ...(ticketmasterConfigured
        ? [{ path: "/shows", label: "Shows", icon: Ticket }]
        : []),
      {
        path: "/flow",
        label: "Flow",
        icon: AudioWaveform,
        permission: "accessFlow",
      },
      { path: "/blocklist", label: "Blocklist", icon: Ban },
      { path: "/requests", label: "Requests", icon: History },
      {
        path: "/settings",
        label: "Settings",
        icon: Settings,
      },
    ];
    return items.filter(
      (item) =>
        !item.permission ||
        user?.role === "admin" ||
        !!user?.permissions?.[item.permission],
    );
  }, [ticketmasterConfigured, user]);

  useEffect(() => {
    const updateBubblePosition = () => {
      if (!navRef.current || !activeBubbleRef.current) return;

      const activeIndex = navItems.findIndex((item) => isActive(item.path));
      if (activeIndex === -1) {
        activeBubbleRef.current.style.opacity = "0";
        return;
      }

      const activeLink = linkRefs.current[activeIndex];
      if (!activeLink) {
        setTimeout(updateBubblePosition, 50);
        return;
      }

      const navRect = navRef.current.getBoundingClientRect();
      const linkRect = activeLink.getBoundingClientRect();

      activeBubbleRef.current.style.left = `${linkRect.left - navRect.left}px`;
      activeBubbleRef.current.style.top = `${linkRect.top - navRect.top}px`;
      activeBubbleRef.current.style.width = `${linkRect.width}px`;
      activeBubbleRef.current.style.height = `${linkRect.height}px`;
      activeBubbleRef.current.style.opacity = "1";
    };

    const timeoutId = setTimeout(updateBubblePosition, 10);
    window.addEventListener("resize", updateBubblePosition);

    const aside = asideRef.current;
    const onTransitionEnd = (e) => {
      if (e.propertyName === "width") updateBubblePosition();
    };
    aside?.addEventListener("transitionend", onTransitionEnd);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("resize", updateBubblePosition);
      aside?.removeEventListener("transitionend", onTransitionEnd);
    };
  }, [location.pathname, navItems, isOpen, isActive, mode]);

  useEffect(() => {
    const updateHoverBubble = () => {
      if (!navRef.current || !hoverBubbleRef.current) return;

      if (hoveredIndex === null) {
        hoverBubbleRef.current.style.left = "0px";
        hoverBubbleRef.current.style.top = "0px";
        hoverBubbleRef.current.style.width = "100%";
        hoverBubbleRef.current.style.height = "100%";
        hoverBubbleRef.current.style.opacity = "0.6";
        return;
      }

      const hoveredLink = linkRefs.current[hoveredIndex];
      if (!hoveredLink) return;

      const navRect = navRef.current.getBoundingClientRect();
      const linkRect = hoveredLink.getBoundingClientRect();

      hoverBubbleRef.current.style.left = `${linkRect.left - navRect.left}px`;
      hoverBubbleRef.current.style.top = `${linkRect.top - navRect.top}px`;
      hoverBubbleRef.current.style.width = `${linkRect.width}px`;
      hoverBubbleRef.current.style.height = `${linkRect.height}px`;
      hoverBubbleRef.current.style.opacity = "1";
    };

    updateHoverBubble();
  }, [hoveredIndex]);

  const translateClass = isOpen
    ? "translate-x-0"
    : mode === "hidden"
      ? "-translate-x-full"
      : "-translate-x-full md:translate-x-0";

  return (
    <>
      {isOpen && (
        <div className="app-mobile-backdrop md:hidden" onClick={onClose} />
      )}

      <aside
        ref={asideRef}
        className={`sidebar-shell ${translateClass}`}
        style={{
          width: isIcons ? "56px" : "208px",
        }}
      >
        <div className="sidebar-logo-row">
          <Link to="/" className="sidebar-logo-link">
            <img
              src="/arralogo.svg"
              alt="Aurral Logo"
              className="sidebar-logo"
            />
            {!isIcons && <span className="sidebar-title">Aurral</span>}
          </Link>
          {!isIcons && (
            <button
              onClick={() => onSetMode("icons")}
              className="sidebar-pin-button"
              aria-label="Collapse to icons"
              title="Collapse to icons"
            >
              <Pin className="artist-icon-xs" />
            </button>
          )}
        </div>
        {isIcons && (
          <div className="sidebar-pin-row">
            <button
              onClick={() => onSetMode("full")}
              className="sidebar-pin-button"
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              <PinOff className="artist-icon-xs" />
            </button>
          </div>
        )}

        <div className={`sidebar-body${isIcons ? " sidebar-body--icons" : ""}`}>
          <div
            ref={navRef}
            className={`sidebar-nav-wrap${isIcons ? " sidebar-nav-wrap--icons" : ""}`}
          >
            <div
              ref={activeBubbleRef}
              className="sidebar-bubble sidebar-bubble--active"
            />

            <div
              ref={hoverBubbleRef}
              className="sidebar-bubble sidebar-bubble--hover"
            />

            <nav
              className="sidebar-nav"
              onMouseLeave={() => setHoveredIndex(null)}
            >
              {navItems.map((item, index) => {
                const Icon = item.icon;
                const active = isActive(item.path);

                return (
                  <Link
                    key={item.path}
                    ref={(el) => {
                      if (el) linkRefs.current[index] = el;
                    }}
                    to={item.path}
                    onMouseEnter={() => setHoveredIndex(index)}
                    className={`sidebar-link ${
                      isIcons ? "sidebar-link--icons" : "sidebar-link--full"
                    }${active ? " is-active" : ""}`}
                  >
                    <Icon className="sidebar-link__icon" />
                    {!isIcons && (
                      <span className="sidebar-link__label">{item.label}</span>
                    )}
                    {isIcons && (
                      <span className="sidebar-tooltip">{item.label}</span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>

        <div
          className={`sidebar-footer${isIcons ? " sidebar-footer--icons" : ""}`}
        >
          {authRequired && (
            <LogoutButton onClick={logout} collapsed={isIcons} />
          )}

          {!isIcons && (
            <div className="sidebar-version">v{resolvedVersion}</div>
          )}
        </div>
      </aside>
    </>
  );
}

Sidebar.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  appVersion: PropTypes.string,
  mode: PropTypes.oneOf(["full", "icons", "hidden"]).isRequired,
  onSetMode: PropTypes.func.isRequired,
};

export default Sidebar;
