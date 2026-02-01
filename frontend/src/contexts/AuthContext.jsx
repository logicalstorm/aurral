import { createContext, useContext, useState, useEffect } from "react";
import { checkHealth, verifyCredentials } from "../utils/api";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [onboardingRequired, setOnboardingRequired] = useState(false);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkAuthStatus = async () => {
    try {
      const healthData = await checkHealth();
      const isOnboarding = !!healthData.onboardingRequired;
      setOnboardingRequired(isOnboarding);

      if (isOnboarding) {
        setIsAuthenticated(false);
        setUser(null);
        setIsLoading(false);
        return;
      }

      const isRequired = healthData.authRequired;
      const authUser = healthData.authUser || "admin";
      setAuthRequired(isRequired);

      if (isRequired) {
        localStorage.setItem("auth_user", authUser);
      }

      if (!isRequired) {
        setUser(
          healthData.user || {
            role: "admin",
            permissions: {
              accessSettings: true,
              accessFlow: true,
              addArtist: true,
              addAlbum: true,
              changeMonitoring: true,
              deleteArtist: true,
              deleteAlbum: true,
            },
          }
        );
        setIsAuthenticated(true);
        setIsLoading(false);
        return;
      }

      const storedPassword = localStorage.getItem("auth_password");
      const storedUser = localStorage.getItem("auth_user") || "admin";

      if (storedPassword) {
        try {
          const isValid = await verifyCredentials(storedPassword, storedUser);
          if (isValid) {
            const healthWithAuth = await checkHealth();
            setUser(healthWithAuth.user || null);
            setIsAuthenticated(!!healthWithAuth.user);
          } else {
            localStorage.removeItem("auth_password");
            setUser(null);
            setIsAuthenticated(false);
          }
        } catch (e) {
          setUser(null);
          setIsAuthenticated(false);
        }
      } else {
        setUser(null);
        setIsAuthenticated(false);
      }
    } catch (error) {
      setUser(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const login = async (password, username = "admin") => {
    if (!password) return false;

    try {
      const isValid = await verifyCredentials(password, username);
      if (isValid) {
        localStorage.setItem("auth_password", password);
        localStorage.setItem("auth_user", username);
        setIsAuthenticated(true);
        const healthWithAuth = await checkHealth();
        setUser(healthWithAuth.user || null);
        window.location.reload();
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  };

  const logout = () => {
    localStorage.removeItem("auth_password");
    localStorage.removeItem("auth_user");
    setIsAuthenticated(false);
    setUser(null);
  };

  const hasPermission = (perm) => {
    if (!user) return false;
    if (user.role === "admin") return true;
    return !!user.permissions?.[perm];
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        user,
        login,
        logout,
        authRequired,
        onboardingRequired,
        refreshAuth: checkAuthStatus,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
