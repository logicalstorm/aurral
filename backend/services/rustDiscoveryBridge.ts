import { buildExistingArtistKeySet } from "./discoveryRecommendations.js";

const mapTasteArtist = (artist = {}) => ({
  mbid: artist.mbid || artist.id || artist.foreignArtistId || null,
  artistName: String(artist.artistName || artist.name || "").trim(),
  source: artist.source || null,
  playcount:
    artist.playcount != null && Number.isFinite(Number(artist.playcount))
      ? Number(artist.playcount)
      : null,
  affinityWeight:
    artist.affinityWeight != null && Number.isFinite(Number(artist.affinityWeight))
      ? Number(artist.affinityWeight)
      : null,
  profileBucket: artist.profileBucket || null,
});

export function buildRustDiscoveryRefreshPayload({
  recentLibraryArtists = [],
  allLibraryArtists = [],
  historyArtists = [],
  existingArtistKeys = [],
  seedLimit = null,
  includeGlobalTop = false,
} = {}) {
  const keySet =
    existingArtistKeys instanceof Set
      ? [...existingArtistKeys]
      : Array.isArray(existingArtistKeys)
        ? existingArtistKeys
        : [...buildExistingArtistKeySet(existingArtistKeys || [])];

  return {
    recentLibraryArtists: recentLibraryArtists.map(mapTasteArtist),
    allLibraryArtists: allLibraryArtists.map(mapTasteArtist),
    historyArtists: historyArtists.map(mapTasteArtist),
    existingArtistKeys: keySet,
    seedLimit:
      seedLimit != null && Number.isFinite(Number(seedLimit))
        ? Number(seedLimit)
        : null,
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
} = {}) => {
  const keySet =
    existingArtistKeys instanceof Set
      ? [...existingArtistKeys]
      : Array.isArray(existingArtistKeys)
        ? existingArtistKeys
        : [...buildExistingArtistKeySet(existingArtistKeys || [])];

  return {
    seeds: seeds.map((seed) => ({
      mbid: seed.mbid || seed.id || null,
      artistName: seed.artistName || seed.name || "",
      source: seed.source || "library",
      weight: seed.weight ?? null,
      affinityWeight: seed.affinityWeight ?? null,
      profileBucket: seed.profileBucket || null,
      discoveryDepth: seed.discoveryDepth ?? null,
      similarityMultiplier: seed.similarityMultiplier ?? null,
      tagAffinityMultiplier: seed.tagAffinityMultiplier ?? null,
    })),
    existingArtistKeys: keySet,
    discoveryMode: payload?.discoveryMode || "balanced",
    existingRecommendations,
    feedback: (Array.isArray(feedback) ? feedback : []).map((entry) => ({
      artistName: entry?.artistName || entry?.name || null,
      artistMbid: entry?.artistMbid || entry?.mbid || null,
      action: entry?.action || entry?.feedbackAction || null,
      tags: Array.isArray(entry?.tags) ? entry.tags : [],
    })),
    limits: {
      poolCap: Number(limits.poolCap) || 500,
      perRefresh: Number(limits.perRefresh) || 200,
    },
    recommendationRunStartedAt:
      payload?.recommendationRunStartedAt || new Date().toISOString(),
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
  const releaseAlbums = prep.releaseAlbums;

  return {
    presets: presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      description: preset.description || null,
      size: preset.size || 30,
      tags: preset.tags || [],
      relatedArtists: preset.relatedArtists || [],
      mix: preset.mix || null,
      deepDive: preset.deepDive === true,
    })),
    existingArtistKeys: keySet,
    recommendations,
    globalTop,
    basedOn,
    topGenres,
    topTags,
    libraryMixArtists: resolvedLibraryMix,
    releaseRadarReleases: releaseAlbums.map((album) => ({
      artistName: album.artistName,
      albumName: album.albumName,
      albumMbid: album.albumMbid || album.mbid || album.foreignAlbumId || null,
      artistMbid: album.artistMbid || album.foreignArtistId || null,
      releaseYear:
        album.releaseYear ||
        (album.releaseDate ? String(album.releaseDate).slice(0, 4) : null),
    })),
    releaseRadarSize,
  };
};

export { buildRustPlaylistPlanPayload };

const mapPrepArtist = (artist = {}) => ({
  id:
    artist?.id != null
      ? String(artist.id)
      : artist?.artistId != null
        ? String(artist.artistId)
        : null,
  artistName: String(artist?.artistName || artist?.name || "").trim(),
  artistMbid: artist?.mbid || artist?.foreignArtistId || null,
});

