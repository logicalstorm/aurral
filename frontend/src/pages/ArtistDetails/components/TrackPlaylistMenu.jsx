import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Check, Loader, Plus } from "lucide-react";

export function TrackPlaylistMenu({
  playlists = [],
  loading = false,
  saving = false,
  error = "",
  defaultNewPlaylistName = "Playlist",
  onLoadPlaylists,
  onSelect,
  onOpenChange,
  menuVariant,
}) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
      onOpenChange?.(false);
    };
    const handleViewportChange = () => {
      setOpen(false);
      onOpenChange?.(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [onOpenChange, open]);

  const handleOpen = async (event) => {
    event.stopPropagation();
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const menuWidth = 256;
      setMenuPosition({
        top: rect.bottom + 8,
        left: Math.max(
          12,
          Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12),
        ),
      });
    }
    const nextOpen = !open;
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
    if (!open) {
      await onLoadPlaylists?.();
    }
  };

  const handleSelect = async (target) => {
    await onSelect?.(target);
    setOpen(false);
    onOpenChange?.(false);
  };

  return (
    <div className="artist-relative" ref={menuRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`artist-playlist-trigger${open ? " is-open" : ""}`}
        onClick={handleOpen}
        title="Add to playlist"
        aria-label="Add to playlist"
        aria-expanded={open}
        disabled={saving}
      >
        <span className="artist-playlist-trigger__icon">
          {saving ? (
            <Loader className="artist-icon-xs animate-spin" />
          ) : (
            <Plus className="artist-icon-xs" />
          )}
        </span>
        <span className="artist-playlist-trigger__label">
          Add to playlist
        </span>
      </button>

      {open ? (
        <div
          className={`artist-playlist-menu${menuVariant === "preview-tracks" ? " artist-playlist-menu--preview-tracks" : ""}`}
          style={{
            top: menuPosition.top,
            left: menuPosition.left,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          {loading ? (
            <div className="artist-menu-item">
              <Loader className="artist-icon-sm animate-spin" />
              Loading playlists
            </div>
          ) : (
            <>
              <button
                type="button"
                className="artist-menu-item"
                onClick={() =>
                  handleSelect({
                    mode: "new",
                    name: defaultNewPlaylistName,
                  })
                }
                disabled={saving}
              >
                <Plus className="artist-icon-sm" />
                <span className="artist-track-title">New playlist</span>
              </button>
              {Array.isArray(playlists) && playlists.length > 0 ? (
                <div className="artist-playlist-menu__scroll">
                  {playlists.map((playlist) => (
                    <button
                      key={playlist.id}
                      type="button"
                      className="artist-menu-item"
                      onClick={() =>
                        handleSelect({
                          mode: "existing",
                          playlistId: playlist.id,
                        })
                      }
                      disabled={saving}
                    >
                      <span className="artist-track-title">
                        {playlist.name}
                      </span>
                      <Check className="artist-icon-sm" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : null}
              {error ? (
                <div className="artist-error-text">
                  {error}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

TrackPlaylistMenu.propTypes = {
  playlists: PropTypes.array,
  loading: PropTypes.bool,
  saving: PropTypes.bool,
  error: PropTypes.string,
  defaultNewPlaylistName: PropTypes.string,
  onLoadPlaylists: PropTypes.func,
  onSelect: PropTypes.func,
  onOpenChange: PropTypes.func,
  menuVariant: PropTypes.oneOf(["preview-tracks"]),
};
