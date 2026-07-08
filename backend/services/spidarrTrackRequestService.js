import { dbOps } from "../db/helpers/index.js";
import { lidarrClient } from "./lidarrClient.js";
import { downloadTracker } from "./weeklyFlow/weeklyFlowDownloadTracker.js";
import { getPathMappings, resolveLocalPath } from "./pathMappings.js";
import { logger } from "./logger.js";

const POLL_MS = 5000;
const MAX_WAIT_MS = 30 * 60 * 1000;

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

async function waitForTrackFile(trackMbid) {
  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    const match = await lidarrClient.findTrackFileByMbid(trackMbid);
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

export async function processSpidarrTrackRequest(job) {
  if (!job?.id || !job?.trackMbid) {
    throw new Error("Track job is missing required metadata");
  }

  downloadTracker.setDownloading(job.id);

  const settings = dbOps.getSettings();
  const lidarr = settings?.integrations?.lidarr || {};

  const result = await lidarrClient.requestTrack({
    artistMbid: job.artistMbid,
    albumMbid: job.albumMbid,
    trackMbid: job.trackMbid,
    artistName: job.artistName,
    trackName: job.trackName,
    albumName: job.albumName,
    searchOnAdd: true,
    qualityProfileId: lidarr.defaultQualityProfileId ?? null,
    metadataProfileId: lidarr.defaultMetadataProfileId ?? null,
    rootFolderPath: lidarr.defaultRootFolderPath ?? null,
    tags: Array.isArray(lidarr.defaultTags) ? lidarr.defaultTags : undefined,
  });

  logger.info(
    `[Spidarr] Track request queued for job ${job.id} (track ${result?.trackId}, command ${result?.commandId ?? "n/a"})`,
  );

  const match = await waitForTrackFile(job.trackMbid);
  if (!match?.file?.path) {
    throw new Error(`Timed out waiting for track file for ${job.trackName}`);
  }

  const finalPath = resolvePlaybackPath(match.file.path);
  downloadTracker.setDone(job.id, finalPath, job.albumName, match.file.path);
  return { finalPath, trackId: result?.trackId, albumId: result?.albumId };
}

export function enqueueSpidarrTrackRequest(jobId) {
  const job = downloadTracker.getJob(jobId);
  if (!job || job.status !== "pending") {
    return false;
  }

  void processSpidarrTrackRequest(job).catch((error) => {
    logger.error(`[Spidarr] Track request failed for job ${jobId}: ${error.message}`);
    downloadTracker.setFailed(jobId, error);
  });

  return true;
}
