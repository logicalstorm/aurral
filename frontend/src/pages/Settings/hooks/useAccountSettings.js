import { useState, useEffect, useCallback } from "react";
import {
  getMyListeningHistory,
  updateMyListeningHistory,
} from "../../../utils/api";

export function useAccountSettings(authUser, showSuccess, showError) {
  const [listenHistoryProvider, setListenHistoryProvider] = useState("lastfm");
  const [listenHistoryUsername, setListenHistoryUsername] = useState("");
  const [savedListenHistoryProvider, setSavedListenHistoryProvider] =
    useState("lastfm");
  const [savedListenHistoryUsername, setSavedListenHistoryUsername] =
    useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const hasUnsavedChanges =
    listenHistoryProvider !== savedListenHistoryProvider ||
    listenHistoryUsername !== savedListenHistoryUsername;

  const fetchListeningHistory = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getMyListeningHistory();
      const provider = data.listenHistoryProvider || "lastfm";
      const username = data.listenHistoryUsername || "";
      setListenHistoryProvider(provider);
      setListenHistoryUsername(username);
      setSavedListenHistoryProvider(provider);
      setSavedListenHistoryUsername(username);
    } catch {
      showError("Failed to load listening history settings");
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    fetchListeningHistory();
  }, [fetchListeningHistory]);

  const handleSave = useCallback(async () => {
    if (!authUser?.id) return;
    try {
      setSaving(true);
      const trimmedUsername = listenHistoryUsername.trim();
      await updateMyListeningHistory(
        authUser.id,
        listenHistoryProvider,
        trimmedUsername || null,
      );
      setSavedListenHistoryProvider(listenHistoryProvider);
      setSavedListenHistoryUsername(trimmedUsername);
      setListenHistoryUsername(trimmedUsername);
      showSuccess("Listening history settings saved");
    } catch {
      showError("Failed to save listening history settings");
    } finally {
      setSaving(false);
    }
  }, [
    authUser?.id,
    listenHistoryProvider,
    listenHistoryUsername,
    showSuccess,
    showError,
  ]);

  return {
    listenHistoryProvider,
    setListenHistoryProvider,
    listenHistoryUsername,
    setListenHistoryUsername,
    hasUnsavedChanges,
    loading,
    saving,
    handleSave,
  };
}
