import createHonkerWorker from "./honkerWorkerFactory.js";
import { getDiscoveryPlaylistBuildQueue } from "./honkerDb.js";
import {
  emitDiscoverPlaylistBuildFailure,
  runQueuedDiscoverPlaylistBuild,
} from "./discovery/index.js";

const {
  start: startDiscoveryPlaylistBuildWorker,
  stop: stopDiscoveryPlaylistBuildWorker,
  isRunning: isDiscoveryPlaylistBuildWorkerRunning,
} = createHonkerWorker({
  name: "discovery-playlist-build",
  getQueue: getDiscoveryPlaylistBuildQueue,
  processJob: runQueuedDiscoverPlaylistBuild,
  idlePollS: 5,
  retryDelayS: 120,
  maxAttempts: 3,
  onFinalFailure: (job, error) =>
    emitDiscoverPlaylistBuildFailure(job.payload, error),
});

export {
  startDiscoveryPlaylistBuildWorker,
  stopDiscoveryPlaylistBuildWorker,
  isDiscoveryPlaylistBuildWorkerRunning,
};
