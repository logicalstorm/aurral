import { db, dbHelpers } from "./db-sqlite.js";

export const dbOps = {
  getSettings() {
    const integrations = dbHelpers.parseJSON(
      db.prepare("SELECT value FROM settings WHERE key = ?").get("integrations")
        ?.value,
    );
    const quality = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("quality")?.value;
    const queueCleaner = dbHelpers.parseJSON(
      db.prepare("SELECT value FROM settings WHERE key = ?").get("queueCleaner")
        ?.value,
    );
    const rootFolderPath = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("rootFolderPath")?.value;
    const releaseTypes = dbHelpers.parseJSON(
      db.prepare("SELECT value FROM settings WHERE key = ?").get("releaseTypes")
        ?.value,
    );
    const weeklyFlowPlaylists = dbHelpers.parseJSON(
      db
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get("weeklyFlowPlaylists")?.value,
    );
    const onboardingComplete =
      db.prepare("SELECT value FROM settings WHERE key = ?").get("onboardingComplete")?.value === "true";

    const defaultFlowPlaylists = {
      discover: { enabled: false, nextRunAt: null },
      mix: { enabled: false, nextRunAt: null },
      trending: { enabled: false, nextRunAt: null },
    };
    const merged = weeklyFlowPlaylists
      ? { ...defaultFlowPlaylists, ...weeklyFlowPlaylists }
      : defaultFlowPlaylists;
    if (merged.recommended) {
      merged.discover = {
        ...defaultFlowPlaylists.discover,
        ...merged.discover,
        ...merged.recommended,
      };
    }
    delete merged.recommended;

    return {
      integrations: integrations || {},
      quality: quality || "standard",
      queueCleaner: queueCleaner || {},
      rootFolderPath: rootFolderPath || null,
      releaseTypes: releaseTypes || [],
      weeklyFlowPlaylists: merged,
      onboardingComplete: !!onboardingComplete,
    };
  },

  updateSettings(settings) {
    const stmt = db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    );

    if (settings.integrations) {
      stmt.run("integrations", dbHelpers.stringifyJSON(settings.integrations));
    }
    if (settings.quality) {
      stmt.run("quality", settings.quality);
    }
    if (settings.queueCleaner) {
      stmt.run("queueCleaner", dbHelpers.stringifyJSON(settings.queueCleaner));
    }
    if (
      settings.rootFolderPath !== undefined &&
      settings.rootFolderPath !== null
    ) {
      stmt.run("rootFolderPath", settings.rootFolderPath);
    }
    if (settings.releaseTypes) {
      stmt.run("releaseTypes", dbHelpers.stringifyJSON(settings.releaseTypes));
    }
    if (settings.weeklyFlowPlaylists !== undefined) {
      stmt.run(
        "weeklyFlowPlaylists",
        dbHelpers.stringifyJSON(settings.weeklyFlowPlaylists),
      );
    }
    if (settings.onboardingComplete !== undefined) {
      stmt.run(
        "onboardingComplete",
        settings.onboardingComplete ? "true" : "false",
      );
    }
  },

  getDiscoveryCache() {
    const recommendations = dbHelpers.parseJSON(
      db
        .prepare(
          "SELECT value, last_updated FROM discovery_cache WHERE key = ?",
        )
        .get("recommendations")?.value,
    );
    const globalTop = dbHelpers.parseJSON(
      db
        .prepare(
          "SELECT value, last_updated FROM discovery_cache WHERE key = ?",
        )
        .get("globalTop")?.value,
    );
    const basedOn = dbHelpers.parseJSON(
      db
        .prepare(
          "SELECT value, last_updated FROM discovery_cache WHERE key = ?",
        )
        .get("basedOn")?.value,
    );
    const topTags = dbHelpers.parseJSON(
      db
        .prepare(
          "SELECT value, last_updated FROM discovery_cache WHERE key = ?",
        )
        .get("topTags")?.value,
    );
    const topGenres = dbHelpers.parseJSON(
      db
        .prepare(
          "SELECT value, last_updated FROM discovery_cache WHERE key = ?",
        )
        .get("topGenres")?.value,
    );
    const lastUpdated = db
      .prepare(
        "SELECT last_updated FROM discovery_cache ORDER BY last_updated DESC LIMIT 1",
      )
      .get()?.last_updated;

    return {
      recommendations: recommendations || [],
      globalTop: globalTop || [],
      basedOn: basedOn || [],
      topTags: topTags || [],
      topGenres: topGenres || [],
      lastUpdated,
    };
  },

  updateDiscoveryCache(discovery) {
    const stmt = db.prepare(
      "INSERT OR REPLACE INTO discovery_cache (key, value, last_updated) VALUES (?, ?, ?)",
    );
    const now = new Date().toISOString();

    if (discovery.recommendations) {
      stmt.run(
        "recommendations",
        dbHelpers.stringifyJSON(discovery.recommendations),
        now,
      );
    }
    if (discovery.globalTop) {
      stmt.run("globalTop", dbHelpers.stringifyJSON(discovery.globalTop), now);
    }
    if (discovery.basedOn) {
      stmt.run("basedOn", dbHelpers.stringifyJSON(discovery.basedOn), now);
    }
    if (discovery.topTags) {
      stmt.run("topTags", dbHelpers.stringifyJSON(discovery.topTags), now);
    }
    if (discovery.topGenres) {
      stmt.run("topGenres", dbHelpers.stringifyJSON(discovery.topGenres), now);
    }
  },

  getImage(mbid) {
    const row = db
      .prepare("SELECT * FROM images_cache WHERE mbid = ?")
      .get(mbid);
    if (!row) return null;
    return {
      mbid: row.mbid,
      imageUrl: row.image_url,
      cacheAge: row.cache_age,
    };
  },

  setImage(mbid, imageUrl) {
    const stmt = db.prepare(
      "INSERT OR REPLACE INTO images_cache (mbid, image_url, cache_age, created_at) VALUES (?, ?, ?, ?)",
    );
    stmt.run(mbid, imageUrl, Date.now(), new Date().toISOString());
  },

  getAllImages() {
    const rows = db.prepare("SELECT * FROM images_cache").all();
    const images = {};
    for (const row of rows) {
      images[row.mbid] = row.image_url;
    }
    return images;
  },

  deleteImage(mbid) {
    return db.prepare("DELETE FROM images_cache WHERE mbid = ?").run(mbid);
  },

  clearImages() {
    return db.prepare("DELETE FROM images_cache").run();
  },
};
