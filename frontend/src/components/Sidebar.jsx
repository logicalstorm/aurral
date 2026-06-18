import { Link, useLocation } from "react-router-dom";
import { useState, useEffect, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import {
  Library,
  Sparkles,
  History,
  AudioWaveform,
  Ticket,
  Settings,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { getBootstrapStatus } from "../utils/api";
import { useFlowWorkerActivity } from "../pages/flows/useFlowWorkerActivity";
import {
  DEFAULT_SETTINGS_TAB,
  SETTINGS_NAV_TABS,
} from "../pages/Settings/settingsTabsConfig";
import {
  DEFAULT_SHOWS_FILTER,
  SHOWS_FILTERS,
} from "../navigation/showsNavConfig";
import {
  DEFAULT_HISTORY_TAB,
  getHistoryNavItems,
} from "../navigation/historyNavConfig";
import { useDiscoverRecent } from "../hooks/useDiscoverRecent";
import { getDiscoverArtistPath } from "../utils/discoverRecentNavigation";
import { useStorageHealth } from "../hooks/useStorageHealth";

function Sidebar({ mode }) {
  const location = useLocation();
  const { user } = useAuth();
  const hasFlowAccess =
    user?.role === "admin" || !!user?.permissions?.accessFlow;
  const canAccessSettings =
    user?.role === "admin" || !!user?.permissions?.accessSettings;
  const { hasActivity: hasRequestActivity } = useFlowWorkerActivity({
    enabled: hasFlowAccess,
  });
  const { hasFailure: hasStorageFailure } = useStorageHealth({
    enabled: canAccessSettings,
  });
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(min-width: 768px)").matches
      : true,
  );
  const [ticketmasterConfigured, setTicketmasterConfigured] = useState(true);
  const [usenetConfigured, setUsenetConfigured] = useState(false);
  const {
    recentPages: discoverRecentPages,
    clearRecentPages,
    isDiscoverSectionActive,
  } = useDiscoverRecent();

  const isIcons = mode === "icons" && isDesktop;
  const currentDiscoverPath = `${location.pathname}${location.search}`;
  const activeDiscoverRecentPath =
    getDiscoverArtistPath(currentDiscoverPath) || currentDiscoverPath;
  const isOnSettings = location.pathname.startsWith("/settings");
  const isOnShows = location.pathname.startsWith("/shows");
  const isOnHistory = location.pathname.startsWith("/history");

  const settingsTabs = useMemo(() => {
    if (!canAccessSettings) return [];
    return SETTINGS_NAV_TABS;
  }, [canAccessSettings]);

  const historyNavItems = useMemo(
    () => getHistoryNavItems(usenetConfigured),
    [usenetConfigured],
  );

  const activeSettingsTab = useMemo(() => {
    if (!isOnSettings) return null;
    const segment = location.pathname.replace(/^\/settings\/?/, "").split("/")[0];
    return segment || DEFAULT_SETTINGS_TAB;
  }, [isOnSettings, location.pathname]);

  const activeShowsFilter = useMemo(() => {
    if (!isOnShows) return null;
    const segment = location.pathname.replace(/^\/shows\/?/, "").split("/")[0];
    return segment || DEFAULT_SHOWS_FILTER;
  }, [isOnShows, location.pathname]);

  const activeHistoryTab = useMemo(() => {
    if (!isOnHistory) return null;
    const segment = location.pathname.replace(/^\/history\/?/, "").split("/")[0];
    return segment || DEFAULT_HISTORY_TAB;
  }, [isOnHistory, location.pathname]);

  const positionSidebarTooltip = useCallback((event) => {
    const link = event.currentTarget;
    const rect = link.getBoundingClientRect();
    link.style.setProperty(
      "--sidebar-tooltip-top",
      `${rect.top + rect.height / 2}px`,
    );
    link.style.setProperty("--sidebar-tooltip-left", `${rect.right + 8}px`);
  }, []);

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
          setUsenetConfigured(!!bootstrap.usenetConfigured);
        }
      } catch {
        if (!cancelled) {
          setTicketmasterConfigured(true);
          setUsenetConfigured(false);
        }
      }
    };
    loadBootstrapStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  const isNavItemActive = useCallback(
    (item) => {
      if (item.section === "discover") {
        return isDiscoverSectionActive;
      }
      if (item.section === "shows") return isOnShows;
      if (item.section === "history") return isOnHistory;
      if (item.path === "/discover" && location.pathname === "/") return true;
      return location.pathname === item.path;
    },
    [isDiscoverSectionActive, isOnHistory, isOnShows, location.pathname],
  );

  const navItems = useMemo(() => {
    const items = [
      {
        path: "/discover",
        label: "Discover",
        icon: Sparkles,
        section: "discover",
        subnav: discoverRecentPages,
      },
      { path: "/library", label: "Library", icon: Library },
      ...(ticketmasterConfigured
        ? [
            {
              path: `/shows/${DEFAULT_SHOWS_FILTER}`,
              basePath: "/shows",
              label: "Shows",
              icon: Ticket,
              section: "shows",
              subnav: SHOWS_FILTERS,
            },
          ]
        : []),
      {
        path: "/playlists",
        label: "Playlists",
        icon: AudioWaveform,
        permission: "accessFlow",
      },
      {
        path: `/history/${DEFAULT_HISTORY_TAB}`,
        basePath: "/history",
        label: "History",
        icon: History,
        section: "history",
        subnav: historyNavItems,
      },
    ];
    return items.filter(
      (item) =>
        !item.permission ||
        user?.role === "admin" ||
        !!user?.permissions?.[item.permission],
    );
  }, [discoverRecentPages, historyNavItems, ticketmasterConfigured, user]);

  const translateClass =
    mode === "hidden" ? "-translate-x-full" : "translate-x-0";

  const renderSubnav = (item, activeId) => {
    if (isIcons || !item.subnav?.length || !isNavItemActive(item)) {
      return null;
    }

    if (item.section === "discover") {
      return (
        <nav className="sidebar-subnav" aria-label={`${item.label} recent pages`}>
          {item.subnav.map((entry) => {
            const active = activeId === entry.id;
            return (
              <Link
                key={entry.id}
                to={entry.path}
                className={`sidebar-subnav-link sidebar-subnav-link--recent${
                  active ? " is-active" : ""
                }`}
                aria-current={active ? "page" : undefined}
                title={entry.label}
              >
                <span className="sidebar-subnav-link__text">{entry.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            className="sidebar-subnav-action"
            onClick={clearRecentPages}
          >
            Clear recent
          </button>
        </nav>
      );
    }

    return (
      <nav className="sidebar-subnav" aria-label={`${item.label} views`}>
        {item.subnav.map((entry) => {
          const active = activeId === entry.id;
          return (
            <Link
              key={entry.id}
              to={`${item.basePath}/${entry.id}`}
              className={`sidebar-subnav-link${active ? " is-active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {entry.label}
            </Link>
          );
        })}
      </nav>
    );
  };

  const getNavGroupClassName = (item, active) => {
    const classes = ["sidebar-nav-group"];
    if (active && item.subnav?.length && !isIcons) {
      classes.push("is-expanded");
    } else if (active) {
      classes.push("is-active-row");
    }
    return classes.join(" ");
  };

  return (
    <aside
      className={`sidebar-shell ${translateClass}`}
      style={{
        width: isIcons ? "56px" : "208px",
      }}
    >
      <div className="sidebar-logo-row">
        <Link to="/" className="sidebar-logo-link">
          <img src="/arralogo.svg" alt="Aurral Logo" className="sidebar-logo" />
          {!isIcons && <span className="sidebar-title">Aurral</span>}
        </Link>
      </div>

      <div className={`sidebar-body${isIcons ? " sidebar-body--icons" : ""}`}>
        <div
          className={`sidebar-nav-wrap${isIcons ? " sidebar-nav-wrap--icons" : ""}`}
        >
          <nav className="sidebar-nav">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isNavItemActive(item);
              const showActivityDot =
                item.section === "history" && hasRequestActivity;
              const activeSubnavId =
                item.section === "discover"
                  ? discoverRecentPages.find(
                      (entry) => entry.path === activeDiscoverRecentPath,
                    )?.id
                  : item.section === "shows"
                    ? activeShowsFilter
                    : item.section === "history"
                      ? activeHistoryTab
                      : null;

              return (
                <div
                  key={item.path}
                  className={getNavGroupClassName(item, active)}
                >
                  <Link
                    to={item.path}
                    onMouseEnter={(event) => {
                      if (isIcons) positionSidebarTooltip(event);
                    }}
                    className={`sidebar-link ${
                      isIcons ? "sidebar-link--icons" : "sidebar-link--full"
                    }${active ? " is-active" : ""}`}
                    aria-label={
                      isIcons
                        ? showActivityDot
                          ? `${item.label} (active)`
                          : item.label
                        : undefined
                    }
                  >
                    <span className="sidebar-link__icon-wrap">
                      <Icon className="sidebar-link__icon" aria-hidden="true" />
                      {showActivityDot ? (
                        <span
                          className="sidebar-link__activity"
                          aria-hidden="true"
                        />
                      ) : null}
                    </span>
                    {!isIcons && (
                      <span className="sidebar-link__label">
                        {item.label}
                        {showActivityDot ? (
                          <span className="sr-only"> (active)</span>
                        ) : null}
                      </span>
                    )}
                    {isIcons && (
                      <span className="sidebar-tooltip">{item.label}</span>
                    )}
                  </Link>
                  {renderSubnav(item, activeSubnavId)}
                </div>
              );
            })}
          </nav>
        </div>

        {canAccessSettings && (
          <div
            className={`sidebar-settings-group${
              isIcons ? "" : isOnSettings ? " sidebar-nav-group is-expanded" : ""
            }`}
          >
            {isIcons ? (
              <Link
                to={`/settings/${DEFAULT_SETTINGS_TAB}`}
                onMouseEnter={positionSidebarTooltip}
                className={`sidebar-link sidebar-link--icons${
                  isOnSettings ? " is-active" : ""
                }`}
                aria-label={
                  hasStorageFailure ? "Settings (storage issues)" : "Settings"
                }
              >
                <span className="sidebar-link__icon-wrap">
                  <Settings className="sidebar-link__icon" aria-hidden="true" />
                  {hasStorageFailure ? (
                    <span
                      className="sidebar-link__activity sidebar-link__activity--alert"
                      aria-hidden="true"
                    />
                  ) : null}
                </span>
                <span className="sidebar-tooltip">Settings</span>
              </Link>
            ) : (
              <>
                <Link
                  to={`/settings/${DEFAULT_SETTINGS_TAB}`}
                  className={`sidebar-link sidebar-link--full${
                    isOnSettings ? " is-active" : ""
                  }`}
                >
                  <span className="sidebar-link__icon-wrap">
                    <Settings
                      className="sidebar-link__icon"
                      aria-hidden="true"
                    />
                    {hasStorageFailure ? (
                      <span
                        className="sidebar-link__activity sidebar-link__activity--alert"
                        aria-hidden="true"
                      />
                    ) : null}
                  </span>
                  <span className="sidebar-link__label">
                    Settings
                    {hasStorageFailure ? (
                      <span className="sr-only"> (storage issues)</span>
                    ) : null}
                  </span>
                </Link>

                {isOnSettings && (
                  <nav
                    className="sidebar-subnav"
                    aria-label="Settings sections"
                  >
                    {settingsTabs.map((tab) => {
                      const tabActive = activeSettingsTab === tab.id;
                      const showStorageAlert =
                        tab.id === "system" && hasStorageFailure;
                      return (
                        <Link
                          key={tab.id}
                          to={`/settings/${tab.id}`}
                          className={`sidebar-subnav-link${
                            tabActive ? " is-active" : ""
                          }`}
                          aria-current={tabActive ? "page" : undefined}
                        >
                          {showStorageAlert ? (
                            <span
                              className="sidebar-subnav-link__alert"
                              aria-hidden="true"
                            />
                          ) : null}
                          <span>{tab.label}</span>
                        </Link>
                      );
                    })}
                  </nav>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

Sidebar.propTypes = {
  mode: PropTypes.oneOf(["full", "icons", "hidden"]).isRequired,
};

export default Sidebar;
