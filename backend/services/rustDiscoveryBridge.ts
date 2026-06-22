import { buildExistingArtistKeySet } from './discoveryRecommendations.js';

const mapTasteArtist = (artist: unknown) => {
  const a = (artist || {}) as Record<string, unknown>;
  return {
    mbid: a.mbid || a.id || a.foreignArtistId || null,
    artistName: String((a.artistName || a.name || '') as string).trim(),
    source: a.source || null,
    playcount:
      a.playcount != null && Number.isFinite(Number(a.playcount))
        ? Number(a.playcount)
        : null,
    affinityWeight:
      a.affinityWeight != null && Number.isFinite(Number(a.affinityWeight))
        ? Number(a.affinityWeight)
        : null,
    profileBucket: a.profileBucket || null,
  };
};

export function buildRustDiscoveryRefreshPayload({
  recentLibraryArtists = [],
  allLibraryArtists = [],
  historyArtists = [],
  existingArtistKeys = [],
  seedLimit = null,
  includeGlobalTop = false,
}: {
  recentLibraryArtists?: unknown[];
  allLibraryArtists?: unknown[];
  historyArtists?: unknown[];
  existingArtistKeys?: string[] | Set<string>;
  seedLimit?: number | null;
  includeGlobalTop?: boolean;
} = {}) {
  const keySet =
    existingArtistKeys instanceof Set
      ? [...existingArtistKeys]
      : Array.isArray(existingArtistKeys)
        ? existingArtistKeys
        : [...buildExistingArtistKeySet(existingArtistKeys || [])];

  return {
    recentLibraryArtists: (recentLibraryArtists as unknown[]).map(mapTasteArtist),
    allLibraryArtists: (allLibraryArtists as unknown[]).map(mapTasteArtist),
    historyArtists: (historyArtists as unknown[]).map(mapTasteArtist),
    existingArtistKeys: keySet,
    seedLimit: seedLimit != null && Number.isFinite(Number(seedLimit)) ? Number(seedLimit) : null,
    includeGlobalTop: includeGlobalTop === true,
  };
}

const buildRustDiscoveryEnrichPayload = ({
  payload = {},
  seeds = [],
  existingArtistKeys = [],
  existingRecommendations = [],
  feedback = [],
  limits = {},
}: {
  payload?: Record<string, unknown>;
  seeds?: unknown[];
  existingArtistKeys?: string[] | Set<string>;
  existingRecommendations?: unknown[];
  feedback?: unknown[];
  limits?: Record<string, number>;
} = {}) => {
  const keySet =
    existingArtistKeys instanceof Set
      ? [...existingArtistKeys]
      : Array.isArray(existingArtistKeys)
        ? existingArtistKeys
        : [...buildExistingArtistKeySet(existingArtistKeys || [])];

  return {
    seeds: (seeds as unknown[]).map((raw: unknown) => {
      const seed = (raw || {}) as Record<string, unknown>;
      return {
        mbid: seed.mbid || seed.id || null,
        artistName: seed.artistName || seed.name || '',
        source: seed.source || 'library',
        weight: seed.weight ?? null,
        affinityWeight: seed.affinityWeight ?? null,
        profileBucket: seed.profileBucket || null,
        discoveryDepth: seed.discoveryDepth ?? null,
        similarityMultiplier: seed.similarityMultiplier ?? null,
        tagAffinityMultiplier: seed.tagAffinityMultiplier ?? null,
      };
    }),
    existingArtistKeys: keySet,
    discoveryMode: payload?.discoveryMode || 'balanced',
    existingRecommendations,
    feedback: (Array.isArray(feedback) ? feedback : []).map((raw: unknown) => {
      const entry = (raw || {}) as Record<string, unknown>;
      return {
        artistName: entry?.artistName || entry?.name || null,
        artistMbid: entry?.artistMbid || entry?.mbid || null,
        action: entry?.action || entry?.feedbackAction || null,
        tags: Array.isArray(entry?.tags) ? entry.tags : [],
      };
    }),
    limits: {
      poolCap: Number(limits.poolCap) || 500,
      perRefresh: Number(limits.perRefresh) || 200,
    },
    recommendationRunStartedAt: payload?.recommendationRunStartedAt || new Date().toISOString(),
  };
};

