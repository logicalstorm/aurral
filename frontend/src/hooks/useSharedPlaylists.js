import { useState, useCallback } from "react";
import { getFlowStatus } from "../utils/api";
import { useToast } from "../contexts/ToastContext";

export function useSharedPlaylists() {
  const { showError } = useToast();
  const [sharedPlaylists, setSharedPlaylists] = useState([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError, setPlaylistsError] = useState("");

  const loadSharedPlaylists = useCallback(async () => {
    setPlaylistsLoading(true);
    setPlaylistsError("");
    try {
      const data = await getFlowStatus();
      const playlists = Array.isArray(data?.sharedPlaylists) ? data.sharedPlaylists : [];
      setSharedPlaylists(playlists);
      return playlists;
    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        "Failed to load playlists";
      setPlaylistsError(message);
      showError(message);
      return null;
    } finally {
      setPlaylistsLoading(false);
    }
  }, [showError]);

  return {
    sharedPlaylists,
    setSharedPlaylists,
    playlistsLoading,
    playlistsError,
    setPlaylistsError,
    loadSharedPlaylists,
  };
}
