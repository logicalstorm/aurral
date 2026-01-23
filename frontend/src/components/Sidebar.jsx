import { Link, useLocation } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import {
  Library,
  Settings,
  Sparkles,
  Music,
  Menu,
  X,
  History,
  LogOut,
  Play,
  Github,
  Heart,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

function Sidebar({ isOpen, onClose }) {
  const location = useLocation();
  const { authRequired, logout } = useAuth();
  const navRef = useRef(null);
  const activeBubbleRef = useRef(null);
  const hoverBubbleRef = useRef(null);
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const linkRefs = useRef({});

  const isActive = (path) => {
    if (path === "/discover" && location.pathname === "/") return true;
    return location.pathname === path;
  };

  const navItems = [
    { path: "/discover", label: "Discover", icon: Sparkles },
    { path: "/flow", label: "Weekly Flow", icon: Play },
    { path: "/library", label: "Library", icon: Library },
    { path: "/requests", label: "Requests", icon: History },
    { path: "/settings", label: "Settings", icon: Settings },
  ];

  // Update bubble position for active link
  useEffect(() => {
    const updateBubblePosition = () => {
      if (!navRef.current || !activeBubbleRef.current) return;

      const activeIndex = navItems.findIndex((item) => isActive(item.path));
      if (activeIndex === -1) {
        // Hide bubble if no active item
        activeBubbleRef.current.style.opacity = "0";
        return;
      }

      const activeLink = linkRefs.current[activeIndex];
      if (!activeLink) {
        // Wait a bit for DOM to update
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

    // Initial update with slight delay to ensure DOM is ready
    const timeoutId = setTimeout(updateBubblePosition, 10);
    window.addEventListener("resize", updateBubblePosition);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("resize", updateBubblePosition);
    };
  }, [location.pathname, navItems, isOpen]);

  // Update hover bubble position
  useEffect(() => {
    const updateHoverBubble = () => {
      if (!navRef.current || !hoverBubbleRef.current) return;

      if (hoveredIndex === null) {
        // Cover entire nav container when not hovering - more subtle/washed out
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

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-52 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex flex-col border-r border-gray-200 dark:border-gray-800 transition-transform duration-300 ease-in-out pl-safe pt-safe pb-safe ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="h-16 flex items-center justify-center px-4 border-b border-gray-200 dark:border-b-gray-800">
          <Link to="/" className="flex items-center space-x-2 group">
            <img
              src="/arralogo.svg"
              alt="Aurral Logo"
              className="w-7 h-7 transition-transform group-hover:scale-110"
            />
            <span className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100 group-hover:text-primary-500 transition-colors">
              Aurral
            </span>
          </Link>
        </div>

        <div className="flex-1 px-3 py-6 overflow-y-auto flex items-start justify-center">
          <div
            ref={navRef}
            className="relative bg-gray-100 dark:bg-gray-900 p-1.5"
          >
            {/* Active bubble */}
            <div
              ref={activeBubbleRef}
              className="absolute bg-gray-100 dark:bg-gray-400 transition-all duration-300 ease-out z-10 opacity-0"
            />

            {/* Hover bubble - covers entire nav by default, shrinks to hovered link */}
            <div
              ref={hoverBubbleRef}
              className="absolute bg-gray-200 dark:bg-gray-800 transition-all duration-200 ease-out z-0"
            />

            <nav
              className="relative flex flex-col space-y-1"
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
                    className={`relative z-20 flex items-center space-x-2.5 px-4 py-2.5 font-medium transition-all duration-200 text-sm ${
                      active
                        ? "text-gray-800 dark:text-gray-800"
                        : "text-gray-400 dark:text-gray-500 hover:text-gray-300 dark:hover:text-gray-400"
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 transition-transform group-hover:scale-110 flex-shrink-0 ${
                        active
                          ? "text-gray-800 dark:text-gray-800"
                          : "text-gray-400 dark:text-gray-500"
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>

        {authRequired && (
          <div className="p-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
            <button
              onClick={logout}
              className="flex items-center justify-center w-full px-3 py-2 space-x-2 text-xs font-medium text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm"
            >
              <LogOut className="w-4 h-4" />
              <span>Logout</span>
            </button>
          </div>
        )}

        <div className="p-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-center space-x-3">
          <a
            href="https://github.com/lklynet/aurral"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            aria-label="GitHub Repository"
          >
            <Github className="w-4 h-4" />
          </a>
          <a
            href="https://github.com/sponsors/lklynet/"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
            aria-label="GitHub Sponsors"
          >
            <Heart className="w-4 h-4" />
          </a>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
