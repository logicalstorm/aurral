import { randomUUID } from "crypto";
import { db } from "../config/db-sqlite.js";

function rowToJob(row) {
  return {
    id: row.id,
    artistName: row.artist_name,
    trackName: row.track_name,
    playlistType: row.playlist_type,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    stagingPath: row.staging_path,
    finalPath: row.final_path,
    error: row.error,
  };
}

const insertStmt = db.prepare(`
  INSERT INTO weekly_flow_jobs (id, artist_name, track_name, playlist_type, status, staging_path, final_path, error, started_at, completed_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateStmt = db.prepare(`
  UPDATE weekly_flow_jobs SET status = ?, staging_path = ?, final_path = ?, error = ?, started_at = ?, completed_at = ?
  WHERE id = ?
`);

const deleteStmt = db.prepare("DELETE FROM weekly_flow_jobs WHERE id = ?");
const deleteAllStmt = db.prepare("DELETE FROM weekly_flow_jobs");
const selectAllStmt = db.prepare("SELECT * FROM weekly_flow_jobs");
const updatePlaylistTypeStmt = db.prepare(
  "UPDATE weekly_flow_jobs SET playlist_type = ? WHERE playlist_type = ?",
);

export class WeeklyFlowDownloadTracker {
  constructor() {
    this.jobs = new Map();
    this._load();
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
          job.id,
        );
      }
      this.jobs.set(job.id, job);
    }
  }

  _insert(job) {
    const createdAt = job.createdAt ?? Date.now();
    job.createdAt = createdAt;
    insertStmt.run(
      job.id,
      job.artistName,
      job.trackName,
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
      job.id,
    );
  }

  addJob(artistName, trackName, playlistType) {
    const id = randomUUID();
    const job = {
      id,
      artistName,
      trackName,
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
    return id;
  }

  addJobs(tracks, playlistType) {
    const ids = [];
    for (const track of tracks) {
      const id = this.addJob(track.artistName, track.trackName, playlistType);
      ids.push(id);
    }
    return ids;
  }

  getJob(id) {
    return this.jobs.get(id) || null;
  }

  getNextPending() {
    for (const job of this.jobs.values()) {
      if (job.status === "pending") {
        return job;
      }
    }
    return null;
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
    job.status = "downloading";
    job.startedAt = Date.now();
    if (stagingPath) {
      job.stagingPath = stagingPath;
    }
    this._update(job);
    return true;
  }

  setDone(id, finalPath) {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.status = "done";
    job.completedAt = Date.now();
    job.finalPath = finalPath;
    this._update(job);
    return true;
  }

  setFailed(id, error) {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.status = "failed";
    job.completedAt = Date.now();
    job.error =
      typeof error === "string" ? error : (error && error.message) || null;
    this._update(job);
    return true;
  }

  getByPlaylistType(playlistType) {
    const jobs = [];
    for (const job of this.jobs.values()) {
      if (job.playlistType === playlistType) {
        jobs.push(job);
      }
    }
    return jobs;
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
    return count;
  }

  resetDownloadingToPending() {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.status === "downloading") {
        job.status = "pending";
        job.startedAt = null;
        job.stagingPath = null;
        this._update(job);
        count++;
      }
    }
    return count;
  }

  getAll() {
    return Array.from(this.jobs.values());
  }

  getStats() {
    const stats = {
      total: this.jobs.size,
      pending: 0,
      downloading: 0,
      done: 0,
      failed: 0,
    };
    for (const job of this.jobs.values()) {
      stats[job.status] = (stats[job.status] || 0) + 1;
    }
    return stats;
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
    return toDelete.length;
  }

  clearAll() {
    const count = this.jobs.size;
    this.jobs.clear();
    deleteAllStmt.run();
    return count;
  }
}

export const downloadTracker = new WeeklyFlowDownloadTracker();
