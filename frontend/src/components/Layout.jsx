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
    <div className="min-h-screen font-sans antialiased transition-colors duration-200">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      <div className="md:ml-52 flex flex-col min-h-screen transition-all duration-300 ease-in-out">
        <header
          className="sticky h-16 top-0 z-30 px-4 py-3 md:px-6 backdrop-blur-md flex items-center gap-4"
          style={{ backgroundColor: "rgba(5, 5, 5, 0.8)" }}
        >
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 -ml-2 hover:bg-gray-900/50 md:hidden transition-colors"
            style={{ color: "#c1c1c3" }}
            aria-label="Open navigation"
          >
            <Menu className="w-5 h-5" />
          </button>

          <form onSubmit={handleSearch} className="relative w-full">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5" style={{ color: "#c1c1c3" }} />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search artists..."
              className="block w-full pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 transition-shadow shadow-sm"
              style={{ focusRingColor: "#c1c1c3" }}
              style={{ backgroundColor: "#211f27", color: "#fff" }}
            />
          </form>
        </header>

        <main className="flex-1 w-full max-w-[1600px] mx-auto p-4 md:p-8 lg:p-10">
          <div className="animate-fade-in">{children}</div>
        </main>

        <footer
          className="backdrop-blur-sm pt-6 pb-8 pb-safe-extra"
          style={{ backgroundColor: "rgba(24, 24, 28, 0.5)" }}
        >
          <div
            className="max-w-[1600px] mx-auto px-6 md:px-8 lg:px-10 flex flex-col md:flex-row justify-between items-center text-sm"
            style={{ color: "#c1c1c3" }}
          >
            <p>&copy; {new Date().getFullYear()} Aurral.</p>
            <div className="flex items-center space-x-6 mt-4 md:mt-0">
              <a
                href="https://musicbrainz.org"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline transition-colors"
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
