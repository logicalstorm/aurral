import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Search, Menu } from "lucide-react";
import Sidebar from "./Sidebar";

function Layout({
  children,
  isHealthy,
  rootFolderConfigured,
  slskdConfigured,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery("");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 font-sans antialiased transition-colors duration-200">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      <div className="md:ml-52 flex flex-col min-h-screen transition-all duration-300 ease-in-out">
        <header className="sticky h-16 top-0 z-30 px-4 py-3 md:px-6 bg-gray-50/90 dark:bg-gray-950/90 backdrop-blur-md border-b border-gray-200 dark:border-gray-800 flex items-center gap-4">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 -ml-2 text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-800 rounded-lg md:hidden"
            aria-label="Open navigation"
          >
            <Menu className="w-5 h-5" />
          </button>

          <form onSubmit={handleSearch} className="relative w-full">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400 dark:text-gray-500" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search artists..."
              className="block w-full pl-10 pr-4 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-shadow shadow-sm"
            />
          </form>
        </header>

        <main className="flex-1 w-full max-w-[1600px] mx-auto p-4 md:p-8 lg:p-10">
          <div className="animate-fade-in">{children}</div>
        </main>

        <footer className="border-t border-gray-200 dark:border-gray-800 bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm pt-6 pb-8 pb-safe-extra">
          <div className="max-w-[1600px] mx-auto px-6 md:px-8 lg:px-10 flex flex-col md:flex-row justify-between items-center text-sm text-gray-500 dark:text-gray-400">
            <p>&copy; {new Date().getFullYear()} Aurral.</p>
            <div className="flex items-center space-x-6 mt-4 md:mt-0">
              <a
                href="https://musicbrainz.org"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary-500 transition-colors"
              >
                MusicBrainz
              </a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default Layout;
