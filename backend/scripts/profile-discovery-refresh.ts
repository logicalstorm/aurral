import "../loadEnv.js";
import { performance } from "node:perf_hooks";

const ms = (start) => `${(performance.now() - start).toFixed(0)}ms`;

const mark = (label, start) => {
  console.log(`[profile] ${label}: ${ms(start)}`);
  return performance.now();
};

const run = async () => {
  const t0 = performance.now();
  let t = t0;

  const { libraryManager } = await import("../services/libraryManager.js");
  t = mark("import libraryManager", t);

  const allLibraryArtistsRaw = await libraryManager.getAllArtists();
  const allLibraryArtists = Array.isArray(allLibraryArtistsRaw)
    ? allLibraryArtistsRaw
    : [];
  const recentLibraryArtists = allLibraryArtists.slice(0, 40);
  t = mark(`load artists (n=${allLibraryArtists.length})`, t);

  const { buildExistingArtistKeySet } = await import(
    "../services/discoveryRecommendations.js"
  );
  const existingArtistKeys = buildExistingArtistKeySet(allLibraryArtists);
  t = mark("existing artist keys", t);

  const { playlistSource } = await import("../services/weeklyFlowPlaylistSource.js");
  const libraryMixPromise =
    playlistSource.buildLibraryMixContext(allLibraryArtists);

  const { getDiscoveryCache } = await import("../services/discoveryService.js");
  const latestCache = getDiscoveryCache(null);

  const { buildRustDiscoveryPipelinePayload } = await import(
    "../services/rustDiscoveryBridge.js"
  );
  const rustPayload = await buildRustDiscoveryPipelinePayload({
    recentLibraryArtists,
    allLibraryArtists,
    historyArtists: [],
    existingArtistKeys,
    includeGlobalTop: true,
    payload: {
      discoveryRunId: "profile-run",
      recommendationRunStartedAt: new Date().toISOString(),
      discoveryMode: "balanced",
    },
    existingRecommendations: latestCache.recommendations || [],
    feedback: [],
    limits: { poolCap: 500, perRefresh: 200 },
    baseDiscoveryData: latestCache,
    libraryArtists: allLibraryArtists,
    historyTopArtists: [],
    imageHydration: { freshLimit: 200, poolLimit: 200 },
    skipPlaylistPlan: true,
  });
  t = mark("build pipeline payload (no mix)", t);

  const { runRustDiscoveryPipeline, runRustWorkerJob, isRustWorkerAvailable } =
    await import("../services/rustWorkerRunner.js");
  const { getRecentMissingReleases } = await import(
    "../services/recentReleasesService.js"
  );
  const { buildRustPlaylistPlanPayload } = await import(
    "../services/rustDiscoveryBridge.js"
  );
  const { getDiscoverPlaylistPresetsForBuild } = await import(
    "../services/discoverPlaylistService.js"
  );

  if (!isRustWorkerAvailable()) {
    console.log("[profile] rust worker unavailable");
    return;
  }

  console.log("[profile] parallel: rust enrichment + library mix + release radar");
  const parallelStart = performance.now();
  const [rustResponse, libraryMixArtists, releaseAlbums] = await Promise.all([
    runRustDiscoveryPipeline(rustPayload),
    libraryMixPromise,
    getRecentMissingReleases(30, {
      artists: allLibraryArtists,
      includeFuture: false,
    }),
  ]);
  const rustResult = rustResponse?.result || {};
  const rustStats = rustResponse?.stats || {};
  console.log(
    `[profile] parallel phase: ${ms(parallelStart)} (lastfm=${rustStats.lastfmCalls || 0}, mix=${libraryMixArtists.length}, releases=${releaseAlbums.length})`,
  );

  const presets = getDiscoverPlaylistPresetsForBuild({
    topGenres: rustResult.topGenres || [],
    topTags: rustResult.topTags || [],
    basedOn: latestCache.basedOn || [],
    recommendations: rustResult.recommendations || [],
    historyTopArtists: [],
  });
  const playlistPayload = await buildRustPlaylistPlanPayload({
    presets,
    existingArtistKeys,
    recommendations: rustResult.recommendations || [],
    globalTop: rustResult.globalTop || [],
    basedOn: latestCache.basedOn || [],
    topGenres: rustResult.topGenres || [],
    topTags: rustResult.topTags || [],
    libraryArtists: allLibraryArtists,
    libraryMixArtists,
    releaseRadarReleases: releaseAlbums,
  });
  t = mark("build playlist payload", parallelStart);

  const playlistStart = performance.now();
  const playlistResponse = await runRustWorkerJob("playlist-plan", playlistPayload, {
    useDaemon: false,
  });
  console.log(
    `[profile] playlist-plan: ${ms(playlistStart)} (playlists=${playlistResponse?.result?.playlists?.length || 0})`,
  );
  mark("total", t0);
};

run().catch((error) => {
  console.error("[profile] failed:", error);
  process.exitCode = 1;
});
