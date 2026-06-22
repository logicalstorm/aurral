import { randomUUID } from 'crypto';
import { db } from '../config/db-sqlite.js';
import { enqueuePipelineJob } from './honkerDb.js';
import { isAnyDownloadSourceConfigured } from './downloadSourceService.js';
import { buildPlaylistDestination } from './playlistPaths.js';
import {
  normalizePositiveInteger,
  normalizeStringList,
  parseStringListJson,
  sanitizePathPart,
  stringifyStringListJson,
} from './playlistDownloadUtils.js';

const JOBS_TABLE = 'playlist_download_jobs';

interface Job {
  [key: string]: string | number | boolean | null | string[] | undefined;
  id: string;
  artistName: string;
  trackName: string;
  albumName: string | null;
  reason: string | null;
  artistMbid: string | null;
  albumMbid: string | null;
  trackMbid: string | null;
  releaseYear: string | null;
  durationMs: number | null;
  trackNumber: number | null;
  albumTrackCount: number | null;
  albumTrackTitles: string[];
  artistAliases: string[];
  playlistId: string;
  playlistType: string;
  status: string;
  startedAt: number | null;
  completedAt: number | null;
  stagingPath: string | null;
  finalPath: string | null;
  externalPath: string | null;
  error: string | null;
  createdAt: number;
  downloadSource: string | null;
  downloadClient: string | null;
  downloadClientId: string | null;
  releaseGuid: string | null;
  releaseTitle: string | null;
  indexerId: string | null;
  indexerName: string | null;
  slskdSearchId: string | null;
  slskdBatchId: string | null;
  remoteUsername: string | null;
  remoteFilename: string | null;
  retryCycle: boolean;
}

function rowToJob(row: Record<string, unknown>): Job {
  const s = (v: unknown): string | null => (v != null ? String(v) : null);
  const n = (v: unknown): number | null =>
    v != null && Number.isFinite(Number(v)) ? Number(v) : null;
  return {
    id: row.id as string,
    artistName: row.artist_name as string,
    trackName: row.track_name as string,
    albumName: s(row.album_name),
    reason: s(row.reason),
    artistMbid: s(row.artist_mbid),
    albumMbid: s(row.album_mbid),
    trackMbid: s(row.track_mbid),
    releaseYear: s(row.release_year),
    durationMs: n(row.duration_ms),
    trackNumber: normalizePositiveInteger(row.track_number),
    albumTrackCount: normalizePositiveInteger(row.album_track_count),
    albumTrackTitles: parseStringListJson(row.album_track_titles),
    artistAliases: parseStringListJson(row.artist_aliases),
    playlistId: (row.playlist_id || row.playlist_type) as string,
    playlistType: (row.playlist_type || row.playlist_id) as string,
    status: row.status as string,
    startedAt: n(row.started_at),
    completedAt: n(row.completed_at),
    stagingPath: s(row.staging_path),
    finalPath: s(row.final_path),
    externalPath: s(row.external_path),
    error: s(row.error),
    createdAt: row.created_at as number,
    downloadSource: s(row.download_source),
    downloadClient: s(row.download_client),
    downloadClientId: s(row.download_client_id),
    releaseGuid: s(row.release_guid),
    releaseTitle: s(row.release_title),
    indexerId: s(row.indexer_id),
    indexerName: s(row.indexer_name),
    slskdSearchId: s(row.slskd_search_id),
    slskdBatchId: s(row.slskd_batch_id),
    remoteUsername: s(row.remote_username),
    remoteFilename: s(row.remote_filename),
    retryCycle: false,
  };
}