const buildRustPlaylistPlanPayload = async ({
  presets = [],
  existingArtistKeys = [],
  recommendations = [],
  globalTop = [],
  basedOn = [],
  topGenres = [],
  topTags = [],
  libraryArtists = [],
  libraryMixArtists = null,
  releaseRadarReleases = null,
  releaseRadarSize = 30,
}: {
  presets?: unknown[];
  existingArtistKeys?: string[] | Set<string>;
  recommendations?: unknown[];
  globalTop?: unknown[];
  basedOn?: unknown[];
  topGenres?: unknown[];
  topTags?: unknown[];
  libraryArtists?: unknown[];
  libraryMixArtists?: unknown[] | null;
  releaseRadarReleases?: unknown[] | null;
  releaseRadarSize?: number;
} = {}) => {
  const keySet =
    existingArtistKeys instanceof Set
      ? [...existingArtistKeys]
      : Array.isArray(existingArtistKeys)
        ? existingArtistKeys
        : [...buildExistingArtistKeySet(existingArtistKeys || [])];

  const prep = await resolveDiscoveryPrep({
    libraryArtists,
    releaseRadarLimit: releaseRadarSize,
    includeFuture: false,
    libraryMixArtists,
    releaseRadarReleases,
  });
  const resolvedLibraryMix = prep.libraryMixArtists;
  const releaseAlbums: unknown[] = prep.releaseAlbums;

  return {
    presets: (presets as unknown[]).map((raw: unknown) => {
      const preset = (raw || {}) as Record<string, unknown>;
      return {
        id: preset.id,
        name: preset.name,
        description: preset.description || null,
        size: preset.size || 30,
        tags: preset.tags || [],
        relatedArtists: preset.relatedArtists || [],
        mix: preset.mix || null,
        deepDive: preset.deepDive === true,
      };
    }),
    existingArtistKeys: keySet,
    recommendations,
    globalTop,
    basedOn,
    topGenres,
    topTags,
    libraryMixArtists: resolvedLibraryMix,
    releaseRadarReleases: releaseAlbums.map((raw: unknown) => {
      const album = (raw || {}) as Record<string, unknown>;
      return {
        artistName: album.artistName,
        albumName: album.albumName,
        albumMbid: album.albumMbid || album.mbid || album.foreignAlbumId || null,
        artistMbid: album.artistMbid || album.foreignArtistId || null,
        releaseYear:
          album.releaseYear || (album.releaseDate ? String(album.releaseDate).slice(0, 4) : null),
      };
    }),
    releaseRadarSize,
  };
};

export { buildRustPlaylistPlanPayload };

const mapPrepArtist = (artist: unknown) => {
  const a = (artist || {}) as Record<string, unknown>;
  return {
    id:
      a?.id != null
        ? String(a.id)
        : a?.artistId != null
          ? String(a.artistId)
          : null,
    artistName: String((a?.artistName || a?.name || '') as string).trim(),
    artistMbid: a?.mbid || a?.foreignArtistId || null,
  };
};

