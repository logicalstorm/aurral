import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useWebSocketChannel } from "../hooks/useWebSocket";
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "../contexts/AuthContext";
import {
  addArtistToLibrary,
  getBootstrapStatus,
  getDiscovery,
  getNearbyShows,
  getRecentlyAdded,
  getRecentReleases,
  lookupArtistsInLibraryBatch,
  readLibraryLookupCache,
  downloadAlbum,
  updateLibraryAlbum,
} from "../utils/api";
import { getArtistRecordId } from "../utils/artistTaste";
import { getArtistFeedbackFlags } from "../utils/discoveryFeedback";
import { useArtistTasteFeedback } from "../hooks/useArtistTasteFeedback";
import {
  readStoredNearbyLocation,
  readStoredRecentlyAdded,
  writeStoredRecentlyAdded,
  readStoredRecentReleases,
  writeStoredRecentReleases,
  readStoredNearbyShows,
  writeStoredNearbyShows,
  readStoredDiscoveryData,
  writeStoredDiscoveryData,
  normalizeDiscoveryData,
  DISCOVER_NEARBY_MODE_KEY,
  DISCOVER_NEARBY_ZIP_KEY,
  DISCOVER_PREVIEW_ITEM_LIMIT,
} from "./discoverUtils";

const getArtistId = (artist) => getArtistRecordId(artist);

