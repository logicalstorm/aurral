import path from "path";
import fs from "fs/promises";
import { downloadTracker } from "./weeklyFlowDownloadTracker.js";
import { slskdClient } from "./slskdClient.js";
import { playlistManager } from "./weeklyFlowPlaylistManager.js";
import { flowPlaylistConfig } from "./weeklyFlowPlaylistConfig.js";
import { playlistSource } from "./weeklyFlowPlaylistSource.js";
import { dbOps, userOps } from "../config/db-helpers.js";
import { resolveWeeklyFlowTrackContext } from "./weeklyFlowTrackResolver.js";
import { getListenHistoryProfile } from "./listeningHistory.js";
import {
  normalizeExistingFileMode,
  repairReusableTrackLinks,
  reuseTrackForPlaylist,
} from "./weeklyFlowFileReuse.js";
import { resolveWeeklyFlowRoot } from "./weeklyFlowPaths.js";
import { startSlskdOrchestratorWorker } from "./slskdOrchestratorWorker.js";

const DEFAULT_CONCURRENCY = 3;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 3;
const FLOW_WORKER_RETRY_CYCLE_OPTIONS_MINUTES = [15, 30, 60, 360, 720, 1440];
const DEFAULT_RETRY_CYCLE_MINUTES = 15;
const JOB_COOLDOWN_MS = 750;
const RETRY_BASE_DELAY_MS = 5000;
const RETRY_MAX_DELAY_MS = 120000;
const AUTH_FAILURE_PAUSE_MS = 45000;
const CONNECTIVITY_FAILURE_PAUSE_MS = 15000;
const RETRYABLE_FAILURE_STREAK_THRESHOLD = 3;
const RETRYABLE_FAILURE_STREAK_PAUSE_MS = 180000;
const REUSE_REPAIR_INTERVAL_MS = 30 * 60 * 1000;
const MAX_RETRIES_PER_JOB = 1;
const MAX_RETRIES_FOR_TIMEOUT_LOGIN = 1;
const MAX_RETRIES_FOR_QUEUED_DOWNLOAD = 2;
const MAX_RETRIES_FOR_OFFLINE_SOURCE = 3;
const QUEUED_RETRY_BASE_DELAY_MS = 15 * 1000;
const QUEUED_RETRY_MAX_DELAY_MS = 45 * 1000;
const NON_RETRYABLE_ERRORS = new Set([
  "No search results found",
  "No candidate files returned",
]);
const WORKER_STOPPED_CODE = "WORKER_STOPPED";
const PLAYLIST_MUTATION_CODE = "PLAYLIST_MUTATION_IN_PROGRESS";

export class WeeklyFlowWorker {
  constructor(
    weeklyFlowRoot = resolveWeeklyFlowRoot(),
  ) {
    this.weeklyFlowRoot = resolveWeeklyFlowRoot(weeklyFlowRoot);
    this.running = false;
    this.activeCount = 0;
    this.lastReuseRepairAt = 0;
    this.reuseRepairCursor = 0;
    this.processLoop = null;
    this.processTimer = null;
    this.retryAttempts = new Map();
    this.retryNotBefore = new Map();
    this.retryableFailureStreak = 0;
    this.backupRefillRounds = new Map();
    this.currentJob = null;
    this.pausedUntil = 0;
    this.lastDequeuedPlaylistType = null;
    this.reuseRepairTimer = null;
    this.reuseRepairInFlight = null;
    this.lastJobMetrics = null;
    this.incompleteRetryTimers = new Map();
    this.activeJobs = new Map();
    this.blockedPlaylistTypes = new Set();
    this.runGeneration = 0;
    this.playlistReservePools = new Map();
    this.playlistRunDiagnostics = new Map();
    this.playlistFailureMemory = new Map();
    this.playlistFinalizing = new Set();
    this.reserveBuildsInFlight = new Set();
    this.downloadMetrics = {
      completedTracks: 0,
      completedTrackAttempts: 0,
      completedTrackLatencyMs: 0,
    };
  }

  _recordCompletedTrack(elapsedMs, attempts) {
    this.downloadMetrics.completedTracks += 1;
    this.downloadMetrics.completedTrackLatencyMs += Math.max(
      0,
      Math.round(Number(elapsedMs) || 0),
    );
    this.downloadMetrics.completedTrackAttempts += Math.max(
      1,
      Math.round(Number(attempts) || 1),
    );
  }

  _scheduleProcessIn(delayMs = JOB_COOLDOWN_MS) {
    const waitMs = Math.max(
      250,
      Math.floor(Number(delayMs) || JOB_COOLDOWN_MS),
    );
    if (!this.running || this.processTimer) return;
    this.processTimer = setTimeout(() => {
      this.processTimer = null;
      if (this.processLoop) this.processLoop();
    }, waitMs);
  }

  wake(delayMs = 0) {
    if (!this.running) return;
    if (this.processTimer) {
      clearTimeout(this.processTimer);
      this.processTimer = null;
    }
    this._scheduleProcessIn(delayMs);
  }

  _createControlFlowError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  _isControlFlowError(error) {
    const code = String(error?.code || "");
    return code === WORKER_STOPPED_CODE || code === PLAYLIST_MUTATION_CODE;
  }

  _isPlaylistBlocked(playlistType) {
    return this.blockedPlaylistTypes.has(String(playlistType || ""));
  }

  _assertJobCanContinue(job, runGeneration) {
    if (runGeneration !== this.runGeneration) {
      throw this._createControlFlowError(WORKER_STOPPED_CODE, "Worker stopped");
    }
    if (this._isPlaylistBlocked(job?.playlistType)) {
      throw this._createControlFlowError(
        PLAYLIST_MUTATION_CODE,
        "Playlist mutation in progress",
      );
    }
  }

