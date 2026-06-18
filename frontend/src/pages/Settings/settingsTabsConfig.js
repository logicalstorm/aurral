import {
  Bell,
  Compass,
  Database,
  Download,
  HardDrive,
  Music,
  Radar,
  Server,
  SlidersHorizontal,
  Users,
} from "lucide-react";

export const SETTINGS_TABS = [
  { id: "storage", label: "Storage", icon: HardDrive },
  { id: "library", label: "Library", icon: Server },
  { id: "indexers", label: "Indexers", icon: Radar },
  { id: "download-clients", label: "Download Clients", icon: Download },
  { id: "playback", label: "Playback", icon: Music },
  { id: "connect", label: "Connect", icon: Bell },
  { id: "discover", label: "Discover", icon: Compass },
  { id: "metadata", label: "Metadata", icon: Database, hidden: true },
  { id: "users", label: "Users", icon: Users },
  { id: "general", label: "General", icon: SlidersHorizontal },
];

export const SETTINGS_NAV_TABS = SETTINGS_TABS.filter((tab) => !tab.hidden);

export const SETTINGS_TAB_IDS = SETTINGS_TABS.map((tab) => tab.id);

export const DEFAULT_SETTINGS_TAB = "storage";

export const LEGACY_SETTINGS_TAB_MAP = {
  integrations: "library",
  playlists: "download-clients",
  downloads: "storage",
  notifications: "connect",
};

export function normalizeSettingsTabId(tabId) {
  if (!tabId) return DEFAULT_SETTINGS_TAB;
  const legacy = LEGACY_SETTINGS_TAB_MAP[tabId];
  if (legacy) return legacy;
  return SETTINGS_TAB_IDS.includes(tabId) ? tabId : DEFAULT_SETTINGS_TAB;
}

export function getSettingsTabById(tabId) {
  const normalized = normalizeSettingsTabId(tabId);
  return SETTINGS_TABS.find((tab) => tab.id === normalized) || SETTINGS_TABS[0];
}
