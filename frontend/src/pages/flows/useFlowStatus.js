import { useState, useEffect, useCallback, useMemo } from "react";
import { useWebSocketChannel } from "../../hooks/useWebSocket";
import { sanitizeFlowStats, EMPTY_FLOW_STATS, getPlaylistStateFromStats } from "./flowStats";
import {
  applyPlaylistStatusMessage,
  fetchPlaylistStatus,
  getCachedPlaylistStatus,
  subscribePlaylistStatus,
  subscribePlaylistStatusPolling,
} from "./playlistStatusStore";

export function useFlowStatus() {
  const [status, setStatus] = useState(() => getCachedPlaylistStatus());
  const [loading, setLoading] = useState(() => !getCachedPlaylistStatus());
  const [countdownNow, setCountdownNow] = useState(() => Date.now());

  useEffect(() => subscribePlaylistStatus((next) => {
    setStatus(next);
    setLoading(false);
  }), []);

  const fetchStatus = useCallback(async (options = {}) => {
    try {
      return await fetchPlaylistStatus(options);
    } catch {
      if (!options.signal?.aborted) setLoading(false);
      return null;
    } finally {
      if (!options.signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const { isConnected: playlistsSocketConnected } = useWebSocketChannel(
    "playlists",
    applyPlaylistStatusMessage,
  );
  const { isConnected: weeklyFlowSocketConnected } = useWebSocketChannel(
    "weekly-flow",
    applyPlaylistStatusMessage,
  );

  useEffect(() => {
    const workerRunning = status?.worker?.running === true;
    const hintPhase = status?.hint?.phase;
    const inTransition = hintPhase === "preparing" || hintPhase === "downloading";
    return subscribePlaylistStatusPolling({
      active: workerRunning || inTransition,
      isSocketConnected: playlistsSocketConnected || weeklyFlowSocketConnected,
    });
  }, [
    playlistsSocketConnected,
    status?.hint?.phase,
    status?.worker?.running,
    weeklyFlowSocketConnected,
  ]);

  useEffect(() => {
    const interval = setInterval(() => setCountdownNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  const getPlaylistStats = useCallback(
    (flowId) =>
      sanitizeFlowStats(
        status?.flowStats?.[flowId] ||
          status?.sharedPlaylistStats?.[flowId] ||
          EMPTY_FLOW_STATS,
      ),
    [status?.flowStats, status?.sharedPlaylistStats],
  );

  const getPlaylistState = useCallback(
    (flowId) => getPlaylistStateFromStats(getPlaylistStats(flowId)),
    [getPlaylistStats],
  );

  const sharedPlaylists = useMemo(() => status?.sharedPlaylists || [], [status?.sharedPlaylists]);
  const flows = useMemo(() => status?.flows || [], [status?.flows]);

  return {
    status,
    loading,
    fetchStatus,
    countdownNow,
    getPlaylistStats,
    getPlaylistState,
    sharedPlaylists,
    flows,
  };
}