  blockPlaylist(playlistType) {
    const id = String(playlistType || "").trim();
    if (!id) return false;
    this.blockedPlaylistTypes.add(id);
    return true;
  }

  unblockPlaylist(playlistType) {
    const id = String(playlistType || "").trim();
    if (!id) return false;
    const removed = this.blockedPlaylistTypes.delete(id);
    if (removed && this.running) {
      this.wake();
    }
    return removed;
  }

  async waitForPlaylistIdle(playlistType) {
    const id = String(playlistType || "").trim();
    if (!id) return;
    while (true) {
      const active = [];
      for (const entry of this.activeJobs.values()) {
        if (entry?.playlistType === id && entry?.promise) {
          active.push(entry.promise);
        }
      }
      if (active.length === 0) {
        return;
      }
      await Promise.allSettled(active);
    }
  }

  async waitForIdle() {
    while (true) {
      const active = [...this.activeJobs.values()]
        .map((entry) => entry?.promise)
        .filter(Boolean);
      if (active.length === 0) {
        return;
      }
      await Promise.allSettled(active);
    }
  }

  pruneOrphanedJobState() {
    for (const jobId of [...this.retryAttempts.keys()]) {
      if (!downloadTracker.getJob(jobId)) {
        this.retryAttempts.delete(jobId);
      }
    }
    for (const jobId of [...this.retryNotBefore.keys()]) {
      if (!downloadTracker.getJob(jobId)) {
        this.retryNotBefore.delete(jobId);
      }
    }
  }

  clearIncompleteRetry(playlistType) {
    const timer = this.incompleteRetryTimers.get(playlistType);
    if (timer) {
      clearTimeout(timer);
      this.incompleteRetryTimers.delete(playlistType);
    }
  }

  _rescheduleIncompleteRetries(
    delayMs = this._getIncompleteRetryDelayMs(),
  ) {
    const playlistTypes = [...this.incompleteRetryTimers.keys()];
    if (playlistTypes.length === 0) return 0;
    for (const playlistType of playlistTypes) {
      this.clearIncompleteRetry(playlistType);
    }
    for (const playlistType of playlistTypes) {
      this._scheduleIncompleteRetry(playlistType, delayMs);
    }
    return playlistTypes.length;
  }

  _normalizeRetryPausedPlaylistIds(value) {
    if (!Array.isArray(value)) return [];
    const out = new Set();
    for (const entry of value) {
      const id = String(entry || "").trim();
      if (!id) continue;
      out.add(id);
    }
    return [...out];
  }

  _getRetryPausedPlaylistIds() {
    const settings = dbOps.getSettings();
    const raw = settings?.playlistWorker || {};
    return this._normalizeRetryPausedPlaylistIds(raw.retryPausedPlaylistIds);
  }

  _isRetryCyclePaused(playlistType) {
    if (!playlistType) return false;
    const paused = this._getRetryPausedPlaylistIds();
    return paused.includes(String(playlistType));
  }

  setRetryCyclePaused(playlistType, paused) {
    const id = String(playlistType || "").trim();
    if (!id) return false;
    const current = dbOps.getSettings();
    const worker = current?.playlistWorker || {};
    const pausedIds = new Set(
      this._normalizeRetryPausedPlaylistIds(worker.retryPausedPlaylistIds),
    );
    if (paused) {
      pausedIds.add(id);
      this.clearIncompleteRetry(id);
    } else {
      pausedIds.delete(id);
    }
    dbOps.updateSettings({
      ...current,
      playlistWorker: {
        ...worker,
        retryPausedPlaylistIds: [...pausedIds],
      },
    });
    if (!paused && this.running) {
      this.wake();
    }
    return true;
  }

  getRetryCyclePausedMap(playlistIds = []) {
    const paused = new Set(this._getRetryPausedPlaylistIds());
    const out = {};
    for (const id of Array.isArray(playlistIds) ? playlistIds : []) {
      const key = String(id || "").trim();
      if (!key) continue;
      out[key] = paused.has(key);
    }
    return out;
  }

  getIncompleteRetryMap(playlistIds = []) {
    const scheduled = new Set(this.incompleteRetryTimers.keys());
    const out = {};
    for (const id of Array.isArray(playlistIds) ? playlistIds : []) {
      const key = String(id || "").trim();
      if (!key) continue;
      out[key] = scheduled.has(key);
    }
    return out;
  }

  _isAuthFailure(message) {
    const text = String(message || "").toLowerCase();
    return text.includes("timeout login") || text.includes("invalidpass");
  }

  _isConnectivityFailure(message) {
    const text = String(message || "").toLowerCase();
    return (
      text.includes("download timeout") ||
      text.includes("download stalled") ||
      text.includes("econnreset") ||
      text.includes("etimedout") ||
      text.includes("socket hang up")
    );
  }

  _isSlowSourceError(message) {
    const text = String(message || "").toLowerCase();
    return (
      text.includes("download queued") ||
      text.includes("download stalled (no bytes received)")
    );
  }

  _isOfflineSourceError(message) {
    const lower = String(message || "").toLowerCase();
    return lower.includes("user not exist") || lower.includes("user offline");
  }

  _isNonRetryableError(message) {
    const text = String(message || "").trim();
    if (!text) return false;
    if (NON_RETRYABLE_ERRORS.has(text)) return true;
    return false;
  }

