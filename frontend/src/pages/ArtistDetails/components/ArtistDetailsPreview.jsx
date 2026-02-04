import PropTypes from "prop-types";
import { Loader, Play, Pause } from "lucide-react";

export function ArtistDetailsPreview({
  loadingPreview,
  previewTracks,
  previewAudioRef,
  playingPreviewId,
  previewProgress,
  previewSnappingBack,
  handlePreviewPlay,
}) {
  return (
    <div className="card mb-4 p-4">
      <h2
        className="text-lg font-semibold mb-2 flex items-center"
        style={{ color: "#fff" }}
      >
        Preview
        {loadingPreview && (
          <Loader
            className="w-4 h-4 ml-2 animate-spin"
            style={{ color: "#c1c1c3" }}
          />
        )}
      </h2>
      {!loadingPreview && previewTracks.length > 0 && (
        <>
          <audio ref={previewAudioRef} />
          <ul className="space-y-0.5">
            {previewTracks.map((track) => (
              <li
                key={track.id}
                className="relative flex items-center gap-2 py-2 px-2 rounded hover:bg-black/30 transition-colors cursor-pointer overflow-hidden"
                style={{
                  backgroundColor:
                    playingPreviewId === track.id
                      ? "rgba(0,0,0,0.12)"
                      : undefined,
                }}
                onClick={() => handlePreviewPlay(track)}
              >
                {playingPreviewId === track.id && (
                  <div
                    className="absolute inset-0 rounded pointer-events-none"
                    style={{
                      width: `${previewProgress * 100}%`,
                      backgroundColor: "rgba(112, 126, 97, 0.55)",
                      transition: previewSnappingBack
                        ? "width 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)"
                        : "width 0.1s linear",
                      zIndex: 15,
                    }}
                  />
                )}
                <button
                  type="button"
                  className="relative z-10 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: "#211f27", color: "#fff" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePreviewPlay(track);
                  }}
                >
                  {playingPreviewId === track.id && !previewSnappingBack ? (
                    <Pause className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4 ml-0.5" />
                  )}
                </button>
                <div className="relative z-10 flex-1 min-w-0">
                  <div
                    className="text-sm font-medium truncate"
                    style={{ color: "#fff" }}
                  >
                    {track.title}
                  </div>
                  {track.album && (
                    <div
                      className="text-xs truncate"
                      style={{ color: "#c1c1c3" }}
                    >
                      {track.album}
                    </div>
                  )}
                </div>
                {track.duration_ms > 0 && (
                  <span
                    className="relative z-10 text-xs flex-shrink-0"
                    style={{ color: "#c1c1c3" }}
                  >
                    0:30
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {!loadingPreview && previewTracks.length === 0 && (
        <p className="text-xs italic" style={{ color: "#c1c1c3" }}>
          No preview available
        </p>
      )}
    </div>
  );
}

ArtistDetailsPreview.propTypes = {
  loadingPreview: PropTypes.bool.isRequired,
  previewTracks: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      title: PropTypes.string.isRequired,
      album: PropTypes.string,
      duration_ms: PropTypes.number,
    })
  ).isRequired,
  previewAudioRef: PropTypes.oneOfType([
    PropTypes.func,
    PropTypes.shape({ current: PropTypes.instanceOf(Element) }),
  ]).isRequired,
  playingPreviewId: PropTypes.string,
  previewProgress: PropTypes.number.isRequired,
  previewSnappingBack: PropTypes.bool.isRequired,
  handlePreviewPlay: PropTypes.func.isRequired,
};
