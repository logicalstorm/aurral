import { getDiscoveryCache } from "./discoveryService.js";

const LIBRARY_OWNERSHIP_CACHE_TTL_MS = 10 * 60 * 1000;

export class WeeklyFlowPlaylistSource {
  constructor() {
    this.libraryOwnershipCache = new Map();
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
    const ownedTitles = await this.getLibraryTrackTitles(libraryManager, artistId);
    const ownedAlbums = await this.getLibraryAlbumNames(libraryManager, artistId);
    const value = { ownedTitles, ownedAlbums };
    this.libraryOwnershipCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + LIBRARY_OWNERSHIP_CACHE_TTL_MS,
    });
    return value;
  }

  async getLibraryTrackTitles(libraryManager, artistId, knownAlbums = null) {
    const albums =
      knownAlbums || (await libraryManager.getArtistAlbums(artistId)) || [];
    const titles = new Set();
    for (const album of albums) {
      const tracks = await libraryManager.getAlbumTracks(album.id);
      for (const track of tracks || []) {
        const title = String(track?.title || track?.trackName || "").trim();
        if (title) titles.add(title.toLowerCase());
      }
    }
    return titles;
  }

  async getLibraryAlbumNames(libraryManager, artistId, knownAlbums = null) {
    const albums =
      knownAlbums || (await libraryManager.getArtistAlbums(artistId)) || [];
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
    const entries = [];
    for (const artist of artists) {
      const artistName = String(artist?.artistName || artist?.name || "").trim();
      if (!artistName) continue;
      const { ownedTitles, ownedAlbums } = await this._getLibraryOwnership(
        libraryManager,
        artist.id,
      );
      entries.push({
        artistName,
        artistMbid: artist?.mbid || artist?.foreignArtistId || null,
        ownedTitles: [...ownedTitles],
        ownedAlbums: [...ownedAlbums],
      });
    }
    return entries;
  }
}

export const playlistSource = new WeeklyFlowPlaylistSource();
