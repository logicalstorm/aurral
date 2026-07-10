import { getFlowStatus } from "../../utils/api";

let cached = null;
let lastWsAt = 0;
const listeners = new Set();

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

export async function fetchPlaylistStatus(options = {}) {
  const data = await getFlowStatus(options);
  if (options.signal?.aborted) return data;
  emit(data);
  return data;
}
