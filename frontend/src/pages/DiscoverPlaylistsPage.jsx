import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDiscoverData } from "./useDiscoverData";
import { useDiscoverNavigation } from "../hooks/useDiscoverNavigation";
import { DiscoverPlaylistContextMenu } from "../components/DiscoverPlaylistContextMenu";
import {
  adoptDiscoverPlaylistAsFlow,
  adoptDiscoverPlaylistAsStatic,
  getDiscoverArtworkUrl,
} from "../utils/api";
import { useToast } from "../contexts/ToastContext";
import { Crosshair, Loader } from "lucide-react";

const DISCOVER_FLOW_PRESET_ORDER = [
  "discover-weekly",
  "trending-mix",
  "library-blend",
  "focus-listening-history",
  "release-radar",
];

const sortDiscoverPlaylists = (playlists) => {
  const list = Array.isArray(playlists) ? [...playlists] : [];
  return list.sort((left, right) => {
    const leftIndex = DISCOVER_FLOW_PRESET_ORDER.indexOf(left?.presetId);
    const rightIndex = DISCOVER_FLOW_PRESET_ORDER.indexOf(right?.presetId);
    const leftOrder = leftIndex >= 0 ? leftIndex : DISCOVER_FLOW_PRESET_ORDER.length;
    const rightOrder = rightIndex >= 0 ? rightIndex : DISCOVER_FLOW_PRESET_ORDER.length;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return String(left?.name || "").localeCompare(String(right?.name || ""));
  });
};

const PLAYLIST_COVER_ICONS = { editorial: Crosshair };

const getPlaylistCoverIcon = (playlist) => {
  if (playlist?.type === "editorial") return PLAYLIST_COVER_ICONS.editorial;
  return null;
};

const getPlaylistTextColor = (playlist) => {
  const hex = String(playlist?.artworkColor || "").trim();
  if (hex === "#ffffff" || hex === "#fffac8") return "#222";
  return "#fff";
};

const getPlaylistSourceLine = (playlist) => {
  if (playlist?.type === "editorial" && playlist?.editorialType) {
    const labels = { genre: "Genre", era: "Era", mood: "Mood" };
    return labels[playlist.editorialType] || playlist.editorialType;
  }
  if (playlist?.type === "editorial") return "Editorial";
  return null;
};

