import { createContext, useContext, useState, useEffect } from "react";
import { checkHealth, verifyCredentials } from "../utils/api";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const checkAuthStatus = async () => {
    try {
      const healthData = await checkHealth();
      const isRequired = healthData.authRequired;
      const authUser = healthData.authUser || "admin";
      setAuthRequired(isRequired);

      if (isRequired) {
        localStorage.setItem("auth_user", authUser);
      }

      if (!isRequired) {
        setIsAuthenticated(true);
        setIsLoading(false);
        return;
      }

      const storedPassword = localStorage.getItem("auth_password");
      const storedUser = localStorage.getItem("auth_user") || "admin";

      if (storedPassword) {
        try {
          const isValid = await verifyCredentials(storedPassword, storedUser);
          setIsAuthenticated(isValid);
          if (!isValid) {
            localStorage.removeItem("auth_password");
          }
        } catch (e) {}
      } else {
        setIsAuthenticated(false);
      }
    } catch (error) {
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
  };

  return (
    <AuthContext.Provider
      value={{ isAuthenticated, isLoading, login, logout, authRequired }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