  _getRetryLimitForError(message) {
    if (this._isSlowSourceError(message)) return MAX_RETRIES_FOR_QUEUED_DOWNLOAD;
    if (this._isOfflineSourceError(message)) return MAX_RETRIES_FOR_OFFLINE_SOURCE;
    if (this._isAuthFailure(message)) return MAX_RETRIES_FOR_TIMEOUT_LOGIN;
    return MAX_RETRIES_PER_JOB;
  }

  _getRetryDelayMs(attempt, message) {
    if (this._isSlowSourceError(message)) {
      return Number(attempt) <= 1
        ? QUEUED_RETRY_BASE_DELAY_MS
        : QUEUED_RETRY_MAX_DELAY_MS;
    }
    if (this._isOfflineSourceError(message)) {
      return Math.min(
        RETRY_MAX_DELAY_MS,
        5000 * 2 ** Math.max(0, Number(attempt) - 1),
      );
    }
    const exp = Math.max(0, Number(attempt) - 1);
    const base = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** exp);
    if (this._isAuthFailure(message)) {
      return Math.max(base, AUTH_FAILURE_PAUSE_MS);
    }
    if (this._isConnectivityFailure(message)) {
      return Math.max(base, CONNECTIVITY_FAILURE_PAUSE_MS);
    }
    return base;
  }

  _pauseWorker(ms) {
    const until = Date.now() + Math.max(0, Number(ms) || 0);
    this.pausedUntil = Math.max(this.pausedUntil, until);
  }

  _recordRetryableFailure() {
    this.retryableFailureStreak += 1;
    if (this.retryableFailureStreak >= RETRYABLE_FAILURE_STREAK_THRESHOLD) {
      this._pauseWorker(RETRYABLE_FAILURE_STREAK_PAUSE_MS);
      this.retryableFailureStreak = 0;
    }
  }

  _resetFailureStreak() {
    this.retryableFailureStreak = 0;
  }

  _normalizeConcurrency(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_CONCURRENCY;
    return Math.min(
      MAX_CONCURRENCY,
      Math.max(MIN_CONCURRENCY, Math.floor(parsed)),
    );
  }

  _normalizeRetryCycleMinutes(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_RETRY_CYCLE_MINUTES;
    const normalized = Math.floor(parsed);
    if (FLOW_WORKER_RETRY_CYCLE_OPTIONS_MINUTES.includes(normalized)) {
      return normalized;
    }
    return DEFAULT_RETRY_CYCLE_MINUTES;
  }

  _normalizeExistingFileMode(value) {
    return normalizeExistingFileMode(value);
  }

  _getIncompleteRetryDelayMs() {
    const { retryCycleMinutes } = this.getWorkerSettings();
    return Math.max(1000, retryCycleMinutes * 60 * 1000);
  }
  _getNextReadyPendingJob(lastPlaylistType = null) {
    const now = Date.now();
    return downloadTracker.getNextPendingMatching((job) => {
      const notBefore = Number(this.retryNotBefore.get(job.id) || 0);
      return notBefore <= now;
    }, lastPlaylistType);
  }

  _getNextPendingWakeDelayMs() {
    const now = Date.now();
    let nextDelay = null;
    for (const job of downloadTracker.getByStatus("pending")) {
      const notBefore = Number(this.retryNotBefore.get(job.id) || 0);
      if (notBefore <= now) return 0;
      const delay = Math.max(250, notBefore - now);
      nextDelay = nextDelay == null ? delay : Math.min(nextDelay, delay);
    }
    return nextDelay;
  }

  getWorkerSettings() {
    const settings = dbOps.getSettings();
    const raw = settings?.playlistWorker || {};
    return {
      concurrency: this._normalizeConcurrency(raw.concurrency),
      retryCycleMinutes: this._normalizeRetryCycleMinutes(
        raw.retryCycleMinutes,
      ),
      retryPausedPlaylistIds: this._normalizeRetryPausedPlaylistIds(
        raw.retryPausedPlaylistIds,
      ),
      existingFileMode: this._normalizeExistingFileMode(raw.existingFileMode),
    };
  }

  updateWorkerSettings(nextSettings = {}) {
    const current = dbOps.getSettings();
    const base = this.getWorkerSettings();
    const normalized = {
      concurrency:
        nextSettings.concurrency === undefined
          ? base.concurrency
          : this._normalizeConcurrency(nextSettings.concurrency),
      retryCycleMinutes:
        nextSettings.retryCycleMinutes === undefined
          ? base.retryCycleMinutes
          : this._normalizeRetryCycleMinutes(nextSettings.retryCycleMinutes),
      retryPausedPlaylistIds: this._normalizeRetryPausedPlaylistIds(
        base.retryPausedPlaylistIds,
      ),
      existingFileMode:
        nextSettings.existingFileMode === undefined
          ? base.existingFileMode
          : this._normalizeExistingFileMode(nextSettings.existingFileMode),
    };
    dbOps.updateSettings({
      ...current,
      playlistWorker: normalized,
    });
    if (normalized.retryCycleMinutes !== base.retryCycleMinutes) {
      this._rescheduleIncompleteRetries(
        Math.max(1000, normalized.retryCycleMinutes * 60 * 1000),
      );
    }
    return normalized;
  }

  _getPlaylistTargetCount(playlistType) {
    const flow = flowPlaylistConfig.getFlow(playlistType);
    const sharedPlaylist = flowPlaylistConfig.getSharedPlaylist(playlistType);
    const raw = Number(flow?.size || sharedPlaylist?.trackCount || 0);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return Math.max(1, Math.floor(raw));
  }

  _getPlaylistFailureState(playlistType) {
    const key = String(playlistType || "").trim();
    if (!key) {
      return {
        failedUsers: new Set(),
        queuedUsers: new Set(),
        failedTrackKeys: new Set(),
        terminalFailures: 0,
      };
    }
    let state = this.playlistFailureMemory.get(key);
    if (!state) {
      state = {
        failedUsers: new Set(),
        queuedUsers: new Set(),
        failedTrackKeys: new Set(),
        terminalFailures: 0,
      };
      this.playlistFailureMemory.set(key, state);
    }
    return state;
  }

  _recordPlaylistTerminalFailure(playlistType, job, message) {
    const state = this._getPlaylistFailureState(playlistType);
    state.terminalFailures += 1;
    const key = this._trackKeyFromJob(job);
    if (key) {
      state.failedTrackKeys.add(key);
    }
    const lower = String(message || "").toLowerCase();
    if (this._isOfflineSourceError(lower)) {
      const user = String(job?.lastFailedUser || "").trim().toLowerCase();
      if (user) state.failedUsers.add(user);
    }
  }

  clearPlaylistRunState(playlistType) {
    const key = String(playlistType || "").trim();
    if (!key) return;
    this.clearIncompleteRetry(key);
    this.playlistReservePools.delete(key);
    this.playlistRunDiagnostics.delete(key);
    this.playlistFailureMemory.delete(key);
    this.playlistFinalizing.delete(key);
    this.reserveBuildsInFlight.delete(key);
  }

  _normalizeReserveTracks(tracks = []) {
    return (Array.isArray(tracks) ? tracks : []).filter(
      (track) =>
        track &&
        String(track?.artistName || "").trim() &&
        String(track?.trackName || "").trim(),
    );
  }

  setPlaylistRunPlan(playlistType, plan = {}) {
    const key = String(playlistType || "").trim();
    if (!key) return;
    this.playlistReservePools.set(
      key,
      this._normalizeReserveTracks(plan?.reserveTracks || []),
    );
    this.playlistRunDiagnostics.set(key, plan?.diagnostics || null);
    this.playlistFinalizing.delete(key);
    this._getPlaylistFailureState(key);
  }

  getPlaylistRunStatus(playlistType) {
    const key = String(playlistType || "").trim();
    const reserves = this.playlistReservePools.get(key) || [];
    const diagnostics = this.playlistRunDiagnostics.get(key) || null;
    const failures = this._getPlaylistFailureState(key);
    return {
      reserveDepth: reserves.length,
      diagnostics,
      failureSummary: {
        failedUsers: failures.failedUsers.size,
        queuedUsers: failures.queuedUsers.size,
        failedTracks: failures.failedTrackKeys.size,
        terminalFailures: failures.terminalFailures,
      },
    };
  }

  _getFlowListenHistoryProfile(flow) {
    const ownerUserId = Number(flow?.ownerUserId);
    if (!Number.isFinite(ownerUserId)) return null;
    const owner = userOps.getUserById(ownerUserId);
    return owner ? getListenHistoryProfile(owner) : null;
  }

  async seedFlowRun(playlistType, flow, options = {}) {
    const key = String(playlistType || "").trim();
    if (!key || !flow) {
      return { tracksQueued: 0, jobIds: [], reserveTracks: 0 };
    }
    const sizeOverride =
      Number.isFinite(Number(options?.size)) && Number(options.size) > 0
        ? Math.round(Number(options.size))
        : null;
    const plan = await playlistSource.buildFlowRunPlan(
      sizeOverride ? { ...flow, size: sizeOverride } : flow,
      {
        listenHistoryProfile: this._getFlowListenHistoryProfile(flow),
      },
    );
    this.clearPlaylistRunState(key);
    this.setPlaylistRunPlan(key, plan);
    const primaryTracks = Array.isArray(plan?.primaryTracks)
      ? plan.primaryTracks
      : [];
    flowPlaylistConfig.markLastRunAt(key);
    const jobIds = downloadTracker.addJobs(primaryTracks, key);
    return {
      tracksQueued: primaryTracks.length,
      jobIds,
      reserveTracks: Array.isArray(plan?.reserveTracks)
        ? plan.reserveTracks.length
        : 0,
    };
  }

  _consumeReserveTracks(playlistType, shortfall) {
    const key = String(playlistType || "").trim();
    const reserves = this.playlistReservePools.get(key) || [];
    if (!key || reserves.length === 0 || shortfall <= 0) return [];
    const existingTrackKeys = new Set(
      downloadTracker
        .getByPlaylistType(key)
        .map((job) => this._trackKeyFromJob(job))
        .filter(Boolean),
    );
    const existingArtistKeys = new Set(
      downloadTracker
        .getByPlaylistType(key)
        .map((job) => this._artistKeyFromJob(job))
        .filter(Boolean),
    );
    const picked = [];
    const remaining = [];
    for (const track of reserves) {
      const trackKey = this._trackKeyFromTrack(track);
      const artistKey = this._artistKeyFromTrack(track);
      if (
        picked.length < shortfall &&
        trackKey &&
        !existingTrackKeys.has(trackKey) &&
        (!artistKey || !existingArtistKeys.has(artistKey))
      ) {
        picked.push(track);
        existingTrackKeys.add(trackKey);
        if (artistKey) existingArtistKeys.add(artistKey);
      } else {
        remaining.push(track);
      }
    }
    this.playlistReservePools.set(key, remaining);
    return picked;
  }

  _maybeStopWhenIdle() {
    if (!this.running) return;
    if (this.activeJobs.size > 0) return;
    if (this.reserveBuildsInFlight.size > 0) return;
    if (downloadTracker.getNextPending()) return;
    this.stop();
  }

  _hasReachedPlaylistTarget(playlistType) {
    const target = this._getPlaylistTargetCount(playlistType);
    if (!target) return false;
    const stats = downloadTracker.getPlaylistTypeStats(playlistType);
    return Number(stats?.done || 0) >= target;
  }

  _trackKeyFromJob(job) {
    const artist = String(job?.artistName || "")
      .trim()
      .toLowerCase();
    const track = String(job?.trackName || "")
      .trim()
      .toLowerCase();
    if (!artist || !track) return "";
    return `${artist}::${track}`;
  }

  _trackKeyFromTrack(track) {
    const artist = String(track?.artistName || "")
      .trim()
      .toLowerCase();
    const name = String(track?.trackName || "")
      .trim()
      .toLowerCase();
    if (!artist || !name) return "";
    return `${artist}::${name}`;
  }

  _artistKeyFromJob(job) {
    return String(job?.artistName || "")
      .trim()
      .toLowerCase();
  }

  _artistKeyFromTrack(track) {
    return String(track?.artistName || "")
      .trim()
      .toLowerCase();
  }

  _dropOverflowPendingJobs(playlistType) {
    if (!this._hasReachedPlaylistTarget(playlistType)) return 0;
    const jobs = downloadTracker.getByPlaylistType(playlistType);
    let removed = 0;
    for (const job of jobs) {
      if (job.status === "done") continue;
      if (downloadTracker.removeJob(job.id)) {
        this.retryAttempts.delete(job.id);
        this.retryNotBefore.delete(job.id);
        removed += 1;
      }
    }
    return removed;
  }

  _requeueFailedJobs(playlistType, reason = null) {
    if (this._isRetryCyclePaused(playlistType)) return 0;
    const jobs = downloadTracker.getByPlaylistType(playlistType);
    let requeued = 0;
    for (const job of jobs) {
      if (job.status !== "failed") continue;
      this.retryAttempts.delete(job.id);
      this.retryNotBefore.delete(job.id);
      const priorError = String(job?.error || "").trim();
      const retryReason = [String(reason || "").trim(), priorError]
        .filter(Boolean)
        .join(" • ");
      if (
        downloadTracker.setPending(job.id, retryReason || null, {
          asRetryCycle: true,
        })
      ) {
        requeued += 1;
      }
    }
    return requeued;
  }

  _scheduleIncompleteRetry(
    playlistType,
    delayMs = this._getIncompleteRetryDelayMs(),
  ) {
    if (!playlistType) return;
    if (this._isRetryCyclePaused(playlistType)) {
      this.clearIncompleteRetry(playlistType);
      return;
    }
    if (
      !flowPlaylistConfig.getFlow(playlistType) &&
      !flowPlaylistConfig.getSharedPlaylist(playlistType)
    ) {
      this.clearIncompleteRetry(playlistType);
      return;
    }
    if (this.incompleteRetryTimers.has(playlistType)) return;
    const waitMs = Math.max(
      1000,
      Math.floor(Number(delayMs) || this._getIncompleteRetryDelayMs()),
    );
    const timer = setTimeout(() => {
      this.incompleteRetryTimers.delete(playlistType);
      this.retryIncompletePlaylist(playlistType).catch((error) => {
        console.error(
          `[WeeklyFlowWorker] Failed incomplete retry for ${playlistType}:`,
          error.message,
        );
        this._scheduleIncompleteRetry(playlistType);
      });
    }, waitMs);
    this.incompleteRetryTimers.set(playlistType, timer);
  }

  async retryIncompletePlaylist(playlistType) {
    if (this._isRetryCyclePaused(playlistType)) {
      this.clearIncompleteRetry(playlistType);
      return 0;
    }
    const flow = flowPlaylistConfig.getFlow(playlistType);
    const sharedPlaylist = flowPlaylistConfig.getSharedPlaylist(playlistType);
    if (!flow && !sharedPlaylist) {
      this.clearIncompleteRetry(playlistType);
      return 0;
    }
    if (flow && flow.enabled !== true) {
      this.clearIncompleteRetry(playlistType);
      return 0;
    }

    const stats = downloadTracker.getPlaylistTypeStats(playlistType);
    const target = this._getPlaylistTargetCount(playlistType);
    if (!target || stats.done >= target) {
      this.clearIncompleteRetry(playlistType);
      return 0;
    }
    if (stats.pending > 0 || stats.downloading > 0) {
      if (this.running) {
        this.wake();
      } else {
        await this.start();
      }
      return 0;
    }

    let changed = 0;
    if (flow) {
      const shortfall = Math.max(0, target - Number(stats.done || 0));
      if (shortfall > 0) {
        changed += await this._enqueueBackupJobs(playlistType, shortfall);
      }
    }
    changed += this._requeueFailedJobs(
      playlistType,
      "Retrying incomplete playlist",
    );

    if (changed > 0) {
      if (this.running) {
        this.wake();
      } else {
        await this.start();
      }
      return changed;
    }

    this._scheduleIncompleteRetry(playlistType);
    return 0;
  }

  async _enqueueBackupJobs(playlistType, shortfall) {
    const target = this._getPlaylistTargetCount(playlistType);
    const flow = flowPlaylistConfig.getFlow(playlistType);
    if (!target || !flow || shortfall <= 0) return 0;
    let added = 0;
    const reserveTracks = this._consumeReserveTracks(playlistType, shortfall);
    if (reserveTracks.length > 0) {
      added += downloadTracker.addJobs(reserveTracks, playlistType).length;
    }
    const remainingShortfall = Math.max(0, shortfall - added);
    if (remainingShortfall <= 0) {
      return added;
    }
    const rounds = Number(this.backupRefillRounds.get(playlistType) || 0);
    const requestSize = Math.max(remainingShortfall, Math.min(target, Math.max(remainingShortfall * 2, 8)));
    const existingKeys = new Set(
      downloadTracker
        .getByPlaylistType(playlistType)
        .map((job) => this._trackKeyFromJob(job))
        .filter(Boolean),
    );
    const existingArtistKeys = new Set(
      downloadTracker
        .getByPlaylistType(playlistType)
        .map((job) => this._artistKeyFromJob(job))
        .filter(Boolean),
    );
    const failures = this._getPlaylistFailureState(playlistType);
    for (const failedTrackKey of failures.failedTrackKeys) {
      existingKeys.add(failedTrackKey);
    }
    this.reserveBuildsInFlight.add(String(playlistType));
    const plan = await playlistSource
      .buildFlowRunPlan(
        { ...flow, size: requestSize },
        {
          reserveSize: Math.max(Math.ceil(target * 0.25), 4),
          excludeArtistKeys: existingArtistKeys,
          excludeTrackKeys: existingKeys,
          listenHistoryProfile: this._getFlowListenHistoryProfile(flow),
        },
      )
      .catch(() => null)
      .finally(() => {
        this.reserveBuildsInFlight.delete(String(playlistType));
      });
    const unique = Array.isArray(plan?.primaryTracks) ? plan.primaryTracks : [];
    const reserve = Array.isArray(plan?.reserveTracks) ? plan.reserveTracks : [];
    if (plan) {
      const currentReserve = this.playlistReservePools.get(String(playlistType)) || [];
      this.playlistReservePools.set(
        String(playlistType),
        [
          ...currentReserve,
          ...reserve.filter((track) => {
            const key = this._trackKeyFromTrack(track);
            const artistKey = this._artistKeyFromTrack(track);
            if (!key || existingKeys.has(key)) return false;
            if (artistKey && existingArtistKeys.has(artistKey)) return false;
            existingKeys.add(key);
            if (artistKey) existingArtistKeys.add(artistKey);
            return true;
          }),
        ],
      );
      this.playlistRunDiagnostics.set(String(playlistType), plan?.diagnostics || null);
    }
    if (unique.length === 0) return added;
    added += downloadTracker.addJobs(unique, playlistType).length;
    if (added > 0) {
      console.log(
        `[WeeklyFlowWorker] Enqueued ${added} replacement tracks for ${playlistType} (shortfall ${shortfall})`,
      );
    }
    return added;
  }

  async repairReusableLinks(force = false) {
    const now = Date.now();
    if (!force && now - this.lastReuseRepairAt < REUSE_REPAIR_INTERVAL_MS) {
      return null;
    }
    this.lastReuseRepairAt = now;
    const { existingFileMode } = this.getWorkerSettings();
    if (normalizeExistingFileMode(existingFileMode) === "download") {
      return null;
    }
    const result = await repairReusableTrackLinks({
      existingFileMode,
      weeklyFlowRoot: this.weeklyFlowRoot,
      cursor: this.reuseRepairCursor,
    });
    if (Number.isFinite(result?.nextCursor)) {
      this.reuseRepairCursor = result.nextCursor;
    }
    return result;
  }

  scheduleReuseLinkRepair(force = false) {
    if (this.reuseRepairInFlight) return;
    this.reuseRepairInFlight = this.repairReusableLinks(force)
      .catch((error) => {
        console.warn(
          `[WeeklyFlowWorker] Reuse link repair failed: ${error?.message || error}`,
        );
      })
      .finally(() => {
        this.reuseRepairInFlight = null;
      });
  }

  async start() {
    if (this.running) {
      return;
    }

    this.runGeneration += 1;
    this.running = true;
    startSlskdOrchestratorWorker();
    console.log("[WeeklyFlowWorker] Starting worker...");
    this.scheduleReuseLinkRepair(true);
    this.reuseRepairTimer = setInterval(() => {
      if (!this.running) return;
      this.scheduleReuseLinkRepair(false);
    }, REUSE_REPAIR_INTERVAL_MS);

    this.processLoop = () => {
      if (!this.running) return;
      const now = Date.now();
      if (this.pausedUntil > now) {
        this._scheduleProcessIn(this.pausedUntil - now);
        return;
      }
      const { concurrency } = this.getWorkerSettings();
      while (this.activeCount < concurrency) {
        const job = this._getNextReadyPendingJob(
          this.lastDequeuedPlaylistType,
        );
        if (!job) {
          const waitMs = this._getNextPendingWakeDelayMs();
          if (waitMs != null) {
            this._scheduleProcessIn(waitMs);
          }
          break;
        }
        this.lastDequeuedPlaylistType = job.playlistType;
        if (this._hasReachedPlaylistTarget(job.playlistType)) {
          downloadTracker.removeJob(job.id);
          continue;
        }
        if (this._isPlaylistBlocked(job.playlistType)) {
          downloadTracker.deferPendingToBack(
            job.id,
            "Playlist mutation in progress",
            {
              keepRetryTier: true,
            },
          );
          this._scheduleProcessIn(JOB_COOLDOWN_MS);
          break;
        }

        this.activeCount++;
        this.currentJob = {
          id: job.id,
          playlistType: job.playlistType,
          artistName: job.artistName,
          trackName: job.trackName,
          progressPct: 0,
          startedAt: Date.now(),
        };
        const jobRunGeneration = this.runGeneration;
        const jobPromise = this.processJob(job, jobRunGeneration)
          .catch(async (error) => {
            if (
              jobRunGeneration !== this.runGeneration ||
              this._isPlaylistBlocked(job.playlistType) ||
              this._isControlFlowError(error)
            ) {
              this.retryAttempts.delete(job.id);
              this.retryNotBefore.delete(job.id);
              return;
            }
            const attempts = Number(this.retryAttempts.get(job.id) || 0);
            const message = String(error?.message || "");
            const retryable = !this._isNonRetryableError(message);
            const retryLimit = this._getRetryLimitForError(message);
            if (retryable && attempts < retryLimit) {
              const retryAttempt = attempts + 1;
              this.retryAttempts.set(job.id, retryAttempt);
              const slowSourceError = this._isSlowSourceError(message);
              if (!slowSourceError) {
                this._recordRetryableFailure();
              }
              const retryDelayMs = this._getRetryDelayMs(retryAttempt, message);
              this.retryNotBefore.set(job.id, Date.now() + retryDelayMs);
              console.warn(
                `[WeeklyFlowWorker] Requeueing job ${job.id}: ${message} (attempt ${retryAttempt}/${retryLimit} in ${Math.ceil(retryDelayMs / 1000)}s)`,
              );
              if (this._isAuthFailure(message)) {
                this._pauseWorker(AUTH_FAILURE_PAUSE_MS);
              } else if (!slowSourceError && this._isConnectivityFailure(message)) {
                this._pauseWorker(CONNECTIVITY_FAILURE_PAUSE_MS);
              }
              downloadTracker.setPending(
                job.id,
                slowSourceError
                  ? `Remote source slow; retrying in ${Math.ceil(retryDelayMs / 1000)}s (attempt ${retryAttempt}/${retryLimit})`
                  : `${message} (retry ${retryAttempt}/${retryLimit} in ${Math.ceil(retryDelayMs / 1000)}s)`,
                {
                  asRetryCycle: true,
                },
              );
              return;
            }
            this._resetFailureStreak();
            this.retryAttempts.delete(job.id);
            this.retryNotBefore.delete(job.id);
            console.error(
              `[WeeklyFlowWorker] Error processing job ${job.id}:`,
              error.message,
            );
            this._recordPlaylistTerminalFailure(
              job.playlistType,
              job,
              error.message,
            );
            downloadTracker.setFailed(job.id, error.message);
            await this.checkPlaylistComplete(job.playlistType);
          })
          .finally(() => {
            this.activeJobs.delete(job.id);
            this.activeCount--;
            if (this.activeCount <= 0) {
              this.currentJob = null;
            }
            this._maybeStopWhenIdle();
            this.wake(0);
          });
        this.activeJobs.set(job.id, {
          playlistType: job.playlistType,
          promise: jobPromise,
        });
      }
    };

    this.processLoop();
  }

  _requestStop() {
    if (!this.running) {
      return false;
    }
    this.running = false;
    this.runGeneration += 1;
    if (this.processTimer) {
      clearTimeout(this.processTimer);
      this.processTimer = null;
    }
    if (this.reuseRepairTimer) {
      clearInterval(this.reuseRepairTimer);
      this.reuseRepairTimer = null;
    }
    this.processLoop = null;
    this.retryAttempts.clear();
    this.retryNotBefore.clear();
    this.retryableFailureStreak = 0;
    this.backupRefillRounds.clear();
    this.pausedUntil = 0;
    this.lastDequeuedPlaylistType = null;
    this.currentJob = null;
    this.playlistReservePools.clear();
    this.playlistRunDiagnostics.clear();
    this.playlistFailureMemory.clear();
    this.playlistFinalizing.clear();
    this.reserveBuildsInFlight.clear();
    console.log("[WeeklyFlowWorker] Worker stopped");
    return true;
  }

  stop() {
    const stopped = this._requestStop();
    if (!stopped) {
      return;
    }
    downloadTracker.resetDownloadingToPending();
    this.pruneOrphanedJobState();
  }

  async stopAndDrain() {
    this._requestStop();
    await this.waitForIdle();
    downloadTracker.resetDownloadingToPending();
    this.pruneOrphanedJobState();
  }

  async processJob(job, runGeneration = this.runGeneration) {
    console.log(
      `[WeeklyFlowWorker] Processing job ${job.id}: ${job.artistName} - ${job.trackName} (${job.playlistType})`,
    );

    const perfStartCpu = process.cpuUsage();
    const perfStartHr = process.hrtime.bigint();
    const timingsMs = {
      completionCheck: 0,
    };

    this._assertJobCanContinue(job, runGeneration);

    try {
      let phaseStart = process.hrtime.bigint();
      const resolvedTrack = await resolveWeeklyFlowTrackContext(job);
      downloadTracker.updateMetadata(job.id, resolvedTrack);
      Object.assign(job, resolvedTrack);
      const { existingFileMode } = this.getWorkerSettings();
      if (existingFileMode !== "download") {
        const reuse = await reuseTrackForPlaylist(resolvedTrack, job.playlistType, {
          existingFileMode,
          weeklyFlowRoot: this.weeklyFlowRoot,
          existingJobId: job.id,
          excludeJobIds: [job.id],
        });
        if (reuse.reused) {
          this._resetFailureStreak();
          this.retryAttempts.delete(job.id);
          this.retryNotBefore.delete(job.id);
          this.backupRefillRounds.delete(job.playlistType);
          this._dropOverflowPendingJobs(job.playlistType);
          this._recordCompletedTrack(
            Number(process.hrtime.bigint() - perfStartHr) / 1e6,
            0,
          );
          phaseStart = process.hrtime.bigint();
          this._assertJobCanContinue(job, runGeneration);
          await this.checkPlaylistComplete(job.playlistType);
          timingsMs.completionCheck +=
            Number(process.hrtime.bigint() - phaseStart) / 1e6;
          const cpuDelta = process.cpuUsage(perfStartCpu);
          const elapsedMs = Number(process.hrtime.bigint() - perfStartHr) / 1e6;
          this.lastJobMetrics = {
            jobId: job.id,
            finishedAt: Date.now(),
            elapsedMs: Math.round(elapsedMs),
            cpuUserMs: Math.round(cpuDelta.user / 1000),
            cpuSystemMs: Math.round(cpuDelta.system / 1000),
            cpuTotalMs: Math.round((cpuDelta.user + cpuDelta.system) / 1000),
            timingsMs: {
              completionCheck: Math.round(timingsMs.completionCheck),
            },
          };
          return;
        }
      }
      if (!slskdClient.isConfigured()) {
        throw new Error("slskd not configured");
      }
      downloadTracker.enqueueSlskdPipeline(job.id);
      return;
    } catch (error) {
      const cpuDelta = process.cpuUsage(perfStartCpu);
      const elapsedMs = Number(process.hrtime.bigint() - perfStartHr) / 1e6;
      this.lastJobMetrics = {
        jobId: job.id,
        finishedAt: Date.now(),
        failed: true,
        error: error.message,
        elapsedMs: Math.round(elapsedMs),
        cpuUserMs: Math.round(cpuDelta.user / 1000),
        cpuSystemMs: Math.round(cpuDelta.system / 1000),
        cpuTotalMs: Math.round((cpuDelta.user + cpuDelta.system) / 1000),
        timingsMs: {
          completionCheck: Math.round(timingsMs.completionCheck),
        },
      };
      throw error;
    }
  }

  async checkPlaylistComplete(playlistType) {
    const playlistKey = String(playlistType || "");
    const stats = downloadTracker.getPlaylistTypeStats(playlistType);
    const { total, pending, downloading, done, failed } = stats;
    const allSettled = total > 0 && pending === 0 && downloading === 0;
    const hasDone = done > 0;

    const target = this._getPlaylistTargetCount(playlistType);
    if (allSettled && target && done < target) {
      const shortfall = target - done;
      const rounds = Number(this.backupRefillRounds.get(playlistType) || 0) + 1;
      this.backupRefillRounds.set(playlistType, rounds);
      const enqueued = await this._enqueueBackupJobs(playlistType, shortfall);
      if (enqueued > 0) {
        this.wake();
        return;
      }
      this._scheduleIncompleteRetry(playlistType);
      return;
    }

    if (allSettled && hasDone) {
      if (this.playlistFinalizing.has(playlistKey)) {
        return;
      }
      this.playlistFinalizing.add(playlistKey);
      this.clearIncompleteRetry(playlistType);
      this.backupRefillRounds.delete(playlistType);
      console.log(
        `[WeeklyFlowWorker] All jobs complete for ${playlistType}, ensuring playlists...`,
      );
      try {
        await fs.rm(path.join(this.weeklyFlowRoot, "_fallback"), {
          recursive: true,
          force: true,
        });
      } catch {}
      try {
        playlistManager.updateConfig(false);
        await playlistManager.ensurePlaylists();
        await playlistManager.scheduleScanLibrary(true);
        if (flowPlaylistConfig.isEnabled(playlistType)) {
          flowPlaylistConfig.scheduleNextRun(playlistType);
        }
      } catch (error) {
        console.error(
          `[WeeklyFlowWorker] Failed to ensure playlists for ${playlistType}:`,
          error.message,
        );
      }

      const flow = flowPlaylistConfig.getFlow(playlistType);
      const completed = done;
      const { notifyWeeklyFlowDone } = await import("./notificationService.js");
      notifyWeeklyFlowDone(
        playlistType,
        { completed, failed },
        path.join(playlistManager.libraryRoot, playlistType),
        flow ? flow.name : playlistType,
      ).catch((err) =>
        console.warn(
          "[WeeklyFlowWorker] Gotify notification failed:",
          err.message,
        ),
      );
      this.playlistFinalizing.delete(playlistKey);
    }
  }

  getStatus() {
    const settings = this.getWorkerSettings();
    const completedTracks = Number(this.downloadMetrics.completedTracks || 0);
    const playlistRuns = {};
    for (const playlistType of new Set([
      ...this.playlistReservePools.keys(),
      ...this.playlistRunDiagnostics.keys(),
      ...this.playlistFailureMemory.keys(),
    ])) {
      playlistRuns[playlistType] = this.getPlaylistRunStatus(playlistType);
    }
    return {
      running: this.running,
      processing: this.activeCount > 0,
      activeCount: this.activeCount,
      stats: downloadTracker.getStats(),
      currentJob: this.currentJob,
      lastJobMetrics: this.lastJobMetrics,
      downloadMetrics: {
        completedTracks,
        avgAttemptsPerTrack:
          completedTracks > 0
            ? Number(
                (
                  this.downloadMetrics.completedTrackAttempts / completedTracks
                ).toFixed(2),
              )
            : 0,
        avgSuccessLatencyMs:
          completedTracks > 0
            ? Math.round(
                this.downloadMetrics.completedTrackLatencyMs / completedTracks,
              )
            : 0,
      },
      playlistRuns,
      settings,
    };
  }
}

export const weeklyFlowWorker = new WeeklyFlowWorker();
