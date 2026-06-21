import { getDiscoveryCache } from "./discoveryService.js";

const LIBRARY_OWNERSHIP_CACHE_TTL_MS = 10 * 60 * 1000;
const LIBRARY_MIX_ARTIST_CONCURRENCY = 12;
const LIBRARY_ALBUM_TRACK_CONCURRENCY = 8;

async function mapConcurrent(items, concurrency, worker) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export class WeeklyFlowPlaylistSource {
  constructor() {
    this.libraryOwnershipCache = new Map();
    this.libraryMixContextCache = new Map();
  }

  _resolveDiscoveryCache(options = {}) {
    if (options?.discoveryCache && typeof options.discoveryCache === "object") {
      return options.discoveryCache;
    }
    return getDiscoveryCache(options?.listenHistoryProfile);
  }

  async buildFlowRunPlan(flow, options = {}) {
    const { isRustWorkerAvailable, runRustFlowPlan } = await import(
      "./rustWorkerRunner.js"
    );
    if (!isRustWorkerAvailable()) {
      throw new Error(
        "aurral-worker is required for flow planning; build with: cd backend/native/aurral-worker && cargo build --release",
      );
    }
    const { buildRustFlowPlanPayload } = await import("./rustDiscoveryBridge.js");
    const rustPayload = await buildRustFlowPlanPayload(flow, options);
    const rustResponse = await runRustFlowPlan(rustPayload);
    const result = rustResponse?.result || {};
    if (!Array.isArray(result.primaryTracks)) {
      throw new Error("aurral-worker flow-plan returned an invalid payload");
    }
    if (
      result.primaryTracks.length === 0 &&
      flow?.discoverPresetId !== "release-radar"
    ) {
      throw new Error("aurral-worker flow-plan returned no tracks");
    }
    return {
      primaryTracks: result.primaryTracks,
      reserveTracks: Array.isArray(result.reserveTracks)
        ? result.reserveTracks
        : [],
      diagnostics: result.diagnostics || {
        targets: {},
        achieved: {
          primary: result.primaryTracks.length,
          reserve: 0,
        },
      },
    };
  }

  async _getLibraryOwnership(libraryManager, artistId) {
    const cacheKey = String(artistId || "").trim();
    const cached = this.libraryOwnershipCache.get(cacheKey);
    if (cached?.expiresAt > Date.now()) {
      return cached.value;
    }
    const albums = (await libraryManager.getAlbums(artistId)) || [];
    const [ownedTitles, ownedAlbums] = await Promise.all([
      this.getLibraryTrackTitles(libraryManager, artistId, albums),
      Promise.resolve(this.getLibraryAlbumNames(artistId, albums)),
    ]);
    const value = { ownedTitles, ownedAlbums };
    this.libraryOwnershipCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + LIBRARY_OWNERSHIP_CACHE_TTL_MS,
    });
    return value;
  }

  async getLibraryTrackTitles(libraryManager, artistId, knownAlbums = null) {
    const albums =
      knownAlbums || (await libraryManager.getAlbums(artistId)) || [];
    const titles = new Set();
    const trackLists = await mapConcurrent(
      albums,
      LIBRARY_ALBUM_TRACK_CONCURRENCY,
      (album) => libraryManager.getTracks(album.id),
    );
    for (const tracks of trackLists) {
      for (const track of tracks || []) {
        const title = String(track?.title || track?.trackName || "").trim();
        if (title) titles.add(title.toLowerCase());
      }
    }
    return titles;
  }

  getLibraryAlbumNames(artistId, knownAlbums = null) {
    const albums = knownAlbums || [];
    const names = new Set();
    for (const album of albums) {
      const title = String(album?.title || album?.albumName || "").trim();
      if (title) names.add(title.toLowerCase());
    }
    return names;
  }

  async buildLibraryMixContext(libraryArtists = null) {
    const { libraryManager } = await import("./libraryManager.js");
    const artists = Array.isArray(libraryArtists)
      ? libraryArtists
      : await libraryManager.getAllArtists();
    const cacheKey = artists
      .map((artist) =>
        String(
          artist?.id ||
            artist?.mbid ||
            artist?.foreignArtistId ||
            artist?.artistName ||
            artist?.name ||
            "",
        ).trim(),
      )
      .filter(Boolean)
      .sort()
      .join("|");
    const cached = this.libraryMixContextCache.get(cacheKey);
    if (cached?.expiresAt > Date.now()) {
      return cached.value;
    }
    const entries = await mapConcurrent(
      artists,
      LIBRARY_MIX_ARTIST_CONCURRENCY,
      async (artist) => {
        const artistName = String(artist?.artistName || artist?.name || "").trim();
        if (!artistName) return null;
        const { ownedTitles, ownedAlbums } = await this._getLibraryOwnership(
          libraryManager,
          artist.id,
        );
        return {
          artistName,
          artistMbid: artist?.mbid || artist?.foreignArtistId || null,
          ownedTitles: [...ownedTitles],
          ownedAlbums: [...ownedAlbums],
        };
      },
    );
    const value = entries.filter(Boolean);
    this.libraryMixContextCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + LIBRARY_OWNERSHIP_CACHE_TTL_MS,
    });
    return value;
  }
}

export const playlistSource = new WeeklyFlowPlaylistSource();
