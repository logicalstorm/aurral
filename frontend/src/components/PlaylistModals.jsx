import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ListMusic,
  Loader2,
  MoreVertical,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";

function ModalShell({
  open,
  title,
  description = "",
  onClose,
  children,
  footer,
  disableClose = false,
}) {
  if (!open) return null;
  return (
    <div
      className="playlist-modal-backdrop"
      onClick={disableClose ? undefined : onClose}
    >
      <div className="playlist-modal" onClick={(event) => event.stopPropagation()}>
        <div className="playlist-modal__header">
          <div className="playlist-modal__heading">
            <h3 className="playlist-modal__title">{title}</h3>
            {description ? (
              <p className="playlist-modal__description">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={disableClose ? undefined : onClose}
            className="btn btn-ghost btn-sm btn-icon"
            aria-label="Close"
            disabled={disableClose}
          >
            <X className="artist-icon-sm" />
          </button>
        </div>
        <div className="playlist-modal__body">{children}</div>
        {footer ? <div className="playlist-modal__footer">{footer}</div> : null}
      </div>
    </div>
  );
}

function normalizeTrackDraft(track, index) {
  return {
    rowId: `track-${index}`,
    artistName: String(track?.artistName || "").trim(),
    trackName: String(track?.trackName || "").trim(),
    albumName: String(track?.albumName || "").trim(),
    artistMbid: String(track?.artistMbid || "").trim(),
    albumMbid: String(track?.albumMbid || "").trim(),
    trackMbid: String(track?.trackMbid || "").trim(),
    releaseYear: String(track?.releaseYear || "").trim(),
    durationMs:
      track?.durationMs != null && Number.isFinite(Number(track.durationMs))
        ? Math.max(0, Math.round(Number(track.durationMs)))
        : null,
    artistAliases: Array.isArray(track?.artistAliases)
      ? track.artistAliases
          .map((entry) => String(entry || "").trim())
          .filter(Boolean)
      : [],
    reason: String(track?.reason || "").trim(),
  };
}

function buildTrackPayload(drafts) {
  return (Array.isArray(drafts) ? drafts : []).map((draft) => {
    const artistName = String(draft?.artistName || "").trim();
    const trackName = String(draft?.trackName || "").trim();
    const albumName = String(draft?.albumName || "").trim();
    if (!artistName || !trackName) {
      throw new Error("Each track needs both an artist and song name");
    }
    const artistMbid = String(draft?.artistMbid || "").trim();
    const albumMbid = String(draft?.albumMbid || "").trim();
    const trackMbid = String(draft?.trackMbid || "").trim();
    const releaseYear = String(draft?.releaseYear || "").trim();
    const reason = String(draft?.reason || "").trim();
    const durationMs =
      draft?.durationMs != null && Number.isFinite(Number(draft.durationMs))
        ? Math.max(0, Math.round(Number(draft.durationMs)))
        : null;
    const artistAliases = Array.isArray(draft?.artistAliases)
      ? draft.artistAliases
          .map((entry) => String(entry || "").trim())
          .filter(Boolean)
      : [];
    return {
      artistName,
      trackName,
      albumName: albumName || null,
      artistMbid: artistMbid || null,
      albumMbid: albumMbid || null,
      trackMbid: trackMbid || null,
      releaseYear: releaseYear || null,
      durationMs,
      artistAliases,
      reason: reason || null,
    };
  });
}

export function CreatePlaylistModal({
  open,
  defaultName = "",
  saving = false,
  error = "",
  onClose,
  onSubmit,
}) {
  const [name, setName] = useState(defaultName);
  const [localError, setLocalError] = useState("");
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setName(defaultName);
      setLocalError("");
    }
    wasOpenRef.current = open;
  }, [defaultName, open]);

  const handleSubmit = async () => {
    const nextName = String(name || "").trim();
    if (!nextName) {
      setLocalError("Playlist name is required");
      return;
    }
    setLocalError("");
    await onSubmit?.(nextName);
  };

  return (
    <ModalShell
      open={open}
      title="New Playlist"
      description="Create a manual playlist you can build up track by track."
      onClose={onClose}
      disableClose={saving}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary btn-sm"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="btn btn-primary btn-sm"
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="artist-icon-sm animate-spin" />
            ) : (
              <Plus className="artist-icon-sm" />
            )}
            Create Playlist
          </button>
        </>
      }
    >
      <div className="playlist-modal__fields">
        <label className="artist-field-label">Playlist Name</label>
        <input
          type="text"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (localError) setLocalError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSubmit();
            }
          }}
          className="input input--tall"
          placeholder="Night Drive"
          autoFocus
        />
        {localError || error ? (
          <p className="artist-error-text">{localError || error}</p>
        ) : null}
      </div>
    </ModalShell>
  );
}

