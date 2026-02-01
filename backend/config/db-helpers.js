import { db, dbHelpers } from "./db-sqlite.js";

const getSettingStmt = db.prepare("SELECT value FROM settings WHERE key = ?");
const upsertSettingStmt = db.prepare(
  "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
);

const getDiscoveryCacheStmt = db.prepare(
  "SELECT value, last_updated FROM discovery_cache WHERE key = ?"
);
const getDiscoveryCacheLastUpdatedStmt = db.prepare(
  "SELECT last_updated FROM discovery_cache ORDER BY last_updated DESC LIMIT 1"
);
const upsertDiscoveryCacheStmt = db.prepare(
  "INSERT OR REPLACE INTO discovery_cache (key, value, last_updated) VALUES (?, ?, ?)"
);

const getImageStmt = db.prepare("SELECT * FROM images_cache WHERE mbid = ?");
const upsertImageStmt = db.prepare(
  "INSERT OR REPLACE INTO images_cache (mbid, image_url, cache_age, created_at) VALUES (?, ?, ?, ?)"
);
const getAllImagesStmt = db.prepare("SELECT * FROM images_cache");
const deleteImageStmt = db.prepare("DELETE FROM images_cache WHERE mbid = ?");
const clearImagesStmt = db.prepare("DELETE FROM images_cache");
const cleanOldImagesStmt = db.prepare(
  "DELETE FROM images_cache WHERE cache_age < ?"
);

export const dbOps = {
  getSettings() {
    const integrations = dbHelpers.parseJSON(
      getSettingStmt.get("integrations")?.value
    );
    const quality = getSettingStmt.get("quality")?.value;
    const queueCleaner = dbHelpers.parseJSON(
      getSettingStmt.get("queueCleaner")?.value
    );
    const rootFolderPath = getSettingStmt.get("rootFolderPath")?.value;
    const releaseTypes = dbHelpers.parseJSON(
      getSettingStmt.get("releaseTypes")?.value
    );
    const weeklyFlowPlaylists = dbHelpers.parseJSON(
      getSettingStmt.get("weeklyFlowPlaylists")?.value
    );
    const onboardingComplete =
      getSettingStmt.get("onboardingComplete")?.value === "true";

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
    if (settings.integrations) {
      upsertSettingStmt.run(
        "integrations",
        dbHelpers.stringifyJSON(settings.integrations)
      );
    }
    if (settings.quality) {
      upsertSettingStmt.run("quality", settings.quality);
    }
    if (settings.queueCleaner) {
      upsertSettingStmt.run(
        "queueCleaner",
        dbHelpers.stringifyJSON(settings.queueCleaner)
      );
    }
    if (
      settings.rootFolderPath !== undefined &&
      settings.rootFolderPath !== null
    ) {
      upsertSettingStmt.run("rootFolderPath", settings.rootFolderPath);
    }
    if (settings.releaseTypes) {
      upsertSettingStmt.run(
        "releaseTypes",
        dbHelpers.stringifyJSON(settings.releaseTypes)
      );
    }
    if (settings.weeklyFlowPlaylists !== undefined) {
      upsertSettingStmt.run(
        "weeklyFlowPlaylists",
        dbHelpers.stringifyJSON(settings.weeklyFlowPlaylists)
      );
    }
    if (settings.onboardingComplete !== undefined) {
      upsertSettingStmt.run(
        "onboardingComplete",
        settings.onboardingComplete ? "true" : "false"
      );
    }
  },

  getDiscoveryCache() {
    const recommendations = dbHelpers.parseJSON(
      getDiscoveryCacheStmt.get("recommendations")?.value
    );
    const globalTop = dbHelpers.parseJSON(
      getDiscoveryCacheStmt.get("globalTop")?.value
    );
    const basedOn = dbHelpers.parseJSON(
      getDiscoveryCacheStmt.get("basedOn")?.value
    );
    const topTags = dbHelpers.parseJSON(
      getDiscoveryCacheStmt.get("topTags")?.value
    );
    const topGenres = dbHelpers.parseJSON(
      getDiscoveryCacheStmt.get("topGenres")?.value
    );
    const lastUpdated = getDiscoveryCacheLastUpdatedStmt.get()?.last_updated;

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
    const now = new Date().toISOString();

    if (discovery.recommendations) {
      upsertDiscoveryCacheStmt.run(
        "recommendations",
        dbHelpers.stringifyJSON(discovery.recommendations),
        now
      );
    }
    if (discovery.globalTop) {
      upsertDiscoveryCacheStmt.run(
        "globalTop",
        dbHelpers.stringifyJSON(discovery.globalTop),
        now
      );
    }
    if (discovery.basedOn) {
      upsertDiscoveryCacheStmt.run(
        "basedOn",
        dbHelpers.stringifyJSON(discovery.basedOn),
        now
      );
    }
    if (discovery.topTags) {
      upsertDiscoveryCacheStmt.run(
        "topTags",
        dbHelpers.stringifyJSON(discovery.topTags),
        now
      );
    }
    if (discovery.topGenres) {
      upsertDiscoveryCacheStmt.run(
        "topGenres",
        dbHelpers.stringifyJSON(discovery.topGenres),
        now
      );
    }
  },

  getImage(mbid) {
    const row = getImageStmt.get(mbid);
    if (!row) return null;
    return {
      mbid: row.mbid,
      imageUrl: row.image_url,
      cacheAge: row.cache_age,
    };
  },

  setImage(mbid, imageUrl) {
    upsertImageStmt.run(mbid, imageUrl, Date.now(), new Date().toISOString());
  },

  getAllImages() {
    const rows = getAllImagesStmt.all();
    const images = {};
    for (const row of rows) {
      images[row.mbid] = row.image_url;
    }
    return images;
  },

  deleteImage(mbid) {
    return deleteImageStmt.run(mbid);
  },

  clearImages() {
    return clearImagesStmt.run();
  },

  cleanOldImageCache(maxAgeDays = 30) {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    return cleanOldImagesStmt.run(cutoff);
  },
};
