export const ACTIVITY_VIEWS = [
  { id: "queue", label: "Queue" },
  { id: "history", label: "History" },
];

export const DEFAULT_ACTIVITY_VIEW = "queue";

export function normalizeActivityView(view) {
  if (!view) return DEFAULT_ACTIVITY_VIEW;
  return ACTIVITY_VIEWS.some((entry) => entry.id === view) ? view : DEFAULT_ACTIVITY_VIEW;
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

export function buildActivityPath(view) {
  const nextView = normalizeActivityView(view);
  return `/activity/${nextView}`;
}
