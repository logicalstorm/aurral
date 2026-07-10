import { useState, useEffect, useMemo } from "react";
import { useWebSocketChannel } from "../../hooks/useWebSocket";
import { hasFlowWorkerActivity, hasReviewActivity } from "./flowStats";
import {
  applyPlaylistStatusMessage,
  fetchPlaylistStatus,
  getCachedPlaylistStatus,
  getLastPlaylistWsAt,
  subscribePlaylistStatus,
} from "./playlistStatusStore";

const POLL_INTERVAL_MS = 4000;
const IDLE_POLL_INTERVAL_MS = 30000;
const WS_RECENT_MS = 3000;

export function useFlowWorkerActivity({ enabled = true } = {}) {
  const [status, setStatus] = useState(() => (enabled ? getCachedPlaylistStatus() : null));

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      return undefined;
    }
    setStatus(getCachedPlaylistStatus());
    return subscribePlaylistStatus(setStatus);
  }, [enabled]);

  useWebSocketChannel("playlists", applyPlaylistStatusMessage, { enabled });
  useWebSocketChannel("weekly-flow", applyPlaylistStatusMessage, { enabled });

  useEffect(() => {
    if (!enabled) return;
    fetchPlaylistStatus().catch(() => {});
  }, [enabled]);

  const hasActivity = useMemo(() => hasFlowWorkerActivity(status), [status]);
  const hasReview = useMemo(() => hasReviewActivity(status), [status]);
  const isActive = hasActivity || hasReview;

  useEffect(() => {
    if (!enabled) return;
    const poll = () => {
      if (document.hidden) return;
      if (Date.now() - getLastPlaylistWsAt() < WS_RECENT_MS) return;
      fetchPlaylistStatus().catch(() => {});
    };
    const interval = setInterval(poll, isActive ? POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, isActive]);

  useEffect(() => {
    if (!enabled) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchPlaylistStatus().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [enabled]);

  return { hasActivity, hasReview, status };
}
