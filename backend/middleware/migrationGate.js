import { v2MigrationRuntime } from "../config/db-sqlite.js";

const MIGRATION_ALLOWED_PATHS = new Set([
  "/api/health/bootstrap",
  "/api/health/live",
  "/api/health/migrate-v2",
  "/api/filesystem/browse",
  "/api/filesystem/ensure",
]);

export function isV2MigrationPending() {
  return !!v2MigrationRuntime.pending;
}

export function clearV2MigrationPending() {
  v2MigrationRuntime.pending = false;
  v2MigrationRuntime.status = {
    required: false,
    schemaVersion: 2,
  };
}

export function createMigrationGateMiddleware() {
  return (req, res, next) => {
    if (!req.path.startsWith("/api")) {
      return next();
    }
    if (!isV2MigrationPending()) {
      return next();
    }
    if (MIGRATION_ALLOWED_PATHS.has(req.path)) {
      return next();
    }
    return res.status(503).json({
      error: "v2_migration_required",
      message: "Aurral v2 database migration is required before the app can start.",
    });
  };
}