export function RenamePlaylistModal({
  open,
  title,
  defaultName = "",
  displayName = "",
  artworkUrl = "",
  saving = false,
  coverBusy = false,
  error = "",
  coverError = "",
  onClose,
  onSubmit,
  onUpload,
  onRemoveCover,
  onGenerateCover,
}) {
  const [name, setName] = useState(defaultName);
  const [localError, setLocalError] = useState("");
  const [previewUrl, setPreviewUrl] = useState(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [coverMenuOpen, setCoverMenuOpen] = useState(false);
  const fileInputRef = useRef(null);
  const coverMenuRef = useRef(null);
  const wasOpenRef = useRef(false);
  const busy = saving || coverBusy;

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setName(defaultName);
      setLocalError("");
      setImageFailed(false);
      setCoverMenuOpen(false);
      setPreviewUrl((prev) => {
        if (prev?.startsWith("blob:")) {
          URL.revokeObjectURL(prev);
        }
        return null;
      });
    }
    wasOpenRef.current = open;
  }, [defaultName, open]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (coverMenuRef.current && !coverMenuRef.current.contains(event.target)) {
        setCoverMenuOpen(false);
      }
    };
    if (coverMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [coverMenuOpen]);

  useEffect(() => {
    setImageFailed(false);
  }, [artworkUrl]);

  useEffect(
    () => () => {
      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    },
    [previewUrl],
  );

  const handleSubmit = async () => {
    const nextName = String(name || "").trim();
    if (!nextName) {
      setLocalError("Name is required");
      return;
    }
    setLocalError("");
    await onSubmit?.(nextName);
  };

  const openFilePicker = () => {
    if (busy) return;
    fileInputRef.current?.click();
  };

  const handleRemove = async () => {
    setCoverMenuOpen(false);
    setPreviewUrl((prev) => {
      if (prev?.startsWith("blob:")) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
    setImageFailed(true);
    await onRemoveCover?.();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      setLocalError("Choose an image file");
      return;
    }
    const blobUrl = URL.createObjectURL(file);
    setPreviewUrl((prev) => {
      if (prev?.startsWith("blob:")) {
        URL.revokeObjectURL(prev);
      }
      return blobUrl;
    });
    setImageFailed(false);
    setLocalError("");
    await onUpload?.(file);
  };

  const coverSrc =
    previewUrl || (!imageFailed && artworkUrl ? artworkUrl : null);
  const fallbackLabel =
    String(displayName || name || "?")
      .trim()
      .charAt(0)
      .toUpperCase() || "?";
  const combinedError = localError || coverError || error;

  return (
    <ModalShell
      open={open}
      title={title}
      onClose={onClose}
      disableClose={busy}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="flow-page__hidden-input"
        onChange={handleFileChange}
      />
      <div className="playlist-modal__edit-layout">
        <div className="playlist-modal__edit-cover">
          <div
            className={`playlist-modal__cover-wrap${coverMenuOpen ? " is-menu-open" : ""}`}
            ref={coverMenuRef}
          >
            <button
              type="button"
              className="playlist-modal__cover-picker"
              disabled={busy}
              onClick={openFilePicker}
              aria-label="Change cover image"
            >
              {coverSrc ? (
                <img
                  src={coverSrc}
                  alt=""
                  onError={() => setImageFailed(true)}
                />
              ) : (
                <div className="playlist-modal__cover-fallback">
                  {fallbackLabel}
                </div>
              )}
              <span className="playlist-modal__cover-picker-overlay">
                Change image
              </span>
            </button>
            <div className="playlist-modal__cover-menu">
              <button
              type="button"
              className="btn btn-secondary btn-icon btn-sm playlist-modal__cover-menu-trigger"
              disabled={busy}
              aria-label="Cover image options"
              aria-expanded={coverMenuOpen}
              aria-haspopup="menu"
              onClick={(event) => {
                event.stopPropagation();
                setCoverMenuOpen((prev) => !prev);
              }}
            >
              <MoreVertical className="artist-icon-sm" />
              </button>
              {coverMenuOpen ? (
                <>
                  <button
                    type="button"
                    className="artist-backdrop-button playlist-modal__cover-menu-backdrop"
                    onClick={() => setCoverMenuOpen(false)}
                    aria-label="Close cover menu"
                  />
                  <div
                    className="artist-dropdown artist-dropdown--right playlist-modal__cover-dropdown"
                    role="menu"
                    onClick={() => setCoverMenuOpen(false)}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="artist-menu-item"
                      disabled={busy}
                      onClick={openFilePicker}
                    >
                      <span className="artist-menu-item__main">
                        <Upload className="artist-icon-sm" />
                        Upload
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="artist-menu-item"
                      disabled={busy}
                      onClick={() => onGenerateCover?.()}
                    >
                      <span className="artist-menu-item__main">
                        {coverBusy ? (
                          <Loader2 className="artist-icon-sm animate-spin" />
                        ) : (
                          <Sparkles className="artist-icon-sm" />
                        )}
                        Generate
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="artist-menu-item artist-menu-item--danger"
                      disabled={busy || !coverSrc}
                      onClick={handleRemove}
                    >
                      <span className="artist-menu-item__main">
                        <Trash2 className="artist-icon-sm" />
                        Remove
                      </span>
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
        <div className="playlist-modal__edit-panel">
          <div className="playlist-modal__edit-panel-main">
            <div className="artist-modal-field aurral-radius-round artist-modal-field--text">
              <input
                type="text"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (localError) setLocalError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleSubmit();
                  }
                }}
                className="artist-input"
                aria-label={title}
                autoFocus
              />
            </div>
            {combinedError ? (
              <p className="artist-error-text">{combinedError}</p>
            ) : null}
          </div>
          <div className="playlist-modal__edit-actions">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary btn-sm"
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="btn btn-primary btn-sm"
              disabled={busy}
            >
              {saving ? (
                <Loader2 className="artist-icon-sm animate-spin" />
              ) : (
                <Check className="artist-icon-sm" />
              )}
              Save
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

export function PlaylistTrackModal({
  open,
  title = "Add To Playlist",
  description = "",
  playlists = [],
  initialTracks = [],
  excludedPlaylistIds = [],
  defaultNewPlaylistName = "",
  saving = false,
  error = "",
  onClose,
  onSubmit,
}) {
  const availablePlaylists = useMemo(() => {
    const excluded = new Set(
      (Array.isArray(excludedPlaylistIds) ? excludedPlaylistIds : [])
        .map((entry) => String(entry || "").trim())
        .filter(Boolean),
    );
    return (Array.isArray(playlists) ? playlists : []).filter(
      (playlist) => !excluded.has(String(playlist?.id || "").trim()),
    );
  }, [excludedPlaylistIds, playlists]);

  const [targetMode, setTargetMode] = useState(
    availablePlaylists.length > 0 ? "existing" : "new",
  );
  const [playlistId, setPlaylistId] = useState("");
  const [playlistName, setPlaylistName] = useState(defaultNewPlaylistName);
  const [trackDrafts, setTrackDrafts] = useState(() =>
    (Array.isArray(initialTracks) ? initialTracks : []).map(normalizeTrackDraft),
  );
  const [localError, setLocalError] = useState("");
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setTargetMode(availablePlaylists.length > 0 ? "existing" : "new");
      setPlaylistId(String(availablePlaylists[0]?.id || ""));
      setPlaylistName(defaultNewPlaylistName);
      setTrackDrafts(
        (Array.isArray(initialTracks) ? initialTracks : []).map(
          normalizeTrackDraft,
        ),
      );
      setLocalError("");
    }
    wasOpenRef.current = open;
  }, [availablePlaylists, defaultNewPlaylistName, initialTracks, open]);

  const updateTrackField = (rowId, key, value) => {
    setTrackDrafts((prev) =>
      prev.map((track) =>
        track.rowId === rowId ? { ...track, [key]: value } : track,
      ),
    );
    if (localError) {
      setLocalError("");
    }
  };

  const handleSubmit = async () => {
    try {
      const tracks = buildTrackPayload(trackDrafts);
      if (tracks.length === 0) {
        throw new Error("No track is ready to add");
      }
      if (targetMode === "existing") {
        if (!playlistId) {
          throw new Error("Choose a playlist");
        }
        setLocalError("");
        await onSubmit?.({
          mode: "existing",
          playlistId,
          tracks,
        });
        return;
      }
      const nextName = String(playlistName || "").trim();
      if (!nextName) {
        throw new Error("Playlist name is required");
      }
      setLocalError("");
      await onSubmit?.({
        mode: "new",
        name: nextName,
        tracks,
      });
    } catch (submitError) {
      setLocalError(submitError?.message || "Failed to add track");
    }
  };

  return (
    <ModalShell
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      disableClose={saving}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary btn-sm"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="btn btn-primary btn-sm"
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="artist-icon-sm animate-spin" />
            ) : (
              <Check className="artist-icon-sm" />
            )}
            Save To Playlist
          </button>
        </>
      }
    >
      <div className="playlist-modal__section">
        {availablePlaylists.length > 0 ? (
          <div className="playlist-modal__segmented">
            <button
              type="button"
              onClick={() => setTargetMode("existing")}
              className={`playlist-modal__segment${
                targetMode === "existing" ? " is-active" : ""
              }`}
            >
              Existing Playlist
            </button>
            <button
              type="button"
              onClick={() => setTargetMode("new")}
              className={`playlist-modal__segment${
                targetMode === "new" ? " is-active" : ""
              }`}
            >
              New Playlist
            </button>
          </div>
        ) : null}

        {targetMode === "existing" && availablePlaylists.length > 0 ? (
          <div className="playlist-modal__fields">
            <label className="artist-field-label">Choose Playlist</label>
            <div className="playlist-modal__option-list">
              {availablePlaylists.map((playlist) => {
                const selected = playlistId === playlist.id;
                return (
                  <button
                    key={playlist.id}
                    type="button"
                    onClick={() => setPlaylistId(playlist.id)}
                    className={`playlist-modal__playlist-option${
                      selected ? " is-selected" : ""
                    }`}
                  >
                    <div className="playlist-modal__playlist-copy">
                      <div className="playlist-modal__playlist-name">
                        {playlist.name}
                      </div>
                      <div className="playlist-modal__playlist-meta">
                        {playlist.trackCount || 0} tracks
                      </div>
                    </div>
                    {selected ? (
                      <Check className="artist-icon-sm" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="playlist-modal__fields">
            <label className="artist-field-label">New Playlist Name</label>
            <input
              type="text"
              value={playlistName}
              onChange={(event) => {
                setPlaylistName(event.target.value);
                if (localError) setLocalError("");
              }}
              className="input input--tall"
              placeholder="Sunday picks"
            />
          </div>
        )}

        <div className="playlist-modal__tracks-panel">
          <div className="playlist-modal__tracks-header">
            <ListMusic className="artist-icon-xs" />
            Tracks
          </div>
          <div>
            {trackDrafts.map((track) => (
              <div key={track.rowId} className="playlist-modal__track-row">
                <div className="playlist-modal__track-field">
                  <label className="playlist-modal__track-label">Song</label>
                  <input
                    type="text"
                    value={track.trackName}
                    onChange={(event) =>
                      updateTrackField(
                        track.rowId,
                        "trackName",
                        event.target.value,
                      )
                    }
                    className="input input-sm"
                  />
                </div>
                <div className="playlist-modal__track-field">
                  <label className="playlist-modal__track-label">Artist</label>
                  <input
                    type="text"
                    value={track.artistName}
                    onChange={(event) =>
                      updateTrackField(
                        track.rowId,
                        "artistName",
                        event.target.value,
                      )
                    }
                    className="input input-sm"
                  />
                </div>
                <div className="playlist-modal__track-field">
                  <label className="playlist-modal__track-label">Album</label>
                  <input
                    type="text"
                    value={track.albumName}
                    onChange={(event) =>
                      updateTrackField(
                        track.rowId,
                        "albumName",
                        event.target.value,
                      )
                    }
                    className="input input-sm"
                    placeholder="Optional"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {localError || error ? (
          <p className="artist-error-text">{localError || error}</p>
        ) : null}
      </div>
    </ModalShell>
  );
}
