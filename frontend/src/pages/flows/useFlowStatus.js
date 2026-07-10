import { useState, useEffect, useCallback, useMemo } from "react";
import { useWebSocketChannel } from "../../hooks/useWebSocket";
import { sanitizeFlowStats, EMPTY_FLOW_STATS, getPlaylistStateFromStats } from "./flowStats";
import {
  applyPlaylistStatusMessage,
  fetchPlaylistStatus,
  getCachedPlaylistStatus,
  getLastPlaylistWsAt,
  subscribePlaylistStatus,
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
    const controller = new AbortController();
    fetchStatus({ signal: controller.signal });
    return () => controller.abort();
  }, [fetchStatus]);

  useWebSocketChannel("playlists", applyPlaylistStatusMessage);
  useWebSocketChannel("weekly-flow", applyPlaylistStatusMessage);

  useEffect(() => {
    const workerRunning = status?.worker?.running === true;
    const hintPhase = status?.hint?.phase;
    const inTransition = hintPhase === "preparing" || hintPhase === "downloading";
    if (!workerRunning && !inTransition) return;
    const interval = setInterval(() => {
      if (Date.now() - getLastPlaylistWsAt() < 20000) return;
      fetchStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, [status?.worker?.running, status?.hint?.phase, fetchStatus]);

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
