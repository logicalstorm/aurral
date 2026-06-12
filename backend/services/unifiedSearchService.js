import NodeCache from "node-cache";
import {
  getNormalizedText,
  scoreTextMatch,
} from "./providers/brainzmashRanking.js";
import { getMetadataBaseUrl } from "./providers/brainzmashProvider.js";
import { searchArtists } from "./metadataProvider.js";
import {
  isRemoteSearchConfigured,
  searchRemoteCatalog,
} from "./aurralSearchClient.js";
import { flowPlaylistConfig } from "./weeklyFlowPlaylistConfig.js";
import { libraryManager } from "./libraryManager.js";
import { compareSearchResults, getLocalMatchThreshold } from "./searchRanking.js";
import { enrichCatalogArtists } from "./searchInference.js";

const unifiedSearchCache = new NodeCache({
  stdTTL: 60,
  checkperiod: 30,
  maxKeys: 500,
});

const SUGGEST_LIMIT = 5;
const FULL_LIMIT = 20;
const EXACT_MATCH_BOOST = 15;
const LOCAL_MATCH_THRESHOLD = 16;

function isLocalMatch(score, query) {
  return Number(score) > getLocalMatchThreshold(query);
}

function dedupeCatalogArtists(artists) {
  const bestByName = new Map();
  for (const artist of artists) {
    const key = getNormalizedText(artist.name);
    if (!key) continue;
    const existing = bestByName.get(key);
    if (!existing || compareSearchResults(existing, artist) > 0) {
      bestByName.set(key, artist);
    }
  }
  return Array.from(bestByName.values()).sort(compareSearchResults);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeMode(value) {
  return String(value || "").trim() === "full" ? "full" : "suggest";
}

function bucketLimit(mode, requestedLimit) {
  const fallback = mode === "full" ? FULL_LIMIT : SUGGEST_LIMIT;
  return Math.min(30, parsePositiveInt(requestedLimit, fallback));
}

function isCatalogSearchAvailable() {
  return isRemoteSearchConfigured() || Boolean(getMetadataBaseUrl());
}

function mapBrainzmashArtist(item) {
  return {
    type: "artist",
    source: "brainzmash",
    id: item.id,
    key: item.id,
    name: item.name,
    sortName: item.sortName || item.name,
    inLibrary: false,
    hasMbid: Boolean(item.id),
    score: item.score || 0,
  };
}

async function searchBrainzmashArtistCatalog(query, limit) {
  try {
    const result = await searchArtists(String(query || "").trim(), {
      limit,
      offset: 0,
    });
    return {
      artists: (result.items || []).map(mapBrainzmashArtist),
      albums: [],
      tracks: [],
    };
  } catch (error) {
    console.warn("[UnifiedSearch] BrainzMash artist fallback failed:", error.message);
    return { artists: [], albums: [], tracks: [] };
  }
}

async function searchCatalog(query, { mode, limit }) {
  if (isRemoteSearchConfigured()) {
    const remoteCatalog = await searchRemoteCatalog(query, { mode, limit });
    if (remoteCatalog) {
      const hasResults =
        remoteCatalog.artists.length > 0 ||
        remoteCatalog.albums.length > 0 ||
        remoteCatalog.tracks.length > 0;
      if (hasResults) {
        return remoteCatalog;
      }
    }
  }
  return searchBrainzmashArtistCatalog(query, limit);
}

export function searchLocalFromData(
  query,
  { playlists = [], artists = [], tracks = [] } = {},
  limit = SUGGEST_LIMIT,
) {
  const normalizedQuery = getNormalizedText(query);
  if (!normalizedQuery) {
    return { artists: [], tracks: [], playlists: [] };
  }

  const playlistResults = playlists
    .map((playlist) => {
      const name = String(playlist?.name || "").trim();
      if (!name) return null;
      const trackScores = (Array.isArray(playlist?.tracks) ? playlist.tracks : [])
        .map((track) =>
          scoreTextMatch(
            query,
            `${track?.artistName || ""} ${track?.trackName || ""}`,
          ),
        )
        .filter((score) => score > 0);
      const bestTrackScore = trackScores.length > 0 ? Math.max(...trackScores) : 0;
      const nameScore = scoreTextMatch(query, name);
      const score = Math.max(nameScore, bestTrackScore);
      if (!isLocalMatch(score, query)) return null;
      return {
        type: "playlist",
        source: "library",
        id: playlist.id,
        key: `playlist:${playlist.id}`,
        name,
        trackCount: Number(playlist?.trackCount || playlist?.tracks?.length || 0),
        score,
        inLibrary: true,
      };
    })
    .filter(Boolean)
    .sort(compareSearchResults)
    .slice(0, limit);

  const artistResults = artists
    .map((artist) => {
      const name = String(artist?.artistName || artist?.name || "").trim();
      const mbid = artist?.mbid || artist?.foreignArtistId || null;
      if (!name || !mbid) return null;
      const score = scoreTextMatch(query, name);
      if (!isLocalMatch(score, query)) return null;
      return {
        type: "artist",
        source: "library",
        id: mbid,
        key: `library-artist:${mbid}`,
        name,
        sortName: name,
        inLibrary: true,
        hasMbid: true,
        score,
      };
    })
    .filter(Boolean)
    .sort(compareSearchResults)
    .slice(0, limit);

  const trackResults = tracks
    .map((track) => {
      const title = String(track?.title || "").trim();
      const artistName = String(track?.artist || track?.artistName || "").trim();
      const albumTitle = String(track?.album || track?.albumTitle || "").trim();
      if (!title) return null;
      const score = scoreTextMatch(
        query,
        `${artistName} ${title} ${albumTitle}`,
      );
      if (!isLocalMatch(score, query)) return null;
      return {
        type: "track",
        source: "library",
        id: track.id,
        key: track.id,
        title,
        artistName: artistName || "Unknown Artist",
        albumTitle: albumTitle || null,
        streamPath: track.streamPath || null,
        inLibrary: true,
        score,
      };
    })
    .filter(Boolean)
    .sort(compareSearchResults)
    .slice(0, limit);

  return {
    artists: artistResults,
    tracks: trackResults,
    playlists: playlistResults,
  };
}

function pickTopResult({ library, catalog }) {
  const catalogArtists = dedupeCatalogArtists(catalog?.artists || []);
  const candidates = [
    ...(library?.playlists || []),
    ...(library?.tracks || []),
    ...(library?.artists || []),
    ...catalogArtists,
    ...(catalog?.tracks || []),
    ...(catalog?.albums || []),
  ]
    .filter(Boolean)
    .sort(compareSearchResults);
  return candidates[0] || null;
}

async function searchLocalLibrary(query, limit, user, mode = "suggest") {
  const playlists = user
    ? flowPlaylistConfig.getSharedPlaylistsForUser(user)
    : [];
  const isSuggest = normalizeMode(mode) === "suggest";
  const timeoutMs = isSuggest ? 2500 : 8000;

  const withTimeout = (promise, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);

  try {
    const artistsPromise = withTimeout(
      libraryManager.getAllArtists(),
      "Library artists",
    );
    const tracksPromise = isSuggest
      ? Promise.resolve([])
      : withTimeout(libraryManager.getPlaybackQueue(), "Library tracks");
    const [artists, tracks] = await Promise.all([artistsPromise, tracksPromise]);
    return searchLocalFromData(
      query,
      { playlists, artists, tracks },
      limit,
    );
  } catch (error) {
    console.warn("[UnifiedSearch] Local library search failed:", error.message);
    return searchLocalFromData(query, { playlists }, limit);
  }
}

export async function searchUnified(
  query,
  { mode = "suggest", limit, user = null } = {},
) {
  const trimmed = String(query || "").trim();
  const normalizedMode = normalizeMode(mode);
  const perBucketLimit = bucketLimit(normalizedMode, limit);
  const catalogSearchConfigured = isCatalogSearchAvailable();

  if (!trimmed) {
    return {
      query: "",
      mode: normalizedMode,
      top: null,
      library: { artists: [], tracks: [], playlists: [] },
      catalog: { artists: [], albums: [], tracks: [] },
      localSearchConfigured: catalogSearchConfigured,
      filters: ["all", "artists", "albums", "tracks", "library", "playlists"],
    };
  }

  const cacheKey = `${normalizedMode}:${perBucketLimit}:${trimmed.toLowerCase()}:${user?.id || "anon"}`;
  const cached = unifiedSearchCache.get(cacheKey);
  if (cached) return cached;

  const [rawCatalog, library] = await Promise.all([
    searchCatalog(trimmed, {
      mode: normalizedMode,
      limit: perBucketLimit,
    }),
    searchLocalLibrary(trimmed, perBucketLimit, user, normalizedMode),
  ]);
  const catalog = {
    artists: dedupeCatalogArtists(
      enrichCatalogArtists(
        {
          artists: rawCatalog.artists || [],
          albums: rawCatalog.albums || [],
          tracks: rawCatalog.tracks || [],
        },
        trimmed,
      ),
    ),
    albums: rawCatalog.albums || [],
    tracks: rawCatalog.tracks || [],
  };

  const response = {
    query: trimmed,
    mode: normalizedMode,
    top: pickTopResult({
      library,
      catalog,
    }),
    library: {
      artists: library.artists,
      tracks: library.tracks,
      playlists: library.playlists,
    },
    catalog,
    localSearchConfigured: catalogSearchConfigured,
    filters: ["all", "artists", "albums", "tracks", "library", "playlists"],
  };

  unifiedSearchCache.set(cacheKey, response);
  return response;
}