const insertStmt = db.prepare(`
  INSERT INTO ${JOBS_TABLE} (
    id,
    artist_name,
    track_name,
    album_name,
    reason,
    artist_mbid,
    album_mbid,
    track_mbid,
    release_year,
    duration_ms,
    track_number,
    album_track_count,
    album_track_titles,
    artist_aliases,
    playlist_id,
    playlist_type,
    status,
    staging_path,
    final_path,
    external_path,
    error,
    started_at,
    completed_at,
    created_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateStmt = db.prepare(`
  UPDATE ${JOBS_TABLE}
  SET status = ?,
      staging_path = ?,
      final_path = ?,
      external_path = ?,
      error = ?,
      started_at = ?,
      completed_at = ?,
      album_name = ?,
      reason = ?,
      artist_mbid = ?,
      album_mbid = ?,
      track_mbid = ?,
      release_year = ?,
      duration_ms = ?,
      track_number = ?,
      album_track_count = ?,
      album_track_titles = ?,
      artist_aliases = ?
  WHERE id = ?
`);

const deleteStmt = db.prepare(`DELETE FROM ${JOBS_TABLE} WHERE id = ?`);
const deleteAllStmt = db.prepare(`DELETE FROM ${JOBS_TABLE}`);
const selectAllStmt = db.prepare(`SELECT * FROM ${JOBS_TABLE} ORDER BY created_at ASC, id ASC`);
const updatePlaylistTypeStmt = db.prepare(
  `UPDATE ${JOBS_TABLE} SET playlist_type = ?, playlist_id = ? WHERE playlist_type = ?`,
);
const clearSlskdMetaStmt = db.prepare(`
  UPDATE ${JOBS_TABLE}
  SET download_source = NULL,
      download_client = NULL,
      download_client_id = NULL,
      release_guid = NULL,
      release_title = NULL,
      indexer_id = NULL,
      indexer_name = NULL,
      slskd_search_id = NULL,
      slskd_batch_id = NULL,
      remote_username = NULL,
      remote_filename = NULL
  WHERE id = ?
`);

const clearTransientPipelineMetaStmt = db.prepare(`
  UPDATE ${JOBS_TABLE}
  SET slskd_search_id = NULL,
      slskd_batch_id = NULL
  WHERE id = ?
`);

const updateDownloadMetaStmt = db.prepare(`
  UPDATE ${JOBS_TABLE}
  SET download_source = COALESCE(?, download_source),
      download_client = COALESCE(?, download_client),
      download_client_id = COALESCE(?, download_client_id),
      release_guid = COALESCE(?, release_guid),
      release_title = COALESCE(?, release_title),
      indexer_id = COALESCE(?, indexer_id),
      indexer_name = COALESCE(?, indexer_name),
      remote_username = COALESCE(?, remote_username),
      remote_filename = COALESCE(?, remote_filename)
  WHERE id = ?
`);

const sortByCreatedAt = (jobs: Job[]) =>
  jobs.sort((a: Job, b: Job) => {
    const aCreated = Number(a?.createdAt ?? 0);
    const bCreated = Number(b?.createdAt ?? 0);
    if (aCreated !== bCreated) return aCreated - bCreated;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });

function buildPipelinePayload(job: Job) {
  const playlistId = job.playlistId || job.playlistType;
  const artistDir = sanitizePathPart(job.artistName, 'Unknown Artist');
  const albumDir = sanitizePathPart(job.albumName, 'Unknown Album');
  return {
    phase: 'search',
    jobId: job.id,
    playlistId,
    track: {
      artistName: job.artistName,
      trackName: job.trackName,
      albumName: job.albumName,
      artistMbid: job.artistMbid,
      albumMbid: job.albumMbid,
      trackMbid: job.trackMbid,
      releaseYear: job.releaseYear,
      durationMs: job.durationMs,
      trackNumber: job.trackNumber,
      albumTrackCount: job.albumTrackCount,
      albumTrackTitles: job.albumTrackTitles || [],
      artistAliases: job.artistAliases || [],
    },
    attempt: 0,
    destination: buildPlaylistDestination(playlistId, artistDir, albumDir),
  };
}

export class WeeklyFlowDownloadTracker {
  private jobs: Map<string, Job>;
  private statsByPlaylistType: Map<string, Record<string, number>>;
  private globalStats: Record<string, number>;
  private pendingFreshQueue: string[];
  private pendingRetryQueue: string[];
  private pendingSet: Set<string>;
  private pendingRetrySet: Set<string>;
  private slskdDispatched: Set<string>;
  private revision: number;

  constructor() {
    this.jobs = new Map();
    this.statsByPlaylistType = new Map();
    this.globalStats = this._emptyStats();
    this.pendingFreshQueue = [];
    this.pendingRetryQueue = [];
    this.pendingSet = new Set();
    this.pendingRetrySet = new Set();
    this.slskdDispatched = new Set();
    this.revision = 0;
    this._load();
  }

  _touchRevision() {
    this.revision += 1;
  }

  isSlskdDispatched(id: string) {
    const job = this.jobs.get(id);
    return this.slskdDispatched.has(id) || !!job?.slskdBatchId || !!job?.slskdSearchId;
  }

  markSlskdDispatched(id: string) {
    this.slskdDispatched.add(id);
  }

  clearSlskdDispatched(id: string) {
    this.slskdDispatched.delete(id);
  }

  clearSlskdPipelineState(id: string, options: { clearDownloadMetadata?: boolean } = {}) {
    const clearDownloadMetadata = options.clearDownloadMetadata !== false;
    this.clearSlskdDispatched(id);
    const job = this.jobs.get(id);
    if (job) {
      if (clearDownloadMetadata) {
        job.downloadSource = null;
        job.downloadClient = null;
        job.downloadClientId = null;
        job.releaseGuid = null;
        job.releaseTitle = null;
        job.indexerId = null;
        job.indexerName = null;
        job.remoteUsername = null;
        job.remoteFilename = null;
      }
      job.slskdSearchId = null;
      job.slskdBatchId = null;
    }
    if (clearDownloadMetadata) {
      clearSlskdMetaStmt.run(id);
    } else {
      clearTransientPipelineMetaStmt.run(id);
    }
  }

  updateDownloadMetadata(id: string, metadata: Record<string, unknown> = {}) {
    const job = this.jobs.get(id);
    if (!job || !metadata || typeof metadata !== 'object') return false;
    const assign = (key: string, value: unknown) => {
      if (value == null) return;
      const text = String(value).trim();
      if (!text) return;
      job[key] = text;
    };
    assign('downloadSource', metadata.downloadSource);
    assign('downloadClient', metadata.downloadClient);
    assign('downloadClientId', metadata.downloadClientId);
    assign('releaseGuid', metadata.releaseGuid);
    assign('releaseTitle', metadata.releaseTitle);
    assign('indexerId', metadata.indexerId);
    assign('indexerName', metadata.indexerName);
    assign('remoteUsername', metadata.remoteUsername);
    assign('remoteFilename', metadata.remoteFilename);
    updateDownloadMetaStmt.run(
      metadata.downloadSource ?? null,
      metadata.downloadClient ?? null,
      metadata.downloadClientId ?? null,
      metadata.releaseGuid ?? null,
      metadata.releaseTitle ?? null,
      metadata.indexerId ?? null,
      metadata.indexerName ?? null,
      metadata.remoteUsername ?? null,
      metadata.remoteFilename ?? null,
      id,
    );
    return true;
  }

  enqueueDownloadPipeline(jobId: string) {
    if (!isAnyDownloadSourceConfigured()) return false;
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'pending') return false;
    if (this.isSlskdDispatched(jobId)) return false;
    enqueuePipelineJob(buildPipelinePayload(job));
    this.markSlskdDispatched(jobId);
    return true;
  }

  enqueueSlskdPipeline(jobId: string) {
    return this.enqueueDownloadPipeline(jobId);
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

  _cloneStats(stats: Record<string, number>) {
    return {
      total: Number(stats?.total || 0),
      pending: Number(stats?.pending || 0),
      downloading: Number(stats?.downloading || 0),
      done: Number(stats?.done || 0),
      failed: Number(stats?.failed || 0),
    };
  }

  _getOrCreatePlaylistStats(playlistType: string) {
    const key = String(playlistType || '');
    let stats = this.statsByPlaylistType.get(key);
    if (!stats) {
      stats = this._emptyStats();
      this.statsByPlaylistType.set(key, stats);
    }
    return stats;
  }

  _applyStatusDelta(playlistType: string | null, fromStatus: string | null, toStatus: string | null) {
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
    this.pendingFreshQueue = [];
    this.pendingRetryQueue = [];
    this.pendingSet = new Set();
    this.pendingRetrySet = new Set();
    for (const job of this.jobs.values()) {
      this._applyStatusDelta(job.playlistType, null, job.status);
      if (job.status === 'pending') {
        this.pendingFreshQueue.push(job.id);
        this.pendingSet.add(job.id);
      }
    }
  }

  _removeFromPendingQueues(id: string) {
    this.pendingFreshQueue = this.pendingFreshQueue.filter((entryId: string) => entryId !== id);
    this.pendingRetryQueue = this.pendingRetryQueue.filter((entryId: string) => entryId !== id);
  }

  _load() {
    const rows = selectAllStmt.all() as Record<string, unknown>[];
    for (const row of rows) {
      const job = rowToJob(row);
      if (job.playlistType === 'recommended') {
        job.playlistType = 'discover';
        updateStmt.run(
          job.status,
          job.stagingPath,
          job.finalPath,
          job.externalPath ?? null,
          job.error,
          job.startedAt,
          job.completedAt,
          job.albumName ?? null,
          job.reason ?? null,
          job.artistMbid ?? null,
          job.albumMbid ?? null,
          job.trackMbid ?? null,
          job.releaseYear ?? null,
          job.durationMs ?? null,
          job.trackNumber ?? null,
          job.albumTrackCount ?? null,
          stringifyStringListJson(job.albumTrackTitles),
          stringifyStringListJson(job.artistAliases),
          job.id,
        );
        updatePlaylistTypeStmt.run('discover', 'discover', 'recommended');
      }
      if (job.status === 'downloading') {
        job.status = 'pending';
        job.startedAt = null;
        job.stagingPath = null;
        updateStmt.run(
          job.status,
          job.stagingPath,
          job.finalPath,
          job.externalPath ?? null,
          job.error,
          job.startedAt,
          job.completedAt,
          job.albumName ?? null,
          job.reason ?? null,
          job.artistMbid ?? null,
          job.albumMbid ?? null,
          job.trackMbid ?? null,
          job.releaseYear ?? null,
          job.durationMs ?? null,
          job.trackNumber ?? null,
          job.albumTrackCount ?? null,
          stringifyStringListJson(job.albumTrackTitles),
          stringifyStringListJson(job.artistAliases),
          job.id,
        );
      }
      this.jobs.set(job.id, job);
    }
    this._rebuildStatsByPlaylistType();
  }

  _insert(job: Job) {
    const createdAt = job.createdAt ?? Date.now();
    job.createdAt = createdAt;
    insertStmt.run(
      job.id,
      job.artistName,
      job.trackName,
      job.albumName ?? null,
      job.reason ?? null,
      job.artistMbid ?? null,
      job.albumMbid ?? null,
      job.trackMbid ?? null,
      job.releaseYear ?? null,
      job.durationMs ?? null,
      job.trackNumber ?? null,
      job.albumTrackCount ?? null,
      stringifyStringListJson(job.albumTrackTitles),
      stringifyStringListJson(job.artistAliases),
      job.playlistId || job.playlistType,
      job.playlistType || job.playlistId,
      job.status,
      job.stagingPath ?? null,
      job.finalPath ?? null,
      job.externalPath ?? null,
      job.error ?? null,
      job.startedAt ?? null,
      job.completedAt ?? null,
      createdAt,
    );
    this._touchRevision();
  }

  _update(job: Job) {
    updateStmt.run(
      job.status,
      job.stagingPath ?? null,
      job.finalPath ?? null,
      job.externalPath ?? null,
      job.error ?? null,
      job.startedAt ?? null,
      job.completedAt ?? null,
      job.albumName ?? null,
      job.reason ?? null,
      job.artistMbid ?? null,
      job.albumMbid ?? null,
      job.trackMbid ?? null,
      job.releaseYear ?? null,
      job.durationMs ?? null,
      job.trackNumber ?? null,
      job.albumTrackCount ?? null,
      stringifyStringListJson(job.albumTrackTitles),
      stringifyStringListJson(job.artistAliases),
      job.id,
    );
    this._touchRevision();
  }

  addJob(track: Record<string, unknown>, playlistType: string) {
    const id = randomUUID();
    const artistName = String(track?.artistName || '').trim();
    const trackName = String(track?.trackName || '').trim();
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
      albumMbid: track?.albumMbid ? String(track.albumMbid).trim() : null,
      trackMbid: track?.trackMbid ? String(track.trackMbid).trim() : null,
      releaseYear: track?.releaseYear ? String(track.releaseYear).trim() : null,
      durationMs:
        track?.durationMs != null && Number.isFinite(Number(track.durationMs))
          ? Math.max(0, Math.round(Number(track.durationMs)))
          : null,
      trackNumber: normalizePositiveInteger(track?.trackNumber),
      albumTrackCount: normalizePositiveInteger(track?.albumTrackCount),
      albumTrackTitles: normalizeStringList(track?.albumTrackTitles),
      artistAliases: normalizeStringList(track?.artistAliases),
      playlistId: playlistType,
      playlistType,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      stagingPath: null,
      finalPath: null,
      externalPath: null,
      error: null,
      createdAt: Date.now(),
      downloadSource: null,
      downloadClient: null,
      downloadClientId: null,
      releaseGuid: null,
      releaseTitle: null,
      indexerId: null,
      indexerName: null,
      slskdSearchId: null,
      slskdBatchId: null,
      remoteUsername: null,
      remoteFilename: null,
      retryCycle: false,
    };
    this.jobs.set(id, job);
    this._insert(job);
    this._applyStatusDelta(playlistType, null, job.status);
    this.pendingFreshQueue.push(id);
    this.pendingSet.add(id);
    this.pendingRetrySet.delete(id);
    return id;
  }

  addJobs(tracks: Record<string, unknown>[], playlistType: string) {
    const ids = [];
    for (const track of tracks) {
      const id = this.addJob(track, playlistType);
      if (!id) continue;
      ids.push(id);
    }
    return ids;
  }

  updateMetadata(id: string, metadata: Record<string, unknown> = {}) {
    const job = this.jobs.get(id);
    if (!job || !metadata || typeof metadata !== 'object') return false;
    let changed = false;
    const assignString = (key: string) => {
      if (!(key in metadata)) return;
      const nextValue = metadata[key] ? String(metadata[key]).trim() || null : null;
      if (job[key] !== nextValue) {
        job[key] = nextValue;
        changed = true;
      }
    };
    assignString('artistName');
    assignString('trackName');
    assignString('albumName');
    assignString('reason');
    assignString('artistMbid');
    assignString('albumMbid');
    assignString('trackMbid');
    assignString('releaseYear');
    if ('durationMs' in metadata) {
      const nextDuration =
        metadata.durationMs != null && Number.isFinite(Number(metadata.durationMs))
          ? Math.max(0, Math.round(Number(metadata.durationMs)))
          : null;
      if (job.durationMs !== nextDuration) {
        job.durationMs = nextDuration;
        changed = true;
      }
    }
    if ('artistAliases' in metadata) {
      const nextAliases = normalizeStringList(metadata.artistAliases);
      const previousSerialized = JSON.stringify(job.artistAliases || []);
      const nextSerialized = JSON.stringify(nextAliases);
      if (previousSerialized !== nextSerialized) {
        job.artistAliases = nextAliases;
        changed = true;
      }
    }
    if ('trackNumber' in metadata) {
      const nextTrackNumber = normalizePositiveInteger(metadata.trackNumber);
      if (job.trackNumber !== nextTrackNumber) {
        job.trackNumber = nextTrackNumber;
        changed = true;
      }
    }
    if ('albumTrackCount' in metadata) {
      const nextTrackCount = normalizePositiveInteger(metadata.albumTrackCount);
      if (job.albumTrackCount !== nextTrackCount) {
        job.albumTrackCount = nextTrackCount;
        changed = true;
      }
    }
    if ('albumTrackTitles' in metadata) {
      const nextTitles = normalizeStringList(metadata.albumTrackTitles);
      const previousSerialized = JSON.stringify(job.albumTrackTitles || []);
      const nextSerialized = JSON.stringify(nextTitles);
      if (previousSerialized !== nextSerialized) {
        job.albumTrackTitles = nextTitles;
        changed = true;
      }
    }
    if (changed) {
      this._update(job);
    }
    return changed;
  }

  getJob(id: string) {
    return this.jobs.get(id) || null;
  }

  removeJob(id: string) {
    const job = this.jobs.get(id);
    if (!job) return false;
    this.clearSlskdPipelineState(id);
    this.jobs.delete(id);
    this.pendingSet.delete(id);
    this.pendingRetrySet.delete(id);
    this._removeFromPendingQueues(id);
    this._applyStatusDelta(job.playlistType, job.status, null);
    deleteStmt.run(id);
    this._touchRevision();
    return true;
  }

  _pickPendingFromQueue(queue: string[], lastPlaylistType: string | null = null) {
    let fallbackIndex = -1;
    for (let index = 0; index < queue.length; index += 1) {
      const nextId = queue[index];
      if (!this.pendingSet.has(nextId)) {
        continue;
      }
      const job = this.jobs.get(nextId);
      if (!job || job.status !== 'pending') {
        continue;
      }
      if (lastPlaylistType && String(job.playlistType || '') === String(lastPlaylistType || '')) {
        if (fallbackIndex === -1) fallbackIndex = index;
        continue;
      }
      return job;
    }
    if (fallbackIndex >= 0) {
      const fallbackId = queue[fallbackIndex];
      const fallbackJob = this.jobs.get(fallbackId);
      if (fallbackJob && fallbackJob.status === 'pending') {
        return fallbackJob;
      }
    }
    return null;
  }

  _compactPendingQueue(queue: string[]) {
    return queue.filter((id: string) => {
      if (!this.pendingSet.has(id)) return false;
      const job = this.jobs.get(id);
      return !!job && job.status === 'pending';
    });
  }

  getNextPending(lastPlaylistType: string | null = null) {
    return this.getNextPendingMatching(() => true, lastPlaylistType);
  }

  _shouldSkipForWorker(job: Job) {
    return job?.status === 'pending' && this.isSlskdDispatched(job.id);
  }


  getNextPendingMatching(predicate: ((job: Job) => boolean) | null = null, lastPlaylistType: string | null = null) {
    const accepts = typeof predicate === 'function' ? predicate : () => true;
    const canProcess = (job: Job | null | undefined) =>
      job && job.status === 'pending' && !this._shouldSkipForWorker(job) && accepts(job);
    this.pendingFreshQueue = this._compactPendingQueue(this.pendingFreshQueue);
    const nextFresh = this._pickPendingFromQueue(this.pendingFreshQueue, lastPlaylistType);
    if (canProcess(nextFresh)) return nextFresh;
    for (const id of this.pendingFreshQueue) {
      const job = this.jobs.get(id);
      if (canProcess(job)) return job;
    }
    this.pendingRetryQueue = this._compactPendingQueue(this.pendingRetryQueue);
    const nextRetry = this._pickPendingFromQueue(this.pendingRetryQueue, lastPlaylistType);
    if (canProcess(nextRetry)) return nextRetry;
    for (const id of this.pendingRetryQueue) {
      const job = this.jobs.get(id);
      if (canProcess(job)) return job;
    }
    if (this.pendingSet.size > 0) {
      for (const id of this.pendingSet) {
        const job = this.jobs.get(id);
        if (canProcess(job)) return job;
      }
    }
    return null;
  }

  peekPending(limit: number = 10) {
    const max =
      Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 10;
    const jobs = [];
    const combined = [...this.pendingFreshQueue, ...this.pendingRetryQueue];
    for (const id of combined) {
      if (jobs.length >= max) break;
      if (!this.pendingSet.has(id)) continue;
      const job = this.jobs.get(id);
      if (!job || job.status !== 'pending') continue;
      jobs.push(job);
    }
    return jobs;
  }

  getPending(limit: number = 10) {
    const pending = [];
    for (const job of this.jobs.values()) {
      if (job.status === 'pending' && pending.length < limit) {
        pending.push(job);
      }
    }
    return pending;
  }

  setDownloading(id: string, stagingPath: string | null = null) {
    const job = this.jobs.get(id);
    if (!job) return false;
    const previousStatus = job.status;
    this.pendingSet.delete(id);
    this.pendingRetrySet.delete(id);
    this._removeFromPendingQueues(id);
    job.status = 'downloading';
    job.startedAt = Date.now();
    if (stagingPath) {
      job.stagingPath = stagingPath;
    }
    this._update(job);
    this._applyStatusDelta(job.playlistType, previousStatus, job.status);
    return true;
  }

  setPending(id: string, error: string | Error | null = null, options: { asRetryCycle?: boolean } = {}) {
    const job = this.jobs.get(id);
    if (!job) return false;
    const previousStatus = job.status;
    const asRetryCycle = options?.asRetryCycle === true;
    this.clearSlskdPipelineState(id);
    job.status = 'pending';
    job.startedAt = null;
    job.completedAt = null;
    job.stagingPath = null;
    job.finalPath = null;
    job.retryCycle = asRetryCycle;
    job.error = typeof error === 'string' ? error : (error && error.message) || null;
    this._update(job);
    this._applyStatusDelta(job.playlistType, previousStatus, job.status);
    this.pendingSet.add(id);
    this._removeFromPendingQueues(id);
    if (asRetryCycle) {
      this.pendingRetrySet.add(id);
      this.pendingRetryQueue.push(id);
    } else {
      this.pendingRetrySet.delete(id);
      this.pendingFreshQueue.push(id);
    }
    return true;
  }


  deferPendingToBack(id: string, error: string | Error | null = null, options: { keepRetryTier?: boolean } = {}) {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'pending') return false;
    const keepRetryTier = options?.keepRetryTier === true;
    const currentlyRetryTier = this.pendingRetrySet.has(id);
    const moveToRetryTier = keepRetryTier ? currentlyRetryTier : false;
    job.error = typeof error === 'string' ? error : (error && error.message) || null;
    this._update(job);
    this._removeFromPendingQueues(id);
    this.pendingSet.add(id);
    if (moveToRetryTier) {
      this.pendingRetrySet.add(id);
      this.pendingRetryQueue.push(id);
    } else {
      this.pendingRetrySet.delete(id);
      this.pendingFreshQueue.push(id);
    }
    return true;
  }

  setDone(id: string, finalPath: string, albumName: string | null = null, externalPath: string | null = null) {
    const job = this.jobs.get(id);
    if (!job) return false;
    const previousStatus = job.status;
    this.clearSlskdPipelineState(id, { clearDownloadMetadata: false });
    this.pendingSet.delete(id);
    this.pendingRetrySet.delete(id);
    this._removeFromPendingQueues(id);
    job.status = 'done';
    job.retryCycle = false;
    job.completedAt = Date.now();
    job.finalPath = finalPath;
    job.externalPath = externalPath ?? null;
    const safeAlbum = String(albumName || '').trim();
    if (safeAlbum) {
      job.albumName = safeAlbum;
    } else if (!job.albumName) {
      job.albumName = null;
    }
    this._update(job);
    this._applyStatusDelta(job.playlistType, previousStatus, job.status);
    return true;
  }

  setFailed(id: string, error: string | Error) {
    const job = this.jobs.get(id);
    if (!job) return false;
    const previousStatus = job.status;
    this.clearSlskdPipelineState(id, { clearDownloadMetadata: false });
    this.pendingSet.delete(id);
    this.pendingRetrySet.delete(id);
    this._removeFromPendingQueues(id);
    job.status = 'failed';
    job.retryCycle = false;
    job.completedAt = Date.now();
    job.error = typeof error === 'string' ? error : (error && error.message) || null;
    this._update(job);
    this._applyStatusDelta(job.playlistType, previousStatus, job.status);
    return true;
  }

  getByPlaylistType(playlistType: string, limit: number | null = null) {
    const jobs = [];
    const max =
      Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : null;
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

  getByStatus(status: string) {
    const jobs = [];
    for (const job of this.jobs.values()) {
      if (job.status === status) {
        jobs.push(job);
      }
    }
    return jobs;
  }

  migratePlaylistTypes(idMap: Map<string, string>) {
    if (!idMap || idMap.size === 0) return 0;
    let count = 0;
    for (const [fromId, toId] of idMap.entries()) {
      updatePlaylistTypeStmt.run(toId, toId, fromId);
      for (const job of this.jobs.values()) {
        if (job.playlistType === fromId) {
          job.playlistType = toId;
          count += 1;
        }
      }
    }
    this._rebuildStatsByPlaylistType();
    if (count > 0) this._touchRevision();
    return count;
  }

  resetDownloadingToPending() {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.status === 'downloading') {
        const previousStatus = job.status;
        this.clearSlskdPipelineState(job.id);
        job.status = 'pending';
        job.startedAt = null;
        job.stagingPath = null;
        this._update(job);
        this._applyStatusDelta(job.playlistType, previousStatus, job.status);
        this.pendingSet.add(job.id);
        this._removeFromPendingQueues(job.id);
        if (job.retryCycle === true) {
          this.pendingRetrySet.add(job.id);
          this.pendingRetryQueue.push(job.id);
        } else {
          this.pendingRetrySet.delete(job.id);
          this.pendingFreshQueue.push(job.id);
        }
        count++;
      }
    }
    return count;
  }

  hasActiveJobsForPlaylist(playlistType: string) {
    for (const job of this.jobs.values()) {
      if (job.playlistType !== playlistType) continue;
      if (job.status === 'pending' || job.status === 'downloading') {
        return true;
      }
    }
    return false;
  }

  failActiveJobsForPlaylist(playlistType: string, error: string = 'Retry cycle paused') {
    let count = 0;
    const failedJobs: Job[] = [];
    for (const job of this.jobs.values()) {
      if (job.playlistType !== playlistType) continue;
      if (job.status !== 'pending' && job.status !== 'downloading') continue;
      const previousStatus = job.status;
      this.clearSlskdPipelineState(job.id);
      this.pendingSet.delete(job.id);
      this.pendingRetrySet.delete(job.id);
      this._removeFromPendingQueues(job.id);
      job.status = 'failed';
      job.retryCycle = false;
      job.startedAt = null;
      job.stagingPath = null;
      job.completedAt = Date.now();
      job.error = typeof error === 'string' ? error : String(error || '');
      this._update(job);
      this._applyStatusDelta(job.playlistType, previousStatus, job.status);
      failedJobs.push(job);
      count += 1;
    }
    if (failedJobs.length > 0) {
      import('./aurralHistoryService.js')
        .then(({ recordTrackJobFailed }) => {
          for (const job of failedJobs) {
            recordTrackJobFailed(job, job.error || error);
          }
        })
        .catch(() => {});
    }
    return count;
  }

  getAll() {
    return sortByCreatedAt(Array.from(this.jobs.values()));
  }

  getDoneWithFinalPath(limit: number = 500) {
    const max =
      Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 500;
    const jobs = [];
    for (const job of this.jobs.values()) {
      if (job?.status !== 'done' || typeof job?.finalPath !== 'string') {
        continue;
      }
      jobs.push(job);
      if (jobs.length >= max) break;
    }
    return jobs;
  }

  getStats() {
    return this._cloneStats(this.globalStats);
  }

  getStatsByPlaylistType(playlistTypes: string[] = []) {
    const statsByType: Record<string, { total: number; pending: number; downloading: number; done: number; failed: number }> = {};
    if (Array.isArray(playlistTypes) && playlistTypes.length > 0) {
      for (const playlistType of playlistTypes) {
        statsByType[playlistType] = this._cloneStats(
          this.statsByPlaylistType.get(String(playlistType)) || this._emptyStats(),
        );
      }
      return statsByType;
    }
    for (const [playlistType, stats] of this.statsByPlaylistType.entries()) {
      statsByType[playlistType] = this._cloneStats(stats);
    }
    return statsByType;
  }

  getPlaylistTypeStats(playlistType: string) {
    return this._cloneStats(
      this.statsByPlaylistType.get(String(playlistType)) || this._emptyStats(),
    );
  }

  _deleteJobsWhere(matches: (job: Job, id: string) => boolean, { cleanPending = false }: { cleanPending?: boolean } = {}) {
    const toDelete = [];
    for (const [id, job] of this.jobs.entries()) {
      if (matches(job, id)) {
        toDelete.push(id);
      }
    }
    for (const id of toDelete) {
      this.jobs.delete(id);
      if (cleanPending) {
        this.pendingSet.delete(id);
        this.pendingRetrySet.delete(id);
        this._removeFromPendingQueues(id);
      }
      deleteStmt.run(id);
    }
    if (toDelete.length > 0) {
      this._rebuildStatsByPlaylistType();
      this._touchRevision();
    }
    return toDelete.length;
  }

  clearCompleted() {
    return this._deleteJobsWhere((job: Job) => job.status === 'done' || job.status === 'failed');
  }

  clearByPlaylistType(playlistType: string) {
    return this._deleteJobsWhere((job: Job) => job.playlistType === playlistType);
  }

  clearPendingByPlaylistType(playlistType: string) {
    return this._deleteJobsWhere(
      (job: Job) => job.playlistType === playlistType && job.status === 'pending',
      { cleanPending: true },
    );
  }

  clearAll() {
    const count = this.jobs.size;
    this.jobs.clear();
    this.statsByPlaylistType.clear();
    this.globalStats = this._emptyStats();
    this.pendingFreshQueue = [];
    this.pendingRetryQueue = [];
    this.pendingSet = new Set();
    this.pendingRetrySet = new Set();
    deleteAllStmt.run();
    this._touchRevision();
    return count;
  }

  getRevision() {
    return this.revision;
  }
}

export const downloadTracker = new WeeklyFlowDownloadTracker();
