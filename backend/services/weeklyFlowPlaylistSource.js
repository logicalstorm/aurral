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

  _normalizeWeightMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out = {};
    for (const [key, rawValue] of Object.entries(value)) {
      const name = String(key || "").trim();
      if (!name) continue;
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed)) continue;
      const rounded = Math.round(parsed);
      if (rounded <= 0) continue;
      out[name] = rounded;
    }
    return out;
  }

  _sumWeightMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
    return Object.values(value).reduce((acc, entry) => {
      const parsed = Number(entry);
      return acc + (Number.isFinite(parsed) ? parsed : 0);
    }, 0);
  }

  _normalizeRecipeCounts(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const parseField = (entry) => {
      const parsed = Number(entry);
      if (!Number.isFinite(parsed)) return 0;
      return Math.max(Math.round(parsed), 0);
    };
    return {
      discover: parseField(value?.discover ?? 0),
      mix: parseField(value?.mix ?? 0),
      trending: parseField(value?.trending ?? 0),
    };
  }

  _buildWeightedSourceCounts(total, sources) {
    const items = sources.filter(
      (source) => Number.isFinite(source.weight) && source.weight > 0,
    );
    if (total <= 0 || items.length === 0) return [];
    const sum = items.reduce((acc, item) => acc + item.weight, 0);
    if (!Number.isFinite(sum) || sum <= 0) return [];
    const scaled = items.map((item) => ({
      ...item,
      raw: (item.weight / sum) * total,
    }));
    const floored = scaled.map((item) => ({
      ...item,
      count: Math.floor(item.raw),
      remainder: item.raw - Math.floor(item.raw),
    }));
    let remaining = total - floored.reduce((acc, item) => acc + item.count, 0);
    const ordered = [...floored].sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < ordered.length && remaining > 0; i++) {
      ordered[i].count += 1;
      remaining -= 1;
    }
    return ordered;
  }

  _isMbid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    );
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

  _dedupeAndFillSources(size, sources) {
    const seen = new Set();
    const picked = [];
    const indices = new Map();
    for (const source of sources) {
      indices.set(source.key, 0);
    }

    const takeFrom = (source) => {
      const list = source.tracks || [];
      let added = 0;
      let index = indices.get(source.key) || 0;
      while (index < list.length && added < source.count) {
        const track = list[index];
        index += 1;
        const key =
          `${track.artistName}`.toLowerCase() +
          "::" +
          `${track.trackName}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        picked.push(track);
        added += 1;
      }
      indices.set(source.key, index);
    };

    for (const source of sources) {
      takeFrom(source);
    }

    let looped = false;
    while (picked.length < size) {
      let progress = false;
      for (const source of sources) {
        const list = source.tracks || [];
        let index = indices.get(source.key) || 0;
        while (index < list.length) {
          const track = list[index];
          index += 1;
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
        indices.set(source.key, index);
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

  async getCuratedDiscoverTracks(limit, options = {}) {
    const tags = options?.tags || {};
    const relatedArtists = options?.relatedArtists || {};
    const deepDive = options?.deepDive === true;
    const sources = [];

    for (const [tag, weight] of Object.entries(tags)) {
      sources.push({ type: "tag", key: tag, weight: Number(weight) });
    }
    for (const [artist, weight] of Object.entries(relatedArtists)) {
      sources.push({ type: "related", key: artist, weight: Number(weight) });
    }

    if (sources.length === 0) {
      return await this.getRecommendedTracks(limit, { deepDive });
    }

    if (!getLastfmApiKey()) {
      throw new Error("Last.fm API key required for curated discovery");
    }

    const counts = this._buildWeightedSourceCounts(limit, sources);
    const curated = [];
    for (const source of counts) {
      if (!source.count) continue;
      try {
        if (source.type === "tag") {
          const tracks = await this.getTagTracks(source.key, source.count);
          curated.push(...tracks);
        } else {
          const tracks = await this.getRelatedArtistTracks(
            source.key,
            source.count,
            {
              deepDive,
            },
          );
          curated.push(...tracks);
        }
      } catch {
        continue;
      }
    }

    if (curated.length >= limit) {
      return curated.slice(0, limit);
    }

    const fallback = await this.getRecommendedTracks(limit - curated.length, {
      deepDive,
    }).catch(() => []);
    return [...curated, ...fallback];
  }

  async getTracksForFlow(flow) {
    const size = Number(flow?.size || 0);
    const limit = Number.isFinite(size) && size > 0 ? size : 30;
    const tags = this._normalizeWeightMap(flow?.tags);
    const relatedArtists = this._normalizeWeightMap(flow?.relatedArtists);
    const tagsTotal = this._sumWeightMap(tags);
    const relatedTotal = this._sumWeightMap(relatedArtists);
    const recipeCounts = this._normalizeRecipeCounts(flow?.recipe);
    const recipeTotal =
      recipeCounts?.discover != null
        ? this._sumWeightMap(recipeCounts)
        : Math.max(limit - tagsTotal - relatedTotal, 0);
    const totalTarget = recipeTotal + tagsTotal + relatedTotal;
    if (totalTarget <= 0) return [];
    const counts =
      recipeCounts?.discover != null
        ? recipeCounts
        : this._buildCounts(recipeTotal, flow?.mix);
    const perTypeLimit = recipeTotal > 0 ? Math.max(recipeTotal, 50) : 0;

    const [discoverTracks, mixTracks, trendingTracks] =
      perTypeLimit > 0
        ? await Promise.all([
            this.getRecommendedTracks(perTypeLimit, {
              deepDive: flow?.deepDive === true,
            }).catch(() => []),
            this.getMixTracks(perTypeLimit, {
              deepDive: flow?.deepDive === true,
            }).catch(() => []),
            this.getDiscoverTracks(perTypeLimit).catch(() => []),
          ])
        : [[], [], []];

    const tagSources = await Promise.all(
      Object.entries(tags).map(async ([tag, count]) => ({
        key: `tag:${tag}`,
        count,
        tracks: await this.getTagTracks(tag, count).catch(() => []),
      })),
    );
    const relatedSources = await Promise.all(
      Object.entries(relatedArtists).map(async ([artist, count]) => ({
        key: `related:${artist}`,
        count,
        tracks: await this.getRelatedArtistTracks(artist, count, {
          deepDive: flow?.deepDive === true,
        }).catch(() => []),
      })),
    );

    return this._dedupeAndFillSources(totalTarget, [
      { key: "discover", count: counts.discover || 0, tracks: discoverTracks },
      { key: "mix", count: counts.mix || 0, tracks: mixTracks },
      { key: "trending", count: counts.trending || 0, tracks: trendingTracks },
      ...tagSources,
      ...relatedSources,
    ]);
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

  async getTagTracks(tag, limit) {
    if (!getLastfmApiKey()) {
      throw new Error("Last.fm API key not configured");
    }
    if (!tag || limit <= 0) return [];
    const requested = Math.max(limit * 3, 50);
    const trackData = await lastfmRequest("tag.getTopTracks", {
      tag,
      limit: requested,
    });
    const tracks = trackData?.tracks?.track
      ? Array.isArray(trackData.tracks.track)
        ? trackData.tracks.track
        : [trackData.tracks.track]
      : [];
    const result = [];
    const seen = new Set();
    for (const track of tracks) {
      if (result.length >= limit) break;
      const artistName = (
        track.artist?.name ||
        track.artist?.["#text"] ||
        ""
      ).trim();
      const trackName = track?.name?.trim();
      if (!artistName || !trackName) continue;
      const key =
        `${artistName}`.toLowerCase() + "::" + `${trackName}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ artistName, trackName });
    }
    return result;
  }

  async getRelatedArtistTracks(artistKey, limit, options = {}) {
    if (!getLastfmApiKey()) {
      throw new Error("Last.fm API key not configured");
    }
    if (!artistKey || limit <= 0) return [];
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
    const params = this._isMbid(artistKey)
      ? { mbid: artistKey, limit: 25 }
      : { artist: artistKey, limit: 25 };
    const similar = await lastfmRequest("artist.getSimilar", params);
    const list = similar?.similarartists?.artist
      ? Array.isArray(similar.similarartists.artist)
        ? similar.similarartists.artist
        : [similar.similarartists.artist]
      : [];
    const tracks = [];
    const seenArtists = new Set();
    for (const candidate of list) {
      if (tracks.length >= limit) break;
      const artistName = String(candidate?.name || "").trim();
      if (!artistName) continue;
      const key = artistName.toLowerCase();
      if (seenArtists.has(key)) continue;
      seenArtists.add(key);
      try {
        const topTracks = await lastfmRequest("artist.getTopTracks", {
          artist: artistName,
          limit: 25,
        });
        const trackList = topTracks?.toptracks?.track
          ? Array.isArray(topTracks.toptracks.track)
            ? topTracks.toptracks.track
            : [topTracks.toptracks.track]
          : [];
        const pick = this._pickTrackFromRanges(trackList, ranges);
        const trackName = pick?.name?.trim();
        if (trackName) tracks.push({ artistName, trackName });
      } catch {
        continue;
      }
    }
    return tracks;
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