export default function DiscoverPlaylistsPage() {
  const { data, error } = useDiscoverData();
  const navigate = useDiscoverNavigation();
  const { showSuccess, showError } = useToast();

  const visiblePlaylists = useMemo(
    () => sortDiscoverPlaylists(data?.discoverPlaylists || []),
    [data?.discoverPlaylists],
  );

  const [adoptingFlowId, setAdoptingFlowId] = useState(null);
  const [adoptingPlaylistId, setAdoptingPlaylistId] = useState(null);
  const [failedArtworkIds, setFailedArtworkIds] = useState({});

  const handleAdoptFlow = useCallback(
    async (playlist) => {
      if (playlist.adoptedFlowId) {
        navigate(`/playlists?selected=${encodeURIComponent(playlist.adoptedFlowId)}`);
        return;
      }
      setAdoptingFlowId(playlist.presetId);
      try {
        const result = await adoptDiscoverPlaylistAsFlow(playlist.presetId);
        const flowId = result?.flowId;
        showSuccess(
          result?.alreadyAdopted
            ? `Opened ${playlist.name}`
            : `Added ${playlist.name} as a rotating flow`,
        );
        if (flowId) {
          navigate(`/playlists?selected=${encodeURIComponent(flowId)}`);
        }
      } catch (err) {
        showError(
          err.response?.data?.message ||
            err.response?.data?.error ||
            err.message ||
            "Failed to add rotating flow",
        );
      } finally {
        setAdoptingFlowId(null);
      }
    },
    [navigate, showError, showSuccess],
  );

  const handleAdoptPlaylist = useCallback(
    async (playlist) => {
      if (playlist.adoptedPlaylistId) {
        navigate(`/playlists?selected=${encodeURIComponent(playlist.adoptedPlaylistId)}`);
        return;
      }
      setAdoptingPlaylistId(playlist.presetId);
      try {
        const result = await adoptDiscoverPlaylistAsStatic(playlist.presetId);
        const playlistId = result?.playlistId;
        showSuccess(
          result?.alreadyAdopted
            ? `Opened ${playlist.name}`
            : `Added ${playlist.name} as a static playlist`,
        );
        if (playlistId) {
          navigate(`/playlists?selected=${encodeURIComponent(playlistId)}`);
        }
      } catch (err) {
        showError(
          err.response?.data?.message ||
            err.response?.data?.error ||
            err.message ||
            "Failed to add static playlist",
        );
      } finally {
        setAdoptingPlaylistId(null);
      }
    },
    [navigate, showError, showSuccess],
  );

  if (error && visiblePlaylists.length === 0) {
    return (
      <div className="discover-playlists-page">
        <header className="discover-playlists-page__header">
          <h1 className="page-title">Playlists for you</h1>
        </header>
        <div className="arr-page__empty">
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (visiblePlaylists.length === 0) {
    return (
      <div className="discover-playlists-page">
        <header className="discover-playlists-page__header">
          <h1 className="page-title">Playlists for you</h1>
        </header>
        <div className="arr-page__empty">
          <Loader className="animate-spin artist-icon-md" />
          <p>Run a discovery refresh to generate playlists.</p>
          <Link to="/settings?tab=discover" className="arr-link">Open Discovery Settings</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="discover-playlists-page">
      <header className="discover-playlists-page__header">
        <h1 className="page-title">Playlists for you</h1>
        <p className="page-subtitle">{visiblePlaylists.length} playlists</p>
      </header>

      <div className="artist-albums-grid">
        {visiblePlaylists.map((playlist) => {
          const CoverIcon = getPlaylistCoverIcon(playlist);
          const sourceLine = getPlaylistSourceLine(playlist);
          const showArtwork =
            Number(playlist.trackCount) > 0 && !failedArtworkIds[playlist.presetId];

          return (
            <article
              key={playlist.presetId}
              className="artist-release-card"
              onClick={() => navigate(`/discover/playlists/${encodeURIComponent(playlist.presetId)}`)}
              role="link"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate(`/discover/playlists/${encodeURIComponent(playlist.presetId)}`);
                }
              }}
            >
              <div className="artist-release-card__cover">
                {showArtwork ? (
                  <img
                    src={getDiscoverArtworkUrl(playlist.presetId)}
                    alt=""
                    loading="lazy"
                    onError={() =>
                      setFailedArtworkIds((current) => ({
                        ...current,
                        [playlist.presetId]: true,
                      }))
                    }
                  />
                ) : (
                  <div
                    className="artist-release-card__placeholder"
                    style={{ backgroundColor: playlist.artworkColor || "#555" }}
                  >
                    {CoverIcon && <CoverIcon className="artist-icon-lg" />}
                    {sourceLine && (
                      <span
                        className="discover-playlists-page__cover-label"
                        style={{ color: getPlaylistTextColor(playlist) }}
                      >
                        {sourceLine}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="artist-release-card__meta-row">
                <div className="artist-release-card__meta-col">
                  {playlist.description && (
                    <p className="artist-release-card__meta artist-truncate">{playlist.description}</p>
                  )}
                  <p className="artist-release-card__meta">{playlist.trackCount || 0} tracks</p>
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <DiscoverPlaylistContextMenu
                    playlist={playlist}
                    canAdopt
                    adoptingFlowId={adoptingFlowId}
                    adoptingPlaylistId={adoptingPlaylistId}
                    onAdoptFlow={handleAdoptFlow}
                    onAdoptPlaylist={handleAdoptPlaylist}
                    triggerVariant="icon"
                  />
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
