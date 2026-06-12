import { useState } from "react";
import PropTypes from "prop-types";
import { confirmV2Migration } from "../utils/api";

function buildChangeList(preview) {
  const items = [
    "Flow and playlist settings move to the v2 schema.",
    "The download jobs table is upgraded for playlist downloads.",
    "In-progress playlist downloads are reset to pending.",
  ];
  if (preview?.hasLegacyPlaylistDirectory) {
    items.push(
      `Playlist files in ${preview.legacyLibraryDir} are moved to ${preview.playlistLibraryDir}.`,
    );
  }
  if (preview?.hasSoulseekIntegration) {
    items.push(
      "Built-in Soulseek settings are removed during migration.",
    );
  }
  items.push(
    "Soulseek downloads now require a separate slskd instance configured in Settings -> Integrations.",
  );
  return items;
}

export default function V2MigrationModal({ preview, appVersion, onComplete }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showDowngrade, setShowDowngrade] = useState(false);

  const handleContinue = async () => {
    setSubmitting(true);
    setError("");
    try {
      await confirmV2Migration();
      onComplete?.();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          err?.message ||
          "Migration failed. Your database has not been changed.",
      );
      setSubmitting(false);
    }
  };

  const changes = buildChangeList(preview);

  return (
    <div className="v2-migration-screen">
      <div className="artist-modal v2-migration-modal">
        <h2 className="artist-modal__title">Upgrade to Aurral v2</h2>
        <p className="artist-modal__copy">
          This release includes a one-time database and filesystem migration.
          It cannot be reversed from inside Aurral.
        </p>

        <div className="v2-migration-modal__section">
          <h3 className="v2-migration-modal__heading">What changes</h3>
          <ul className="v2-migration-modal__list">
            {changes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        {(preview?.flowCount > 0 ||
          preview?.sharedPlaylistCount > 0 ||
          preview?.weeklyFlowJobCount > 0) && (
          <div className="v2-migration-modal__section">
            <h3 className="v2-migration-modal__heading">Detected data</h3>
            <ul className="v2-migration-modal__list v2-migration-modal__list--compact">
              {preview.flowCount > 0 && (
                <li>
                  {preview.flowCount} flow
                  {preview.flowCount === 1 ? "" : "s"}
                </li>
              )}
              {preview.sharedPlaylistCount > 0 && (
                <li>
                  {preview.sharedPlaylistCount} shared playlist
                  {preview.sharedPlaylistCount === 1 ? "" : "s"}
                </li>
              )}
              {preview.weeklyFlowJobCount > 0 && (
                <li>
                  {preview.weeklyFlowJobCount} queued download job
                  {preview.weeklyFlowJobCount === 1 ? "" : "s"}
                </li>
              )}
            </ul>
          </div>
        )}

        <div className="v2-migration-modal__callout">
          <strong>External slskd required.</strong> Playlist downloads no longer
          use Aurral&apos;s built-in Soulseek integration. Plan to run slskd
          separately and connect it in Settings before relying on playlist
          downloads again.
        </div>

        {showDowngrade ? (
          <div className="v2-migration-modal__downgrade">
            <h3 className="v2-migration-modal__heading">Stay on v1 instead</h3>
            <p className="artist-modal__subcopy">
              Migration has not started yet. To remain on v1, stop this
              container and pin a 1.x image tag instead of{" "}
              <code>:latest</code>, for example{" "}
              <code>ghcr.io/lklynet/aurral:1.76.0</code>. Restart with that
              image before using Aurral again.
            </p>
          </div>
        ) : null}

        {error ? <p className="v2-migration-modal__error">{error}</p> : null}

        <div className="artist-modal__actions v2-migration-modal__actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowDowngrade((value) => !value)}
            disabled={submitting}
          >
            {showDowngrade ? "Hide downgrade steps" : "Stay on v1"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleContinue}
            disabled={submitting}
          >
            {submitting ? "Migrating..." : "Continue with v2"}
          </button>
        </div>

        {appVersion ? (
          <p className="v2-migration-modal__version">Release {appVersion}</p>
        ) : null}
      </div>
    </div>
  );
}

V2MigrationModal.propTypes = {
  preview: PropTypes.shape({
    flowCount: PropTypes.number,
    sharedPlaylistCount: PropTypes.number,
    weeklyFlowJobCount: PropTypes.number,
    hasSoulseekIntegration: PropTypes.bool,
    hasLegacyPlaylistDirectory: PropTypes.bool,
    legacyLibraryDir: PropTypes.string,
    playlistLibraryDir: PropTypes.string,
  }),
  appVersion: PropTypes.string,
  onComplete: PropTypes.func,
};
