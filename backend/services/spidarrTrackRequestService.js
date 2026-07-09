import { dbOps } from "../db/helpers/index.js";
import { lidarrClient } from "./lidarrClient.js";
import { downloadTracker } from "./weeklyFlow/weeklyFlowDownloadTracker.js";
import { getPathMappings, resolveLocalPath } from "./pathMappings.js";
import { logger } from "./logger.js";
import { UUID_REGEX } from "../../lib/uuid.js";
import { resolveWeeklyFlowTrackContext } from "./weeklyFlow/weeklyFlowTrackResolver.js";
import { claimPlaylistAcquisition } from "./lidarrPlaylistTagService.js";

const POLL_MS = 5000;
const MAX_WAIT_MS = 30 * 60 * 1000;
const activePolls = new Set();

export function isSpidarrTrackRequestsEnabled() {
  const settings = dbOps.getSettings();
  const lidarr = settings?.integrations?.lidarr;
  if (!lidarr?.url || !lidarr?.apiKey) {
    return false;
  }
  return lidarr.useTrackRequests !== false;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForResolvableTrack(job, maxWaitMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const resolved = await lidarrClient.resolveTrackForRequest(job);
    if (resolved?.foreignTrackId) {
      return resolved;
    }
    await sleep(1000);
  }
  return null;
}

async function requestTrackWithRetries(job, requestPayload) {
  let requestTrackMbid = asUuid(requestPayload.trackMbid);
  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const resolved = await lidarrClient.resolveTrackForRequest({
      ...job,
      trackMbid: requestTrackMbid,
    });
    const resolvedMbid = asUuid(resolved?.foreignTrackId);
    if (resolvedMbid) {
      requestTrackMbid = resolvedMbid;
      if (resolvedMbid !== asUuid(job.trackMbid)) {
        downloadTracker.updateMetadata(job.id, { trackMbid: resolvedMbid });
      }
    }

    try {
      return {
        result: await lidarrClient.requestTrack({
          ...requestPayload,
          trackMbid: requestTrackMbid,
        }),
        requestTrackMbid,
      };
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error || "");
      const retryable =
        /was not found after adding album/i.test(message) ||
        /409/.test(message) ||
        /UNIQUE constraint failed: Albums\.ForeignAlbumId/i.test(message);
      if (!retryable || attempt === 4) {
        throw error;
      }
      await sleep(2000 * (attempt + 1));
    }
  }

  throw lastError || new Error(`Track request failed for ${job.trackName}`);
}

async function waitForTrackFile(job, trackMbid) {
  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    const match =
      (await lidarrClient.findTrackFileForJob(job)) ||
      (trackMbid ? await lidarrClient.findTrackFileByMbid(trackMbid) : null);
    if (match?.file?.path) {
      return match;
    }
    await sleep(POLL_MS);
  }
  return null;
}

function resolvePlaybackPath(filePath) {
  const mappings = getPathMappings();
  return resolveLocalPath(filePath, mappings) || filePath;
}

function asUuid(value) {
  const text = String(value || "").trim();
  return UUID_REGEX.test(text) ? text : "";
}

async function enrichJobMbids(job) {
  const needs =
    !asUuid(job.trackMbid) || !asUuid(job.albumMbid) || !asUuid(job.artistMbid);
  if (!needs) return job;

  const enriched = await resolveWeeklyFlowTrackContext(job);
  const patch = {};
  for (const key of ["artistMbid", "albumMbid", "trackMbid", "albumName", "releaseYear"]) {
    const next = key.endsWith("Mbid") ? asUuid(enriched?.[key]) : String(enriched?.[key] || "").trim();
    if (!next) continue;
    if (key.endsWith("Mbid") ? asUuid(job[key]) !== next : String(job[key] || "").trim() !== next) {
      patch[key] = next;
    }
  }
  if (enriched?.durationMs != null && Number.isFinite(Number(enriched.durationMs))) {
    const durationMs = Math.max(0, Math.round(Number(enriched.durationMs)));
    if (job.durationMs !== durationMs) patch.durationMs = durationMs;
  }
  if (Object.keys(patch).length) {
    downloadTracker.updateMetadata(job.id, patch);
    return { ...job, ...patch };
  }
  return job;
}