export async function buildRustDiscoveryPrepPayload({
  libraryArtists = [],
  releaseRadarLimit = 30,
  includeFuture = false,
  includeReleaseRadar = true,
}: {
  libraryArtists?: unknown[];
  releaseRadarLimit?: number;
  includeFuture?: boolean;
  includeReleaseRadar?: boolean;
} = {}) {
  const { lidarrClient } = await import('./lidarrClient.js');
  const configured = lidarrClient.isConfigured();
  const config = configured ? lidarrClient.getConfig() : null;
  const artists = (Array.isArray(libraryArtists) ? libraryArtists : [])
    .map(mapPrepArtist)
    .filter((artist) => artist.artistName);
  return {
    lidarr: configured && config
      ? {
          url: config.url,
          apiKey: config.apiKey,
          insecure: config.insecure === true,
        }
      : null,
    artists,
    releaseRadarLimit:
      releaseRadarLimit != null && Number.isFinite(Number(releaseRadarLimit))
        ? Math.max(1, Math.round(Number(releaseRadarLimit)))
        : 30,
    includeFuture: includeFuture === true,
    includeReleaseRadar: includeReleaseRadar === true,
  };
}

export async function resolveDiscoveryPrep({
  libraryArtists = [],
  releaseRadarLimit = 30,
  includeFuture = false,
  includeReleaseRadar = true,
  libraryMixArtists = null,
  releaseRadarReleases = null,
}: {
  libraryArtists?: unknown[];
  releaseRadarLimit?: number;
  includeFuture?: boolean;
  includeReleaseRadar?: boolean;
  libraryMixArtists?: unknown[] | null;
  releaseRadarReleases?: unknown[] | null;
} = {}) {
  if (libraryMixArtists != null && releaseRadarReleases != null) {
    return {
      libraryMixArtists,
      releaseRadarReleases,
      releaseAlbums: releaseRadarReleases,
      source: 'provided',
    };
  }
  const { isRustWorkerAvailable, runRustDiscoveryPrep } = await import('./rustWorkerRunner.js');
  if (isRustWorkerAvailable()) {
    try {
      const payload = await buildRustDiscoveryPrepPayload({
        libraryArtists,
        releaseRadarLimit,
        includeFuture,
        includeReleaseRadar,
      });
      const response = await runRustDiscoveryPrep(payload) as Record<string, unknown>;
      const result = (response?.result || {}) as Record<string, unknown>;
      const libraryMix = Array.isArray(result.libraryMixArtists) ? result.libraryMixArtists : [];
      const releases = Array.isArray(result.releaseRadarReleases)
        ? result.releaseRadarReleases
        : [];
      return {
        libraryMixArtists: libraryMix,
        releaseRadarReleases: releases,
        releaseAlbums: releases,
        source: 'rust',
        stats: response?.stats || {},
      };
    } catch (error) {
      console.warn(
        `[Discovery] Rust discovery-prep failed, falling back to Node: ${(error as Error)?.message || error}`,
      );
    }
  }
  const { playlistSource } = await import('./weeklyFlowPlaylistSource.js');
  const { getRecentMissingReleases } = await import('./recentReleasesService.js');
  const [resolvedLibraryMix, releaseAlbums] = await Promise.all([
    libraryMixArtists != null
      ? Promise.resolve(libraryMixArtists)
      : playlistSource.buildLibraryMixContext(libraryArtists),
    releaseRadarReleases != null
      ? Promise.resolve(releaseRadarReleases)
      : getRecentMissingReleases(releaseRadarLimit, {
          artists: libraryArtists,
          includeFuture,
        }),
  ]);
  return {
    libraryMixArtists: resolvedLibraryMix,
    releaseRadarReleases: (releaseAlbums as Record<string, unknown>[]).map((raw: unknown) => {
      const album = (raw || {}) as Record<string, unknown>;
      return {
        artistName: album.artistName,
        albumName: album.albumName,
        albumMbid: album.mbid || album.foreignAlbumId || null,
        artistMbid: album.artistMbid || album.foreignArtistId || null,
        releaseYear: album.releaseDate ? String(album.releaseDate).slice(0, 4) : null,
      };
    }),
    releaseAlbums,
    source: 'node',
  };
}

