import { useContext } from "react";
import { DiscoverRecentContext } from "../contexts/discoverRecentContext";

export function useDiscoverRecent() {
  const context = useContext(DiscoverRecentContext);
  if (!context) {
    throw new Error("useDiscoverRecent must be used within DiscoverRecentProvider");
  }
  return context;
}