export function useDiscoverData() {
  const { user: authUser, hasPermission } = useAuth();
  const { showSuccess, showError } = useToast();
  const initialNearbyLocation = useMemo(() => readStoredNearbyLocation(), []);

  const [data, setData] = useState(() => readStoredDiscoveryData(authUser?.id));
  const [recentlyAdded, setRecentlyAdded] = useState(
    () => readStoredRecentlyAdded(authUser?.id) || [],
  );
  const [recentReleases, setRecentReleases] = useState(
    () => readStoredRecentReleases(authUser?.id) || [],
  );
  const [pendingRecentReleaseIds, setPendingRecentReleaseIds] = useState({});
  const [error, setError] = useState(null);
  const [libraryLookup, setLibraryLookup] = useState({});
  const { lookup: artistFeedbackLookup, submitFeedback } =
    useArtistTasteFeedback();
  const [nearbyShowsData, setNearbyShowsData] = useState(() =>
    readStoredNearbyShows(
      authUser?.id,
      initialNearbyLocation.mode,
      initialNearbyLocation.zip,
    ),
  );
  const [ticketmasterConfigured, setTicketmasterConfigured] = useState(true);
  const [nearbyShowsLoading, setNearbyShowsLoading] = useState(
    () =>
      !readStoredNearbyShows(
        authUser?.id,
        initialNearbyLocation.mode,
        initialNearbyLocation.zip,
      ),
  );
  const [nearbyShowsError, setNearbyShowsError] = useState(null);
  const [nearbyLocationMode, setNearbyLocationMode] = useState(
    initialNearbyLocation.mode,
  );
  const [appliedNearbyZip, setAppliedNearbyZip] = useState(
    initialNearbyLocation.zip,
  );
  const lastDiscoveryWsMessageAtRef = useRef(0);
  const discoveryPollInFlightRef = useRef(false);
  const canAddArtist = hasPermission("addArtist");
  const canAddAlbum = hasPermission("addAlbum");

  const applyDiscoveryData = useCallback(
    (nextValue) => {
      const normalizedData = normalizeDiscoveryData(nextValue);
      if (!normalizedData) return;
      setData(normalizedData);
      writeStoredDiscoveryData(normalizedData, authUser?.id);
    },
    [authUser?.id],
  );

  const fetchAndApplyDiscovery = useCallback(
    (cacheBust = false) =>
      getDiscovery(cacheBust)
        .then((discoveryData) => {
          applyDiscoveryData(discoveryData);
          setError(null);
        })
        .catch(console.warn),
    [applyDiscoveryData],
  );

  const { isConnected: isDiscoverySocketConnected } = useWebSocketChannel(
    "discovery",
    (msg) => {
      if (msg.type !== "discovery_update") return;

      if (msg.phase === "error") {
        setData((prev) =>
          normalizeDiscoveryData({
            ...(prev || {}),
            isUpdating: false,
            updatePhase: "error",
            updateProgress: null,
            updateProgressMessage:
              msg.progressMessage || "Discovery refresh failed",
          }),
        );
        return;
      }

      if (msg.playlistsUpdating || msg.phase === "playlists_building") {
        lastDiscoveryWsMessageAtRef.current = Date.now();
        setData((prev) =>
          normalizeDiscoveryData({
            ...(prev || {}),
            playlistsUpdating: true,
            playlistsUpdateMessage:
              msg.playlistsUpdateMessage ||
              msg.progressMessage ||
              "Updating recommended playlists...",
            isUpdating: false,
            configured: true,
            stale: false,
          }),
        );
        return;
      }

      if (msg.phase === "playlists_completed") {
        lastDiscoveryWsMessageAtRef.current = Date.now();
        setData((prev) =>
          normalizeDiscoveryData({
            ...(prev || {}),
            discoverPlaylists: Array.isArray(msg.discoverPlaylists)
              ? msg.discoverPlaylists
              : prev?.discoverPlaylists || [],
            playlistsUpdating: false,
            playlistsUpdateMessage: null,
            lastUpdated: msg.lastUpdated || prev?.lastUpdated || null,
            configured: true,
            stale: false,
          }),
        );
        fetchAndApplyDiscovery(true);
        return;
      }

      if (msg.phase === "playlists_error") {
        setData((prev) =>
          normalizeDiscoveryData({
            ...(prev || {}),
            playlistsUpdating: false,
            playlistsUpdateMessage: null,
          }),
        );
        return;
      }

      if (msg.isUpdating) {
        lastDiscoveryWsMessageAtRef.current = Date.now();
        setData((prev) =>
          normalizeDiscoveryData({
            ...(prev || {}),
            isUpdating: true,
            updatePhase: msg.phase || prev?.updatePhase || null,
            updateProgress:
              typeof msg.progress === "number"
                ? msg.progress
                : prev?.updateProgress ?? null,
            updateProgressMessage:
              msg.progressMessage || prev?.updateProgressMessage || null,
            provider: msg.provider || prev?.provider || "lastfm",
            capabilities: msg.capabilities || prev?.capabilities || null,
            configured: true,
            stale: false,
          }),
        );
        return;
      }

      if (msg.phase === "completed" || Array.isArray(msg.recommendations)) {
        lastDiscoveryWsMessageAtRef.current = Date.now();
        if (Array.isArray(msg.recommendations)) {
          setData((prev) => {
            const normalized = normalizeDiscoveryData({
              recommendations: msg.recommendations || [],
              globalTop: msg.globalTop || [],
              basedOn: msg.basedOn || [],
              topTags: msg.topTags || [],
              topGenres: msg.topGenres || [],
              fallbackGenres: msg.fallbackGenres || [],
              discoverPlaylists: msg.discoverPlaylists || [],
              provider: msg.provider || "lastfm",
              capabilities: msg.capabilities || null,
              lastUpdated: msg.lastUpdated || null,
              isUpdating: false,
              updatePhase: null,
              updateProgress: null,
              updateProgressMessage: null,
              playlistsUpdating:
                typeof msg.playlistsUpdating === "boolean"
                  ? msg.playlistsUpdating
                  : prev?.playlistsUpdating,
              playlistsUpdateMessage:
                msg.playlistsUpdateMessage ??
                prev?.playlistsUpdateMessage ??
                null,
              recommendationQuality:
                msg.recommendationQuality || prev?.recommendationQuality || null,
              isEnriching:
                typeof msg.isEnriching === "boolean"
                  ? msg.isEnriching
                  : prev?.isEnriching === true,
              discoveryRunId: msg.discoveryRunId || prev?.discoveryRunId || null,
              enrichmentStartedAt:
                msg.enrichmentStartedAt || prev?.enrichmentStartedAt || null,
              enrichmentCompletedAt:
                msg.enrichmentCompletedAt || prev?.enrichmentCompletedAt || null,
              enrichmentProgressMessage:
                msg.enrichmentProgressMessage ??
                prev?.enrichmentProgressMessage ??
                null,
              stale: false,
              discoveryMode:
                msg.discoveryMode === "safer" || msg.discoveryMode === "deeper"
                  ? msg.discoveryMode
                  : "balanced",
              configured: true,
            });
            writeStoredDiscoveryData(normalized, authUser?.id);
            return normalized;
          });
        } else {
          setData((prev) =>
            normalizeDiscoveryData({
              ...(prev || {}),
              isUpdating: false,
              updatePhase: null,
              updateProgress: null,
              updateProgressMessage: null,
              playlistsUpdating:
                typeof msg.playlistsUpdating === "boolean"
                  ? msg.playlistsUpdating
                  : prev?.playlistsUpdating,
              playlistsUpdateMessage:
                msg.playlistsUpdateMessage ?? prev?.playlistsUpdateMessage ?? null,
              recommendationQuality:
                msg.recommendationQuality || prev?.recommendationQuality || null,
              isEnriching:
                typeof msg.isEnriching === "boolean"
                  ? msg.isEnriching
                  : prev?.isEnriching === true,
              discoveryRunId: msg.discoveryRunId || prev?.discoveryRunId || null,
              enrichmentStartedAt:
                msg.enrichmentStartedAt || prev?.enrichmentStartedAt || null,
              enrichmentCompletedAt:
                msg.enrichmentCompletedAt || prev?.enrichmentCompletedAt || null,
              enrichmentProgressMessage:
                msg.enrichmentProgressMessage ??
                prev?.enrichmentProgressMessage ??
                null,
              stale: false,
            }),
          );
        }
        fetchAndApplyDiscovery(true);
      }
    },
  );

  useEffect(() => {
    if (!isDiscoverySocketConnected) return;
    if (!data?.isUpdating && !data?.isEnriching && !data?.stale) return;
    fetchAndApplyDiscovery();
  }, [
    authUser?.id,
    isDiscoverySocketConnected,
    data?.isUpdating,
    data?.isEnriching,
    data?.stale,
    fetchAndApplyDiscovery,
  ]);

  useEffect(() => {
    if (!isDiscoverySocketConnected) return;
    if (!data?.playlistsUpdating) return;
    fetchAndApplyDiscovery(true);
  }, [authUser?.id, isDiscoverySocketConnected, data?.playlistsUpdating, fetchAndApplyDiscovery]);

  useEffect(() => {
    if (!data?.isUpdating && !data?.isEnriching) return;
    const hasRecentWsUpdate =
      Date.now() - lastDiscoveryWsMessageAtRef.current < 20000;
    if (isDiscoverySocketConnected && hasRecentWsUpdate) return;
    const pollDiscovery = () => {
      if (discoveryPollInFlightRef.current) return;
      discoveryPollInFlightRef.current = true;
      fetchAndApplyDiscovery(true)
        .finally(() => {
          discoveryPollInFlightRef.current = false;
        });
    };
    pollDiscovery();
    const id = setInterval(pollDiscovery, 10000);
    return () => clearInterval(id);
  }, [
    authUser?.id,
    data?.isUpdating,
    data?.isEnriching,
    isDiscoverySocketConnected,
    fetchAndApplyDiscovery,
  ]);

  useEffect(() => {
    if (!data?.stale || data?.isUpdating || data?.isEnriching) return;
    if (isDiscoverySocketConnected) return;
    const id = setTimeout(() => {
      fetchAndApplyDiscovery(true);
    }, 15000);
    return () => clearTimeout(id);
  }, [
    authUser?.id,
    data?.stale,
    data?.isUpdating,
    data?.isEnriching,
    isDiscoverySocketConnected,
    fetchAndApplyDiscovery,
  ]);

  useEffect(() => {
    if (!data) return;
    if (data.isUpdating && !data.stale) {
      lastDiscoveryWsMessageAtRef.current = 0;
    }
  }, [data, data?.isUpdating, data?.stale]);

  useEffect(() => {
    getDiscovery()
      .then((discoveryData) => {
        const normalizedData = normalizeDiscoveryData(discoveryData);
        setData(normalizedData);
        writeStoredDiscoveryData(normalizedData, authUser?.id);
        setError(null);
      })
      .catch((err) => {
        setError(
          err.response?.data?.message || "Failed to load discovery data",
        );
        setData({
          recommendations: [],
          globalTop: [],
          basedOn: [],
          topTags: [],
          topGenres: [],
          fallbackGenres: [],
          provider: "lastfm",
          capabilities: null,
          lastUpdated: null,
          isUpdating: false,
          stale: false,
          discoveryMode: "balanced",
          configured: false,
        });
      });

    getRecentlyAdded()
      .then((items) => {
        setRecentlyAdded(items);
        writeStoredRecentlyAdded(items, authUser?.id);
      })
      .catch((err) => {
        showError(err?.message || "Failed to load recently added");
      });

    getRecentReleases()
      .then((items) => {
        setRecentReleases(items);
        writeStoredRecentReleases(items, authUser?.id);
      })
      .catch((err) => {
        showError(err?.message || "Failed to load recent releases");
      });
  }, [authUser?.id, showError]);

  useEffect(() => {
    let cancelled = false;
    const loadBootstrapStatus = async () => {
      try {
        const bootstrap = await getBootstrapStatus();
        if (!cancelled) {
          setTicketmasterConfigured(!!bootstrap.ticketmasterConfigured);
        }
      } catch {
        if (!cancelled) {
          setTicketmasterConfigured(true);
        }
      }
    };
    loadBootstrapStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const storedMode = localStorage.getItem(DISCOVER_NEARBY_MODE_KEY);
      const storedZip = localStorage.getItem(DISCOVER_NEARBY_ZIP_KEY) || "";
      if (storedMode === "zip" || storedMode === "ip") {
        setNearbyLocationMode(storedMode);
      }
      setAppliedNearbyZip(storedZip);
    } catch {}
  }, [authUser?.id]);

  useEffect(() => {
    if (!ticketmasterConfigured) {
      setNearbyShowsData(null);
      setNearbyShowsError(null);
      setNearbyShowsLoading(false);
      return;
    }
    const shouldUseZip = nearbyLocationMode === "zip";
    if (shouldUseZip && !appliedNearbyZip.trim()) {
      setNearbyShowsData(null);
      setNearbyShowsError(null);
      setNearbyShowsLoading(false);
      return;
    }
    const locationMode = shouldUseZip ? "zip" : "ip";
    const locationZip = shouldUseZip ? appliedNearbyZip : "";
    const cachedNearbyShows = readStoredNearbyShows(
      authUser?.id,
      locationMode,
      locationZip,
    );
    if (cachedNearbyShows) {
      setNearbyShowsData(cachedNearbyShows);
    }
    let cancelled = false;
    setNearbyShowsLoading(!cachedNearbyShows);
    setNearbyShowsError(null);
    getNearbyShows(locationZip)
      .then((response) => {
        if (cancelled) return;
        setNearbyShowsData(response);
        writeStoredNearbyShows(
          response,
          authUser?.id,
          locationMode,
          locationZip,
        );
        setNearbyShowsError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        if (!cachedNearbyShows) {
          setNearbyShowsError(
            err.response?.data?.message || "Failed to load nearby shows",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setNearbyShowsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    authUser?.id,
    nearbyLocationMode,
    appliedNearbyZip,
    ticketmasterConfigured,
  ]);

  const getLibraryArtistImage = (artist) => {
    if (artist.images && artist.images.length > 0) {
      const posterImage = artist.images.find(
        (img) => img.coverType === "poster" || img.coverType === "fanart",
      );
      const image = posterImage || artist.images[0];
      return image?.remoteUrl || image?.url || null;
    }
    return null;
  };

  const getRecentReleaseKey = useCallback(
    (album) => album.mbid || album.foreignAlbumId || album.id,
    [],
  );

  const handleAddArtistToLibrary = useCallback(
    async (artist) => {
      const artistId = getArtistId(artist);
      if (!artist?.name || !artistId) return false;
      try {
        await addArtistToLibrary({
          foreignArtistId: artistId,
          artistName: artist.name,
        });
        setLibraryLookup((prev) => ({
          ...prev,
          [artistId]: true,
        }));
        showSuccess(`Adding ${artist.name}...`);
        return true;
      } catch (err) {
        showError(
          err.response?.data?.message ||
            err.response?.data?.error ||
            err.message ||
            "Failed to add artist to library",
        );
        return false;
      }
    },
    [showError, showSuccess],
  );

  const handleRecentReleaseAlbumAction = useCallback(
    async (album) => {
      const albumKey = getRecentReleaseKey(album);
      if (!album?.id || !album?.artistId || !albumKey) return;
      setPendingRecentReleaseIds((prev) => ({ ...prev, [albumKey]: true }));
      try {
        await updateLibraryAlbum(album.id, {
          ...album,
          monitored: true,
        });
        await downloadAlbum(album.artistId, album.id, {
          artistMbid: album.artistMbid || album.foreignArtistId,
          artistName: album.artistName,
        });
        showSuccess(`Searching for ${album.albumName || "album"}`);
      } catch (err) {
        showError(
          err.response?.data?.message ||
            err.response?.data?.error ||
            err.message ||
            "Failed to request album",
        );
      } finally {
        setPendingRecentReleaseIds(({ [albumKey]: _, ...prev }) => prev);
      }
    },
    [getRecentReleaseKey, showError, showSuccess],
  );

  const handleDiscoveryFeedback = useCallback(
    (artist, action, options = {}) => submitFeedback(artist, action, options),
    [submitFeedback],
  );

  return {
    authUser,
    data,
    recentlyAdded,
    recentReleases,
    pendingRecentReleaseIds,
    error,
    libraryLookup,
    setLibraryLookup,
    artistFeedbackLookup,
    nearbyShowsData,
    ticketmasterConfigured,
    nearbyShowsLoading,
    nearbyShowsError,
    nearbyLocationMode,
    setNearbyLocationMode,
    appliedNearbyZip,
    setAppliedNearbyZip,
    canAddArtist,
    canAddAlbum,
    isDiscoverySocketConnected,
    applyDiscoveryData,
    fetchAndApplyDiscovery,
    getLibraryArtistImage,
    getRecentReleaseKey,
    handleAddArtistToLibrary,
    handleRecentReleaseAlbumAction,
    handleDiscoveryFeedback,
    lastDiscoveryWsMessageAtRef,
  };
}
