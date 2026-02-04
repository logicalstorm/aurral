import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export function useUnsavedGuard(hasUnsavedChanges, setHasUnsavedChanges) {
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  const hasUnsavedChangesRef = useRef(false);

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }

    const handleClick = (e) => {
      const link = e.target.closest("a[href]");
      if (
        link &&
        link.getAttribute("href")?.startsWith("/") &&
        link.getAttribute("href") !== "/settings"
      ) {
        e.preventDefault();
        e.stopPropagation();
        const targetPath = link.getAttribute("href");
        setShowUnsavedModal(true);
        setPendingNavigation(() => () => {
          navigate(targetPath);
          if (hasUnsavedChangesRef.current === false) return;
        });
        return false;
      }
    };

    const handlePopState = () => {
      if (location.pathname === "/settings") {
        window.history.pushState(null, "", "/settings");
        setShowUnsavedModal(true);
        setPendingNavigation(() => () => {
          window.history.back();
        });
      }
    };

    document.addEventListener("click", handleClick, true);
    window.addEventListener("popstate", handlePopState);
    return () => {
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [hasUnsavedChanges, location.pathname, navigate]);

  const handleConfirmLeave = () => {
    setHasUnsavedChanges?.(false);
    if (pendingNavigation) {
      pendingNavigation();
    }
    setShowUnsavedModal(false);
    setPendingNavigation(null);
  };

  const handleCancelLeave = () => {
    setShowUnsavedModal(false);
    setPendingNavigation(null);
  };

  return {
    showUnsavedModal,
    handleConfirmLeave,
    handleCancelLeave,
  };
}
