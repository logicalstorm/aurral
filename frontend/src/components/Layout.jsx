import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { useLocation } from "react-router-dom";
import { Menu, Github, Heart } from "lucide-react";
import Sidebar from "./Sidebar";
import GlobalSearch from "./GlobalSearch";

const VALID_SIDEBAR_MODES = ["full", "icons", "hidden"];

function Layout({ children, appVersion }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
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
  }, [location.pathname]);

  return (
    <div className="min-h-screen font-sans antialiased transition-colors duration-200">
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        appVersion={appVersion}
        mode={sidebarMode}
        onSetMode={handleSetSidebarMode}
      />

      <div
        className={`flex flex-col min-h-screen transition-all duration-300 ease-in-out ${
          sidebarMode === "full"
            ? "md:ml-[208px]"
            : sidebarMode === "icons"
              ? "md:ml-[56px]"
              : ""
        }`}
      >
        <header
          className="sticky h-16 top-0 z-30 px-4 py-3 md:px-6 backdrop-blur-md flex items-center gap-4"
          style={{ backgroundColor: "rgba(5, 5, 5, 0.8)" }}
        >
          <button
            onClick={() => {
              const isDesktop = window.matchMedia("(min-width: 768px)").matches;
              if (isDesktop) {
                handleSetSidebarMode(sidebarMode === "hidden" ? prevVisibleMode.current : "hidden");
              } else {
                setIsSidebarOpen(true);
              }
            }}
            className="p-2 -ml-2 hover:bg-gray-900/50 transition-colors"
            style={{ color: "#c1c1c3" }}
            aria-label="Toggle navigation"
          >
            <Menu className="w-5 h-5" />
          </button>

          <GlobalSearch />

          <div className="flex items-center space-x-2">
            <a
              href="https://github.com/lklynet/aurral"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 transition-colors rounded-md hover:bg-white/5 group"
              style={{ color: "#c1c1c3" }}
              aria-label="GitHub Repository"
            >
              <Github className="w-5 h-5 transition-colors group-hover:text-white" />
            </a>
            <a
              href="https://github.com/sponsors/lklynet/"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 transition-colors rounded-md hover:bg-white/5 group"
              style={{ color: "#c1c1c3" }}
              aria-label="GitHub Sponsors"
            >
              <Heart className="w-5 h-5 transition-colors group-hover:text-pink-500" />
            </a>
          </div>
        </header>

        <main className="flex-1 w-full max-w-[1600px] mx-auto p-4 md:p-8 lg:p-10">
          <div className="animate-fade-in">{children}</div>
        </main>
      </div>
    </div>
  );
}

Layout.propTypes = {
  children: PropTypes.node.isRequired,
  appVersion: PropTypes.string,
};

export default Layout;