export async function buildRustDiscoveryPrepPayload({
  libraryArtists = [],
  releaseRadarLimit = 30,
  includeFuture = false,
  includeReleaseRadar = true,
} = {}) {
  const { lidarrClient } = await import("./lidarrClient.js");
  const configured = lidarrClient.isConfigured();
  const config = configured ? lidarrClient.getConfig() : null;
  const artists = (Array.isArray(libraryArtists) ? libraryArtists : [])
    .map(mapPrepArtist)
    .filter((artist) => artist.artistName);
  return {
    lidarr: configured
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
} = {}) {
  if (libraryMixArtists != null && releaseRadarReleases != null) {
    return {
      libraryMixArtists,
      releaseRadarReleases,
      releaseAlbums: releaseRadarReleases,
      source: "provided",
    };
  }
  const { isRustWorkerAvailable, runRustDiscoveryPrep } = await import(
    "./rustWorkerRunner.js"
  );
  if (isRustWorkerAvailable()) {
    try {
      const payload = await buildRustDiscoveryPrepPayload({
        libraryArtists,
        releaseRadarLimit,
        includeFuture,
        includeReleaseRadar,
      });
      const response = await runRustDiscoveryPrep(payload);
      const result = response?.result || {};
      const libraryMix = Array.isArray(result.libraryMixArtists)
        ? result.libraryMixArtists
        : [];
      const releases = Array.isArray(result.releaseRadarReleases)
        ? result.releaseRadarReleases
        : [];
      return {
        libraryMixArtists: libraryMix,
        releaseRadarReleases: releases,
        releaseAlbums: releases,
        source: "rust",
        stats: response?.stats || {},
      };
    } catch (error) {
      console.warn(
        `[Discovery] Rust discovery-prep failed, falling back to Node: ${error?.message || error}`,
      );
    }
  }
  const { playlistSource } = await import("./weeklyFlowPlaylistSource.js");
  const { getRecentMissingReleases } = await import("./recentReleasesService.js");
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
    releaseRadarReleases: releaseAlbums.map((album) => ({
      artistName: album.artistName,
      albumName: album.albumName,
      albumMbid: album.mbid || album.foreignAlbumId || null,
      artistMbid: album.artistMbid || album.foreignArtistId || null,
      releaseYear: album.releaseDate
        ? String(album.releaseDate).slice(0, 4)
        : null,
    })),
    releaseAlbums,
    source: "node",
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
}) {
  const enrich = buildRustDiscoveryEnrichPayload({
    payload,
    seeds,
    existingArtistKeys,
    existingRecommendations,
    feedback,
    limits,
  });

  const { getDiscoverPlaylistPresetsForBuild } = await import(
    "./discoverPlaylistService.js"
  );
  const presets = getDiscoverPlaylistPresetsForBuild({
    topGenres: baseDiscoveryData.topGenres || [],
    topTags: baseDiscoveryData.topTags || [],
    basedOn: baseDiscoveryData.basedOn || [],
    recommendations:
      baseDiscoveryData.recommendations || existingRecommendations || [],
    historyTopArtists,
  });

  const playlist = skipPlaylistPlan
    ? {
        presets,
        globalTop: baseDiscoveryData.globalTop || [],
        basedOn: baseDiscoveryData.basedOn || [],
        topGenres: baseDiscoveryData.topGenres || [],
        topTags: baseDiscoveryData.topTags || [],
        libraryMixArtists: [],
        releaseRadarReleases: [],
        releaseRadarSize: 30,
      }
    : await buildRustPlaylistPlanPayload({
        presets,
        existingArtistKeys,
        recommendations: existingRecommendations,
        globalTop: baseDiscoveryData.globalTop || [],
        basedOn: baseDiscoveryData.basedOn || [],
        topGenres: baseDiscoveryData.topGenres || [],
        topTags: baseDiscoveryData.topTags || [],
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
      freshLimit:
        imageHydration.freshLimit != null
          ? Number(imageHydration.freshLimit)
          : null,
      poolLimit:
        imageHydration.poolLimit != null
          ? Number(imageHydration.poolLimit)
          : null,
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

export async function buildRustFlowPlanPayload(flow = {}, options = {}) {
  const { libraryManager } = await import("./libraryManager.js");
  const { playlistSource } = await import("./weeklyFlowPlaylistSource.js");
  const allLibraryArtistsRaw =
    options.libraryArtists || (await libraryManager.getAllArtists());
  const allLibraryArtists = Array.isArray(allLibraryArtistsRaw)
    ? allLibraryArtistsRaw
    : [];
  const existingArtistKeys = buildExistingArtistKeySet(allLibraryArtists);
  const discoveryCache = playlistSource._resolveDiscoveryCache(options);
  const requestedSize = Number(flow?.size || 0);
  const targetSize =
    Number.isFinite(requestedSize) && requestedSize > 0
      ? Math.round(requestedSize)
      : 30;
  const prep = await resolveDiscoveryPrep({
    libraryArtists: allLibraryArtists,
    releaseRadarLimit: targetSize,
    includeFuture: false,
    includeReleaseRadar: flow?.discoverPresetId === "release-radar",
  });
  const libraryMixArtists = prep.libraryMixArtists;
  const releaseRadarReleases =
    flow?.discoverPresetId === "release-radar" ? prep.releaseRadarReleases : [];

  return {
    flow: {
      size: targetSize,
      mix: flow?.mix || { discover: 34, mix: 33, trending: 33, focus: 0 },
      deepDive: flow?.deepDive === true,
      tags: Array.isArray(flow?.tags) ? flow.tags : [],
      relatedArtists: Array.isArray(flow?.relatedArtists)
        ? flow.relatedArtists
        : [],
    },
    discoverPresetId: flow?.discoverPresetId || null,
    existingArtistKeys: [...existingArtistKeys],
    recommendations: discoveryCache?.recommendations || [],
    globalTop: discoveryCache?.globalTop || [],
    libraryMixArtists,
    releaseRadarReleases: releaseRadarReleases.map((album) => ({
      artistName: album.artistName,
      albumName: album.albumName,
      albumMbid: album.albumMbid || album.mbid || album.foreignAlbumId || null,
      artistMbid: album.artistMbid || album.foreignArtistId || null,
      releaseYear:
        album.releaseYear ||
        (album.releaseDate ? String(album.releaseDate).slice(0, 4) : null),
    })),
    releaseRadarSize: targetSize,
  };
}
