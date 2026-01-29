import { randomUUID } from "crypto";

export class WeeklyFlowDownloadTracker {
  constructor() {
    this.jobs = new Map();
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
    };
    this.jobs.set(id, job);
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
    return true;
  }

  setDone(id, finalPath) {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.status = "done";
    job.completedAt = Date.now();
    job.finalPath = finalPath;
    return true;
  }

  setFailed(id, error) {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.status = "failed";
    job.completedAt = Date.now();
    job.error = error;
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
    }
    return toDelete.length;
  }

  clearAll() {
    const count = this.jobs.size;
    this.jobs.clear();
    return count;
  }
}

export const downloadTracker = new WeeklyFlowDownloadTracker();
