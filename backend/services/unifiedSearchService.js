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

const unifiedSearchCache = new NodeCache({
  stdTTL: 60,
  checkperiod: 30,
  maxKeys: 500,
});

const SUGGEST_LIMIT = 5;
const FULL_LIMIT = 20;
const EXACT_MATCH_BOOST = 15;

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
      return remoteCatalog;
    }
  }
  return searchBrainzmashArtistCatalog(query, limit);
}

export function searchLocalFromData(
  query,
  { playlists = [] } = {},
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
      if (score <= 15) return null;
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
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  return {
    artists: [],
    tracks: [],
    playlists: playlistResults,
  };
}

function pickTopResult({ library, catalog }) {
  const candidates = [
    ...(library?.playlists || []),
    ...(catalog?.tracks || []),
    ...(catalog?.artists || []),
    ...(catalog?.albums || []),
  ]
    .filter(Boolean)
    .sort((left, right) => (right.score || 0) - (left.score || 0));
  return candidates[0] || null;
}

function searchLocalLibrary(query, limit, user, mode) {
  const playlists =
    user && mode === "full"
      ? flowPlaylistConfig.getSharedPlaylistsForUser(user)
      : [];
  return searchLocalFromData(query, { playlists }, limit);
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

  const cacheKey = `${normalizedMode}:${perBucketLimit}:${trimmed.toLowerCase()}`;
  const cached = unifiedSearchCache.get(cacheKey);
  if (cached) return cached;

  const catalog = await searchCatalog(trimmed, {
    mode: normalizedMode,
    limit: perBucketLimit,
  });
  const library = searchLocalLibrary(trimmed, perBucketLimit, user, normalizedMode);

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
    catalog: {
      artists: catalog.artists,
      albums: catalog.albums,
      tracks: catalog.tracks,
    },
    localSearchConfigured: catalogSearchConfigured,
    filters: ["all", "artists", "albums", "tracks", "library", "playlists"],
  };

  unifiedSearchCache.set(cacheKey, response);
  return response;
}
