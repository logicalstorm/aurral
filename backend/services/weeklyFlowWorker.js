import path from "path";
import fs from "fs/promises";
import { downloadTracker } from "./weeklyFlowDownloadTracker.js";
import { soulseekClient } from "./simpleSoulseekClient.js";
import { playlistManager } from "./weeklyFlowPlaylistManager.js";
import { flowPlaylistConfig } from "./weeklyFlowPlaylistConfig.js";

const CONCURRENCY = 1;
const JOB_COOLDOWN_MS = 2000;
const MAX_MATCH_CANDIDATES = 1;
const FALLBACK_MP3_REGEX = /^[^/\\]+-[a-f0-9]{8}\.mp3$/i;
const FALLBACK_SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const MAX_RETRIES_PER_JOB = 3;
const NON_RETRYABLE_ERRORS = new Set([
  "No search results found",
  "No candidate files returned",
]);

export class WeeklyFlowWorker {
  constructor(
    weeklyFlowRoot = process.env.WEEKLY_FLOW_FOLDER || "/app/downloads",
  ) {
    this.weeklyFlowRoot = path.isAbsolute(weeklyFlowRoot)
      ? weeklyFlowRoot
      : path.resolve(process.cwd(), weeklyFlowRoot);
    this.running = false;
    this.activeCount = 0;
    this.lastFallbackSweepAt = 0;
    this.processLoop = null;
    this.processTimer = null;
    this.retryAttempts = new Map();
    this.currentJob = null;
    this.fallbackSweepInFlight = null;
    this.fallbackSweepTimer = null;
    this.lastJobMetrics = null;
  }

  async moveFallbackMp3sToDir(force = false) {
    const now = Date.now();
    if (!force && now - this.lastFallbackSweepAt < FALLBACK_SWEEP_INTERVAL_MS) {
      return;
    }
    this.lastFallbackSweepAt = now;
    const cwd = process.cwd();
    if (path.resolve(cwd) === path.resolve(this.weeklyFlowRoot)) return;
    const fallbackDir = path.join(this.weeklyFlowRoot, "_fallback");
    try {
      const entries = await fs.readdir(cwd, { withFileTypes: true });
      const toMove = entries.filter(
        (e) =>
          e.isFile() &&
          e.name.endsWith(".mp3") &&
          FALLBACK_MP3_REGEX.test(e.name),
      );
      if (toMove.length === 0) return;
      await fs.mkdir(fallbackDir, { recursive: true });
      for (const e of toMove) {
        const src = path.join(cwd, e.name);
        const dest = path.join(fallbackDir, e.name);
        try {
          await fs.rename(src, dest);
        } catch {}
      }
    } catch {}
  }

  scheduleFallbackSweep(force = false) {
    if (this.fallbackSweepInFlight) return;
    this.fallbackSweepInFlight = this.moveFallbackMp3sToDir(force)
      .catch(() => {})
      .finally(() => {
        this.fallbackSweepInFlight = null;
      });
  }

  async start() {
    if (this.running) {
      return;
    }

    this.running = true;
    console.log("[WeeklyFlowWorker] Starting worker...");
    await this.moveFallbackMp3sToDir(true);
    this.fallbackSweepTimer = setInterval(() => {
      if (!this.running) return;
      this.scheduleFallbackSweep(false);
    }, FALLBACK_SWEEP_INTERVAL_MS);

    this.processLoop = () => {
      if (!this.running) return;

      while (this.activeCount < CONCURRENCY) {
        const job = downloadTracker.getNextPending();
        if (!job) break;

        this.activeCount++;
        this.currentJob = {
          id: job.id,
          playlistType: job.playlistType,
          artistName: job.artistName,
          trackName: job.trackName,
          progressPct: 0,
          startedAt: Date.now(),
        };
        this.processJob(job)
          .catch(async (error) => {
            const attempts = Number(this.retryAttempts.get(job.id) || 0);
            const message = String(error?.message || "");
            const retryable = !NON_RETRYABLE_ERRORS.has(message);
            if (retryable && attempts < MAX_RETRIES_PER_JOB) {
              this.retryAttempts.set(job.id, attempts + 1);
              downloadTracker.setPending(
                job.id,
                `${message} (retry ${attempts + 1}/${MAX_RETRIES_PER_JOB})`,
              );
              return;
            }
            this.retryAttempts.delete(job.id);
            console.error(
              `[WeeklyFlowWorker] Error processing job ${job.id}:`,
              error.message,
            );
            downloadTracker.setFailed(job.id, error.message);
            await this.checkPlaylistComplete(job.playlistType);
          })
          .finally(() => {
            this.activeCount--;
            if (this.activeCount <= 0) {
              this.currentJob = null;
            }
            if (this.running && !this.processTimer) {
              this.processTimer = setTimeout(() => {
                this.processTimer = null;
                if (this.processLoop) this.processLoop();
              }, JOB_COOLDOWN_MS);
            }
          });
      }
    };

    this.processLoop();
  }

