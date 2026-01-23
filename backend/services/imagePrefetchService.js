import { db } from "../config/db.js";
import { getArtistImage } from "./imageService.js";

/**
 * Background service to pre-fetch images for artists that are likely to be viewed
 * This runs in the background and doesn't block user requests
 */
class ImagePrefetchService {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.batchSize = 5;
    this.delayBetweenBatches = 100; // ms
  }

  /**
   * Add MBIDs to the pre-fetch queue
   * @param {string[]} mbids - Array of MusicBrainz IDs to pre-fetch
   */
  enqueue(mbids) {
    if (!Array.isArray(mbids)) return;
    
    const uniqueMbids = [...new Set(mbids)];
    const uncached = uniqueMbids.filter(mbid => {
      if (!mbid) return false;
      const cached = db.data.images?.[mbid];
      return !cached || cached === "NOT_FOUND";
    });

    this.queue.push(...uncached);
    this.processQueue();
  }

  /**
   * Process the pre-fetch queue in batches
   */
  async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.batchSize);
      
      // Fetch images in parallel for this batch
      await Promise.allSettled(
        batch.map(mbid => 
          getArtistImage(mbid).catch(err => {
            // Silently fail - this is background work
            return null;
          })
        )
      );

      // Small delay between batches to avoid overwhelming APIs
      if (this.queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, this.delayBetweenBatches));
      }
    }

    this.processing = false;
  }

  /**
   * Pre-fetch images for discovery recommendations
   */
  async prefetchDiscoveryImages(discoveryData) {
    const mbids = [];
    
    if (discoveryData?.recommendations) {
      mbids.push(...discoveryData.recommendations.map(a => a.id).filter(Boolean));
    }
    
    if (discoveryData?.globalTop) {
      mbids.push(...discoveryData.globalTop.map(a => a.id).filter(Boolean));
    }

    this.enqueue(mbids);
  }

  /**
   * Pre-fetch images for search results
   */
  async prefetchSearchResults(artists) {
    const mbids = artists.map(a => a.id || a.mbid).filter(Boolean);
    this.enqueue(mbids);
  }
}

export const imagePrefetchService = new ImagePrefetchService();
