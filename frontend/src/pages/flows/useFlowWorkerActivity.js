import { useState, useEffect, useMemo } from "react";
import { useWebSocketChannel } from "../../hooks/useWebSocket";
import { hasFlowWorkerActivity, hasReviewActivity } from "./flowStats";
import {
  applyPlaylistStatusMessage,
  fetchPlaylistStatus,
  getCachedPlaylistStatus,
  subscribePlaylistStatus,
  subscribePlaylistStatusPolling,
} from "./playlistStatusStore";

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

  const { isConnected: playlistsSocketConnected } = useWebSocketChannel(
    "playlists",
    applyPlaylistStatusMessage,
    { enabled },
  );
  const { isConnected: weeklyFlowSocketConnected } = useWebSocketChannel(
    "weekly-flow",
    applyPlaylistStatusMessage,
    { enabled },
  );

  useEffect(() => {
    if (!enabled) return;
    fetchPlaylistStatus().catch(() => {});
  }, [enabled]);

  const hasActivity = useMemo(() => hasFlowWorkerActivity(status), [status]);
  const hasReview = useMemo(() => hasReviewActivity(status), [status]);
  const isActive = hasActivity || hasReview;

  useEffect(() => {
    if (!enabled) return;
    return subscribePlaylistStatusPolling({
      active: isActive,
      isSocketConnected: playlistsSocketConnected || weeklyFlowSocketConnected,
    });
  }, [enabled, isActive, playlistsSocketConnected, weeklyFlowSocketConnected]);

  return { hasActivity, hasReview, status };
}
