import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Check,
  Loader2,
  Play,
  FilePlus2,
  Download,
  Trash2,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  getFlowJobs,
  createFlow,
  updateFlow,
  deleteFlow,
  createSharedPlaylist,
  addSharedPlaylistTracks,
  convertFlowToStaticPlaylist,
  deleteSharedPlaylist,
  importSharedPlaylist,
  updateSharedPlaylist,
  deleteSharedPlaylistTrack,
  setFlowEnabled,
  startFlowPlaylist,
  getFlowTrackStreamUrl,
  getFlowArtworkUrl,
  uploadFlowArtwork,
  deleteFlowArtwork,
  generateFlowArtwork,
  reSearchSharedPlaylistTrack,
} from "../utils/api";
import {
  CreatePlaylistModal,
  RenamePlaylistModal,
} from "../components/PlaylistModals";
import PillToggle from "../components/PillToggle";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useFlowStatus } from "./flows/useFlowStatus";
import {
  formatTrackCountLabel,
  formatFlowLastRun,
  getFlowDisplayTrackCount,
  isReleaseRadarFlow,
} from "./flows/flowStats";
import { getPlaylistRunActivity } from "./flows/flowRunActivity";
import { omitKey } from "../utils/object";
import {
  PlaylistLibraryItem,
  PlaylistDetailHero,
  FlowDetailTabs,
  FlowLibraryCreateMenu,
  LibrarySidebarToggleIcon,
} from "./flows/FlowPlaylistUI";
import {
  FlowEmptyState,
  FlowDetailPlaceholder,
  ConfirmDeleteModal,
  ConfirmDisableModal,
  FlowImportReviewModal,
  FlowFormFields,
  ReleaseRadarRecipeFields,
  FlowTracksPanel,
  MoreMenu,
} from "./FlowPageComponents";
import {
  NEW_FLOW_TEMPLATE,
  buildFlowFromForm,
  buildReleaseRadarFlowFromForm,
  buildSharedTracklistPayload,
  buildTrackForPlaylistModal,
  downloadFlowShareBundle,
  flowToForm,
  formatFlowLastRunShort,
  formatNextRun,
  formatNextRunShort,
  getNextFlowName,
  getUnavailableFlowSourceMessage,
  isFlowDirty,
  isReleaseRadarFlowDirty,
  normalizeMixPercent,
  normalizeNameKey,
  parseFlowImportFile,
  reserveUniqueFlowName,
  slugifyFilePart,
} from "./flows/flowPageUtils";

const LIBRARY_SIDEBAR_COLLAPSED_KEY = "aurral.playlists.sidebarCollapsed";

function readLibrarySidebarCollapsed() {
  try {
    return (
      globalThis.localStorage?.getItem(LIBRARY_SIDEBAR_COLLAPSED_KEY) === "1"
    );
  } catch {
    return false;
  }
}

const FLOW_MOBILE_LAYOUT_QUERY = "(max-width: 767px)";

function useFlowMobileLayout() {
  const [isMobileLayout, setIsMobileLayout] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(FLOW_MOBILE_LAYOUT_QUERY).matches
      : false,
  );

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return undefined;
    }
    const mediaQuery = window.matchMedia(FLOW_MOBILE_LAYOUT_QUERY);
    const handleChange = (event) => setIsMobileLayout(event.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return isMobileLayout;
}

