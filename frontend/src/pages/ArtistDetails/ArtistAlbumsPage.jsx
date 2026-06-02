import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
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
import { useArtistDetailsStream } from "./hooks/useArtistDetailsStream";
import { useArtistDetailsLibrary } from "./hooks/useArtistDetailsLibrary";
import {
  allReleaseTypes,
  primaryReleaseTypes,
  secondaryReleaseTypes,
} from "./constants";
import { getReleaseMetric, getReleaseYear, matchesReleaseTypeFilter } from "./utils";

const sortOptions = [
  { value: "latest", label: "Latest" },
  { value: "oldest", label: "Oldest" },
  { value: "popular", label: "Most popular" },
  { value: "rating", label: "Highest rated" },
];

const typeOptions = [...primaryReleaseTypes, ...secondaryReleaseTypes];

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

function ArtistAlbumsPage() {
  const { mbid } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const { hasPermission } = useAuth();
  const [selectedTypes, setSelectedTypes] = useState(allReleaseTypes);
  const [sortMode, setSortMode] = useState("latest");
  const [viewMode, setViewMode] = useState("grid");
  const [visibleCoverIds, setVisibleCoverIds] = useState([]);
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
    selectedReleaseTypes: selectedTypes,
  });

  const releaseGroups = useMemo(
    () => artist?.["release-groups"] || [],
    [artist],
  );
  const filteredReleaseGroups = useMemo(
    () =>
      sortReleaseGroups(
        releaseGroups.filter((releaseGroup) =>
          matchesReleaseTypeFilter(releaseGroup, selectedTypes),
        ),
        sortMode,
      ),
    [releaseGroups, selectedTypes, sortMode],
  );

  useEffect(() => {
    setVisibleCoverIds(filteredReleaseGroups.map((item) => item.id).filter(Boolean));
  }, [filteredReleaseGroups]);

  const toggleType = (type) => {
    setSelectedTypes((prev) =>
      prev.includes(type)
        ? prev.filter((item) => item !== type)
        : [...prev, type],
    );
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

    if (viewMode === "list") {
      return (
        <div
          key={releaseGroup.id}
          className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 bg-[#101012] p-2 transition-colors hover:bg-white/[0.06]"
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
              {[getReleaseYear(releaseGroup), releaseGroup["primary-type"]]
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
              <span className="inline-flex items-center gap-1 bg-green-500/20 px-2 py-1 text-xs font-bold text-green-300">
                <CheckCircle className="h-3.5 w-3.5" />
                Complete
              </span>
            ) : canAddAlbum ? (
              <AddAlbumButton
                onClick={() =>
                  library.handleRequestAlbum(releaseGroup.id, releaseGroup.title)
                }
                isLoading={library.requestingAlbum === releaseGroup.id}
                disabled={library.requestingAlbum === releaseGroup.id}
              />
            ) : null}
          </div>
        </div>
      );
    }

    return (
      <article key={releaseGroup.id} className="bg-[#101012] p-3">
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
              <span className="inline-flex items-center gap-1 bg-green-500/20 px-2 py-1 text-xs font-bold text-green-300">
                <CheckCircle className="h-3.5 w-3.5" />
                Complete
              </span>
            ) : canAddAlbum ? (
              <AddAlbumButton
                onClick={() =>
                  library.handleRequestAlbum(releaseGroup.id, releaseGroup.title)
                }
                isLoading={library.requestingAlbum === releaseGroup.id}
                disabled={library.requestingAlbum === releaseGroup.id}
              />
            ) : null}
          </div>
        </div>
        <h2 className="line-clamp-2 min-h-[2.5rem] text-sm font-bold leading-5 text-white">
          {releaseGroup.title}
        </h2>
        <p className="mt-1 truncate text-xs text-white/50">
          {[getReleaseYear(releaseGroup), releaseGroup["primary-type"]]
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

  return (
    <div className="artist-details-page">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-white/65 transition-colors hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="mb-7 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 text-sm font-bold uppercase tracking-[0.16em] text-white/45">
            Discography
          </p>
          <h1 className="text-4xl font-black text-white">{artist.name}</h1>
          {loadingReleases && (
            <p className="mt-2 inline-flex items-center gap-2 text-sm text-white/55">
              <Loader className="h-4 w-4 animate-spin" />
              Loading releases
            </p>
          )}
        </div>
        <Link
          to={`/artist/${artist.id}`}
          state={{ artistName: artist.name, inLibrary: existsInLibrary }}
          className="text-sm font-bold text-white/65 transition-colors hover:text-white"
        >
          Artist page
        </Link>
      </div>

      <div className="mb-6 grid gap-4 bg-[#101012] p-4 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-start">
        <div>
          <h2 className="mb-3 text-sm font-bold text-white">Release Types</h2>
          <div className="flex flex-wrap gap-2">
            {typeOptions.map((type) => {
              const active = selectedTypes.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  className="px-3 py-1.5 text-xs font-bold transition-colors"
                  style={{
                    backgroundColor: active ? "#fff" : "rgba(255,255,255,0.08)",
                    color: active ? "#050505" : "#fff",
                  }}
                >
                  {type}
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
        {filteredReleaseGroups.map(renderReleaseCard)}
      </div>
    </div>
  );
}

export default ArtistAlbumsPage;
