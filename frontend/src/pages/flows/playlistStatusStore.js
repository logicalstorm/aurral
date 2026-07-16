import { getFlowStatus } from "../../utils/api/endpoints/playlists.js";

let cached = null;
let lastWsAt = 0;
let fetchInFlight = null;
let pollTimer = null;
let visibilityListenerAttached = false;
const listeners = new Set();
const pollingSubscribers = new Map();

const ACTIVE_POLL_INTERVAL_MS = 4000;
const IDLE_POLL_INTERVAL_MS = 30000;
const WS_STALE_AFTER_MS = 15000;

export function getCachedPlaylistStatus() {
  return cached;
}

export function getLastPlaylistWsAt() {
  return lastWsAt;
}

export function subscribePlaylistStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(next, { fromWs = false } = {}) {
  cached = next;
  if (fromWs) lastWsAt = Date.now();
  for (const listener of listeners) listener(next);
}

export function applyPlaylistStatusMessage(msg) {
  if (msg?.type !== "playlist_status") return false;
  if (!msg?.status || typeof msg.status !== "object") return false;
  emit(msg.status, { fromWs: true });
  return true;
}

export async function fetchPlaylistStatus() {
  if (!fetchInFlight) {
    fetchInFlight = getFlowStatus()
      .then((data) => {
        emit(data);
        return data;
      })
      .finally(() => {
        fetchInFlight = null;
      });
  }
  const data = await fetchInFlight;
  return data;
}

const hasConnectedSubscriber = () =>
  Array.from(pollingSubscribers.values()).some((subscriber) => subscriber.isSocketConnected);

const hasActiveSubscriber = () =>
  Array.from(pollingSubscribers.values()).some((subscriber) => subscriber.active);

const hasRecentWebSocketMessage = () =>
  lastWsAt > 0 && Date.now() - lastWsAt < WS_STALE_AFTER_MS;

const shouldFetchFallback = () => {
  if (typeof document !== "undefined" && document.hidden) return false;
  return !hasConnectedSubscriber() && !hasRecentWebSocketMessage();
};

const clearPollTimer = () => {
  if (pollTimer == null) return;
  clearTimeout(pollTimer);
  pollTimer = null;
};

const scheduleNextPoll = ({ reset = false } = {}) => {
  if (reset) clearPollTimer();
  if (pollTimer != null || pollingSubscribers.size === 0) return;
  const delay = hasActiveSubscriber() ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS;
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    if (shouldFetchFallback()) {
      try {
        await fetchPlaylistStatus();
      } catch {}
    }
    scheduleNextPoll();
  }, delay);
};

const handleVisibilityChange = () => {
  if (document.visibilityState !== "visible") return;
  if (shouldFetchFallback()) fetchPlaylistStatus().catch(() => {});
  scheduleNextPoll({ reset: true });
};

const syncVisibilityListener = () => {
  if (typeof document === "undefined") return;
  if (pollingSubscribers.size > 0 && !visibilityListenerAttached) {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    visibilityListenerAttached = true;
  } else if (pollingSubscribers.size === 0 && visibilityListenerAttached) {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    visibilityListenerAttached = false;
  }
};

export function subscribePlaylistStatusPolling({
  active = false,
  isSocketConnected = false,
} = {}) {
  const subscriber = Symbol("playlist-status-poller");
  pollingSubscribers.set(subscriber, {
    active: Boolean(active),
    isSocketConnected: Boolean(isSocketConnected),
  });
  syncVisibilityListener();
  scheduleNextPoll({ reset: true });

  return () => {
    pollingSubscribers.delete(subscriber);
    if (pollingSubscribers.size === 0) clearPollTimer();
    else scheduleNextPoll({ reset: true });
    syncVisibilityListener();
  };
}
