import createHonkerWorker from "../honkerWorkerFactory.js";
import { getPlaylistReserveBuildQueue } from "../honkerDb.js";
import { weeklyFlowWorker } from "./weeklyFlowWorker.js";

const {
  start: startWeeklyFlowPlaylistReserveBuildWorker,
  stop: stopWeeklyFlowPlaylistReserveBuildWorker,
  isRunning: isWeeklyFlowPlaylistReserveBuildWorkerRunning,
} = createHonkerWorker({
  name: "playlist-reserve-build",
  getQueue: getPlaylistReserveBuildQueue,
  processJob: (payload) => weeklyFlowWorker.runQueuedReserveBuild(payload),
  idlePollS: 10,
  retryDelayS: 120,
  maxAttempts: 3,
});

export {
  startWeeklyFlowPlaylistReserveBuildWorker,
  stopWeeklyFlowPlaylistReserveBuildWorker,
  isWeeklyFlowPlaylistReserveBuildWorkerRunning,
};
