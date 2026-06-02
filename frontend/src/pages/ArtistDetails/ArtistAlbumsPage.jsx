import { Fragment, useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import {
  CheckCircle,
  Grid3X3,
  List,
  Loader,
  Music,
  Star,
} from "lucide-react";
import AddAlbumButton from "../../components/AddAlbumButton";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { useSharedVolume } from "../../hooks/useSharedVolume";
import { useArtistDetailsStream } from "./hooks/useArtistDetailsStream";
import { useArtistDetailsLibrary } from "./hooks/useArtistDetailsLibrary";
import { allReleaseTypes } from "./constants";
import { ArtistDetailsReleaseTrackList } from "./components/ArtistDetailsReleaseTrackList";
import {
  addSharedPlaylistTracks,
  createSharedPlaylist,
  getFlowStatus,
} from "../../utils/api";
import { getReleaseMetric, getReleaseYear } from "./utils";

const sortOptions = [
  { value: "latest", label: "Latest" },
  { value: "oldest", label: "Oldest" },
  { value: "popular", label: "Most popular" },
  { value: "rating", label: "Highest rated" },
];

const releaseTabs = [
  { value: "albums", label: "Albums" },
  { value: "singles", label: "EP & Singles" },
  { value: "compilations", label: "Compilations" },
];

const normalizePlaylistNameKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const reserveUniquePlaylistName = (playlists, baseName = "Playlist") => {
  const normalizedBase = String(baseName || "").trim() || "Playlist";
  const existing = new Set(
    (Array.isArray(playlists) ? playlists : [])
      .map((playlist) => normalizePlaylistNameKey(playlist?.name))
      .filter(Boolean),
  );
  if (!existing.has(normalizedBase.toLowerCase())) {
    return normalizedBase;
  }
  let index = 2;
  while (index < 10000) {
    const candidate = `${normalizedBase} ${index}`;
    if (!existing.has(candidate.toLowerCase())) {
      return candidate;
    }
    index += 1;
  }
  return `${normalizedBase} ${Date.now()}`;
};

const isCompilation = (releaseGroup) =>
  releaseGroup?.["primary-type"] === "Compilation" ||
  (releaseGroup?.["secondary-types"] || []).includes("Compilation");

const isSingleOrEp = (releaseGroup) =>
  releaseGroup?.["primary-type"] === "Single" ||
  releaseGroup?.["primary-type"] === "EP";

const matchesReleaseTab = (releaseGroup, tab) => {
  if (tab === "compilations") return isCompilation(releaseGroup);
  if (tab === "singles") {
    return isSingleOrEp(releaseGroup) && !isCompilation(releaseGroup);
  }
  return releaseGroup?.["primary-type"] === "Album" && !isCompilation(releaseGroup);
};

const getReleaseTypeLabel = (releaseGroup) => {
  const types = [
    releaseGroup?.["primary-type"],
    ...(Array.isArray(releaseGroup?.["secondary-types"])
      ? releaseGroup["secondary-types"]
      : []),
  ].filter(Boolean);
  return types.length ? types.join(" · ") : "Release";
};

const sortReleaseGroups = (items, sortMode) =>
  [...items].sort((a, b) => {
    if (sortMode === "popular") {
      const diff = getReleaseMetric(b).sortValue - getReleaseMetric(a).sortValue;
      if (diff !== 0) return diff;
    }
    if (sortMode === "rating") {
      const ratingA = Number(a?.rating?.value || 0);
      const ratingB = Number(b?.rating?.value || 0);
      const diff = ratingB - ratingA;
      if (diff !== 0) return diff;
    }
    const dateA = String(a["first-release-date"] || "");
    const dateB = String(b["first-release-date"] || "");
    return sortMode === "oldest"
      ? dateA.localeCompare(dateB)
      : dateB.localeCompare(dateA);
  });

const getGridColumnCount = () => {
  if (typeof window === "undefined") return 2;
  if (window.matchMedia("(min-width: 1280px)").matches) return 6;
  if (window.matchMedia("(min-width: 1024px)").matches) return 5;
  if (window.matchMedia("(min-width: 640px)").matches) return 3;
  return 2;
};

function ArtistAlbumsPage() {
  const { mbid } = useParams();
  const { state } = useLocation();
  const { showSuccess, showError } = useToast();
  const { hasPermission } = useAuth();
  const [previewVolume] = useSharedVolume();
  const [selectedTab, setSelectedTab] = useState("albums");
  const [sortMode, setSortMode] = useState("latest");
  const [viewMode, setViewMode] = useState("grid");
  const [gridColumnCount, setGridColumnCount] = useState(getGridColumnCount);
  const [visibleCoverIds, setVisibleCoverIds] = useState([]);
  const [sharedPlaylists, setSharedPlaylists] = useState([]);
  const [playlistModalLoading, setPlaylistModalLoading] = useState(false);
  const [playlistModalError, setPlaylistModalError] = useState("");
  const [playlistMenuSavingKey, setPlaylistMenuSavingKey] = useState("");
  const artistNameFromNav = state?.artistName || "";
  const canAddAlbum = hasPermission("addAlbum");

  const stream = useArtistDetailsStream(mbid, artistNameFromNav, allReleaseTypes, {
    visibleCoverIds,
    initialLibraryHint: {
      existsInLibrary:
        typeof state?.inLibrary === "boolean" ? state.inLibrary : undefined,
      libraryArtist: state?.libraryArtist || null,
    },
  });

  const {
    artist,
    libraryArtist,
    setLibraryArtist,
    libraryAlbums,
    setLibraryAlbums,
    loading,
    error,
    loadingReleases,
    existsInLibrary,
    setExistsInLibrary,
    appSettings,
    albumCovers,
  } = stream;

  const library = useArtistDetailsLibrary({
    artist,
    libraryArtist,
    setLibraryArtist,
    libraryAlbums,
    setLibraryAlbums,
    existsInLibrary,
    setExistsInLibrary,
    appSettings,
    showSuccess,
    showError,
    selectedReleaseTypes: allReleaseTypes,
  });

  const releaseGroups = useMemo(
    () => artist?.["release-groups"] || [],
    [artist],
  );
  const filteredReleaseGroups = useMemo(
    () =>
      sortReleaseGroups(
        releaseGroups.filter((releaseGroup) =>
          matchesReleaseTab(releaseGroup, selectedTab),
        ),
        sortMode,
      ),
    [releaseGroups, selectedTab, sortMode],
  );

  useEffect(() => {
    setVisibleCoverIds(filteredReleaseGroups.map((item) => item.id).filter(Boolean));
  }, [filteredReleaseGroups]);

  useEffect(() => {
    const updateGridColumnCount = () => setGridColumnCount(getGridColumnCount());
    updateGridColumnCount();
    window.addEventListener("resize", updateGridColumnCount);
    return () => window.removeEventListener("resize", updateGridColumnCount);
  }, []);

  const loadSharedPlaylists = async () => {
    setPlaylistModalLoading(true);
    try {
      const data = await getFlowStatus();
      const playlists = Array.isArray(data?.sharedPlaylists)
        ? data.sharedPlaylists
        : [];
      setSharedPlaylists(playlists);
      return playlists;
    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        "Failed to load playlists";
      setPlaylistModalError(message);
      showError(message);
      return null;
    } finally {
      setPlaylistModalLoading(false);
    }
  };

  const getDefaultTrackPlaylistName = (track) =>
    reserveUniquePlaylistName(
      sharedPlaylists,
      `${artist?.name || artistNameFromNav || track?.artistName || "Artist"} Picks`,
    );

  const buildReleaseTrackPayload = (track, releaseGroup) => {
    const year = String(releaseGroup?.["first-release-date"] || "").slice(0, 4);
    return {
      artistName: artist?.name || artistNameFromNav || "",
      trackName: track?.trackName || track?.title || "",
      albumName: releaseGroup?.title || "",
      artistMbid: mbid || "",
      albumMbid: releaseGroup?.id || "",
      trackMbid: track?.mbid || track?.id || "",
      releaseYear: year || null,
      durationMs:
        track?.length != null && Number.isFinite(Number(track.length))
          ? Number(track.length)
          : null,
      reason: null,
      artistAliases: [],
    };
  };

  const saveTrackToPlaylist = async (trackPayload, target, savingKey) => {
    if (!trackPayload?.artistName || !trackPayload?.trackName) {
      showError("Track details are incomplete");
      return;
    }
    setPlaylistModalError("");
    setPlaylistMenuSavingKey(String(savingKey || ""));
    try {
      if (target?.mode === "new") {
        const name =
          String(target?.name || "").trim() ||
          reserveUniquePlaylistName(
            sharedPlaylists,
            `${trackPayload.artistName} Picks`,
          );
        const response = await createSharedPlaylist({
          name,
          tracks: [trackPayload],
        });
        showSuccess(`Track saved to ${response?.playlist?.name || name}`);
      } else {
        const targetPlaylist = sharedPlaylists.find(
          (playlist) => playlist.id === target?.playlistId,
        );
        await addSharedPlaylistTracks(target.playlistId, {
          tracks: [trackPayload],
        });
        showSuccess(`Track added to ${targetPlaylist?.name || "playlist"}`);
      }
      const nextPlaylists = await loadSharedPlaylists();
      if (nextPlaylists) {
        setSharedPlaylists(nextPlaylists);
      }
    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        "Failed to save track to playlist";
      setPlaylistModalError(message);
      showError(message);
    } finally {
      setPlaylistMenuSavingKey("");
    }
  };

  const handleReleaseTrackAdd = (track, releaseGroup, target) => {
    const payload = buildReleaseTrackPayload(track, releaseGroup);
    const savingKey = String(track?.id ?? track?.mbid ?? "");
    return saveTrackToPlaylist(payload, target, savingKey);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader className="h-10 w-10 animate-spin text-white/65" />
      </div>
    );
  }

  if (error || !artist) {
    return (
      <div className="bg-[#101012] p-6">
        <p className="text-white/75">{error || "Artist not found"}</p>
      </div>
    );
  }

  const renderReleaseCard = (releaseGroup) => {
    const status = library.getAlbumStatus(releaseGroup.id);
    const metric = getReleaseMetric(releaseGroup);
    const cover = albumCovers[releaseGroup.id];
    const isComplete = status?.status === "available" || status?.status === "added";
    const releaseTypeLabel = getReleaseTypeLabel(releaseGroup);

    if (viewMode === "list") {
      return (
        <div
          key={releaseGroup.id}
          className="grid cursor-pointer grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 bg-[#101012] p-2 transition-colors hover:bg-white/[0.06]"
          onClick={() =>
            library.handleReleaseGroupAlbumClick(releaseGroup, status?.libraryId)
          }
        >
          <div className="h-14 w-14 bg-white/[0.06]">
            {cover ? (
              <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Music className="h-5 w-5 text-white/35" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-white">{releaseGroup.title}</h2>
            <p className="mt-1 truncate text-xs text-white/50">
              {[getReleaseYear(releaseGroup), releaseTypeLabel]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {metric.label && (
              <span className="hidden items-center gap-1 text-xs text-white/50 sm:inline-flex">
                <Star className="h-3.5 w-3.5 text-yellow-400" />
                {metric.label}
              </span>
            )}
            {isComplete ? (
              <span
                className="inline-flex h-8 min-w-12 items-center justify-center rounded-full bg-green-500 text-white shadow-lg shadow-black/30 ring-1 ring-white/15"
                title="Complete"
              >
                <CheckCircle className="h-4 w-4" />
                <span className="sr-only">Complete</span>
              </span>
            ) : canAddAlbum ? (
              <div onClick={(event) => event.stopPropagation()}>
                <AddAlbumButton
                  onClick={(event) => {
                    event.stopPropagation();
                    library.handleRequestAlbum(releaseGroup.id, releaseGroup.title);
                  }}
                  isLoading={library.requestingAlbum === releaseGroup.id}
                  disabled={library.requestingAlbum === releaseGroup.id}
                />
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    return (
      <article
        key={releaseGroup.id}
        className="cursor-pointer bg-[#101012] p-3 transition-colors hover:bg-white/[0.06]"
        onClick={() =>
          library.handleReleaseGroupAlbumClick(releaseGroup, status?.libraryId)
        }
      >
        <div className="relative mb-3 aspect-square bg-white/[0.06]">
          {cover ? (
            <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Music className="h-10 w-10 text-white/35" />
            </div>
          )}
          <div className="absolute bottom-2 right-2">
            {isComplete ? (
              <span
                className="inline-flex h-8 min-w-12 items-center justify-center rounded-full bg-green-500 text-white shadow-lg shadow-black/30 ring-1 ring-white/15"
                title="Complete"
              >
                <CheckCircle className="h-4 w-4" />
                <span className="sr-only">Complete</span>
              </span>
            ) : canAddAlbum ? (
              <div onClick={(event) => event.stopPropagation()}>
                <AddAlbumButton
                  onClick={(event) => {
                    event.stopPropagation();
                    library.handleRequestAlbum(releaseGroup.id, releaseGroup.title);
                  }}
                  isLoading={library.requestingAlbum === releaseGroup.id}
                  disabled={library.requestingAlbum === releaseGroup.id}
                />
              </div>
            ) : null}
          </div>
        </div>
        <h2 className="line-clamp-2 min-h-[2.5rem] text-sm font-bold leading-5 text-white">
          {releaseGroup.title}
        </h2>
        <p className="mt-1 truncate text-xs text-white/50">
          {[getReleaseYear(releaseGroup), releaseTypeLabel]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {metric.label && (
          <p className="mt-2 inline-flex items-center gap-1 text-xs text-white/50">
            <Star className="h-3.5 w-3.5 text-yellow-400" />
            {metric.label}
          </p>
        )}
      </article>
    );
  };

  const expandedRelease = filteredReleaseGroups.find(
    (releaseGroup) => releaseGroup.id === library.expandedReleaseGroup,
  );
  const expandedStatus = expandedRelease
    ? library.getAlbumStatus(expandedRelease.id)
    : null;
  const expandedTrackKey = expandedStatus?.libraryId || expandedRelease?.id;
  const expandedTracks = expandedTrackKey ? library.albumTracks[expandedTrackKey] : null;
  const expandedLoading = expandedTrackKey
    ? library.loadingTracks[expandedTrackKey]
    : false;
  const expandedReleaseIndex = expandedRelease
    ? filteredReleaseGroups.findIndex(
        (releaseGroup) => releaseGroup.id === expandedRelease.id,
      )
    : -1;
  const expandedRenderAfterIndex =
    expandedReleaseIndex < 0
      ? -1
      : viewMode === "grid"
        ? Math.min(
            expandedReleaseIndex +
              (gridColumnCount - 1 - (expandedReleaseIndex % gridColumnCount)),
            filteredReleaseGroups.length - 1,
          )
        : expandedReleaseIndex;

  return (
    <div className="artist-details-page">
      <div className="mb-7 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-4xl font-black text-white">{artist.name}</h1>
          {loadingReleases && (
            <p className="mt-2 inline-flex items-center gap-2 text-sm text-white/55">
              <Loader className="h-4 w-4 animate-spin" />
              Loading releases
            </p>
          )}
        </div>
      </div>

      <div className="mb-6 grid gap-4 bg-[#101012] p-4 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-start">
        <div>
          <h2 className="mb-3 text-sm font-bold text-white">Release Type</h2>
          <div className="flex flex-wrap gap-2">
            {releaseTabs.map((tab) => {
              const active = selectedTab === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setSelectedTab(tab.value)}
                  className="px-3 py-1.5 text-xs font-bold transition-colors"
                  style={{
                    backgroundColor: active ? "#fff" : "rgba(255,255,255,0.08)",
                    color: active ? "#050505" : "#fff",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <label className="block">
          <span className="mb-3 block text-sm font-bold text-white">Sort</span>
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value)}
            className="h-10 bg-white/[0.08] px-3 text-sm font-bold text-white outline-none"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className="mb-3 block text-sm font-bold text-white">View</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className="flex h-10 w-10 items-center justify-center bg-white/[0.08] text-white"
              aria-label="Grid view"
              title="Grid view"
            >
              <Grid3X3 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className="flex h-10 w-10 items-center justify-center bg-white/[0.08] text-white"
              aria-label="List view"
              title="List view"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="mb-4 text-sm font-bold text-white/55">
        {filteredReleaseGroups.length.toLocaleString()} release
        {filteredReleaseGroups.length === 1 ? "" : "s"}
      </div>

      <div
        className={
          viewMode === "grid"
            ? "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6"
            : "space-y-2"
        }
      >
        {filteredReleaseGroups.map((releaseGroup, index) => (
          <Fragment key={releaseGroup.id}>
            {renderReleaseCard(releaseGroup)}
            {expandedRelease && expandedRenderAfterIndex === index && (
              <div className={viewMode === "grid" ? "col-span-full" : ""}>
                <ArtistDetailsReleaseTrackList
                  release={expandedRelease}
                  trackKey={expandedTrackKey}
                  tracks={expandedTracks}
                  loading={expandedLoading}
                  previewVolume={previewVolume}
                  onAddTrackToPlaylist={handleReleaseTrackAdd}
                  playlists={sharedPlaylists}
                  playlistsLoading={playlistModalLoading}
                  playlistSavingKey={playlistMenuSavingKey}
                  playlistError={playlistModalError}
                  getDefaultPlaylistName={getDefaultTrackPlaylistName}
                  onLoadPlaylists={loadSharedPlaylists}
                />
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export default ArtistAlbumsPage;
