import { dbOps } from "../config/db-helpers.js";

const TYPES = ["discover", "mix", "trending"];
const DEFAULT = { enabled: false, nextRunAt: null };
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function getConfig() {
  const settings = dbOps.getSettings();
  const playlists = settings.weeklyFlowPlaylists || {};
  const out = {};
  for (const type of TYPES) {
    out[type] = { ...DEFAULT, ...(playlists[type] || {}) };
  }
  return out;
}

function setConfig(playlists) {
  const current = dbOps.getSettings();
  dbOps.updateSettings({
    ...current,
    weeklyFlowPlaylists: playlists,
  });
}

export const flowPlaylistConfig = {
  getPlaylists() {
    return getConfig();
  },

  isEnabled(playlistType) {
    const config = getConfig();
    return config[playlistType]?.enabled === true;
  },

  setEnabled(playlistType, enabled) {
    const config = getConfig();
    if (!TYPES.includes(playlistType)) return;
    config[playlistType] = { ...(config[playlistType] || DEFAULT), enabled };
    if (!enabled) {
      config[playlistType].nextRunAt = null;
    }
    setConfig(config);
  },

  setNextRunAt(playlistType, nextRunAt) {
    const config = getConfig();
    if (!TYPES.includes(playlistType)) return;
    config[playlistType] = {
      ...(config[playlistType] || DEFAULT),
      nextRunAt: nextRunAt ?? null,
    };
    setConfig(config);
  },

  scheduleNextRun(playlistType) {
    this.setNextRunAt(playlistType, Date.now() + WEEK_MS);
  },

  getDueForRefresh() {
    const config = getConfig();
    const now = Date.now();
    return TYPES.filter(
      (type) =>
        config[type]?.enabled &&
        config[type]?.nextRunAt != null &&
        config[type].nextRunAt <= now,
    );
  },
};
