import { Link, useLocation } from "react-router-dom";
import {
  Library,
  Settings,
  Sparkles,
  Moon,
  Sun,
  Music,
  Menu,
  X,
  History,
  LogOut,
  Play
} from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { useAuth } from "../contexts/AuthContext";

function Sidebar({
  isHealthy,
  lidarrConfigured,
  lidarrStatus,
  isOpen,
  onClose,
}) {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { authRequired, logout } = useAuth();

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

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex flex-col border-r border-gray-200 dark:border-gray-800 transition-transform duration-300 ease-in-out pl-safe pt-safe pb-safe ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="h-16 flex items-center justify-between px-6 border-b border-gray-200 dark:border-b-gray-800">
          <Link to="/" className="flex items-center space-x-3 group">
            <img
              src="/arralogo.svg"
              alt="Aurral Logo"
              className="w-8 h-8 transition-transform group-hover:scale-110"
            />
            <span className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100 group-hover:text-primary-500 transition-colors">
              Aurral
            </span>
          </Link>
          <button
            onClick={onClose}
            className="md:hidden p-2 -mr-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center space-x-3 px-4 py-3 rounded-xl font-medium transition-all duration-200 group ${
                  active
                    ? "bg-primary-500/10 text-primary-600 dark:text-primary-400 border border-primary-500/20"
                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100 border border-transparent"
                }`}
              >
                <Icon
                  className={`w-5 h-5 transition-transform group-hover:scale-110 ${
                    active
                      ? "text-primary-600 dark:text-primary-400"
                      : "text-gray-500 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-gray-100"
                  }`}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
          <div className="flex flex-col space-y-4">
            <div className="flex items-center justify-between px-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                System Status
              </span>
              <div className="flex items-center space-x-2">
                <div
                  className={`w-2 h-2 rounded-full ${
                    isHealthy === null
                      ? "bg-gray-400 dark:bg-gray-500"
                      : isHealthy && lidarrConfigured && lidarrStatus === "connected"
                        ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"
                        : isHealthy && lidarrConfigured && lidarrStatus !== "connected"
                           ? "bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.6)]"
                        : isHealthy
                          ? "bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.6)]"
                          : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"
                  }`}
                />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {isHealthy === null
                    ? "Checking..."
                    : isHealthy && lidarrConfigured && lidarrStatus === "connected"
                      ? "Online"
                       : isHealthy && lidarrConfigured && lidarrStatus !== "connected"
                        ? "Lidarr Down"
                      : isHealthy
                        ? "Config"
                        : "Offline"}
                </span>
              </div>
            </div>

            <button
              onClick={toggleTheme}
              className="flex items-center justify-center w-full px-4 py-2 space-x-2 text-sm font-medium text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors shadow-sm"
            >
              {theme === "dark" ? (
                <>
                  <Sun className="w-4 h-4" />
                  <span>Light Mode</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4" />
                  <span>Dark Mode</span>
                </>
              )}
            </button>
            
            {authRequired && (
              <button
                onClick={logout}
                className="flex items-center justify-center w-full px-4 py-2 space-x-2 text-sm font-medium text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors shadow-sm"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
