import { dbOps } from '../config/db-helpers.js';
import { enqueueImagePrefetchJob } from './honkerDb.js';

const BATCH_SIZE = 10;

function enqueueUncachedMbids(mbids: unknown[]) {
  const unique = [
    ...new Set(
      (Array.isArray(mbids) ? mbids : []).map((mbid) => String(mbid || '').trim()).filter(Boolean),
    ),
  ] as string[];
  if (unique.length === 0) return;

  const cachedImages = dbOps.getImages(unique) as Record<string, Record<string, unknown>>;
  const uncached = unique.filter((mbid) => {
    const cached = cachedImages[mbid] as Record<string, unknown> | undefined;
    return !cached || cached['imageUrl'] === 'NOT_FOUND';
  });
  for (let index = 0; index < uncached.length; index += BATCH_SIZE) {
    enqueueImagePrefetchJob({
      mbids: uncached.slice(index, index + BATCH_SIZE),
      requestedAt: Date.now(),
    });
  }
}

class ImagePrefetchService {
  enqueue(mbids: unknown[]) {
    enqueueUncachedMbids(mbids);
  }

  async prefetchDiscoveryImages(discoveryData: Record<string, unknown> | null, { recommendationLimit = 48 }: { recommendationLimit?: number } = {}) {
    const mbids: string[] = [];
    if (discoveryData?.['recommendations']) {
      mbids.push(
        ...((discoveryData['recommendations'] as Array<Record<string, unknown>>)
          .slice(0, Math.max(0, Number(recommendationLimit) || 0))
          .map((artist: Record<string, unknown>) => artist.id as string)
          .filter(Boolean)),
      );
    }
    if (discoveryData?.['globalTop']) {
      mbids.push(
        ...((discoveryData['globalTop'] as Array<Record<string, unknown>>)
          .slice(0, 18)
          .map((artist: Record<string, unknown>) => artist.id as string)
          .filter(Boolean)),
      );
    }
    this.enqueue(mbids);
  }

  async prefetchSearchResults(artists: unknown[]) {
    const mbids = (artists as Array<Record<string, unknown>>).map((artist: Record<string, unknown>) => (artist.id || artist.mbid) as string).filter(Boolean);
    this.enqueue(mbids);
  }
}

export const imagePrefetchService = new ImagePrefetchService();
