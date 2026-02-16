import { lastfmRequest, getLastfmApiKey } from "./apiClients.js";
import { getDiscoveryCache } from "./discoveryService.js";

export class WeeklyFlowPlaylistSource {
  _buildCounts(size, mix) {
    const weights = [
      { key: "discover", value: Number(mix?.discover ?? 0) },
      { key: "mix", value: Number(mix?.mix ?? 0) },
      { key: "trending", value: Number(mix?.trending ?? 0) },
    ];
    const sum = weights.reduce(
      (acc, w) => acc + (Number.isFinite(w.value) ? w.value : 0),
      0,
    );
    if (sum <= 0 || !Number.isFinite(sum)) {
      return { discover: 0, mix: 0, trending: 0 };
    }
    const scaled = weights.map((w) => ({
      ...w,
      raw: (w.value / sum) * size,
    }));
    const floored = scaled.map((w) => ({
      ...w,
      count: Math.floor(w.raw),
      remainder: w.raw - Math.floor(w.raw),
    }));
    let remaining = size - floored.reduce((acc, w) => acc + w.count, 0);
    const ordered = [...floored].sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < ordered.length && remaining > 0; i++) {
      ordered[i].count += 1;
      remaining -= 1;
    }
    const out = {};
    for (const item of ordered) {
      out[item.key] = item.count;
    }
    return out;
  }

  _sliceRange(trackList, start, end) {
    if (!Array.isArray(trackList) || trackList.length === 0) return [];
    if (start >= trackList.length) return [];
    const safeStart = Math.max(0, start);
    const safeEnd = Math.min(trackList.length - 1, end);
    if (safeEnd < safeStart) return [];
    return trackList.slice(safeStart, safeEnd + 1);
  }

  _pickRandomTrack(trackList) {
    if (!Array.isArray(trackList) || trackList.length === 0) return null;
    const index = Math.floor(Math.random() * trackList.length);
    return trackList[index] || null;
  }

  _pickTrackFromRanges(trackList, ranges) {
    for (const range of ranges) {
      const candidates = this._sliceRange(
        trackList,
        range.start,
        range.end,
      ).filter((track) => String(track?.name || "").trim().length > 0);
      const pick = this._pickRandomTrack(candidates);
      if (pick) return pick;
    }
    return null;
  }

  _pickTrackFromRangesWithOwned(trackList, ownedTitles, ranges) {
    for (const range of ranges) {
      const candidates = this._sliceRange(
        trackList,
        range.start,
        range.end,
      ).filter((track) => {
        const name = String(track?.name || "")
          .trim()
          .toLowerCase();
        return name && !ownedTitles.has(name);
      });
      const pick = this._pickRandomTrack(candidates);
      if (pick) return pick;
    }
    return null;
  }

  _dedupeAndFill(size, sources, counts) {
    const seen = new Set();
    const picked = [];
    const indices = {
      discover: 0,
      mix: 0,
      trending: 0,
    };

    const takeFrom = (type, count) => {
      const list = sources[type] || [];
      let added = 0;
      while (indices[type] < list.length && added < count) {
        const track = list[indices[type]];
        indices[type] += 1;
        const key =
          `${track.artistName}`.toLowerCase() +
          "::" +
          `${track.trackName}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        picked.push(track);
        added += 1;
      }
    };

    takeFrom("discover", counts.discover || 0);
    takeFrom("mix", counts.mix || 0);
    takeFrom("trending", counts.trending || 0);

    const order = ["discover", "mix", "trending"];
    let looped = false;
    while (picked.length < size) {
      let progress = false;
      for (const type of order) {
        const list = sources[type] || [];
        while (indices[type] < list.length) {
          const track = list[indices[type]];
          indices[type] += 1;
          const key =
            `${track.artistName}`.toLowerCase() +
            "::" +
            `${track.trackName}`.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          picked.push(track);
          progress = true;
          break;
        }
        if (picked.length >= size) break;
      }
      if (!progress) {
        if (looped) break;
        looped = true;
      } else {
        looped = false;
      }
    }

    return picked.slice(0, size);
  }

  async getTracksForFlow(flow) {
    const size = Number(flow?.size || 0);
    const limit = Number.isFinite(size) && size > 0 ? size : 30;
    const counts = this._buildCounts(limit, flow?.mix);
    const perTypeLimit = Math.max(limit, 50);

    const [discoverTracks, mixTracks, trendingTracks] = await Promise.all([
      this.getRecommendedTracks(perTypeLimit, {
        deepDive: flow?.deepDive === true,
      }).catch(() => []),
      this.getMixTracks(perTypeLimit, {
        deepDive: flow?.deepDive === true,
      }).catch(() => []),
      this.getDiscoverTracks(perTypeLimit).catch(() => []),
    ]);

    return this._dedupeAndFill(
      limit,
      {
        discover: discoverTracks,
        mix: mixTracks,
        trending: trendingTracks,
      },
      counts,
    );
  }

  async getTracksForPlaylist(playlistType, limit = 30) {
    switch (playlistType) {
      case "discover":
        return await this.getRecommendedTracks(limit);
      case "mix":
        return await this.getMixTracks(limit);
      case "trending":
        return await this.getDiscoverTracks(limit);
      default:
        throw new Error(`Unknown playlist type: ${playlistType}`);
    }
  }

  async getDiscoverTracks(limit) {
    if (!getLastfmApiKey()) {
      throw new Error("Last.fm API key not configured");
    }

    try {
      const trackData = await lastfmRequest("chart.getTopTracks", {
        limit: 100,
      });

      if (!trackData?.tracks?.track) {
        return [];
      }

      const tracks = Array.isArray(trackData.tracks.track)
        ? trackData.tracks.track
        : [trackData.tracks.track];

      const result = [];
      const seenArtists = new Set();
      for (const track of tracks) {
        if (result.length >= limit) break;

        const artistName = (
          track.artist?.name ||
          track.artist?.["#text"] ||
          ""
        ).trim();
        const trackName = track?.name?.trim();
        if (!artistName || !trackName) continue;

        const key = artistName.toLowerCase();
        if (seenArtists.has(key)) continue;
        seenArtists.add(key);

        result.push({ artistName, trackName });
      }

      return result;
    } catch (error) {
      console.error(
        "[WeeklyFlowPlaylistSource] Error fetching discover tracks:",
        error.message,
      );
      throw error;
    }
  }

  async getRecommendedTracks(limit, options = {}) {
    const discoveryCache = getDiscoveryCache();
    const recommendations = discoveryCache.recommendations || [];
    const globalTop = discoveryCache.globalTop || [];

    if (recommendations.length === 0 && globalTop.length === 0) {
      throw new Error(
        "No discovery recommendations available. Update discovery cache first.",
      );
    }

    const artists = [...recommendations, ...globalTop].slice(0, limit);

    if (!getLastfmApiKey()) {
      throw new Error("Last.fm API key required for recommended tracks");
    }

    const tracks = [];
    const deepDive = options?.deepDive === true;
    const ranges = deepDive
      ? [
          { start: 9, end: 24 },
          { start: 0, end: 9 },
          { start: 0, end: Number.MAX_SAFE_INTEGER },
        ]
      : [
          { start: 0, end: 9 },
          { start: 0, end: Number.MAX_SAFE_INTEGER },
        ];
    for (const artist of artists) {
      if (tracks.length >= limit) break;

      const artistName = (artist.name || artist.artistName || "").trim();
      if (!artistName) continue;

      try {
        const topTracks = await lastfmRequest("artist.getTopTracks", {
          artist: artistName,
          limit: 25,
        });

        if (topTracks?.toptracks?.track) {
          const trackList = Array.isArray(topTracks.toptracks.track)
            ? topTracks.toptracks.track
            : [topTracks.toptracks.track];
          const pick = this._pickTrackFromRanges(trackList, ranges);
          const trackName = pick?.name?.trim();
          if (trackName) tracks.push({ artistName, trackName });
        }
      } catch (error) {
        console.warn(
          `[WeeklyFlowPlaylistSource] Failed to get tracks for ${artistName}:`,
          error.message,
        );
      }
    }

    return tracks;
  }

  async getLibraryTrackTitles(libraryManager, artistId) {
    const albums = await libraryManager.getAlbums(artistId);
    const titles = new Set();
    const maxAlbums = 30;
    for (const album of albums.slice(0, maxAlbums)) {
      const tracks = await libraryManager.getTracks(album.id);
      for (const t of tracks) {
        const name = (t.trackName || t.title || "").trim().toLowerCase();
        if (name) titles.add(name);
      }
    }
    return titles;
  }

  async getMixTracks(limit, options = {}) {
    const { libraryManager } = await import("./libraryManager.js");
    const artists = await libraryManager.getAllArtists();
    if (artists.length === 0) {
      throw new Error("No artists in library. Add artists to enable Mix.");
    }

    if (!getLastfmApiKey()) {
      throw new Error("Last.fm API key required for Mix");
    }

    const shuffled = [...artists].sort(() => 0.5 - Math.random());
    const tracks = [];
    const deepDive = options?.deepDive === true;
    const ranges = deepDive
      ? [
          { start: 9, end: 24 },
          { start: 0, end: 9 },
          { start: 0, end: Number.MAX_SAFE_INTEGER },
        ]
      : [
          { start: 0, end: 9 },
          { start: 0, end: Number.MAX_SAFE_INTEGER },
        ];
    const maxArtistsToTry = Math.min(45, Math.max(limit * 2, 30));

    for (
      let i = 0;
      i < shuffled.length && tracks.length < limit && i < maxArtistsToTry;
      i++
    ) {
      const artist = shuffled[i];
      const artistName = (artist.artistName || artist.name || "").trim();
      if (!artistName) continue;

      try {
        const ownedTitles = await this.getLibraryTrackTitles(
          libraryManager,
          artist.id,
        );
        const topTracks = await lastfmRequest("artist.getTopTracks", {
          artist: artistName,
          limit: 25,
        });

        if (!topTracks?.toptracks?.track) continue;

        const trackList = Array.isArray(topTracks.toptracks.track)
          ? topTracks.toptracks.track
          : [topTracks.toptracks.track];

        const pick = this._pickTrackFromRangesWithOwned(
          trackList,
          ownedTitles,
          ranges,
        );
        const trackName = pick?.name?.trim();
        if (trackName) tracks.push({ artistName, trackName });
      } catch (error) {
        console.warn(
          `[WeeklyFlowPlaylistSource] Failed to get Mix tracks for ${artistName}:`,
          error.message,
        );
      }
    }

    return tracks;
  }
}

export const playlistSource = new WeeklyFlowPlaylistSource();