export async function processSpidarrTrackRequest(job, options = {}) {
  if (!job?.id) {
    throw new Error("Track job is missing required metadata");
  }

  const resumeOnly = options.resumeOnly === true;
  if (!resumeOnly) {
    downloadTracker.setDownloading(job.id);
  }

  const settings = dbOps.getSettings();
  const lidarr = settings?.integrations?.lidarr || {};

  job = await enrichJobMbids(job);

  let requestTrackMbid = asUuid(job.trackMbid);
  let result = null;

  if (!resumeOnly) {
    const resolved = (await waitForResolvableTrack(job)) || (await lidarrClient.resolveTrackForRequest(job));
    const resolvedTrackMbid = asUuid(resolved?.foreignTrackId);
    const jobTrackMbid = asUuid(job.trackMbid);
    requestTrackMbid = resolvedTrackMbid || jobTrackMbid;
    if (!requestTrackMbid) {
      throw new Error(
        `No MusicBrainz track id for ${job.artistName} - ${job.trackName} (got ${job.trackMbid || "empty"})`,
      );
    }
    if (requestTrackMbid !== String(job.trackMbid || "").trim()) {
      logger.info(
        `[Spidarr] Mapped ${job.trackMbid || "(none)"} → Lidarr track ${requestTrackMbid} (${job.artistName} - ${job.trackName})`,
      );
      downloadTracker.updateMetadata(job.id, { trackMbid: requestTrackMbid });
    }

    const artistMbid = asUuid(job.artistMbid);
    const albumMbid = asUuid(job.albumMbid);
    if (!artistMbid || !albumMbid) {
      throw new Error(
        `Missing artist/album MBID for ${job.artistName} - ${job.trackName}`,
      );
    }

    const requestPayload = {
      artistMbid,
      albumMbid,
      trackMbid: requestTrackMbid,
      artistName: job.artistName,
      trackName: job.trackName,
      albumName: job.albumName,
      searchOnAdd: true,
      qualityProfileId: lidarr.defaultQualityProfileId ?? null,
      metadataProfileId: lidarr.defaultMetadataProfileId ?? null,
      rootFolderPath: lidarr.defaultRootFolderPath ?? null,
      tags: Array.isArray(lidarr.defaultTags) ? lidarr.defaultTags : undefined,
    };

    const { result, requestTrackMbid: queuedTrackMbid } = await requestTrackWithRetries(job, requestPayload);
    requestTrackMbid = queuedTrackMbid;

    logger.info(
      `[Spidarr] Track request queued for job ${job.id} (track ${result?.trackId}, command ${result?.commandId ?? "n/a"})`,
    );
  }

  const match = await waitForTrackFile(job, requestTrackMbid);
  if (!match?.file?.path) {
    throw new Error(`Timed out waiting for track file for ${job.trackName}`);
  }

  const finalPath = resolvePlaybackPath(match.file.path);
  downloadTracker.setDone(job.id, finalPath, job.albumName, match.file.path);
  try {
    await claimPlaylistAcquisition(job.playlistType, {
      job,
      track: match.track,
      albumMbid: job.albumMbid,
    });
  } catch (error) {
    logger.warn(`[Spidarr] Playlist tag claim failed for job ${job.id}: ${error.message}`);
  }
  const { weeklyFlowWorker } = await import("./weeklyFlow/weeklyFlowWorker.js");
  if (weeklyFlowWorker.running) {
    weeklyFlowWorker.wake(0);
  } else {
    await weeklyFlowWorker.start();
  }
  await weeklyFlowWorker.checkPlaylistComplete(job.playlistType);
  return { finalPath, trackId: result?.trackId, albumId: result?.albumId };
}

export async function reconcileLidarrDownloadingJobs() {
  if (!isSpidarrTrackRequestsEnabled()) {
    return { markedDone: 0, resumed: 0 };
  }

  let markedDone = 0;
  let resumed = 0;
  const playlistsTouched = new Set();
  const { weeklyFlowWorker } = await import("./weeklyFlow/weeklyFlowWorker.js");

  for (const job of downloadTracker.getAll()) {
    if (job.status !== "downloading" && job.status !== "failed") continue;

    const enriched = await enrichJobMbids(job);
    let match = await lidarrClient.findTrackFileForJob(enriched);
    if (!match?.file?.path) {
      const mbids = [asUuid(enriched.trackMbid)].filter(Boolean);
      for (const mbid of mbids) {
        match = await lidarrClient.findTrackFileByMbid(mbid);
        if (match?.file?.path) break;
      }
    }

    if (match?.file?.path) {
      const finalPath = resolvePlaybackPath(match.file.path);
      downloadTracker.setDone(enriched.id, finalPath, enriched.albumName, match.file.path);
      try {
        await claimPlaylistAcquisition(enriched.playlistType, {
          job: enriched,
          track: match.track,
          albumMbid: enriched.albumMbid,
        });
      } catch (error) {
        logger.warn(`[Spidarr] Playlist tag claim failed for job ${enriched.id}: ${error.message}`);
      }
      playlistsTouched.add(enriched.playlistType);
      markedDone += 1;
      continue;
    }

    if (job.status === "downloading" && enqueueSpidarrTrackRequest(enriched.id, { resumeOnly: true })) {
      resumed += 1;
      continue;
    }

    const errorText = String(enriched.error || "");
    const retryableFailed =
      job.status === "failed" &&
      (/was not found after adding album/i.test(errorText) ||
        /Timed out waiting for track file/i.test(errorText) ||
        /409/.test(errorText));
    if (retryableFailed && downloadTracker.setPending(enriched.id, null, { retryCycle: true })) {
      if (enqueueSpidarrTrackRequest(enriched.id)) {
        resumed += 1;
      }
    }
  }

  for (const playlistType of playlistsTouched) {
    await weeklyFlowWorker.checkPlaylistComplete(playlistType);
  }

  if (markedDone > 0 || resumed > 0) {
    if (weeklyFlowWorker.running) {
      weeklyFlowWorker.wake(0);
    } else {
      await weeklyFlowWorker.start();
    }
  }

  return { markedDone, resumed };
}

export function enqueueSpidarrTrackRequest(jobId, options = {}) {
  const job = downloadTracker.getJob(jobId);
  if (!job) {
    return false;
  }

  const resumeOnly = options.resumeOnly === true;
  if (!resumeOnly && job.status !== "pending") {
    return false;
  }
  if (resumeOnly && job.status !== "downloading") {
    return false;
  }
  if (activePolls.has(jobId)) {
    return false;
  }

  activePolls.add(jobId);
  void processSpidarrTrackRequest(job, { resumeOnly })
    .catch(async (error) => {
      logger.error(`[Spidarr] Track request failed for job ${jobId}: ${error.message}`);
      downloadTracker.setFailed(jobId, error);
      const { weeklyFlowWorker } = await import("./weeklyFlow/weeklyFlowWorker.js");
      if (weeklyFlowWorker.running) {
        weeklyFlowWorker.wake(0);
      } else {
        await weeklyFlowWorker.start();
      }
    })
    .finally(() => {
      activePolls.delete(jobId);
    });

  return true;
}