export async function buildRustDiscoveryRunPayload({
  payload = {},
  seeds = [],
  existingArtistKeys = [],
  existingRecommendations = [],
  feedback = [],
  limits = {},
  baseDiscoveryData = {},
  libraryArtists = [],
  historyTopArtists = [],
  imageHydration = {},
  skipPlaylistPlan = false,
}: {
  payload?: Record<string, unknown>;
  seeds?: unknown[];
  existingArtistKeys?: string[] | Set<string>;
  existingRecommendations?: unknown[];
  feedback?: unknown[];
  limits?: Record<string, number>;
  baseDiscoveryData?: Record<string, unknown>;
  libraryArtists?: unknown[];
  historyTopArtists?: unknown[];
  imageHydration?: Record<string, unknown>;
  skipPlaylistPlan?: boolean;
}) {
  const enrich = buildRustDiscoveryEnrichPayload({
    payload,
    seeds,
    existingArtistKeys,
    existingRecommendations,
    feedback,
    limits,
  });

  const { getDiscoverPlaylistPresetsForBuild } = await import('./discoverPlaylistService.js');
  const presets = getDiscoverPlaylistPresetsForBuild({
    topGenres: (baseDiscoveryData.topGenres || []) as never[],
    topTags: (baseDiscoveryData.topTags || []) as never[],
    basedOn: (baseDiscoveryData.basedOn || []) as never[],
    recommendations: ((baseDiscoveryData.recommendations || existingRecommendations) || []) as never[],
    historyTopArtists: historyTopArtists as never[],
  });

  const playlist = skipPlaylistPlan
    ? {
        presets,
        globalTop: (baseDiscoveryData.globalTop || []) as never[],
        basedOn: (baseDiscoveryData.basedOn || []) as never[],
        topGenres: (baseDiscoveryData.topGenres || []) as never[],
        topTags: (baseDiscoveryData.topTags || []) as never[],
        libraryMixArtists: [] as never[],
        releaseRadarReleases: [] as never[],
        releaseRadarSize: 30,
      }
    : await buildRustPlaylistPlanPayload({
        presets,
        existingArtistKeys,
        recommendations: existingRecommendations,
        globalTop: (baseDiscoveryData.globalTop || []) as never[],
        basedOn: (baseDiscoveryData.basedOn || []) as never[],
        topGenres: (baseDiscoveryData.topGenres || []) as never[],
        topTags: (baseDiscoveryData.topTags || []) as never[],
        libraryArtists,
      });

  return {
    ...enrich,
    presets: playlist.presets,
    globalTop: playlist.globalTop,
    basedOn: playlist.basedOn,
    topGenres: playlist.topGenres,
    topTags: playlist.topTags,
    libraryMixArtists: playlist.libraryMixArtists,
    releaseRadarReleases: playlist.releaseRadarReleases,
    releaseRadarSize: playlist.releaseRadarSize,
    skipPlaylistPlan,
    imageHydration: {
      freshLimit: imageHydration.freshLimit != null ? Number(imageHydration.freshLimit) : null,
      poolLimit: imageHydration.poolLimit != null ? Number(imageHydration.poolLimit) : null,
    },
  };
}