  stop() {
    if (!this.running) {
      return;
    }

    this.running = false;
    if (this.processTimer) {
      clearTimeout(this.processTimer);
      this.processTimer = null;
    }
    if (this.fallbackSweepTimer) {
      clearInterval(this.fallbackSweepTimer);
      this.fallbackSweepTimer = null;
    }
    this.processLoop = null;
    this.retryAttempts.clear();
    this.currentJob = null;
    downloadTracker.resetDownloadingToPending();
    soulseekClient.disconnect().catch(() => {});
    console.log("[WeeklyFlowWorker] Worker stopped");
  }

  _normalizeAlbumName(value) {
    const text = String(value || "")
      .replace(/\u0000/g, "")
      .trim();
    return text || null;
  }

  _parseAlbumFromPath(filePath) {
    if (!filePath || typeof filePath !== "string") return null;
    const normalized = filePath.replace(/\\/g, "/").trim();
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return this._normalizeAlbumName(parts[parts.length - 2]);
  }

  async processJob(job) {
    console.log(
      `[WeeklyFlowWorker] Processing job ${job.id}: ${job.artistName} - ${job.trackName} (${job.playlistType})`,
    );

    const stagingDir = path.join(this.weeklyFlowRoot, "_staging", job.id);
    const stagingPath = path.join(
      stagingDir,
      `${job.artistName} - ${job.trackName}.tmp`,
    );
    const perfStartCpu = process.cpuUsage();
    const perfStartHr = process.hrtime.bigint();
    const timingsMs = {
      search: 0,
      download: 0,
      finalize: 0,
      completionCheck: 0,
      cleanupOnError: 0,
    };

    downloadTracker.setDownloading(job.id, stagingPath);

    try {
      let phaseStart = process.hrtime.bigint();
      const initialResults = await soulseekClient.search(
        job.artistName,
        job.trackName,
      );
      timingsMs.search += Number(process.hrtime.bigint() - phaseStart) / 1e6;
      if (!initialResults || initialResults.length === 0) {
        throw new Error("No search results found");
      }

      let selectedMatch = null;
      let selectedExt = ".mp3";
      let downloadedSourcePath = null;
      let lastError = null;

      await new Promise((r) => setImmediate(r));
      await fs.mkdir(stagingDir, { recursive: true });
      const stagingFile = `${job.artistName} - ${job.trackName}`;
      const stagingFilePath = path.join(stagingDir, stagingFile);

      phaseStart = process.hrtime.bigint();
      const candidates = (Array.isArray(initialResults) ? initialResults : [])
        .filter((candidate) => {
          return typeof candidate?.file === "string" && candidate.file.trim();
        })
        .slice(0, MAX_MATCH_CANDIDATES);
      if (candidates.length === 0) {
        lastError = new Error("No candidate files returned");
        timingsMs.search += Number(process.hrtime.bigint() - phaseStart) / 1e6;
      } else {
        for (const candidate of candidates) {
          const extFromSoulseek = path.extname(candidate.file || "");
          const ext =
            extFromSoulseek &&
            /^\.(flac|mp3|m4a|ogg|wav)$/i.test(extFromSoulseek)
              ? extFromSoulseek
              : ".mp3";
          try {
            const downloadStart = process.hrtime.bigint();
            downloadedSourcePath = await soulseekClient.download(
              candidate,
              stagingFilePath,
              (progressPct) => {
                if (!this.currentJob || this.currentJob.id !== job.id) return;
                this.currentJob.progressPct = Math.max(
                  0,
                  Math.min(100, Number(progressPct) || 0),
                );
              },
            );
            timingsMs.download +=
              Number(process.hrtime.bigint() - downloadStart) / 1e6;
            if (this.currentJob && this.currentJob.id === job.id) {
              this.currentJob.progressPct = 100;
            }
            selectedMatch = candidate;
            selectedExt = ext;
            lastError = null;
            break;
          } catch (err) {
            lastError = err;
          }
        }
        timingsMs.search += Number(process.hrtime.bigint() - phaseStart) / 1e6;
      }
      if (!selectedMatch) {
        throw lastError || new Error("No suitable match found");
      }

      const sourcePath =
        typeof downloadedSourcePath === "string" && downloadedSourcePath
          ? downloadedSourcePath
          : null;
      if (!sourcePath) {
        throw new Error("Download completed but no file found");
      }
      const downloadedExt = path.extname(sourcePath).toLowerCase();
      const finalExt =
        downloadedExt && /^\.(flac|mp3|m4a|ogg|wav)$/i.test(downloadedExt)
          ? downloadedExt
          : selectedExt;

      const sanitize = (str) => {
        return str.replace(/[<>:"/\\|?*]/g, "_").trim();
      };

      const artistDir = sanitize(job.artistName);
      const albumFromApi = this._normalizeAlbumName(job.albumName);
      const albumFromPath = this._parseAlbumFromPath(selectedMatch.file);
      const resolvedAlbum = albumFromApi || albumFromPath || "Unknown Album";
      const albumDir = sanitize(resolvedAlbum);
      const finalDir = path.join(
        this.weeklyFlowRoot,
        "aurral-weekly-flow",
        job.playlistType,
        artistDir,
        albumDir,
      );
      const finalFileName = `${sanitize(job.trackName)}${finalExt}`;
      const finalPath = path.join(finalDir, finalFileName);

      phaseStart = process.hrtime.bigint();
      await fs.mkdir(finalDir, { recursive: true });
      await fs.rename(sourcePath, finalPath);

      await fs.rm(stagingDir, { recursive: true, force: true });

      downloadTracker.setDone(job.id, finalPath, resolvedAlbum);
      this.retryAttempts.delete(job.id);
      console.log(`[WeeklyFlowWorker] Job ${job.id} completed: ${finalPath}`);
      timingsMs.finalize += Number(process.hrtime.bigint() - phaseStart) / 1e6;

      phaseStart = process.hrtime.bigint();
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
          search: Math.round(timingsMs.search),
          download: Math.round(timingsMs.download),
          finalize: Math.round(timingsMs.finalize),
          completionCheck: Math.round(timingsMs.completionCheck),
          cleanupOnError: Math.round(timingsMs.cleanupOnError),
        },
      };
      console.log(
        `[WeeklyFlowWorker] Job metrics ${job.id}: ${JSON.stringify(this.lastJobMetrics)}`,
      );
    } catch (error) {
      try {
        const cleanupStart = process.hrtime.bigint();
        await fs.rm(stagingDir, { recursive: true, force: true });
        timingsMs.cleanupOnError +=
          Number(process.hrtime.bigint() - cleanupStart) / 1e6;
      } catch (cleanupError) {
        console.warn(
          `[WeeklyFlowWorker] Failed to cleanup staging dir: ${cleanupError.message}`,
        );
      }
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
          search: Math.round(timingsMs.search),
          download: Math.round(timingsMs.download),
          finalize: Math.round(timingsMs.finalize),
          completionCheck: Math.round(timingsMs.completionCheck),
          cleanupOnError: Math.round(timingsMs.cleanupOnError),
        },
      };
      console.log(
        `[WeeklyFlowWorker] Job metrics ${job.id}: ${JSON.stringify(this.lastJobMetrics)}`,
      );
      throw error;
    }
  }

  async checkPlaylistComplete(playlistType) {
    const stats = downloadTracker.getPlaylistTypeStats(playlistType);
    const allDone =
      stats.total > 0 && stats.pending === 0 && stats.downloading === 0;
    const hasDone = stats.done > 0;

    if (allDone && hasDone) {
      console.log(
        `[WeeklyFlowWorker] All jobs complete for ${playlistType}, ensuring smart playlists...`,
      );
      try {
        await fs.rm(path.join(this.weeklyFlowRoot, "_fallback"), {
          recursive: true,
          force: true,
        });
      } catch {}
      try {
        playlistManager.updateConfig(false);
        await playlistManager.ensureSmartPlaylists();
        await playlistManager.scanLibrary();
        if (flowPlaylistConfig.isEnabled(playlistType)) {
          flowPlaylistConfig.scheduleNextRun(playlistType);
        }
      } catch (error) {
        console.error(
          `[WeeklyFlowWorker] Failed to ensure smart playlists for ${playlistType}:`,
          error.message,
        );
      }
      const completed = stats.done;
      const failed = stats.failed;
      const { notifyWeeklyFlowDone } = await import("./notificationService.js");
      notifyWeeklyFlowDone(playlistType, { completed, failed }).catch((err) =>
        console.warn(
          "[WeeklyFlowWorker] Gotify notification failed:",
          err.message,
        ),
      );
      if (!downloadTracker.getNextPending()) {
        this.stop();
      }
    }
  }

  getStatus() {
    return {
      running: this.running,
      processing: this.activeCount > 0,
      activeCount: this.activeCount,
      stats: downloadTracker.getStats(),
      currentJob: this.currentJob,
      lastJobMetrics: this.lastJobMetrics,
    };
  }
}

export const weeklyFlowWorker = new WeeklyFlowWorker();
