import { randomUUID } from "crypto";
import { db } from "../config/db-sqlite.js";

function rowToJob(row) {
  return {
    id: row.id,
    artistName: row.artist_name,
    trackName: row.track_name,
    albumName: row.album_name || null,
    reason: row.reason || null,
    artistMbid: row.artist_mbid || null,
    playlistType: row.playlist_type,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    stagingPath: row.staging_path,
    finalPath: row.final_path,
    error: row.error,
    createdAt: row.created_at,
  };
}

const insertStmt = db.prepare(`
  INSERT INTO weekly_flow_jobs (id, artist_name, track_name, album_name, reason, artist_mbid, playlist_type, status, staging_path, final_path, error, started_at, completed_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateStmt = db.prepare(`
  UPDATE weekly_flow_jobs SET status = ?, staging_path = ?, final_path = ?, error = ?, started_at = ?, completed_at = ?, album_name = ?
  WHERE id = ?
`);

const deleteStmt = db.prepare("DELETE FROM weekly_flow_jobs WHERE id = ?");
const deleteAllStmt = db.prepare("DELETE FROM weekly_flow_jobs");
const selectAllStmt = db.prepare(
  "SELECT * FROM weekly_flow_jobs ORDER BY created_at ASC, id ASC",
);
const updatePlaylistTypeStmt = db.prepare(
  "UPDATE weekly_flow_jobs SET playlist_type = ? WHERE playlist_type = ?",
);

const sortByCreatedAt = (jobs) =>
  jobs.sort((a, b) => {
    const aCreated = Number(a?.createdAt ?? 0);
    const bCreated = Number(b?.createdAt ?? 0);
    if (aCreated !== bCreated) return aCreated - bCreated;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });

export class WeeklyFlowDownloadTracker {
  constructor() {
    this.jobs = new Map();
    this.statsByPlaylistType = new Map();
    this.globalStats = this._emptyStats();
    this.pendingQueue = [];
    this.pendingSet = new Set();
    this._load();
  }

  _emptyStats() {
    return {
      total: 0,
      pending: 0,
      downloading: 0,
      done: 0,
      failed: 0,
    };
  }

  _cloneStats(stats) {
    return {
      total: Number(stats?.total || 0),
      pending: Number(stats?.pending || 0),
      downloading: Number(stats?.downloading || 0),
      done: Number(stats?.done || 0),
      failed: Number(stats?.failed || 0),
    };
  }

  _getOrCreatePlaylistStats(playlistType) {
    const key = String(playlistType || "");
    let stats = this.statsByPlaylistType.get(key);
    if (!stats) {
      stats = this._emptyStats();
      this.statsByPlaylistType.set(key, stats);
    }
    return stats;
  }

  _applyStatusDelta(playlistType, fromStatus, toStatus) {
    if (playlistType) {
      const stats = this._getOrCreatePlaylistStats(playlistType);
      if (fromStatus && stats[fromStatus] > 0) {
        stats[fromStatus] -= 1;
        stats.total = Math.max(0, stats.total - 1);
      }
      if (toStatus) {
        stats[toStatus] = (stats[toStatus] || 0) + 1;
        stats.total += 1;
      }
      if (stats.total <= 0) {
        this.statsByPlaylistType.delete(String(playlistType));
      }
    }
    if (fromStatus && this.globalStats[fromStatus] > 0) {
      this.globalStats[fromStatus] -= 1;
      this.globalStats.total = Math.max(0, this.globalStats.total - 1);
    }
    if (toStatus) {
      this.globalStats[toStatus] = (this.globalStats[toStatus] || 0) + 1;
      this.globalStats.total += 1;
    }
  }

  _rebuildStatsByPlaylistType() {
    this.statsByPlaylistType.clear();
    this.globalStats = this._emptyStats();
    this.pendingQueue = [];
    this.pendingSet = new Set();
    for (const job of this.jobs.values()) {
      this._applyStatusDelta(job.playlistType, null, job.status);
      if (job.status === "pending") {
        this.pendingQueue.push(job.id);
        this.pendingSet.add(job.id);
      }
    }
  }

  _load() {
    const rows = selectAllStmt.all();
    for (const row of rows) {
      const job = rowToJob(row);
      if (job.playlistType === "recommended") {
        job.playlistType = "discover";
        updateStmt.run(
          job.status,
          job.stagingPath,
          job.finalPath,
          job.error,
          job.startedAt,
          job.completedAt,
          job.albumName ?? null,
          job.id,
        );
        updatePlaylistTypeStmt.run("discover", "recommended");
      }
      if (job.status === "downloading") {
        job.status = "pending";
        job.startedAt = null;
        job.stagingPath = null;
        updateStmt.run(
          job.status,
          job.stagingPath,
          job.finalPath,
          job.error,
          job.startedAt,
          job.completedAt,
          job.albumName ?? null,
          job.id,
        );
      }
      this.jobs.set(job.id, job);
    }
    this._rebuildStatsByPlaylistType();
  }

  _insert(job) {
    const createdAt = job.createdAt ?? Date.now();
    job.createdAt = createdAt;
    insertStmt.run(
      job.id,
      job.artistName,
      job.trackName,
      job.albumName ?? null,
      job.reason ?? null,
      job.artistMbid ?? null,
      job.playlistType,
      job.status,
      job.stagingPath ?? null,
      job.finalPath ?? null,
      job.error ?? null,
      job.startedAt ?? null,
      job.completedAt ?? null,
      createdAt,
    );
  }

  _update(job) {
    updateStmt.run(
      job.status,
      job.stagingPath ?? null,
      job.finalPath ?? null,
      job.error ?? null,
      job.startedAt ?? null,
      job.completedAt ?? null,
      job.albumName ?? null,
      job.id,
    );
  }

  addJob(track, playlistType) {
    const id = randomUUID();
    const artistName = String(track?.artistName || "").trim();
    const trackName = String(track?.trackName || "").trim();
    if (!artistName || !trackName) {
      return null;
    }
    const job = {
      id,
      artistName,
      trackName,
      albumName: track?.albumName ? String(track.albumName).trim() : null,
      reason: track?.reason ? String(track.reason).trim() : null,
      artistMbid: track?.artistMbid ? String(track.artistMbid).trim() : null,
      playlistType,
      status: "pending",
      startedAt: null,
      completedAt: null,
      stagingPath: null,
      finalPath: null,
      error: null,
      createdAt: Date.now(),
    };
    this.jobs.set(id, job);
    this._insert(job);
    this._applyStatusDelta(playlistType, null, job.status);
    this.pendingQueue.push(id);
    this.pendingSet.add(id);
    return id;
  }

  addJobs(tracks, playlistType) {
    const ids = [];
    for (const track of tracks) {
      const id = this.addJob(track, playlistType);
      if (!id) continue;
      ids.push(id);
    }
    return ids;
  }

  getJob(id) {
    return this.jobs.get(id) || null;
  }

  removeJob(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    this.jobs.delete(id);
    this.pendingSet.delete(id);
    this.pendingQueue = this.pendingQueue.filter((entryId) => entryId !== id);
    this._applyStatusDelta(job.playlistType, job.status, null);
    deleteStmt.run(id);
    return true;
  }

  getNextPending() {
    while (this.pendingQueue.length > 0) {
      const nextId = this.pendingQueue[0];
      if (!this.pendingSet.has(nextId)) {
        this.pendingQueue.shift();
        continue;
      }
      const job = this.jobs.get(nextId);
      if (!job || job.status !== "pending") {
        this.pendingSet.delete(nextId);
        this.pendingQueue.shift();
        continue;
      }
      return job;
    }
    return null;
  }

  peekPending(limit = 10) {
    const max =
      Number.isFinite(Number(limit)) && Number(limit) > 0
        ? Math.floor(Number(limit))
        : 10;
    const jobs = [];
    for (const id of this.pendingQueue) {
      if (jobs.length >= max) break;
      if (!this.pendingSet.has(id)) continue;
      const job = this.jobs.get(id);
      if (!job || job.status !== "pending") continue;
      jobs.push(job);
    }
    return jobs;
  }

  getPending(limit = 10) {
    const pending = [];
    for (const job of this.jobs.values()) {
      if (job.status === "pending" && pending.length < limit) {
        pending.push(job);
      }
    }
    return pending;
  }

  setDownloading(id, stagingPath = null) {
    const job = this.jobs.get(id);
    if (!job) return false;
    const previousStatus = job.status;
    this.pendingSet.delete(id);
    job.status = "downloading";
    job.startedAt = Date.now();
    if (stagingPath) {
      job.stagingPath = stagingPath;
    }
    this._update(job);
    this._applyStatusDelta(job.playlistType, previousStatus, job.status);
    return true;
  }

  setPending(id, error = null) {
    const job = this.jobs.get(id);
    if (!job) return false;
    const previousStatus = job.status;
    job.status = "pending";
    job.startedAt = null;
    job.completedAt = null;
    job.stagingPath = null;
    job.error =
      typeof error === "string" ? error : (error && error.message) || null;
    this._update(job);
    this._applyStatusDelta(job.playlistType, previousStatus, job.status);
    if (!this.pendingSet.has(id)) {
      this.pendingSet.add(id);
      this.pendingQueue.push(id);
    }
    return true;
  }

  deferPendingToBack(id, error = null) {
    const job = this.jobs.get(id);
    if (!job || job.status !== "pending") return false;
    job.error =
      typeof error === "string" ? error : (error && error.message) || null;
    this._update(job);
    this.pendingQueue = this.pendingQueue.filter((entryId) => entryId !== id);
    this.pendingQueue.push(id);
    this.pendingSet.add(id);
    return true;
  }

  setDone(id, finalPath, albumName = null) {
    const job = this.jobs.get(id);
    if (!job) return false;
    const previousStatus = job.status;
    this.pendingSet.delete(id);
    job.status = "done";
    job.completedAt = Date.now();
    job.finalPath = finalPath;
    const safeAlbum = String(albumName || "").trim();
    if (safeAlbum) {
      job.albumName = safeAlbum;
    } else if (!job.albumName) {
      job.albumName = null;
    }
    this._update(job);
    this._applyStatusDelta(job.playlistType, previousStatus, job.status);
    return true;
  }

  setFailed(id, error) {
    const job = this.jobs.get(id);
    if (!job) return false;
    const previousStatus = job.status;
    this.pendingSet.delete(id);
    job.status = "failed";
    job.completedAt = Date.now();
    job.error =
      typeof error === "string" ? error : (error && error.message) || null;
    this._update(job);
    this._applyStatusDelta(job.playlistType, previousStatus, job.status);
    return true;
  }

  getByPlaylistType(playlistType, limit = null) {
    const jobs = [];
    const max =
      Number.isFinite(Number(limit)) && Number(limit) > 0
        ? Math.floor(Number(limit))
        : null;
    for (const job of this.jobs.values()) {
      if (job.playlistType === playlistType) {
        jobs.push(job);
        if (max != null && jobs.length >= max) {
          break;
        }
      }
    }
    if (max != null) {
      return jobs;
    }
    return sortByCreatedAt(jobs);
  }

  getByStatus(status) {
    const jobs = [];
    for (const job of this.jobs.values()) {
      if (job.status === status) {
        jobs.push(job);
      }
    }
    return jobs;
  }

  migratePlaylistTypes(idMap) {
    if (!idMap || idMap.size === 0) return 0;
    let count = 0;
    for (const [fromId, toId] of idMap.entries()) {
      updatePlaylistTypeStmt.run(toId, fromId);
      for (const job of this.jobs.values()) {
        if (job.playlistType === fromId) {
          job.playlistType = toId;
          count += 1;
        }
      }
    }
    this._rebuildStatsByPlaylistType();
    return count;
  }

  resetDownloadingToPending() {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.status === "downloading") {
        const previousStatus = job.status;
        job.status = "pending";
        job.startedAt = null;
        job.stagingPath = null;
        this._update(job);
        this._applyStatusDelta(job.playlistType, previousStatus, job.status);
        if (!this.pendingSet.has(job.id)) {
          this.pendingSet.add(job.id);
          this.pendingQueue.push(job.id);
        }
        count++;
      }
    }
    return count;
  }

  getAll() {
    return sortByCreatedAt(Array.from(this.jobs.values()));
  }

  getStats() {
    return this._cloneStats(this.globalStats);
  }

  getStatsByPlaylistType(playlistTypes = []) {
    const statsByType = {};
    if (Array.isArray(playlistTypes) && playlistTypes.length > 0) {
      for (const playlistType of playlistTypes) {
        statsByType[playlistType] = this._cloneStats(
          this.statsByPlaylistType.get(String(playlistType)) ||
            this._emptyStats(),
        );
      }
      return statsByType;
    }
    for (const [playlistType, stats] of this.statsByPlaylistType.entries()) {
      statsByType[playlistType] = this._cloneStats(stats);
    }
    return statsByType;
  }

  getPlaylistTypeStats(playlistType) {
    return this._cloneStats(
      this.statsByPlaylistType.get(String(playlistType)) || this._emptyStats(),
    );
  }

  clearCompleted() {
    const toDelete = [];
    for (const [id, job] of this.jobs.entries()) {
      if (job.status === "done" || job.status === "failed") {
        toDelete.push(id);
      }
    }
    for (const id of toDelete) {
      this.jobs.delete(id);
      deleteStmt.run(id);
    }
    if (toDelete.length > 0) {
      this._rebuildStatsByPlaylistType();
    }
    return toDelete.length;
  }

  clearByPlaylistType(playlistType) {
    const toDelete = [];
    for (const [id, job] of this.jobs.entries()) {
      if (job.playlistType === playlistType) {
        toDelete.push(id);
      }
    }
    for (const id of toDelete) {
      this.jobs.delete(id);
      deleteStmt.run(id);
    }
    if (toDelete.length > 0) {
      this._rebuildStatsByPlaylistType();
    }
    return toDelete.length;
  }

  clearAll() {
    const count = this.jobs.size;
    this.jobs.clear();
    this.statsByPlaylistType.clear();
    this.globalStats = this._emptyStats();
    this.pendingQueue = [];
    this.pendingSet = new Set();
    deleteAllStmt.run();
    return count;
  }
}

export const downloadTracker = new WeeklyFlowDownloadTracker();
