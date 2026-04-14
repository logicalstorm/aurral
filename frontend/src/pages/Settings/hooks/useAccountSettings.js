import { useState, useEffect, useCallback } from "react";
import { getMyLastfm, updateMyLastfm } from "../../../utils/api";

export function useAccountSettings(authUser, showSuccess, showError) {
  const [lastfmUsername, setLastfmUsername] = useState("");
  const [savedLastfmUsername, setSavedLastfmUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const hasUnsavedChanges = lastfmUsername !== savedLastfmUsername;

  const fetchLastfm = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getMyLastfm();
      const val = data.lastfmUsername || "";
      setLastfmUsername(val);
      setSavedLastfmUsername(val);
    } catch {
      showError("Failed to load Last.fm settings");
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    fetchLastfm();
  }, [fetchLastfm]);

  const handleSave = useCallback(async () => {
    if (!authUser?.id) return;
    try {
      setSaving(true);
      await updateMyLastfm(authUser.id, lastfmUsername.trim() || null);
      const trimmed = lastfmUsername.trim();
      setSavedLastfmUsername(trimmed);
      setLastfmUsername(trimmed);
      showSuccess("Last.fm username saved");
    } catch {
      showError("Failed to save Last.fm username");
    } finally {
      setSaving(false);
    }
  }, [authUser?.id, lastfmUsername, showSuccess, showError]);

  return {
    lastfmUsername,
    setLastfmUsername,
    hasUnsavedChanges,
    loading,
    saving,
    handleSave,
  };
}
