const SCHEMA_VERSION_KEY = "schemaVersion";
const TARGET_SCHEMA_VERSION = 2;
const LEGACY_LIBRARY_DIR = "aurral-weekly-flow";
const PLAYLIST_LIBRARY_DIR = "aurral-playlists";

function tableExists(db, name) {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(name);
  return !!row;
}

function tryAddColumn(db, sql) {
  try {
    db.exec(sql);
  } catch (error) {
    if (!String(error?.message || "").toLowerCase().includes("duplicate column name")) {
      throw error;
    }
  }
}

function migrateSettings(db, dbHelpers) {
  const getSettingStmt = db.prepare("SELECT value FROM settings WHERE key = ?");
  const upsertSettingStmt = db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
  );

  const flows = dbHelpers.parseJSON(getSettingStmt.get("flows")?.value);
  const playlists = dbHelpers.parseJSON(getSettingStmt.get("playlists")?.value);
  const weeklyFlows = dbHelpers.parseJSON(getSettingStmt.get("weeklyFlows")?.value);
  const weeklyFlowPlaylists = dbHelpers.parseJSON(
    getSettingStmt.get("weeklyFlowPlaylists")?.value,
  );
  const weeklyFlowWorker = dbHelpers.parseJSON(
    getSettingStmt.get("weeklyFlowWorker")?.value,
  );
  const playlistWorker = dbHelpers.parseJSON(
    getSettingStmt.get("playlistWorker")?.value,
  );

  if (!flows && weeklyFlows) {
    upsertSettingStmt.run("flows", dbHelpers.stringifyJSON(weeklyFlows));
  }
  if (!playlists && weeklyFlowPlaylists) {
    upsertSettingStmt.run(
      "playlists",
      dbHelpers.stringifyJSON(weeklyFlowPlaylists),
    );
  }
  if (!playlistWorker && weeklyFlowWorker) {
    upsertSettingStmt.run(
      "playlistWorker",
      dbHelpers.stringifyJSON({
        existingFileMode:
          weeklyFlowWorker.existingFileMode === "download"
            ? "download"
            : "reuse",
        retryPausedPlaylistIds: weeklyFlowWorker.retryPausedPlaylistIds || [],
      }),
    );
  }

  const integrations = dbHelpers.parseJSON(
    getSettingStmt.get("integrations")?.value,
  );
  if (integrations) {
    const next = { ...integrations };
    if (next.soulseek) {
      delete next.soulseek;
    }
    upsertSettingStmt.run("integrations", dbHelpers.stringifyJSON(next));
  }
}

function backfillSlskdSettings(db, dbHelpers) {
  const getSettingStmt = db.prepare("SELECT value FROM settings WHERE key = ?");
  const upsertSettingStmt = db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
  );
  const integrations = dbHelpers.parseJSON(
    getSettingStmt.get("integrations")?.value,
  );
  if (!integrations) return;
  const weeklyFlowWorker = dbHelpers.parseJSON(
    getSettingStmt.get("weeklyFlowWorker")?.value,
  );
  const slskd = { ...(integrations.slskd || {}) };
  let changed = false;
  if (!slskd.preferredFormat) {
    slskd.preferredFormat =
      String(weeklyFlowWorker?.preferredFormat || "").toLowerCase() === "mp3"
        ? "mp3"
        : "flac";
    changed = true;
  }
  if (slskd.preferredFormatStrict === undefined) {
    slskd.preferredFormatStrict =
      weeklyFlowWorker?.preferredFormatStrict === true;
    changed = true;
  }
  if (!changed) return;
  upsertSettingStmt.run(
    "integrations",
    dbHelpers.stringifyJSON({
      ...integrations,
      slskd,
    }),
  );
}

