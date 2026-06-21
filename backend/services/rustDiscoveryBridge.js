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
  releaseRadarSize = 30,
} = {}) => {
  const keySet =
    existingArtistKeys instanceof Set
      ? [...existingArtistKeys]
      : Array.isArray(existingArtistKeys)
        ? existingArtistKeys
        : [...buildExistingArtistKeySet(existingArtistKeys || [])];

  const { playlistSource } = await import("./weeklyFlowPlaylistSource.js");
  const libraryMixArtists =
    await playlistSource.buildLibraryMixContext(libraryArtists);

  const { getRecentMissingReleases } = await import("./recentReleasesService.js");
  const releaseAlbums = await getRecentMissingReleases(releaseRadarSize, {
    artists: libraryArtists,
    includeFuture: false,
  });

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
    libraryMixArtists,
    releaseRadarReleases: releaseAlbums.map((album) => ({
      artistName: album.artistName,
      albumName: album.albumName,
      albumMbid: album.mbid || album.foreignAlbumId || null,
      artistMbid: album.artistMbid || album.foreignArtistId || null,
      releaseYear: album.releaseDate
        ? String(album.releaseDate).slice(0, 4)
        : null,
    })),
    releaseRadarSize,
  };
};

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
} = {}) {
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
  const playlist = await buildRustPlaylistPlanPayload({
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

export async function buildRustFlowPlanPayload(flow = {}, options = {}) {
  const { libraryManager } = await import("./libraryManager.js");
  const allLibraryArtistsRaw =
    options.libraryArtists || (await libraryManager.getAllArtists());
  const allLibraryArtists = Array.isArray(allLibraryArtistsRaw)
    ? allLibraryArtistsRaw
    : [];
  const existingArtistKeys = buildExistingArtistKeySet(allLibraryArtists);
  const { playlistSource } = await import("./weeklyFlowPlaylistSource.js");
  const discoveryCache = playlistSource._resolveDiscoveryCache(options);
  const libraryMixArtists =
    await playlistSource.buildLibraryMixContext(allLibraryArtists);
  const requestedSize = Number(flow?.size || 0);
  const targetSize =
    Number.isFinite(requestedSize) && requestedSize > 0
      ? Math.round(requestedSize)
      : 30;
  let releaseRadarReleases = [];
  if (flow?.discoverPresetId === "release-radar") {
    const { getRecentMissingReleases } = await import("./recentReleasesService.js");
    releaseRadarReleases = await getRecentMissingReleases(targetSize, {
      artists: allLibraryArtists,
      includeFuture: false,
    });
  }

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
      albumMbid: album.mbid || album.foreignAlbumId || null,
      artistMbid: album.artistMbid || album.foreignArtistId || null,
      releaseYear: album.releaseDate
        ? String(album.releaseDate).slice(0, 4)
        : null,
    })),
    releaseRadarSize: targetSize,
  };
}
