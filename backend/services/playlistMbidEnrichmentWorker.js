import createHonkerWorker from "./honkerWorkerFactory.js";
import { getPlaylistMbidEnrichmentQueue } from "./honkerDb.js";import {
  enrichSharedPlaylistMbids,
  schedulePlaylistMbidEnrichmentForMissingPlaylists,
} from "./playlistMbidEnrichmentService.js";

async function processPlaylistMbidEnrichment(payload = {}) {
  const kind = String(payload?.kind || payload?.type || "").trim();
  switch (kind) {
    case "playlist-mbid-enrichment": {
      return enrichSharedPlaylistMbids(payload.playlistId);
    }
    case "playlist-mbid-enrichment-sweep": {
      const jobIds = schedulePlaylistMbidEnrichmentForMissingPlaylists({
        reason: payload?.reason || "sweep",
      });
      return {
        success: true,
        enqueued: jobIds.length,
        jobIds,
      };
    }
    default:
      throw new Error(`Unknown playlist MBID enrichment task: ${kind || "unknown"}`);
  }
}

const {  start: startPlaylistMbidEnrichmentWorker,
  stop: stopPlaylistMbidEnrichmentWorker,
  isRunning: isPlaylistMbidEnrichmentWorkerRunning,
} = createHonkerWorker({
  name: "playlist-mbid-enrichment",
  getQueue: getPlaylistMbidEnrichmentQueue,
  processJob: processPlaylistMbidEnrichment,
  idlePollS: 10,
  retryDelayS: 300,
  maxAttempts: 4,
});

export {
  startPlaylistMbidEnrichmentWorker,
  stopPlaylistMbidEnrichmentWorker,
  isPlaylistMbidEnrichmentWorkerRunning,
};