function migrateJobsTable(db) {
  if (tableExists(db, "weekly_flow_jobs")) {
    if (tableExists(db, "playlist_download_jobs")) {
      const playlistCount = Number(
        db.prepare("SELECT COUNT(*) AS count FROM playlist_download_jobs").get()
          .count || 0,
      );
      if (playlistCount === 0) {
        db.exec("DROP TABLE playlist_download_jobs");
      }
    }
    if (!tableExists(db, "playlist_download_jobs")) {
      db.exec("ALTER TABLE weekly_flow_jobs RENAME TO playlist_download_jobs");
    }
  }

  if (!tableExists(db, "playlist_download_jobs")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS playlist_download_jobs (
        id TEXT PRIMARY KEY,
        artist_name TEXT NOT NULL,
        track_name TEXT NOT NULL,
        album_name TEXT,
        reason TEXT,
        artist_mbid TEXT,
        album_mbid TEXT,
        track_mbid TEXT,
        release_year TEXT,
        duration_ms INTEGER,
        artist_aliases TEXT,
        playlist_id TEXT NOT NULL,
        playlist_type TEXT,
        status TEXT NOT NULL,
        staging_path TEXT,
        final_path TEXT,
        error TEXT,
        started_at INTEGER,
        completed_at INTEGER,
        created_at INTEGER NOT NULL,
        slskd_search_id TEXT,
        slskd_batch_id TEXT,
        remote_username TEXT,
        remote_filename TEXT
      );
    `);
  }

  const columns = db
    .prepare("PRAGMA table_info(playlist_download_jobs)")
    .all()
    .map((column) => column.name);

  if (!columns.includes("playlist_id")) {
    tryAddColumn(db, "ALTER TABLE playlist_download_jobs ADD COLUMN playlist_id TEXT");
  }
  if (!columns.includes("playlist_type")) {
    tryAddColumn(
      db,
      "ALTER TABLE playlist_download_jobs ADD COLUMN playlist_type TEXT",
    );
  }
  tryAddColumn(
    db,
    "ALTER TABLE playlist_download_jobs ADD COLUMN slskd_search_id TEXT",
  );
  tryAddColumn(
    db,
    "ALTER TABLE playlist_download_jobs ADD COLUMN slskd_batch_id TEXT",
  );
  tryAddColumn(
    db,
    "ALTER TABLE playlist_download_jobs ADD COLUMN remote_username TEXT",
  );
  tryAddColumn(
    db,
    "ALTER TABLE playlist_download_jobs ADD COLUMN remote_filename TEXT",
  );

  const latestColumns = db
    .prepare("PRAGMA table_info(playlist_download_jobs)")
    .all()
    .map((column) => column.name);

  if (latestColumns.includes("playlist_type")) {
    db.exec(`
      UPDATE playlist_download_jobs
      SET playlist_id = playlist_type
      WHERE playlist_id IS NULL OR TRIM(playlist_id) = '';
    `);
  }

  if (latestColumns.includes("started_at")) {
    db.exec(`
      UPDATE playlist_download_jobs
      SET status = 'pending',
          started_at = NULL,
          staging_path = NULL
      WHERE status = 'downloading';
    `);
  } else {
    db.exec(`
      UPDATE playlist_download_jobs
      SET status = 'pending'
      WHERE status = 'downloading';
    `);
  }

  if (latestColumns.includes("final_path")) {
    db.exec(`
      UPDATE playlist_download_jobs
      SET final_path = REPLACE(final_path, '${LEGACY_LIBRARY_DIR}', '${PLAYLIST_LIBRARY_DIR}')
      WHERE final_path LIKE '%${LEGACY_LIBRARY_DIR}%';
    `);
  }
  if (latestColumns.includes("staging_path")) {
    db.exec(`
      UPDATE playlist_download_jobs
      SET staging_path = REPLACE(staging_path, '${LEGACY_LIBRARY_DIR}', '${PLAYLIST_LIBRARY_DIR}')
      WHERE staging_path LIKE '%${LEGACY_LIBRARY_DIR}%';
    `);
  }

  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_playlist_download_jobs_status ON playlist_download_jobs(status)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_playlist_download_jobs_playlist_id ON playlist_download_jobs(playlist_id)",
  );
}

export function applyV2Migration(db, dbHelpers) {
  const getSettingStmt = db.prepare("SELECT value FROM settings WHERE key = ?");
  const upsertSettingStmt = db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
  );
  const currentVersion = Number(
    getSettingStmt.get(SCHEMA_VERSION_KEY)?.value || 1,
  );
  backfillSlskdSettings(db, dbHelpers);
  if (currentVersion >= TARGET_SCHEMA_VERSION) {
    migrateJobsTable(db);
    return { migrated: false, schemaVersion: currentVersion };
  }

  const run = db.transaction(() => {
    migrateSettings(db, dbHelpers);
    migrateJobsTable(db);
    upsertSettingStmt.run(SCHEMA_VERSION_KEY, String(TARGET_SCHEMA_VERSION));
  });
  run();
  return { migrated: true, schemaVersion: TARGET_SCHEMA_VERSION };
}
