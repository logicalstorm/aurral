import { db, dbHelpers } from "../config/db-sqlite.js";
import {
  applyV2Migration,
  getV2MigrationStatus,
} from "../config/schema-migration-v2.js";
import { clearV2MigrationPending } from "../middleware/migrationGate.js";
import { ensurePlaylistFilesystemLayout } from "../services/playlistFilesystemMigration.js";

export function migrateToV2({ logger = console, force = false } = {}) {
  const status = getV2MigrationStatus(db, dbHelpers);
  if (!force && !status.required) {
    return {
      migrated: false,
      schemaVersion: status.schemaVersion,
      skipped: true,
      layout: ensurePlaylistFilesystemLayout({ logger }),
    };
  }
  const result = applyV2Migration(db, dbHelpers);
  const layout = ensurePlaylistFilesystemLayout({ logger });
  clearV2MigrationPending();
  if (result.migrated || layout.renamed || layout.merged > 0 || layout.sidecarsMoved > 0) {
    logger.info?.(
      "[migrate:v2] Upgrade complete. Configure slskd in Settings -> Integrations. If Navidrome still points at aurral-weekly-flow, restart Aurral or update the Aurral Playlists library path to aurral-playlists.",
    );
  }
  return { ...result, layout };
}
