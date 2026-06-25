export const ACTIVITY_VIEWS = [
  { id: "queue", label: "Queue" },
  { id: "history", label: "History" },
];

const BASE_ACTIVITY_SOURCE_ITEMS = [
  { id: "all", label: "All" },
  { id: "lidarr", label: "Lidarr" },
  { id: "slskd", label: "slskd" },
  { id: "aurral", label: "Aurral" },
];

const USENET_ACTIVITY_SOURCE_ITEM = { id: "usenet", label: "Usenet" };

export const DEFAULT_ACTIVITY_VIEW = "queue";
export const DEFAULT_ACTIVITY_SOURCE = "all";

const ACTIVITY_VIEW_IDS = ACTIVITY_VIEWS.map((entry) => entry.id);
const LEGACY_HISTORY_SOURCE_IDS = ["all", "lidarr", "slskd", "nzbget", "usenet", "aurral"];

export function getActivitySourceItems(usenetConfigured = false) {
  if (!usenetConfigured) return BASE_ACTIVITY_SOURCE_ITEMS;
  const items = [...BASE_ACTIVITY_SOURCE_ITEMS];
  const slskdIndex = items.findIndex((item) => item.id === "slskd");
  items.splice(slskdIndex + 1, 0, USENET_ACTIVITY_SOURCE_ITEM);
  return items;
}

export function getActivitySourceIds(usenetConfigured = false) {
  return getActivitySourceItems(usenetConfigured).map((item) => item.id);
}

export function normalizeActivityView(view) {
  if (!view) return DEFAULT_ACTIVITY_VIEW;
  return ACTIVITY_VIEW_IDS.includes(view) ? view : DEFAULT_ACTIVITY_VIEW;
}

export function normalizeActivitySource(source, usenetConfigured = false) {
  if (!source) return DEFAULT_ACTIVITY_SOURCE;
  if (source === "nzbget" && usenetConfigured) return "usenet";
  const sourceIds = getActivitySourceIds(usenetConfigured);
  return sourceIds.includes(source) ? source : DEFAULT_ACTIVITY_SOURCE;
}

export function getActivityRequestSource(request) {
  if (request?.source === "nzbget" || request?.source === "sabnzbd") return "usenet";
  if (request?.source === "slskd") return "slskd";
  if (request?.source === "aurral") return "aurral";
  if (request?.source === "lidarr") return "lidarr";
  if (request?.type === "album" || request?.albumId) return "lidarr";
  return "aurral";
}

export function matchesActivitySource(request, source) {
  if (source === "all") return true;
  return getActivityRequestSource(request) === source;
}

export function isActivityQueueItem(request) {
  return (
    request?.inQueue === true || request?.status === "processing" || request?.status === "pending"
  );
}

export function matchesActivityView(request, view) {
  if (view === "queue") return isActivityQueueItem(request);
  return !isActivityQueueItem(request);
}

export function buildActivityPath(view, source) {
  const nextView = normalizeActivityView(view);
  const nextSource = source == null || source === "" ? DEFAULT_ACTIVITY_SOURCE : String(source);
  return `/activity/${nextView}/${nextSource}`;
}

export function resolveLegacyHistoryPath(tab, usenetConfigured = false) {
  if (!tab) return buildActivityPath("history", DEFAULT_ACTIVITY_SOURCE);
  if (ACTIVITY_VIEW_IDS.includes(tab)) {
    return buildActivityPath(tab, DEFAULT_ACTIVITY_SOURCE);
  }
  if (LEGACY_HISTORY_SOURCE_IDS.includes(tab)) {
    return buildActivityPath("history", normalizeActivitySource(tab, usenetConfigured));
  }
  return buildActivityPath("history", DEFAULT_ACTIVITY_SOURCE);
}

export function resolveActivityPartialPath(segment, usenetConfigured = false) {
  if (ACTIVITY_VIEW_IDS.includes(segment)) {
    return buildActivityPath(segment, DEFAULT_ACTIVITY_SOURCE);
  }
  const sourceIds = getActivitySourceIds(usenetConfigured);
  if (sourceIds.includes(segment)) {
    return buildActivityPath("history", segment);
  }
  return buildActivityPath(DEFAULT_ACTIVITY_VIEW, DEFAULT_ACTIVITY_SOURCE);
}
