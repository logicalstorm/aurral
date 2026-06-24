import { useState, useEffect } from "react";

const FLOW_MOBILE_LAYOUT_QUERY = "(max-width: 767px)";

export function useFlowMobileLayout() {
  const [isMobileLayout, setIsMobileLayout] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(FLOW_MOBILE_LAYOUT_QUERY).matches
      : false,
  );

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return undefined;
    }
    const mediaQuery = window.matchMedia(FLOW_MOBILE_LAYOUT_QUERY);
    const handleChange = (event) => setIsMobileLayout(event.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return isMobileLayout;
}
