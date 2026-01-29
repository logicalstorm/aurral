import { dbOps } from "../config/db-helpers.js";
import { getArtistImage } from "./imageService.js";

class ImagePrefetchService {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.batchSize = 5;
    this.delayBetweenBatches = 100; // ms
  }

  enqueue(mbids) {
    if (!Array.isArray(mbids)) return;

    const uniqueMbids = [...new Set(mbids)];
    const uncached = uniqueMbids.filter((mbid) => {
      if (!mbid) return false;
      const cached = dbOps.getImage(mbid);
      return !cached || cached.imageUrl === "NOT_FOUND";
    });

    this.queue.push(...uncached);
    this.processQueue();
  }

  async processQueue() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.batchSize);

      await Promise.allSettled(
        batch.map((mbid) =>
          getArtistImage(mbid).catch((err) => {
            return null;
          }),
        ),
      );

      if (this.queue.length > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.delayBetweenBatches),
        );
      }
    }

    this.processing = false;
  }

  async prefetchDiscoveryImages(discoveryData) {
    const mbids = [];

    if (discoveryData?.recommendations) {
      mbids.push(
        ...discoveryData.recommendations.map((a) => a.id).filter(Boolean),
      );
    }

    if (discoveryData?.globalTop) {
      mbids.push(...discoveryData.globalTop.map((a) => a.id).filter(Boolean));
    }

    this.enqueue(mbids);
  }

  async prefetchSearchResults(artists) {
    const mbids = artists.map((a) => a.id || a.mbid).filter(Boolean);
    this.enqueue(mbids);
  }
}

export const imagePrefetchService = new ImagePrefetchService();