export async function buildRustDiscoveryPipelinePayload({
  recentLibraryArtists = [],
  allLibraryArtists = [],
  historyArtists = [],
  existingArtistKeys = [],
  seedLimit = null,
  includeGlobalTop = false,
  payload = {},
  existingRecommendations = [],
  feedback = [],
  limits = {},
  baseDiscoveryData = {},
  libraryArtists = [],
  historyTopArtists = [],
  imageHydration = {},
  skipPlaylistPlan = false,
}: {
  recentLibraryArtists?: unknown[];
  allLibraryArtists?: unknown[];
  historyArtists?: unknown[];
  existingArtistKeys?: string[] | Set<string>;
  seedLimit?: number | null;
  includeGlobalTop?: boolean;
  payload?: Record<string, unknown>;
  existingRecommendations?: unknown[];
  feedback?: unknown[];
  limits?: Record<string, number>;
  baseDiscoveryData?: Record<string, unknown>;
  libraryArtists?: unknown[];
  historyTopArtists?: unknown[];
  imageHydration?: Record<string, unknown>;
  skipPlaylistPlan?: boolean;
} = {}) {
  const refresh = buildRustDiscoveryRefreshPayload({
    recentLibraryArtists,
    allLibraryArtists,
    historyArtists,
    existingArtistKeys,
    seedLimit,
    includeGlobalTop,
  });
  const run = await buildRustDiscoveryRunPayload({
    payload,
    seeds: [],
    existingArtistKeys,
    existingRecommendations,
    feedback,
    limits,
    baseDiscoveryData,
    libraryArtists,
    historyTopArtists,
    imageHydration,
    skipPlaylistPlan,
  });
  return {
    ...refresh,
    discoveryMode: run.discoveryMode,
    existingRecommendations: run.existingRecommendations,
    feedback: run.feedback,
    limits: run.limits,
    recommendationRunStartedAt: run.recommendationRunStartedAt,
    presets: run.presets,
    basedOn: run.basedOn,
    topGenres: run.topGenres,
    topTags: run.topTags,
    libraryMixArtists: run.libraryMixArtists,
    releaseRadarReleases: run.releaseRadarReleases,
    releaseRadarSize: run.releaseRadarSize,
    imageHydration: run.imageHydration,
    skipPlaylistPlan: run.skipPlaylistPlan,
  };
}

export async function buildRustFlowPlanPayload(flow: Record<string, unknown> = {}, options: Record<string, unknown> = {}) {
  const { libraryManager } = await import('./libraryManager.js');
  const { playlistSource } = await import('./weeklyFlowPlaylistSource.js');
  const allLibraryArtistsRaw = options.libraryArtists || (await libraryManager.getAllArtists());
  const allLibraryArtists: unknown[] = Array.isArray(allLibraryArtistsRaw) ? allLibraryArtistsRaw : [];
  const existingArtistKeys = buildExistingArtistKeySet(allLibraryArtists as never[]);
  const discoveryCache = playlistSource._resolveDiscoveryCache(options) as Record<string, unknown>;
  const requestedSize = Number(flow?.size || 0);
  const targetSize =
    Number.isFinite(requestedSize) && requestedSize > 0 ? Math.round(requestedSize) : 30;
  const prep = await resolveDiscoveryPrep({
    libraryArtists: allLibraryArtists,
    releaseRadarLimit: targetSize,
    includeFuture: false,
    includeReleaseRadar: flow?.discoverPresetId === 'release-radar',
  });
  const libraryMixArtists = prep.libraryMixArtists;
  const releaseRadarReleases =
    flow?.discoverPresetId === 'release-radar' ? prep.releaseRadarReleases : [];

  return {
    flow: {
      size: targetSize,
      mix: flow?.mix || { discover: 34, mix: 33, trending: 33, focus: 0 },
      deepDive: flow?.deepDive === true,
      tags: Array.isArray(flow?.tags) ? flow.tags : [],
      relatedArtists: Array.isArray(flow?.relatedArtists) ? flow.relatedArtists : [],
    },
    discoverPresetId: flow?.discoverPresetId || null,
    existingArtistKeys: [...existingArtistKeys],
    recommendations: (discoveryCache?.recommendations as unknown[]) || [],
    globalTop: (discoveryCache?.globalTop as unknown[]) || [],
    libraryMixArtists,
    releaseRadarReleases: (releaseRadarReleases as unknown[]).map((raw: unknown) => {
      const album = (raw || {}) as Record<string, unknown>;
      return {
        artistName: album.artistName,
        albumName: album.albumName,
        albumMbid: album.albumMbid || album.mbid || album.foreignAlbumId || null,
        artistMbid: album.artistMbid || album.foreignArtistId || null,
        releaseYear:
          album.releaseYear || (album.releaseDate ? String(album.releaseDate).slice(0, 4) : null),
      };
    }),
    releaseRadarSize: targetSize,
  };
}
