export function CommunityGuideModal({
  show,
  onClose,
  onApply,
}) {
  if (!show) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.75)" }}
      onClick={onClose}
    >
      <div
        className="card max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4">
          <h3 className="text-xl font-bold mb-2" style={{ color: "#fff" }}>
            Apply Davo&apos;s Recommended Settings
          </h3>
          <p className="mb-4" style={{ color: "#c1c1c3" }}>
            This will apply Davo&apos;s Community Lidarr Guide settings to your
            Lidarr instance:
          </p>
          <ul className="space-y-2 mb-4" style={{ color: "#c1c1c3" }}>
            <li className="flex items-start">
              <span className="mr-2">•</span>
              <span>Update quality definitions for FLAC and FLAC 24bit</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">•</span>
              <span>
                Add custom formats (Preferred Groups, CD, WEB, Lossless, Vinyl)
              </span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">•</span>
              <span>Update naming scheme</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">•</span>
              <span>
                Create <strong>&quot;Aurral - HQ&quot;</strong> quality profile
                (FLAC + MP3-320)
              </span>
            </li>
          </ul>
          <p className="text-xs" style={{ color: "#c1c1c3" }}>
            <a
              href="https://wiki.servarr.com/lidarr/community-guide"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: "#60a5fa" }}
            >
              Read the full guide
            </a>{" "}
            for more details on these settings.
          </p>
        </div>
        <div className="flex gap-3 justify-end mt-6">
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button onClick={onApply} className="btn btn-primary">
            Apply Settings
          </button>
        </div>
      </div>
    </div>
  );
}