function FlowPage() {
  useDocumentTitle("Playlists");
  const navigate = useNavigate();
  const location = useLocation();
  const {
    status,
    loading,
    fetchStatus,
    getPlaylistStats,
    getPlaylistState,
    countdownNow,
    sharedPlaylists,
    flows: flowList,
  } = useFlowStatus();
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmDisable, setConfirmDisable] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [libraryFilter, setLibraryFilter] = useState("all");
  const [libraryCollapsed, setLibraryCollapsed] = useState(
    readLibrarySidebarCollapsed,
  );
  const [detailTab, setDetailTab] = useState("tracks");
  const [mobileShowDetail, setMobileShowDetail] = useState(false);
  const isMobileLayout = useFlowMobileLayout();
  const [optimisticEnabled, setOptimisticEnabled] = useState({});
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [convertingId, setConvertingId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [togglingToEnabled, setTogglingToEnabled] = useState(null);
  const [rerunningId, setRerunningId] = useState(null);
  const [renameModal, setRenameModal] = useState(null);
  const [artworkRevisionById, setArtworkRevisionById] = useState({});
  const [coverArtworkBusyId, setCoverArtworkBusyId] = useState(null);
  const [coverArtworkError, setCoverArtworkError] = useState("");
  const [simpleDrafts, setSimpleDrafts] = useState({});
  const [simpleErrors, setSimpleErrors] = useState({});
  const [sharedPlaylistDrafts, setSharedPlaylistDrafts] = useState({});
  const [sharedPlaylistErrors, setSharedPlaylistErrors] = useState({});
  const [applyingFlowId, setApplyingFlowId] = useState(null);
  const [applyingFlowNameId, setApplyingFlowNameId] = useState(null);
  const [applyingSharedPlaylistNameId, setApplyingSharedPlaylistNameId] = useState(null);
  const [reSearchingTrackIds, setReSearchingTrackIds] = useState({});
  const [savingToPlaylistId, setSavingToPlaylistId] = useState(null);
  const [deletingTrackId, setDeletingTrackId] = useState(null);
  const [tracksLoadingByFlowId, setTracksLoadingByFlowId] = useState({});
  const [tracksErrorByFlowId, setTracksErrorByFlowId] = useState({});
  const [tracksByFlowId, setTracksByFlowId] = useState({});
  const [importReview, setImportReview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [isCreatePlaylistOpen, setIsCreatePlaylistOpen] = useState(false);
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [createPlaylistError, setCreatePlaylistError] = useState("");
  const [playlistMenuSavingKey, setPlaylistMenuSavingKey] = useState("");
  const [playlistMenuError, setPlaylistMenuError] = useState("");
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const importInputRef = useRef(null);
  const { user } = useAuth();
  const { showSuccess, showError } = useToast();
  const disabledFlowSources = status?.capabilities?.unavailableSources || {};
  const canCreateGeneratedFlow =
    Object.keys(disabledFlowSources).length === 0;

  useEffect(() => {
    if (!status?.flows?.length) return;
    setSimpleDrafts((prev) => {
      const next = { ...prev };
      for (const flow of status.flows) {
        const normalized = flowToForm(flow);
        if (!next[flow.id]) {
          next[flow.id] = normalized;
          continue;
        }
        next[flow.id] = {
          ...normalized,
          ...next[flow.id],
        };
      }
      return next;
    });
  }, [status?.flows]);

  useEffect(() => {
    if (!status?.sharedPlaylists?.length) return;
    setSharedPlaylistDrafts((prev) => {
      const next = { ...prev };
      for (const playlist of status.sharedPlaylists) {
        if (typeof next[playlist.id] !== "string") {
          next[playlist.id] = playlist.name || "";
        }
      }
      return next;
    });
  }, [status?.sharedPlaylists]);

  const handleCancelSimple = (flow) => {
    setSimpleDrafts((prev) => ({
      ...prev,
      [flow.id]: flowToForm(flow),
    }));
    setSimpleErrors((prev) => omitKey(prev, flow.id));
    setDetailTab("tracks");
  };

  const handleApplySimple = async (flow) => {
    setApplyingFlowId(flow.id);
    setSimpleErrors((prev) => omitKey(prev, flow.id));
    try {
      const draft = simpleDrafts[flow.id] || flowToForm(flow);
      if (!isReleaseRadarFlow(flow)) {
        const sourceError = getUnavailableFlowSourceMessage(
          draft,
          disabledFlowSources,
        );
        if (sourceError) {
          throw new Error(sourceError);
        }
      }
      const payload = isReleaseRadarFlow(flow)
        ? buildReleaseRadarFlowFromForm(flow, draft)
        : buildFlowFromForm(draft);
      const response = await updateFlow(flow.id, payload);
      const updatedFlow = response?.flow || {
        ...flow,
        ...payload,
      };
      setSimpleDrafts((prev) => ({
        ...prev,
        [flow.id]: flowToForm(updatedFlow),
      }));
      setDetailTab("tracks");
      showSuccess("Flow updated");
      await fetchStatus();
    } catch (err) {
      const message =
        err.response?.data?.message || err.message || "Failed to update flow";
      setSimpleErrors((prev) => ({ ...prev, [flow.id]: message }));
      showError(message);
    } finally {
      setApplyingFlowId(null);
    }
  };

  const handleApplyFlowNameEdit = async (flow, nameOverride) => {
    if (!flow?.id) return;
    setApplyingFlowNameId(flow.id);
    setSimpleErrors((prev) => omitKey(prev, flow.id));
    try {
      const currentDraft = simpleDrafts[flow.id] ?? flowToForm(flow);
      if (!isReleaseRadarFlow(flow)) {
        const sourceError = getUnavailableFlowSourceMessage(
          currentDraft,
          disabledFlowSources,
        );
        if (sourceError) {
          throw new Error(sourceError);
        }
      }
      const nextName =
        nameOverride !== undefined
          ? String(nameOverride).trim()
          : String(currentDraft?.name ?? flow.name ?? "").trim();
      const payload = isReleaseRadarFlow(flow)
        ? {
            ...buildReleaseRadarFlowFromForm(flow, currentDraft),
            name: nextName,
          }
        : buildFlowFromForm({
            ...flowToForm(flow),
            name: nextName,
          });
      const response = await updateFlow(flow.id, payload);
      const updatedFlow = response?.flow || {
        ...flow,
        ...payload,
      };
      setSimpleDrafts((prev) => ({
        ...prev,
        [flow.id]: {
          ...(prev[flow.id] ?? flowToForm(updatedFlow)),
          name: updatedFlow.name || "",
        },
      }));
      showSuccess("Flow updated");
      await fetchStatus();
      return true;
    } catch (err) {
      const message =
        err.response?.data?.message || err.message || "Failed to update flow";
      setSimpleErrors((prev) => ({ ...prev, [flow.id]: message }));
      showError(message);
      return false;
    } finally {
      setApplyingFlowNameId(null);
    }
  };

  const handleCreateInline = async () => {
    if (creating) return;
    if (!canCreateGeneratedFlow) {
      showError("Flows require a Last.fm API key in this version");
      return;
    }
    setCreating(true);
    try {
      const uniqueName = getNextFlowName(status?.flows, NEW_FLOW_TEMPLATE.name);
      const draft = flowToForm({
        ...NEW_FLOW_TEMPLATE,
        name: uniqueName,
      });
      const payload = buildFlowFromForm(draft);
      const response = await createFlow(payload);
      const createdFlow = response?.flow;
      if (createdFlow?.id) {
        setSimpleDrafts((prev) => ({
          ...prev,
          [createdFlow.id]: flowToForm(createdFlow),
        }));
        setSelectedId(createdFlow.id);
        setDetailTab("recipe");
        setMobileShowDetail(true);
      }
      showSuccess("Flow created");
      await fetchStatus();
    } catch (err) {
      const message =
        err.response?.data?.message || err.message || "Failed to create flow";
      showError(message);
    } finally {
      setCreating(false);
    }
  };

  const handleOpenCreatePlaylist = () => {
    setCreatePlaylistError("");
    setIsCreatePlaylistOpen(true);
  };

  const handleCreatePlaylist = async (name) => {
    setCreatingPlaylist(true);
    setCreatePlaylistError("");
    try {
      await createSharedPlaylist({ name });
      showSuccess("Playlist created");
      setIsCreatePlaylistOpen(false);
      await fetchStatus();
    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        "Failed to create playlist";
      setCreatePlaylistError(message);
      showError(message);
    } finally {
      setCreatingPlaylist(false);
    }
  };

  const handleDelete = async (flow) => {
    setConfirmDelete({
      flowId: flow.id,
      title: flow.name,
      kind: "flow",
    });
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    setDeletingId(confirmDelete.flowId);
    try {
      if (confirmDelete.kind === "shared") {
        await deleteSharedPlaylist(confirmDelete.flowId);
        showSuccess("Shared playlist deleted");
      } else {
        await deleteFlow(confirmDelete.flowId);
        showSuccess("Flow deleted");
      }
      await fetchStatus();
      if (selectedId === confirmDelete.flowId) {
        setSelectedId(null);
        setMobileShowDetail(false);
      }
    } catch (err) {
      showError(
        err.response?.data?.message ||
          err.message ||
          (confirmDelete.kind === "shared"
            ? "Failed to delete shared playlist"
            : "Failed to delete flow")
      );
    } finally {
      setDeletingId(null);
    }
    setConfirmDelete(null);
  };

  const fetchFlowTracks = useCallback(
    async (flowId, { showSpinner = true, signal } = {}) => {
      if (!flowId) return;
      if (showSpinner) {
        setTracksLoadingByFlowId((prev) => ({ ...prev, [flowId]: true }));
      }
      setTracksErrorByFlowId((prev) => ({ ...prev, [flowId]: "" }));
      try {
        const jobs = await getFlowJobs(flowId, null, { signal });
        if (signal?.aborted) return;
        const normalized = (Array.isArray(jobs) ? jobs : [])
          .map((job) => ({
            ...job,
            albumName: job?.albumName || null,
            reason: job?.reason || null,
            streamUrl:
              job?.status === "done" && job?.id
                ? getFlowTrackStreamUrl(job.id)
                : null,
          }));
        setTracksByFlowId((prev) => ({
          ...prev,
          [flowId]: normalized,
        }));
      } catch (err) {
        if (signal?.aborted) return;
        const message =
          err.response?.data?.message || err.message || "Failed to load tracks";
        setTracksErrorByFlowId((prev) => ({ ...prev, [flowId]: message }));
        showError(message);
      } finally {
        if (showSpinner && !signal?.aborted) {
          setTracksLoadingByFlowId((prev) => ({ ...prev, [flowId]: false }));
        }
      }
    },
    [showError],
  );

  const handleToggleEnabled = async (flow, nextEnabled) => {
    setTogglingId(flow.id);
    setTogglingToEnabled(nextEnabled);
    try {
      await setFlowEnabled(flow.id, nextEnabled);
      showSuccess(nextEnabled ? "Flow enabled" : "Flow disabled");
      await fetchStatus();
    } catch (err) {
      showError(
        err.response?.data?.message || err.message || "Failed to update flow"
      );
    } finally {
      setOptimisticEnabled((prev) => omitKey(prev, flow.id));
      setTogglingId(null);
      setTogglingToEnabled(null);
    }
  };

  const handleRunNow = async (flow) => {
    if (!flow?.id || flow.enabled !== true) return;
    setRerunningId(flow.id);
    try {
      const response = await startFlowPlaylist(flow.id, flow.size);
      const tracksQueued = Number(response?.tracksQueued || 0);
      showSuccess(
        tracksQueued > 0
          ? `${flow.name} queued ${tracksQueued} tracks`
          : `${flow.name} run started`,
      );
      await fetchStatus();
      if (selectedId === flow.id) {
        await fetchFlowTracks(flow.id, { showSpinner: false });
      }
    } catch (err) {
      showError(
        err.response?.data?.message ||
          err.response?.data?.error ||
          err.message ||
          "Failed to run flow",
      );
    } finally {
      setRerunningId(null);
    }
  };

  const handleToggleRequest = (flow, nextEnabled) => {
    if (!nextEnabled) {
      setConfirmDisable({ flowId: flow.id, title: flow.name });
      return;
    }
    setOptimisticEnabled((prev) => ({ ...prev, [flow.id]: true }));
    handleToggleEnabled(flow, true);
  };

  const getNextPlaylistName = useCallback(
    (baseName = "Playlist") => {
      const reservedNames = new Set(
        sharedPlaylists
          .map((playlist) => normalizeNameKey(playlist?.name))
          .filter(Boolean),
      );
      return reserveUniqueFlowName(reservedNames, baseName);
    },
    [sharedPlaylists],
  );
  const effectiveFlowList = useMemo(
    () =>
      flowList.map((flow) => {
        const optimisticValue = optimisticEnabled[flow.id];
        if (typeof optimisticValue !== "boolean") return flow;
        return {
          ...flow,
          enabled: optimisticValue,
        };
      }),
    [flowList, optimisticEnabled],
  );

  const collection = useMemo(() => {
    const shared = sharedPlaylists.map((playlist) => ({
      ...playlist,
      kind: "shared",
    }));
    const generated = effectiveFlowList.map((flow) => ({
      ...flow,
      kind: "flow",
    }));
    return [...shared, ...generated];
  }, [sharedPlaylists, effectiveFlowList]);

  const filteredCollection = useMemo(() => {
    if (libraryFilter === "playlists") {
      return collection.filter((entry) => entry.kind === "shared");
    }
    if (libraryFilter === "flows") {
      return collection.filter((entry) => entry.kind === "flow");
    }
    return collection;
  }, [collection, libraryFilter]);

  const selectedEntry = useMemo(
    () => collection.find((entry) => entry.id === selectedId) || null,
    [collection, selectedId],
  );

  useEffect(() => {
    const navPlaylistId = location.state?.selectedPlaylistId;
    if (navPlaylistId) {
      const navEntry = collection.find((entry) => entry.id === navPlaylistId);
      if (
        navEntry &&
        !filteredCollection.some((entry) => entry.id === navPlaylistId)
      ) {
        setLibraryFilter("all");
        return;
      }
    }
    if (!filteredCollection.length) {
      if (!navPlaylistId && selectedId) {
        setSelectedId(null);
        setMobileShowDetail(false);
      }
      return;
    }
    if (
      isMobileLayout &&
      selectedId &&
      !filteredCollection.some((entry) => entry.id === selectedId)
    ) {
      setSelectedId(null);
      setMobileShowDetail(false);
      return;
    }
    if (
      navPlaylistId &&
      filteredCollection.some((entry) => entry.id === navPlaylistId)
    ) {
      setSelectedId(navPlaylistId);
      setMobileShowDetail(true);
      setDetailTab("tracks");
      navigate(location.pathname, { replace: true, state: {} });
      return;
    }
    if (
      !isMobileLayout &&
      (!selectedId ||
        !filteredCollection.some((entry) => entry.id === selectedId))
    ) {
      setSelectedId(filteredCollection[0].id);
    }
  }, [
    collection,
    filteredCollection,
    isMobileLayout,
    location.pathname,
    location.state?.selectedPlaylistId,
    navigate,
    selectedId,
  ]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    fetchFlowTracks(selectedId, { signal: controller.signal });
    return () => controller.abort();
  }, [selectedId, fetchFlowTracks]);

  const selectPlaylist = (entry) => {
    if (
      isMobileLayout &&
      selectedId === entry.id &&
      mobileShowDetail
    ) {
      setMobileShowDetail(false);
      return;
    }
    setSelectedId(entry.id);
    if (isMobileLayout) {
      setMobileShowDetail(true);
    }
    setDetailTab("tracks");
    setRenameModal(null);
  };

  const handleConfirmDisable = async () => {
    if (!confirmDisable) return;
    const flow = flowList.find((entry) => entry.id === confirmDisable.flowId);
    if (flow) {
      setOptimisticEnabled((prev) => ({ ...prev, [flow.id]: false }));
      await handleToggleEnabled(flow, false);
    }
    setConfirmDisable(null);
  };

  const exportTracklist = async ({
    playlistId,
    playlistName,
    sourceName = null,
    sourceFlowId = null,
  }) => {
    if (!playlistId) return;
    const jobs = await getFlowJobs(playlistId);
    const tracks = (Array.isArray(jobs) ? jobs : [])
      .filter((job) => job?.status !== "failed")
      .map((job) => ({
        artistName: job.artistName,
        trackName: job.trackName,
        albumName: job.albumName || null,
        artistMbid: job.artistMbid || null,
        albumMbid: job.albumMbid || null,
        trackMbid: job.trackMbid || null,
        releaseYear: job.releaseYear || null,
        durationMs: job.durationMs || null,
        artistAliases: job.artistAliases || [],
      }))
      .filter((track) => track.artistName && track.trackName);
    if (tracks.length === 0) {
      throw new Error("No generated tracks available to export yet");
    }
    downloadFlowShareBundle(
      `aurral-tracklist-${slugifyFilePart(playlistName)}.json`,
      buildSharedTracklistPayload({
        name: playlistName,
        sourceName: sourceName || playlistName,
        sourceFlowId,
        tracks,
      }),
    );
  };

  const handleExportFlow = async (flow) => {
    if (!flow) return;
    try {
      await exportTracklist({
        playlistId: flow.id,
        playlistName: flow.name,
        sourceName: flow.name,
        sourceFlowId: flow.id,
      });
      showSuccess(`Exported ${flow.name} tracklist`);
    } catch (error) {
      showError(error?.message || "Failed to export tracklist");
    }
  };

  const handleOpenImportPicker = () => {
    if (importInputRef.current) {
      importInputRef.current.value = "";
      importInputRef.current.click();
    }
  };

  const handleImportFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      const flows = parseFlowImportFile(content).map((flow) => ({
        ...flow,
        importName: flow?.name || "",
      }));
      setImportReview({
        fileName: file.name,
        flows,
      });
    } catch (error) {
      showError(error?.message || "Failed to read tracklist file");
    } finally {
      event.target.value = "";
    }
  };

  const handleConfirmImport = async () => {
    if (!importReview || importing) return;
    setImporting(true);
    const reservedNames = new Set(
      (status?.sharedPlaylists || [])
        .map((playlist) => normalizeNameKey(playlist?.name))
        .filter(Boolean),
    );
    let importedCount = 0;
    let renamedCount = 0;
    const failed = [];

    for (const payload of importReview.flows) {
      const desiredName = String(payload?.importName ?? payload?.name ?? "").trim();
      const baseName = desiredName || String(payload?.name || "").trim();
      const finalName = reserveUniqueFlowName(reservedNames, baseName);
      if (finalName !== baseName) {
        renamedCount += 1;
      }
      try {
        await importSharedPlaylist({
          name: finalName,
          sourceName: payload?.sourceName || null,
          sourceFlowId: payload?.sourceFlowId || null,
          tracks: payload?.tracks || [],
        });
        importedCount += 1;
      } catch (error) {
        failed.push({
          name: finalName,
          message:
            error?.response?.data?.message ||
            error?.response?.data?.error ||
            error?.message ||
            "Failed to import tracklist",
        });
      }
    }

    try {
      await fetchStatus();
    } finally {
      setImporting(false);
    }

    if (importedCount > 0) {
      showSuccess(
        `${importedCount} ${importedCount === 1 ? "tracklist" : "tracklists"} imported${renamedCount > 0 ? ` • ${renamedCount} renamed` : ""}`,
      );
      setImportReview(null);
    }
    if (failed.length > 0) {
      const first = failed[0];
      showError(
        failed.length === 1
          ? `${first.name}: ${first.message}`
          : `${failed.length} imports failed. First issue: ${first.name} - ${first.message}`,
      );
    }
  };

  const handleDeleteSharedPlaylist = (playlist) => {
    if (!playlist) return;
    setConfirmDelete({
      flowId: playlist.id,
      title: playlist.name,
      kind: "shared",
    });
  };

  const handleApplySharedPlaylist = async (playlist, nameOverride) => {
    if (!playlist) return;
    setApplyingSharedPlaylistNameId(playlist.id);
    setSharedPlaylistErrors((prev) => omitKey(prev, playlist.id));
    try {
      const name =
        nameOverride !== undefined
          ? String(nameOverride).trim()
          : String(sharedPlaylistDrafts[playlist.id] ?? playlist.name ?? "").trim();
      const response = await updateSharedPlaylist(playlist.id, { name });
      const updatedPlaylist = response?.playlist || { ...playlist, name };
      setSharedPlaylistDrafts((prev) => ({
        ...prev,
        [playlist.id]: updatedPlaylist.name || "",
      }));
      showSuccess("Static playlist updated");
      await fetchStatus();
      return true;
    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.message ||
        "Failed to update static playlist";
      setSharedPlaylistErrors((prev) => ({
        ...prev,
        [playlist.id]: message,
      }));
      showError(message);
      return false;
    } finally {
      setApplyingSharedPlaylistNameId(null);
    }
  };

  const handleConvertFlowToStatic = async (flow) => {
    if (!flow || convertingId) return;
    setConvertingId(flow.id);
    try {
      const reservedNames = new Set(
        (status?.sharedPlaylists || [])
          .map((playlist) => normalizeNameKey(playlist?.name))
          .filter(Boolean),
      );
      const playlistName = reserveUniqueFlowName(
        reservedNames,
        `${flow.name} Static`,
      );
      const response = await convertFlowToStaticPlaylist(flow.id, {
        name: playlistName,
      });
      showSuccess(
        `Saved ${flow.name} as static playlist${response?.playlist?.name ? `: ${response.playlist.name}` : ""}`,
      );
      await fetchStatus();
    } catch (err) {
      showError(
        err.response?.data?.message ||
          err.response?.data?.error ||
          err.message ||
          "Failed to create static playlist",
      );
    } finally {
      setConvertingId(null);
    }
  };

  const loadPlaylistsForMenu = useCallback(async () => {
    setPlaylistsLoading(true);
    setPlaylistMenuError("");
    try {
      await fetchStatus();
    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        "Failed to load playlists";
      setPlaylistMenuError(message);
      showError(message);
    } finally {
      setPlaylistsLoading(false);
    }
  }, [fetchStatus, showError]);

  const getDefaultTrackPlaylistName = (track) =>
    getNextPlaylistName(`${track?.artistName || "Artist"} Picks`);

  const saveTrackToPlaylist = async (
    track,
    target,
    { moveFromPlaylistId = null } = {},
  ) => {
    const payload = buildTrackForPlaylistModal(track);
    if (!payload) {
      showError("Track details are incomplete");
      return;
    }
    setPlaylistMenuError("");
    setPlaylistMenuSavingKey(String(track?.id ?? ""));
    const targetPlaylistId =
      target?.mode === "new"
        ? null
        : String(target?.playlistId || "").trim() || null;
    if (targetPlaylistId) {
      setSavingToPlaylistId(targetPlaylistId);
    }
    const sourceTrackJobId = track?.id || null;
    try {
      if (target?.mode === "new") {
        const name =
          String(target?.name || "").trim() ||
          getNextPlaylistName(`${payload.artistName} Picks`);
        const response = await createSharedPlaylist({
          name,
          tracks: [payload],
        });
        if (moveFromPlaylistId && sourceTrackJobId) {
          await deleteSharedPlaylistTrack(moveFromPlaylistId, sourceTrackJobId);
          showSuccess(
            `Track moved to ${response?.playlist?.name || name}`,
          );
        } else {
          showSuccess(
            `Track saved to ${response?.playlist?.name || name}`,
          );
        }
      } else {
        const targetPlaylist = sharedPlaylists.find(
          (playlist) => playlist.id === target?.playlistId,
        );
        await addSharedPlaylistTracks(target.playlistId, {
          tracks: [payload],
        });
        if (moveFromPlaylistId && sourceTrackJobId) {
          await deleteSharedPlaylistTrack(moveFromPlaylistId, sourceTrackJobId);
          showSuccess(
            `Track moved to ${targetPlaylist?.name || "playlist"}`,
          );
        } else {
          showSuccess(
            `Track added to ${targetPlaylist?.name || "playlist"}`,
          );
        }
      }
      await fetchStatus();
      if (selectedId) {
        await fetchFlowTracks(selectedId, { showSpinner: false });
      }
    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        "Failed to save track to playlist";
      setPlaylistMenuError(message);
      showError(message);
    } finally {
      setPlaylistMenuSavingKey("");
      setSavingToPlaylistId(null);
    }
  };

  const handleAddTrackToPlaylist = (track, target) =>
    saveTrackToPlaylist(track, target);

  const handleMoveTrackToPlaylist = (track, target, moveFromPlaylistId) =>
    saveTrackToPlaylist(track, target, { moveFromPlaylistId });

  const bumpArtworkRevision = useCallback((playlistId) => {
    if (!playlistId) return;
    setArtworkRevisionById((prev) => ({
      ...prev,
      [playlistId]: (prev[playlistId] || 0) + 1,
    }));
  }, []);

  const artworkUrlFor = useCallback(
    (playlistId) =>
      getFlowArtworkUrl(playlistId, artworkRevisionById[playlistId]),
    [artworkRevisionById],
  );

  const handleOpenEditModal = (entry) => {
    const target = entry || selectedEntry;
    if (!target) return;
    if (target.id !== selectedId) {
      selectPlaylist(target);
    }
    setCoverArtworkError("");
    if (target.kind === "flow") {
      setSimpleErrors((prev) => omitKey(prev, target.id));
      setRenameModal({
        kind: "flow",
        id: target.id,
        name: target.name || "",
      });
      return;
    }
    setSharedPlaylistErrors((prev) => omitKey(prev, target.id));
    setRenameModal({
      kind: "shared",
      id: target.id,
      name: target.name || "",
    });
  };

  const handleUploadCover = async (file) => {
    const playlistId = renameModal?.id;
    if (!playlistId || !file) return;
    setCoverArtworkBusyId(playlistId);
    setCoverArtworkError("");
    try {
      await uploadFlowArtwork(playlistId, file);
      bumpArtworkRevision(playlistId);
      showSuccess("Cover updated");
    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.message ||
        "Failed to upload cover";
      setCoverArtworkError(message);
      showError(message);
    } finally {
      setCoverArtworkBusyId(null);
    }
  };

  const handleRemoveCover = async () => {
    const playlistId = renameModal?.id;
    if (!playlistId) return;
    setCoverArtworkBusyId(playlistId);
    setCoverArtworkError("");
    try {
      await deleteFlowArtwork(playlistId);
      bumpArtworkRevision(playlistId);
      showSuccess("Cover removed");
    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.message ||
        "Failed to remove cover";
      setCoverArtworkError(message);
      showError(message);
    } finally {
      setCoverArtworkBusyId(null);
    }
  };

  const handleGenerateCover = async () => {
    const playlistId = renameModal?.id;
    if (!playlistId) return;
    setCoverArtworkBusyId(playlistId);
    setCoverArtworkError("");
    try {
      await generateFlowArtwork(playlistId);
      bumpArtworkRevision(playlistId);
      showSuccess("Cover generated");
    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.message ||
        "Failed to generate cover";
      setCoverArtworkError(message);
      showError(message);
    } finally {
      setCoverArtworkBusyId(null);
    }
  };

  const handleRenameModalSubmit = async (nextName) => {
    if (!renameModal) return;
    if (renameModal.kind === "flow") {
      const flow = effectiveFlowList.find((entry) => entry.id === renameModal.id);
      if (!flow) return;
      const saved = await handleApplyFlowNameEdit(flow, nextName);
      if (saved) setRenameModal(null);
      return;
    }
    const playlist = sharedPlaylists.find((entry) => entry.id === renameModal.id);
    if (!playlist) return;
    const saved = await handleApplySharedPlaylist(playlist, nextName);
    if (saved) setRenameModal(null);
  };

  const handleDeleteSharedPlaylistTrack = async (playlistId, track) => {
    const jobId = track?.id;
    if (!playlistId || !jobId || deletingTrackId === jobId) return;
    setDeletingTrackId(jobId);
    try {
      await deleteSharedPlaylistTrack(playlistId, jobId);
      showSuccess(`Removed ${track.trackName || "track"}`);
      await fetchStatus();
      await fetchFlowTracks(playlistId, { showSpinner: false });
    } catch (err) {
      showError(
        err.response?.data?.message ||
          err.response?.data?.error ||
          err.message ||
          "Failed to remove track",
      );
    } finally {
      setDeletingTrackId(null);
    }
  };

  const handleReSearchSharedPlaylistTrack = async (playlistId, track) => {
    const jobId = track?.id;
    if (!playlistId || !jobId || reSearchingTrackIds[jobId]) return;
    setReSearchingTrackIds((prev) => ({
      ...prev,
      [jobId]: true,
    }));
    setTracksByFlowId((prev) => {
      const existing = Array.isArray(prev[playlistId]) ? prev[playlistId] : [];
      return {
        ...prev,
        [playlistId]: existing.map((entry) =>
          entry?.id === jobId
            ? {
                ...entry,
                status: "pending",
                error: null,
                streamUrl: null,
              }
            : entry,
        ),
      };
    });
    try {
      await reSearchSharedPlaylistTrack(playlistId, jobId);
      showSuccess(`Re-searching ${track.trackName}`);
      await fetchStatus();
      await fetchFlowTracks(playlistId, { showSpinner: false });
    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        "Failed to re-search track";
      showError(message);
      await fetchFlowTracks(playlistId, { showSpinner: false });
    } finally {
      setReSearchingTrackIds((prev) => omitKey(prev, jobId));
    }
  };

  const handleNavigateArtist = (track) => {
    if (!track?.artistMbid) return;
    navigate(`/artist/${track.artistMbid}`, {
      state: { artistName: track.artistName },
    });
  };
  if (loading && !status) {
    return (
      <div className="flow-page__loading">
        <Loader2 className="artist-spinner artist-spinner--large" />
      </div>
    );
  }

  const selectedIsFlow = selectedEntry?.kind === "flow";
  const selectedFlow =
    selectedIsFlow && selectedEntry
      ? effectiveFlowList.find((flow) => flow.id === selectedEntry.id)
      : null;
  const selectedPlaylist =
    selectedEntry?.kind === "shared"
      ? sharedPlaylists.find((playlist) => playlist.id === selectedEntry.id)
      : null;
  const selectedStats = selectedId ? getPlaylistStats(selectedId) : null;
  const selectedTracks = selectedId ? tracksByFlowId[selectedId] || [] : [];
  const selectedTracksLoading =
    selectedId && tracksLoadingByFlowId[selectedId] === true;
  const selectedTracksError = selectedId
    ? tracksErrorByFlowId[selectedId] || ""
    : "";
  const playbackSource = selectedEntry
    ? {
        type: selectedIsFlow ? "flow" : "playlist",
        id: selectedEntry.id,
        label:
          selectedFlow?.name ||
          selectedPlaylist?.name ||
          selectedEntry.name ||
          "Playlist",
      }
    : null;
  const flowEnabled = selectedFlow?.enabled === true;
  const flowNextRun =
    selectedFlow && flowEnabled
      ? formatNextRun(selectedFlow.nextRunAt, countdownNow)
      : null;
  const flowLastRun = selectedFlow
    ? formatFlowLastRun(selectedFlow.lastRunAt)
    : null;
  const selectedEntryUsername =
    selectedEntry?.ownerUsername || user?.username || null;
  const selectedEntryTotalTracks = (() => {
    if (!selectedEntry) return 0;
    if (selectedEntry.kind === "flow") {
      return getFlowDisplayTrackCount(
        selectedFlow,
        selectedStats,
        selectedTracks.length,
      );
    }
    return Math.max(
      Number(selectedPlaylist?.trackCount || 0),
      selectedTracks.length,
      Number(selectedStats?.total || 0),
    );
  })();
  const selectedEntryTrackLabel = formatTrackCountLabel(
    selectedEntryTotalTracks,
    selectedStats,
  );
  const flowLastRunShort = selectedFlow
    ? formatFlowLastRunShort(selectedFlow.lastRunAt)
    : null;
  const flowNextRunShort =
    selectedFlow && flowEnabled && getPlaylistState(selectedFlow.id) !== "running"
      ? formatNextRunShort(selectedFlow.nextRunAt, countdownNow)
      : null;
  const detailMetaLine =
    selectedEntry && !selectedIsFlow
      ? selectedEntryUsername
        ? `${selectedEntryUsername} · ${selectedEntryTrackLabel}`
        : selectedEntryTrackLabel
      : "";
  const detailFlowMeta =
    selectedIsFlow && selectedEntry
      ? {
          username: selectedEntryUsername,
          trackLabel: selectedEntryTrackLabel,
          lastRunShort: flowLastRunShort,
          lastRunTitle: flowLastRun ? `Last updated ${flowLastRun}` : "",
          nextRunShort: flowNextRunShort,
          nextRunTitle:
            flowNextRunShort === "soon"
              ? "Next update soon"
              : flowNextRun
                ? `Next update in ${flowNextRun}`
                : "",
        }
      : null;
  const simpleDraft =
    selectedFlow && simpleDrafts[selectedFlow.id]
      ? simpleDrafts[selectedFlow.id]
      : selectedFlow
        ? flowToForm(selectedFlow)
        : null;
  const simpleError = selectedFlow ? simpleErrors[selectedFlow.id] : null;
  const flowHasChanges =
    selectedFlow && simpleDraft
      ? isReleaseRadarFlow(selectedFlow)
        ? isReleaseRadarFlowDirty(selectedFlow, simpleDraft)
        : isFlowDirty(selectedFlow, simpleDraft)
      : false;
  const flowCanExport = Number(selectedStats?.total || 0) > 0;
  const flowCanConvert = Number(selectedStats?.done || 0) > 0;
  const countReSearchingForPlaylist = (playlistId) => {
    if (!playlistId) return 0;
    const tracks = tracksByFlowId[playlistId];
    if (!Array.isArray(tracks) || tracks.length === 0) return 0;
    let count = 0;
    for (const track of tracks) {
      if (track?.id && reSearchingTrackIds[track.id]) count += 1;
    }
    return count;
  };
  const getEntryActivityMessage = (entry) => {
    if (!entry?.id) return null;
    const isFlow = entry.kind === "flow";
    const activity = getPlaylistRunActivity({
      playlistId: entry.id,
      kind: isFlow ? "flow" : "playlist",
      enabled: isFlow ? entry.enabled === true : true,
      status,
      stats: getPlaylistStats(entry.id),
      rerunning: rerunningId === entry.id,
      togglingToEnabled:
        togglingId === entry.id ? togglingToEnabled : null,
      addingTrack: savingToPlaylistId === entry.id,
      reSearchingCount: countReSearchingForPlaylist(entry.id),
    });
    return activity?.message || null;
  };
  const selectedActivityMessage = selectedEntry
    ? getEntryActivityMessage(selectedEntry)
    : null;
  const flowCanRunNow =
    selectedFlow?.enabled === true &&
    rerunningId !== selectedFlow?.id &&
    !selectedActivityMessage;
  const renameModalSaving =
    renameModal?.kind === "flow"
      ? applyingFlowNameId === renameModal.id
      : renameModal?.kind === "shared"
        ? applyingSharedPlaylistNameId === renameModal.id
        : false;
  const renameModalError =
    renameModal?.kind === "flow"
      ? simpleErrors[renameModal.id] || ""
      : renameModal?.kind === "shared"
        ? sharedPlaylistErrors[renameModal.id] || ""
        : "";

  const selectedDetailMoreMenu = (
    <MoreMenu activeButtonClass="btn-neutral-active">
      {selectedIsFlow && selectedFlow ? (
        <>
          <button
            type="button"
            className="artist-menu-item"
            onClick={() => handleRunNow(selectedFlow)}
            disabled={!flowCanRunNow}
          >
            <span className="artist-menu-item__main">
              {rerunningId === selectedFlow.id ? (
                <Loader2 className="artist-icon-sm animate-spin" />
              ) : (
                <Play className="artist-icon-sm" />
              )}
              Run now
            </span>
          </button>
          <button
            type="button"
            className="artist-menu-item"
            onClick={() => handleConvertFlowToStatic(selectedFlow)}
            disabled={!flowCanConvert || convertingId === selectedFlow.id}
          >
            <span className="artist-menu-item__main">
              <FilePlus2 className="artist-icon-sm" />
              Convert to static
            </span>
          </button>
          <button
            type="button"
            className="artist-menu-item"
            onClick={() => handleExportFlow(selectedFlow)}
            disabled={!flowCanExport}
          >
            <span className="artist-menu-item__main">
              <Download className="artist-icon-sm" />
              Export JSON
            </span>
          </button>
          <div className="flow-page__menu-divider" />
          <button
            type="button"
            className="artist-menu-item artist-menu-item--danger"
            onClick={() => handleDelete(selectedFlow)}
            disabled={deletingId === selectedFlow.id}
          >
            <span className="artist-menu-item__main">
              <Trash2 className="artist-icon-sm" />
              Delete flow
            </span>
          </button>
        </>
      ) : selectedPlaylist ? (
        <>
          <button
            type="button"
            className="artist-menu-item"
            onClick={() => handleExportFlow(selectedPlaylist)}
          >
            <span className="artist-menu-item__main">
              <Download className="artist-icon-sm" />
              Export JSON
            </span>
          </button>
          <div className="flow-page__menu-divider" />
          <button
            type="button"
            className="artist-menu-item artist-menu-item--danger"
            onClick={() => handleDeleteSharedPlaylist(selectedPlaylist)}
            disabled={deletingId === selectedPlaylist.id}
          >
            <span className="artist-menu-item__main">
              <Trash2 className="artist-icon-sm" />
              Delete playlist
            </span>
          </button>
        </>
      ) : null}
    </MoreMenu>
  );

  const selectedDetailBody = selectedEntry ? (
    <>
      {selectedIsFlow ? (
        <FlowDetailTabs activeTab={detailTab} onChange={setDetailTab} />
      ) : null}
      <div className="flow-page__detail-panel">
        {!selectedIsFlow || detailTab === "tracks" ? (
          selectedIsFlow ? (
            <FlowTracksPanel
              tracks={selectedTracks}
              loading={selectedTracksLoading}
              error={selectedTracksError}
              playbackSource={playbackSource}
              activityHint={selectedActivityMessage}
              emptyMessage={
                flowEnabled
                  ? "No tracks generated for this flow yet."
                  : "Enable this flow to generate tracks."
              }
              playlists={sharedPlaylists}
              playlistsLoading={playlistsLoading}
              playlistSavingKey={playlistMenuSavingKey}
              playlistMenuError={playlistMenuError}
              getDefaultPlaylistName={getDefaultTrackPlaylistName}
              onLoadPlaylists={loadPlaylistsForMenu}
              onAddTrackToPlaylist={handleAddTrackToPlaylist}
              onNavigateArtist={handleNavigateArtist}
            />
          ) : selectedPlaylist ? (
            <FlowTracksPanel
              tracks={selectedTracks}
              loading={selectedTracksLoading}
              error={selectedTracksError}
              playbackSource={playbackSource}
              activityHint={selectedActivityMessage}
              emptyMessage="No tracks in this playlist yet."
              useTrackContextMenu
              playlists={sharedPlaylists}
              playlistsLoading={playlistsLoading}
              playlistSavingKey={playlistMenuSavingKey}
              playlistMenuError={playlistMenuError}
              excludedPlaylistIds={[selectedPlaylist.id]}
              getDefaultPlaylistName={getDefaultTrackPlaylistName}
              onLoadPlaylists={loadPlaylistsForMenu}
              reSearchingTrackIds={reSearchingTrackIds}
              deletingTrackId={deletingTrackId}
              onReSearchTrack={(track) =>
                handleReSearchSharedPlaylistTrack(selectedPlaylist.id, track)
              }
              onDeleteTrack={(track) =>
                handleDeleteSharedPlaylistTrack(selectedPlaylist.id, track)
              }
              onAddTrackToPlaylist={handleAddTrackToPlaylist}
              onMoveTrackToPlaylist={(track, target) =>
                handleMoveTrackToPlaylist(track, target, selectedPlaylist.id)
              }
              onNavigateArtist={handleNavigateArtist}
            />
          ) : null
        ) : null}
        {detailTab === "recipe" && selectedIsFlow && simpleDraft ? (
          <div className="flow-page__form flow-page__detail-recipe">
            {isReleaseRadarFlow(selectedFlow) ? (
              <ReleaseRadarRecipeFields
                draft={simpleDraft}
                inputClassName="flow-page__field-control"
                errorMessage={simpleError}
                onDraftChange={(updater) =>
                  setSimpleDrafts((prev) => {
                    const base =
                      prev[selectedFlow.id] ?? flowToForm(selectedFlow);
                    return {
                      ...prev,
                      [selectedFlow.id]: updater(base),
                    };
                  })
                }
                onClearError={() => {
                  if (simpleErrors[selectedFlow.id]) {
                    setSimpleErrors((prev) => omitKey(prev, selectedFlow.id));
                  }
                }}
              />
            ) : (
              <FlowFormFields
                draft={simpleDraft}
                remaining={Number(simpleDraft.size || 0)}
                inputClassName="flow-page__field-control"
                errorMessage={simpleError}
                onDraftChange={(updater) =>
                  setSimpleDrafts((prev) => {
                    const base =
                      prev[selectedFlow.id] ?? flowToForm(selectedFlow);
                    return {
                      ...prev,
                      [selectedFlow.id]: updater(base),
                    };
                  })
                }
                onClearError={() => {
                  if (simpleErrors[selectedFlow.id]) {
                    setSimpleErrors((prev) => omitKey(prev, selectedFlow.id));
                  }
                }}
                normalizeMixPercent={normalizeMixPercent}
                disabledSources={disabledFlowSources}
              />
            )}
            <div className="flow-page__recipe-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={applyingFlowId === selectedFlow.id}
                onClick={() => handleCancelSimple(selectedFlow)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn btn-sm${flowHasChanges ? " btn-primary" : " btn-secondary"}`}
                disabled={
                  !flowHasChanges ||
                  Boolean(simpleError) ||
                  applyingFlowId === selectedFlow.id
                }
                onClick={() => handleApplySimple(selectedFlow)}
              >
                {applyingFlowId === selectedFlow.id ? (
                  <Loader2 className="artist-icon-sm animate-spin" />
                ) : (
                  <Check className="artist-icon-sm" />
                )}
                {flowHasChanges ? "Save recipe" : "Saved"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  ) : null;

  const selectedDetailContent = selectedEntry ? (
    <>
      <PlaylistDetailHero
        entry={selectedEntry}
        artworkUrl={artworkUrlFor(selectedEntry.id)}
        metaLine={detailMetaLine}
        flowMeta={detailFlowMeta}
        activityHint={selectedActivityMessage}
        enabled={flowEnabled}
        togglingId={togglingId}
        onToggleEnabled={(checked) =>
          selectedFlow && handleToggleRequest(selectedFlow, checked)
        }
        onRenameTitle={() => handleOpenEditModal()}
        onArtworkClick={() => handleOpenEditModal()}
        moreMenu={selectedDetailMoreMenu}
      />
      {selectedDetailBody}
    </>
  ) : null;

  return (
    <div className="flow-page">
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="flow-page__hidden-input"
        onChange={handleImportFileChange}
      />
      <div
        className={`flow-page__shell${!isMobileLayout && libraryCollapsed ? " flow-page__shell--library-collapsed" : ""}`}
      >
        <aside
          className={`flow-page__library${!isMobileLayout && libraryCollapsed ? " flow-page__library--collapsed" : ""}`}
        >
          <div className="flow-page__library-head">
            <button
              type="button"
              className="flow-page__library-collapse"
              onClick={() => {
                setLibraryCollapsed((prev) => {
                  const next = !prev;
                  try {
                    globalThis.localStorage?.setItem(
                      LIBRARY_SIDEBAR_COLLAPSED_KEY,
                      next ? "1" : "0",
                    );
                  } catch {}
                  return next;
                });
              }}
              aria-label={
                libraryCollapsed
                  ? "Expand playlist sidebar"
                  : "Collapse playlist sidebar"
              }
              title={
                libraryCollapsed
                  ? "Expand playlist sidebar"
                  : "Collapse playlist sidebar"
              }
            >
              <LibrarySidebarToggleIcon collapsed={libraryCollapsed} />
            </button>
            <h1 className="flow-page__library-title">Playlists</h1>
            <FlowLibraryCreateMenu
              onImport={handleOpenImportPicker}
              onNewPlaylist={handleOpenCreatePlaylist}
              onNewFlow={handleCreateInline}
              creatingPlaylist={creatingPlaylist}
              creatingFlow={creating}
              canCreateFlow={canCreateGeneratedFlow}
              compact={libraryCollapsed}
            />
          </div>
          <div
            className="artist-segmented flow-page__library-filters"
            role="group"
            aria-label="Library filter"
          >
            {[
              { id: "all", label: "All" },
              { id: "playlists", label: "Playlists" },
              { id: "flows", label: "Flows" },
            ].map((filter) => {
              const isActive = libraryFilter === filter.id;
              return (
                <button
                  key={filter.id}
                  type="button"
                  className={`artist-segmented-button flow-page__library-filter${isActive ? " is-active" : ""}`}
                  aria-pressed={isActive}
                  onClick={() => setLibraryFilter(filter.id)}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
          <div className="flow-page__library-list">
            {filteredCollection.length === 0 ? (
              <FlowEmptyState
                canCreate={canCreateGeneratedFlow}
                libraryFilter={libraryFilter}
                variant={isMobileLayout ? "full" : "compact"}
                onImport={handleOpenImportPicker}
                onNewPlaylist={handleOpenCreatePlaylist}
                onNewFlow={handleCreateInline}
                creatingPlaylist={creatingPlaylist}
                creatingFlow={creating}
              />
            ) : (
              filteredCollection.map((entry) => {
                const stats = getPlaylistStats(entry.id);
                const isExpanded =
                  isMobileLayout &&
                  mobileShowDetail &&
                  selectedId === entry.id;
                return (
                  <div
                    key={entry.id}
                    className={`flow-page__library-row${isExpanded ? " is-expanded" : ""}`}
                  >
                    <PlaylistLibraryItem
                      entry={entry}
                      artworkUrl={artworkUrlFor(entry.id)}
                      isActive={
                        isMobileLayout
                          ? isExpanded
                          : selectedId === entry.id
                      }
                      expanded={isExpanded}
                      stats={stats}
                      activityHint={getEntryActivityMessage(entry)}
                      collapsed={!isMobileLayout && libraryCollapsed}
                      onSelect={selectPlaylist}
                      trailing={
                        isExpanded ? (
                          <>
                            {entry.kind === "flow" ? (
                              <div
                                className="flow-page__toggle-wrap"
                                data-no-card-toggle="true"
                              >
                                <PillToggle
                                  checked={flowEnabled}
                                  className={`pill-toggle--flow-compact${flowEnabled ? "" : " is-off"}`}
                                  onChange={(event) =>
                                    selectedFlow &&
                                    handleToggleRequest(
                                      selectedFlow,
                                      event.target.checked,
                                    )
                                  }
                                  disabled={togglingId === entry.id}
                                />
                              </div>
                            ) : null}
                            {selectedDetailMoreMenu}
                          </>
                        ) : null
                      }
                    />
                    {isExpanded ? (
                      <div className="flow-page__library-inline-detail">
                        {selectedDetailBody}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {!isMobileLayout ? (
          <section
            className={`flow-page__detail${!selectedEntry ? " flow-page__detail--empty" : ""}`}
          >
            {!selectedEntry ? (
              filteredCollection.length === 0 ? (
                <FlowEmptyState
                  canCreate={canCreateGeneratedFlow}
                  libraryFilter={libraryFilter}
                  variant="full"
                  onImport={handleOpenImportPicker}
                  onNewPlaylist={handleOpenCreatePlaylist}
                  onNewFlow={handleCreateInline}
                  creatingPlaylist={creatingPlaylist}
                  creatingFlow={creating}
                />
              ) : (
                <FlowDetailPlaceholder />
              )
            ) : (
              selectedDetailContent
            )}
          </section>
        ) : null}
      </div>

      <ConfirmDeleteModal
        confirmDelete={confirmDelete}
        deletingId={deletingId}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={handleConfirmDelete}
      />
      <ConfirmDisableModal
        confirmDisable={confirmDisable}
        togglingId={togglingId}
        onCancel={() => setConfirmDisable(null)}
        onConfirm={handleConfirmDisable}
      />
      <FlowImportReviewModal
        importReview={importReview}
        importing={importing}
        onNameChange={(index, name) => {
          setImportReview((prev) => {
            if (!prev || !Array.isArray(prev.flows)) return prev;
            const nextFlows = prev.flows.map((flow, flowIndex) =>
              flowIndex === index ? { ...flow, importName: name } : flow,
            );
            return {
              ...prev,
              flows: nextFlows,
            };
          });
        }}
        onCancel={() => {
          if (importing) return;
          setImportReview(null);
        }}
        onConfirm={handleConfirmImport}
      />
      <RenamePlaylistModal
        open={!!renameModal}
        title={renameModal?.kind === "flow" ? "Edit flow" : "Edit playlist"}
        defaultName={renameModal?.name || ""}
        displayName={renameModal?.name || ""}
        artworkUrl={renameModal ? artworkUrlFor(renameModal.id) : ""}
        saving={renameModalSaving}
        coverBusy={coverArtworkBusyId === renameModal?.id}
        error={renameModalError}
        coverError={coverArtworkError}
        onClose={() => {
          if (renameModalSaving || coverArtworkBusyId) return;
          setRenameModal(null);
          setCoverArtworkError("");
        }}
        onSubmit={handleRenameModalSubmit}
        onUpload={handleUploadCover}
        onRemoveCover={handleRemoveCover}
        onGenerateCover={handleGenerateCover}
      />
      <CreatePlaylistModal
        open={isCreatePlaylistOpen}
        defaultName={getNextPlaylistName("Playlist")}
        saving={creatingPlaylist}
        error={createPlaylistError}
        onClose={() => {
          if (creatingPlaylist) return;
          setCreatePlaylistError("");
          setIsCreatePlaylistOpen(false);
        }}
        onSubmit={handleCreatePlaylist}
      />
    </div>
  );
}

export default FlowPage;
