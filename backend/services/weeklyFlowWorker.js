import path from "path";
import fs from "fs/promises";
import { downloadTracker } from "./weeklyFlowDownloadTracker.js";
import { soulseekClient } from "./simpleSoulseekClient.js";
import { playlistManager } from "./weeklyFlowPlaylistManager.js";
import { flowPlaylistConfig } from "./weeklyFlowPlaylistConfig.js";

const CONCURRENCY = 1;
const JOB_COOLDOWN_MS = 2000;
const FALLBACK_MP3_REGEX = /^[^/\\]+-[a-f0-9]{8}\.mp3$/i;

export class WeeklyFlowWorker {
  constructor(weeklyFlowRoot = process.env.WEEKLY_FLOW_FOLDER || "/app/downloads") {
    this.weeklyFlowRoot = path.isAbsolute(weeklyFlowRoot)
      ? weeklyFlowRoot
      : path.resolve(process.cwd(), weeklyFlowRoot);
    this.running = false;
    this.activeCount = 0;
  }

  async moveFallbackMp3sToDir() {
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

  async start() {
    if (this.running) {
      return;
    }

    this.running = true;
    console.log("[WeeklyFlowWorker] Starting worker...");
    await this.moveFallbackMp3sToDir();

    const processLoop = () => {
      if (!this.running) return;

      while (this.activeCount < CONCURRENCY) {
        const job = downloadTracker.getNextPending();
        if (!job) break;

        this.activeCount++;
        this.processJob(job)
          .catch(async (error) => {
            console.error(
              `[WeeklyFlowWorker] Error processing job ${job.id}:`,
              error.message,
            );
            downloadTracker.setFailed(job.id, error.message);
            await this.checkPlaylistComplete(job.playlistType);
          })
          .finally(() => {
            this.activeCount--;
            this.moveFallbackMp3sToDir().catch(() => {});
            if (this.running) setTimeout(processLoop, JOB_COOLDOWN_MS);
          });
      }
    };

    processLoop();
  }

  stop() {
    if (!this.running) {
      return;
    }

    this.running = false;
    downloadTracker.resetDownloadingToPending();
    soulseekClient.disconnect().catch(() => {});
    console.log("[WeeklyFlowWorker] Worker stopped");
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

    downloadTracker.setDownloading(job.id, stagingPath);

    try {
      const results = await soulseekClient.search(
        job.artistName,
        job.trackName,
      );
      if (!results || results.length === 0) {
        throw new Error("No search results found");
      }

      const bestMatch = soulseekClient.pickBestMatch(results, job.trackName);
      if (!bestMatch) {
        throw new Error("No suitable match found");
      }

      const extFromSoulseek = path.extname(bestMatch.file || "");
      const ext =
        extFromSoulseek && /^\.(flac|mp3|m4a|ogg|wav)$/i.test(extFromSoulseek)
          ? extFromSoulseek
          : ".mp3";

      await new Promise((r) => setImmediate(r));
      await fs.mkdir(stagingDir, { recursive: true });
      const stagingFile = `${job.artistName} - ${job.trackName}${ext}`;
      const stagingFilePath = path.join(stagingDir, stagingFile);

      let lastError = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        let match = bestMatch;
        if (attempt === 1) {
          const retryResults = await soulseekClient.search(
            job.artistName,
            job.trackName,
          );
          if (retryResults?.length) {
            const retryMatch = soulseekClient.pickBestMatch(
              retryResults,
              job.trackName,
            );
            if (retryMatch) match = retryMatch;
          }
        }
        try {
          await soulseekClient.download(match, stagingFilePath);
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          const isTimeout = err?.message === "Download timeout";
          if (!isTimeout || attempt === 1) throw err;
        }
      }
      if (lastError) throw lastError;

      const downloadedFiles = await fs.readdir(stagingDir);
      if (downloadedFiles.length === 0) {
        throw new Error("Download completed but no file found");
      }

      const downloadedFile = downloadedFiles[0];
      const sourcePath = path.join(stagingDir, downloadedFile);
      const finalExt = path.extname(downloadedFile) || ext;

      const sanitize = (str) => {
        return str.replace(/[<>:"/\\|?*]/g, "_").trim();
      };

      const parseAlbumFromPath = (filePath) => {
        if (!filePath || typeof filePath !== "string") return null;
        const normalized = filePath.replace(/\\/g, "/").trim();
        const parts = normalized.split("/").filter(Boolean);
        if (parts.length >= 2) {
          return parts[parts.length - 2];
        }
        return null;
      };

      const artistDir = sanitize(job.artistName);
      const albumFromPath = parseAlbumFromPath(bestMatch.file);
      const albumDir = albumFromPath
        ? sanitize(albumFromPath)
        : "Unknown Album";
      const finalDir = path.join(
        this.weeklyFlowRoot,
        "aurral-weekly-flow",
        job.playlistType,
        artistDir,
        albumDir,
      );
      const finalFileName = `${sanitize(job.trackName)}${finalExt}`;
      const finalPath = path.join(finalDir, finalFileName);

      await fs.mkdir(finalDir, { recursive: true });
      await fs.rename(sourcePath, finalPath);

      await fs.rm(stagingDir, { recursive: true, force: true });

      playlistManager.updateConfig(false);

      downloadTracker.setDone(job.id, finalPath);
      console.log(`[WeeklyFlowWorker] Job ${job.id} completed: ${finalPath}`);

      await this.checkPlaylistComplete(job.playlistType);
    } catch (error) {
      try {
        await fs.rm(stagingDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn(
          `[WeeklyFlowWorker] Failed to cleanup staging dir: ${cleanupError.message}`,
        );
      }
      throw error;
    }
  }

  async checkPlaylistComplete(playlistType) {
    const jobs = downloadTracker.getByPlaylistType(playlistType);
    const allDone = jobs.every(
      (j) => j.status === "done" || j.status === "failed",
    );
    const hasDone = jobs.some((j) => j.status === "done");

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
      const completed = jobs.filter((j) => j.status === "done").length;
      const failed = jobs.filter((j) => j.status === "failed").length;
      const { notifyWeeklyFlowDone } = await import(
        "./notificationService.js"
      );
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
    };
  }
}

export const weeklyFlowWorker = new WeeklyFlowWorker();
