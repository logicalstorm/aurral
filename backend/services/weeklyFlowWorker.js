import path from "path";
import fs from "fs/promises";
import { downloadTracker } from "./weeklyFlowDownloadTracker.js";
import { soulseekClient } from "./simpleSoulseekClient.js";
import { playlistManager } from "./weeklyFlowPlaylistManager.js";

export class WeeklyFlowWorker {
  constructor(weeklyFlowRoot = "./weekly-flow") {
    this.weeklyFlowRoot = weeklyFlowRoot;
    this.running = false;
    this.intervalId = null;
    this.processing = false;
  }

  async start(intervalMs = 5000) {
    if (this.running) {
      return;
    }

    this.running = true;
    console.log("[WeeklyFlowWorker] Starting worker...");

    const processLoop = async () => {
      if (this.processing) {
        return;
      }

      const job = downloadTracker.getNextPending();
      if (!job) {
        return;
      }

      this.processing = true;
      try {
        await this.processJob(job);
      } catch (error) {
        console.error(
          `[WeeklyFlowWorker] Error processing job ${job.id}:`,
          error.message,
        );
        downloadTracker.setFailed(job.id, error.message);
      } finally {
        this.processing = false;
      }
    };

    this.intervalId = setInterval(processLoop, intervalMs);
    processLoop();
  }

  stop() {
    if (!this.running) {
      return;
    }

    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
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

      await fs.mkdir(stagingDir, { recursive: true });
      await soulseekClient.download(bestMatch, stagingPath);

      const downloadedFiles = await fs.readdir(stagingDir);
      if (downloadedFiles.length === 0) {
        throw new Error("Download completed but no file found");
      }

      const downloadedFile = downloadedFiles[0];
      const sourcePath = path.join(stagingDir, downloadedFile);
      const ext = path.extname(downloadedFile) || ".mp3";

      const sanitize = (str) => {
        return str.replace(/[<>:"/\\|?*]/g, "_").trim();
      };

      const artistDir = sanitize(job.artistName);
      const albumDir = "Unknown Album";
      const finalDir = path.join(
        this.weeklyFlowRoot,
        job.playlistType,
        artistDir,
        albumDir,
      );
      const finalFileName = `${sanitize(job.trackName)}${ext}`;
      const finalPath = path.join(finalDir, finalFileName);

      await fs.mkdir(finalDir, { recursive: true });
      await fs.rename(sourcePath, finalPath);

      await fs.rm(stagingDir, { recursive: true, force: true });

      playlistManager.updateConfig();
      await playlistManager.createSymlink(finalPath, job.playlistType);

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
        `[WeeklyFlowWorker] All jobs complete for ${playlistType}, creating playlist...`,
      );
      playlistManager.updateConfig();
      const playlistName = playlistManager.getPlaylistName(playlistType);

      try {
        await playlistManager.createPlaylist(playlistType, playlistName);
        await playlistManager.triggerNavidromeScan();
      } catch (error) {
        console.error(
          `[WeeklyFlowWorker] Failed to create playlist for ${playlistType}:`,
          error.message,
        );
      }
    }
  }

  getStatus() {
    return {
      running: this.running,
      processing: this.processing,
      stats: downloadTracker.getStats(),
    };
  }
}

export const weeklyFlowWorker = new WeeklyFlowWorker();
