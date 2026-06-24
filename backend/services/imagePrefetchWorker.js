import createHonkerWorker from "./honkerWorkerFactory.js";
import { getImagePrefetchQueue } from "./honkerDb.js";
import { dbOps } from "../config/db-helpers.js";
import { getArtistImage } from "./imageService.js";

async function processImagePrefetch(payload = {}) {
  const mbids = (Array.isArray(payload?.mbids) ? payload.mbids : [])
    .map((mbid) => String(mbid || "").trim())
    .filter(Boolean);
  if (mbids.length === 0) return { skipped: true };

  const artistNames =
    payload?.artistNames && typeof payload.artistNames === "object"
      ? payload.artistNames
      : {};
  await Promise.allSettled(
    mbids.map((mbid) => {
      const cached = dbOps.getImage(mbid);
      return getArtistImage(mbid, {
        artistName:
          typeof artistNames[mbid] === "string" ? artistNames[mbid] : null,
        forceRefresh: cached?.imageUrl === "NOT_FOUND",
      });
    }),
  );
  return { prefetched: mbids.length };
}

const {
  start: startImagePrefetchWorker,
  stop: stopImagePrefetchWorker,
  isRunning: isImagePrefetchWorkerRunning,
} = createHonkerWorker({
  name: "image-prefetch",
  getQueue: getImagePrefetchQueue,
  processJob: processImagePrefetch,
  idlePollS: 10,
  retryDelayS: 60,
  maxAttempts: 4,
});

export {
  startImagePrefetchWorker,
  stopImagePrefetchWorker,
  isImagePrefetchWorkerRunning,
};
