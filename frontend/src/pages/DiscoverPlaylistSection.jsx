import { useCallback, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { useNavigate } from "react-router-dom";
import { ListMusic, Loader2, Sparkles, Crosshair } from "lucide-react";
import { adoptDiscoverPlaylist } from "../utils/api";
import { useToast } from "../contexts/ToastContext";

const RECIPE_LABELS = {
  discover: "Discovery",
  mix: "Library",
  trending: "Trending",
  focus: "Focus",
  releaseRadar: "New releases",
};

const formatRecipe = (recipe) => {
  if (!recipe || typeof recipe !== "object") return [];
  return Object.entries(recipe)
    .map(([key, value]) => {
      const count = Number(value);
      if (!Number.isFinite(count) || count <= 0) return null;
      return {
        key,
        label: RECIPE_LABELS[key] || key,
        count,
      };
    })
    .filter(Boolean);
};

function DiscoverPlaylistCard({
  playlist,
  expanded,
  adopting,
  canAdopt,
  onToggle,
  onAdopt,
}) {
  const recipeItems = useMemo(
    () => formatRecipe(playlist.recipe),
    [playlist.recipe],
  );
  const focusTags = Array.isArray(playlist.tags) ? playlist.tags : [];
  const focusArtists = Array.isArray(playlist.relatedArtists)
    ? playlist.relatedArtists
    : [];

  return (
    <div className={`discover-playlist-card${expanded ? " is-expanded" : ""}`}>
      <button
        type="button"
        className="discover-playlist-card__header"
        onClick={() => onToggle(playlist.presetId)}
        aria-expanded={expanded}
      >
        <div
          className={`discover-playlist-card__icon-wrap${
            playlist.type === "focus"
              ? " discover-playlist-card__icon-wrap--focus"
              : ""
          }`}
        >
          {playlist.type === "release_radar" ? (
            <Sparkles className="discover-playlist-card__icon" />
          ) : playlist.type === "focus" ? (
            <Crosshair className="discover-playlist-card__icon" />
          ) : (
            <ListMusic className="discover-playlist-card__icon" />
          )}
        </div>
        <div className="discover-playlist-card__copy">
          <span className="discover-playlist-card__name">{playlist.name}</span>
          <span className="discover-playlist-card__meta">
            {playlist.trackCount} tracks
            {playlist.description ? ` · ${playlist.description}` : ""}
          </span>
        </div>
      </button>
      {expanded ? (
        <div className="discover-playlist-card__body">
          <div className="discover-playlist-card__recipe">
            <span className="discover-playlist-card__recipe-label">Recipe</span>
            <div className="discover-playlist-card__recipe-items">
              {recipeItems.map((item) => (
                <span
                  key={item.key}
                  className="discover-playlist-card__recipe-pill"
                >
                  {item.count} {item.label}
                </span>
              ))}
              {focusTags.map((tag) => (
                <span
                  key={`tag-${tag}`}
                  className="discover-playlist-card__recipe-pill discover-playlist-card__recipe-pill--focus"
                >
                  #{tag}
                </span>
              ))}
              {focusArtists.map((artist) => (
                <span
                  key={`artist-${artist}`}
                  className="discover-playlist-card__recipe-pill discover-playlist-card__recipe-pill--focus"
                >
                  ~{artist}
                </span>
              ))}
            </div>
          </div>
          <ol className="discover-playlist-card__tracks">
            {playlist.tracks.map((track, index) => (
              <li key={`${track.artistName}-${track.trackName}-${index}`}>
                <span className="discover-playlist-card__track-title">
                  {track.trackName}
                </span>
                <span className="discover-playlist-card__track-artist">
                  {track.artistName}
                  {track.albumName ? ` · ${track.albumName}` : ""}
                </span>
              </li>
            ))}
          </ol>
          {canAdopt ? (
            playlist.adoptedFlowId ? (
              <button
                type="button"
                className="btn btn-secondary discover-playlist-card__action"
                onClick={() => onAdopt(playlist, true)}
              >
                Open flow
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary discover-playlist-card__action"
                disabled={adopting}
                onClick={() => onAdopt(playlist, false)}
              >
                {adopting ? (
                  <>
                    <Loader2 className="artist-icon-sm animate-spin" />
                    Adding flow...
                  </>
                ) : (
                  "Add flow & download"
                )}
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

DiscoverPlaylistCard.propTypes = {
  playlist: PropTypes.shape({
    presetId: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    description: PropTypes.string,
    type: PropTypes.string,
    trackCount: PropTypes.number,
    recipe: PropTypes.object,
    tracks: PropTypes.arrayOf(PropTypes.object),
    adoptedFlowId: PropTypes.string,
  }).isRequired,
  expanded: PropTypes.bool.isRequired,
  adopting: PropTypes.bool.isRequired,
  canAdopt: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
  onAdopt: PropTypes.func.isRequired,
};

export function DiscoverPlaylistSection({
  playlists = [],
  canAdopt = false,
  onAdopted,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const [adoptingId, setAdoptingId] = useState(null);
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();

  const handleToggle = useCallback((presetId) => {
    setExpandedId((current) => (current === presetId ? null : presetId));
  }, []);

  const handleAdopt = useCallback(
    async (playlist, openExisting) => {
      if (openExisting && playlist.adoptedFlowId) {
        navigate(
          `/playlists?selected=${encodeURIComponent(playlist.adoptedFlowId)}`,
        );
        return;
      }
      setAdoptingId(playlist.presetId);
      try {
        const result = await adoptDiscoverPlaylist(playlist.presetId);
        const flowId = result?.flowId;
        onAdopted?.(playlist.presetId, flowId);
        showSuccess(
          result?.alreadyAdopted
            ? `Opened ${playlist.name}`
            : `Added ${playlist.name} and started downloads`,
        );
        if (flowId) {
          navigate(`/playlists?selected=${encodeURIComponent(flowId)}`);
        }
      } catch (error) {
        showError(
          error.response?.data?.message ||
            error.response?.data?.error ||
            error.message ||
            "Failed to add playlist flow",
        );
      } finally {
        setAdoptingId(null);
      }
    },
    [navigate, onAdopted, showError, showSuccess],
  );

  if (!Array.isArray(playlists) || playlists.length === 0) {
    return null;
  }

  return (
    <div className="discover-playlists">
      {playlists.map((playlist) => (
        <DiscoverPlaylistCard
          key={playlist.presetId}
          playlist={playlist}
          expanded={expandedId === playlist.presetId}
          adopting={adoptingId === playlist.presetId}
          canAdopt={canAdopt}
          onToggle={handleToggle}
          onAdopt={handleAdopt}
        />
      ))}
    </div>
  );
}

DiscoverPlaylistSection.propTypes = {
  playlists: PropTypes.arrayOf(PropTypes.object),
  canAdopt: PropTypes.bool,
  onAdopted: PropTypes.func,
};
