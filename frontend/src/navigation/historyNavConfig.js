const BASE_HISTORY_NAV_ITEMS = [
  { id: "all", label: "All" },
  { id: "lidarr", label: "Lidarr" },
  { id: "slskd", label: "slskd" },
  { id: "aurral", label: "Aurral" },
];

const NZBGET_HISTORY_NAV_ITEM = { id: "nzbget", label: "NZBGet" };

export const DEFAULT_HISTORY_TAB = "all";

export function getHistoryNavItems(usenetConfigured = false) {
  if (!usenetConfigured) return BASE_HISTORY_NAV_ITEMS;
  const items = [...BASE_HISTORY_NAV_ITEMS];
  const slskdIndex = items.findIndex((item) => item.id === "slskd");
  items.splice(slskdIndex + 1, 0, NZBGET_HISTORY_NAV_ITEM);
  return items;
}

export function getHistoryTabIds(usenetConfigured = false) {
  return getHistoryNavItems(usenetConfigured).map((item) => item.id);
}

export function normalizeHistoryTab(tab, usenetConfigured = false) {
  const tabIds = getHistoryTabIds(usenetConfigured);
  if (!tab) return DEFAULT_HISTORY_TAB;
  return tabIds.includes(tab) ? tab : DEFAULT_HISTORY_TAB;
}
