import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ListMusic, Loader2, Plus, X } from "lucide-react";

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
        <div className="playlist-modal__footer">{footer}</div>
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
