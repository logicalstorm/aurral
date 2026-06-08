import { db, dbHelpers } from "../config/db-sqlite.js";
import { applyV2Migration } from "../config/schema-migration-v2.js";
import { ensurePlaylistFilesystemLayout } from "../services/playlistFilesystemMigration.js";

export function migrateToV2({ logger = console } = {}) {
  const result = applyV2Migration(db, dbHelpers);
  const layout = ensurePlaylistFilesystemLayout({ logger });
  if (result.migrated || layout.renamed || layout.merged > 0 || layout.sidecarsMoved > 0) {
    logger.info?.(
      "[migrate:v2] Upgrade complete. Configure slskd in Settings → Integrations. If Navidrome still points at aurral-weekly-flow, restart Aurral or update the Aurral Weekly Flow library path to aurral-playlists.",
    );
  }
  return { ...result, layout };
}
