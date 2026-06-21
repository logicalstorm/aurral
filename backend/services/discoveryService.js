import { dbOps, userOps } from "../config/db-helpers.js";
import {
  BASE_DISCOVER_FLOW_COUNT,
  DISCOVERY_FLOWS_DEFAULT,
  DISCOVERY_FLOWS_MAX,
} from "../config/discoverPlaylistPresets.js";
import {
  lastfmRequest,
  listenbrainzRequest,
  getLastfmApiKey,
  musicbrainzGetCachedArtistMbidByName,
} from "./apiClients.js";
import { buildImageProxyUrl } from "./imageProxyService.js";
import { websocketService } from "./websocketService.js";
import { libraryManager } from "./libraryManager.js";
import {
  getDefaultListenHistoryProfile,
  getListenHistoryCacheNamespace,
  getListenHistoryProfile,
  hasListenHistoryProfile,
} from "./listeningHistory.js";
import {
  DISCOVERY_PROVIDER_LASTFM,
  buildListenbrainzFallbackDiscovery,
  getDiscoveryCapabilities,
} from "./listenbrainzDiscoveryFallback.js";
import {
  buildExistingArtistKeySet,
  filterRecommendationsForServe,
  rerankRecommendations,
  deriveDiscoveryGenresFromPool,
  deriveDiscoveryTagsFromPool,
} from "./discoveryRecommendations.js";
import {
  enqueueDiscoveryRecommendationEnrichmentJob,
  enqueueDiscoveryUserRefreshJob,
  isDiscoveryRefreshQueueLocked,
  isHonkerLockHeld,
  withHonkerLock,
} from "./honkerDb.js";

const LASTFM_PERIODS = [
  "none",
  "7day",
  "1month",
  "3month",
  "6month",
  "12month",
  "overall",
];
const LISTENBRAINZ_RANGE_BY_PERIOD = {
  "7day": "week",
  "1month": "month",
  "3month": "quarter",
  "6month": "half_yearly",
  "12month": "year",
  overall: "all_time",
};
const getLastfmDiscoveryPeriod = () => {
  const settings = dbOps.getSettings();
  const p = settings.integrations?.lastfm?.discoveryPeriod;
  return p && LASTFM_PERIODS.includes(p) ? p : "1month";
};

const getListenbrainzRange = (discoveryPeriod) => {
  if (discoveryPeriod === "none") return null;
  return LISTENBRAINZ_RANGE_BY_PERIOD[discoveryPeriod] || "month";
};

const normalizeTextList = (value) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    const normalized = String(entry || "")
      .trim()
      .toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

export const getDiscoveryAutoRefreshHours = () => {
  const settings = dbOps.getSettings();
  const parsed = parseInt(
    settings.integrations?.lastfm?.discoveryAutoRefreshHours,
    10,
  );
  return [24, 168, 720].includes(parsed) ? parsed : 168;
};

const DISCOVERY_RECOMMENDATIONS_MIN = 50;
const DISCOVERY_RECOMMENDATIONS_MAX = 500;
const DISCOVERY_RECOMMENDATIONS_DEFAULT = 200;
const DISCOVERY_QUALITY_INITIAL = "initial";
const DISCOVERY_QUALITY_ENRICHING = "enriching";
const DISCOVERY_QUALITY_ENRICHED = "enriched";

const getDiscoveryUserRefreshDelaySeconds = () => {
  const parsed = Number(
    process.env.AURRAL_DISCOVERY_USER_REFRESH_DELAY_SECONDS,
  );
  if (!Number.isFinite(parsed)) return 300;
  return Math.max(30, Math.min(3600, Math.floor(parsed)));
};

export const getDiscoveryRecommendationsPerRefresh = () => {
  const settings = dbOps.getSettings();
  const parsed = parseInt(
    settings.integrations?.lastfm?.discoveryRecommendationsPerRefresh,
    10,
  );
  if (!Number.isFinite(parsed)) return DISCOVERY_RECOMMENDATIONS_DEFAULT;
  return Math.min(
    DISCOVERY_RECOMMENDATIONS_MAX,
    Math.max(DISCOVERY_RECOMMENDATIONS_MIN, parsed),
  );
};

export const getDiscoveryRecommendationPoolLimit = () =>
  DISCOVERY_RECOMMENDATIONS_MAX;

const createDiscoveryRunId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const getDiscoveryRecommendationSeedLimit = (count, failureRatio) => {
  const target = getDiscoveryRecommendationsPerRefresh();
  const sampleBase = Math.min(
    count,
    Math.max(32, Math.min(56, Math.ceil(target / 4))),
  );
  if (failureRatio >= 0.8) return Math.min(28, sampleBase);
  return sampleBase;
};

const getDiscoveryRecommendationResolveLimit = (count = null) =>
  Math.min(
    count ?? getDiscoveryRecommendationPoolLimit(),
    Math.max(getDiscoveryRecommendationsPerRefresh(), 120),
  );

const applyProxiedRecommendationImages = (recommendations = []) => {
  const list = Array.isArray(recommendations) ? recommendations : [];
  for (const recommendation of list) {
    if (!recommendation || typeof recommendation !== "object") continue;
    const raw = recommendation.image || recommendation.imageUrl || null;
    if (!raw) continue;
    const proxied = buildImageProxyUrl(raw) || raw;
    recommendation.image = proxied;
    recommendation.imageUrl = proxied;
  }
  return list;
};

let discoveryPlaylistsBuilding = false;
let discoveryPlaylistBuildPromise = null;

const DISCOVERY_REFRESH_PROGRESS = {
  START: 0,
  LOADING: 8,
  SEEDS: 12,
  ENRICHING: 15,
  PREPARING: 18,
  ENRICHING_MAX: 88,
  SCORING_DONE: 92,
  SAVING: 96,
  COMPLETE: 100,
};

const startDiscoveryProgressHeartbeat = (
  onTick,
  {
    startProgress = 30,
    endProgress = 70,
    intervalMs = 2500,
    estimatedMs = 90000,
  } = {},
) => {
  const startedAt = Date.now();
  let lastProgress = startProgress;
  const timer = setInterval(() => {
    const ratio = Math.min(1, (Date.now() - startedAt) / estimatedMs);
    const progress = Math.round(
      startProgress + (endProgress - startProgress) * ratio,
    );
    if (progress <= lastProgress) return;
    lastProgress = progress;
    onTick(progress);
  }, intervalMs);
  return () => clearInterval(timer);
};

const runDiscoveryPlaylistPlanWithRust = async ({
  rustResult = {},
  latestCache = {},
  allLibraryArtists = [],
  existingArtistKeys = [],
  historyTopArtists = [],
  libraryMixArtists = [],
  releaseAlbums = [],
  onProgress = null,
} = {}) => {
  const { runRustWorkerJob } = await import("./rustWorkerRunner.js");
  const { buildRustPlaylistPlanPayload } = await import(
    "./rustDiscoveryBridge.js"
  );
  const { getDiscoverPlaylistPresetsForBuild } = await import(
    "./discoverPlaylistService.js"
  );

  const emitStep = (phase, message, progress) => {
    if (typeof onProgress === "function") {
      onProgress({ phase, progressMessage: message, progress });
    }
  };

  const presets = getDiscoverPlaylistPresetsForBuild({
    topGenres: rustResult.topGenres || latestCache.topGenres || [],
    topTags: rustResult.topTags || latestCache.topTags || [],
    basedOn: latestCache.basedOn || [],
    recommendations: rustResult.recommendations || [],
    historyTopArtists,
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

  emitStep("playlists_building", "Building discover playlists", 82);
  const stopHeartbeat = onProgress
    ? startDiscoveryProgressHeartbeat(
        (progress) => {
          onProgress({
            phase: "playlists_building",
            progressMessage: "Building discover playlists",
            progress,
          });
        },
        { startProgress: 82, endProgress: 96, estimatedMs: 150000 },
      )
    : () => {};

  try {
    const playlistStarted = Date.now();
    const playlistResponse = await runRustWorkerJob(
      "playlist-plan",
      playlistPayload,
      { useDaemon: false },
    );
    console.log(
      `[Discovery] Playlist plan finished in ${Date.now() - playlistStarted}ms`,
    );
    return playlistResponse?.result?.playlists || [];
  } finally {
    stopHeartbeat();
  }
};

const applyDiscoveryPlaylistsResult = (playlists = [], cacheNamespace = null) => {
  const latestCache = getDiscoveryCache(cacheNamespace);
  const discoverPlaylists = Array.isArray(playlists) ? playlists : [];
  dbOps.updateDiscoveryCache({ discoverPlaylists }, cacheNamespace);
  if (!cacheNamespace) {
    Object.assign(discoveryCache, { discoverPlaylists });
    emitDiscoveryDataUpdate(
      { ...getDiscoveryCache(null), discoverPlaylists },
      {
        phase: "playlists_completed",
        progress: 100,
        progressMessage: "Discover playlists updated",
      },
    );
  }
  websocketService.emitDiscoveryUpdate({
    isUpdating: false,
    configured: true,
    playlistsUpdating: false,
    phase: "playlists_completed",
    progress: 100,
    progressMessage: "Discover playlists updated",
    discoverPlaylists,
  });
};

const scheduleDiscoveryPlaylistBuild = (context = {}) => {
  if (discoveryPlaylistBuildPromise) return discoveryPlaylistBuildPromise;

  discoveryPlaylistsBuilding = true;
  websocketService.emitDiscoveryUpdate({
    isUpdating: false,
    configured: true,
    playlistsUpdating: true,
    phase: "playlists_building",
    progressMessage: "Building discover playlists",
  });

  discoveryPlaylistBuildPromise = runDiscoveryPlaylistPlanWithRust(context)
    .then((playlists) => {
      applyDiscoveryPlaylistsResult(playlists, context.cacheNamespace || null);
      return playlists;
    })
    .catch((error) => {
      console.error(
        "[Discovery] Background playlist build failed:",
        error.message,
      );
      websocketService.emitDiscoveryUpdate({
        isUpdating: false,
        configured: true,
        playlistsUpdating: false,
        phase: "playlists_error",
        progressMessage: "Discover playlist build failed",
        error: error.message,
      });
      throw error;
    })
    .finally(() => {
      discoveryPlaylistsBuilding = false;
      discoveryPlaylistBuildPromise = null;
    });

  return discoveryPlaylistBuildPromise;
};

const runDiscoveryPipelineWithRust = async ({
  recentLibraryArtists = [],
  allLibraryArtists = [],
  historyArtists = [],
  existingArtistKeys = [],
  includeGlobalTop = false,
  cacheNamespace = null,
  discoveryRunId,
  recommendationRunStartedAt,
  existingRecommendations = [],
  feedback = [],
  historyTopArtists = [],
  discoveryMode,
  seedLimit = null,
  libraryMixPromise = null,
  onProgress = null,
  buildPlaylists = true,
} = {}) => {
  const emitStep = (phase, message, progress) => {
    if (typeof onProgress === "function") {
      onProgress({ phase, progressMessage: message, progress });
    }
  };
  const { runRustDiscoveryPipeline } = await import("./rustWorkerRunner.js");
  const { buildRustDiscoveryPipelinePayload } = await import(
    "./rustDiscoveryBridge.js"
  );
  const { getRecentMissingReleases } = await import("./recentReleasesService.js");
  const latestCache = getDiscoveryCache(cacheNamespace);
  emitStep("preparing_pipeline", "Preparing recommendation pipeline", DISCOVERY_REFRESH_PROGRESS.PREPARING);
  const payloadStarted = Date.now();
  console.log("[Discovery] Building pipeline payload...");

  const mixPromise =
    libraryMixPromise ||
    import("./weeklyFlowPlaylistSource.js").then(({ playlistSource }) =>
      playlistSource.buildLibraryMixContext(allLibraryArtists),
    );
  const releaseRadarPromise = getRecentMissingReleases(30, {
    artists: allLibraryArtists,
    includeFuture: false,
  });

  const rustPayload = await buildRustDiscoveryPipelinePayload({
    recentLibraryArtists,
    allLibraryArtists,
    historyArtists,
    existingArtistKeys,
    seedLimit,
    includeGlobalTop,
    payload: {
      discoveryRunId,
      recommendationRunStartedAt,
      discoveryMode: discoveryMode || getDiscoveryMode(),
    },
    existingRecommendations,
    feedback,
    limits: {
      poolCap: getDiscoveryRecommendationPoolLimit(),
      perRefresh: getDiscoveryRecommendationsPerRefresh(),
    },
    baseDiscoveryData: latestCache,
    libraryArtists: allLibraryArtists,
    historyTopArtists,
    imageHydration: {
      freshLimit: getDiscoveryRecommendationsPerRefresh(),
      poolLimit: getDiscoveryRecommendationResolveLimit(
        existingRecommendations.length ||
          latestCache.recommendations?.length ||
          0,
      ),
    },
    skipPlaylistPlan: true,
  });
  console.log(
    `[Discovery] Pipeline payload ready in ${Date.now() - payloadStarted}ms (${(Buffer.byteLength(JSON.stringify(rustPayload), "utf8") / 1024 / 1024).toFixed(2)} MiB)`,
  );

  emitStep(
    "enriching_recommendations",
    "Finding similar artists and tags",
    DISCOVERY_REFRESH_PROGRESS.ENRICHING,
  );
  const rustStarted = Date.now();
  console.log("[Discovery] Running rust enrichment pipeline...");
  const stopHeartbeat = onProgress
    ? startDiscoveryProgressHeartbeat(
        (progress) => {
          onProgress({
            phase: "enriching_recommendations",
            progressMessage: "Finding similar artists and tags",
            progress,
          });
        },
        {
          startProgress: DISCOVERY_REFRESH_PROGRESS.ENRICHING,
          endProgress: DISCOVERY_REFRESH_PROGRESS.ENRICHING_MAX,
          estimatedMs: 120000,
        },
      )
    : () => {};

  let rustResponse;
  let libraryMixArtists;
  let releaseAlbums;
  try {
    [rustResponse, libraryMixArtists, releaseAlbums] = await Promise.all([
      runRustDiscoveryPipeline(rustPayload),
      mixPromise,
      releaseRadarPromise,
    ]);
  } finally {
    stopHeartbeat();
  }
  const rustStats = rustResponse?.stats || {};
  const rustResult = rustResponse?.result || {};
  console.log(
    `[Discovery] Rust enrichment finished in ${Date.now() - rustStarted}ms (lastfm=${rustStats.lastfmCalls || 0}, metadata=${rustStats.musicbrainzCalls || 0})`,
  );
  emitStep(
    "enriching_recommendations",
    "Recommendation scoring complete",
    DISCOVERY_REFRESH_PROGRESS.SCORING_DONE,
  );

  if (!buildPlaylists) {
    return {
      ...rustResponse,
      libraryMixArtists,
      releaseAlbums,
    };
  }

  const playlists = await runDiscoveryPlaylistPlanWithRust({
    rustResult,
    latestCache,
    allLibraryArtists,
    existingArtistKeys,
    historyTopArtists,
    libraryMixArtists,
    releaseAlbums,
    onProgress,
  });
  emitStep("building_playlists", "Discover playlists ready", 95);

  return {
    ...rustResponse,
    libraryMixArtists,
    releaseAlbums,
    result: {
      ...rustResult,
      playlists,
    },
    stats: {
      lastfmCalls: rustStats.lastfmCalls || 0,
      musicbrainzCalls: rustStats.musicbrainzCalls || 0,
      durationMs: rustStats.durationMs || 0,
    },
  };
};

const finalizeDiscoveryEnrichmentResult = ({
  rustResult = {},
  discoveryRunId,
  cacheNamespace = null,
  latestCache = {},
  recommendationRunStartedAt = null,
  completionPhase = "playlists_completed",
  completionMessage = "Discovery recommendations and playlists updated",
}) => {
  let recommendationsArray = rustResult.recommendations || [];
  let discoverPlaylists = rustResult.playlists || [];
  const pipelineSeeds = Array.isArray(rustResult.seeds) ? rustResult.seeds : [];

  recommendationsArray = applyProxiedRecommendationImages(recommendationsArray);
  const globalTop = applyProxiedRecommendationImages(rustResult.globalTop || []);

  const poolGenres = deriveDiscoveryGenresFromPool(recommendationsArray);
  const poolTags = deriveDiscoveryTagsFromPool(recommendationsArray);

  const enrichedAt = new Date().toISOString();
  const enrichedData = {
    recommendations: recommendationsArray,
    basedOn: pipelineSeeds.map((seed) => ({
      name: seed.artistName || seed.name,
      id: seed.mbid || seed.id || null,
      source: seed.source || "library",
      profileBucket: seed.profileBucket || null,
    })),
    topTags:
      poolTags.length > 0
        ? poolTags
        : rustResult.topTags || latestCache.topTags || [],
    topGenres:
      poolGenres.length > 0
        ? poolGenres
        : rustResult.topGenres || latestCache.topGenres || [],
    globalTop: globalTop.length > 0 ? globalTop : latestCache.globalTop || [],
    fallbackGenres: latestCache.fallbackGenres || [],
    fallbackGenrePools: latestCache.fallbackGenrePools || {},
    discoverPlaylists,
    provider: latestCache.provider || DISCOVERY_PROVIDER_LASTFM,
    capabilities:
      latestCache.capabilities ||
      getDiscoveryCapabilities(
        (latestCache.provider || DISCOVERY_PROVIDER_LASTFM) ===
          DISCOVERY_PROVIDER_LASTFM,
      ),
    lastUpdated: recommendationRunStartedAt || latestCache.lastUpdated || enrichedAt,
    recommendationQuality: DISCOVERY_QUALITY_ENRICHED,
    isEnriching: false,
    discoveryRunId,
    enrichmentStartedAt: latestCache.enrichmentStartedAt || enrichedAt,
    enrichmentCompletedAt: enrichedAt,
    enrichmentProgressMessage: null,
  };

  if (!cacheNamespace) {
    Object.assign(discoveryCache, enrichedData, { isUpdating: false });
  }
  dbOps.updateDiscoveryCache(enrichedData, cacheNamespace);
  if (!cacheNamespace) {
    emitDiscoveryDataUpdate(enrichedData, {
      phase: completionPhase,
      progress: DISCOVERY_REFRESH_PROGRESS.COMPLETE,
      progressMessage: completionMessage,
    });
  } else {
    websocketService.emitDiscoveryUpdate({
      isUpdating: false,
      configured: true,
      phase: completionPhase,
      progress: DISCOVERY_REFRESH_PROGRESS.COMPLETE,
      progressMessage: completionMessage,
    });
  }

  return {
    enriched: true,
    recommendationCount: recommendationsArray.length,
    playlistCount: discoverPlaylists.length,
    enrichedData,
  };
};

const runDiscoveryPhase1WithRust = async ({
  recentLibraryArtists = [],
  allLibraryArtists = [],
  historyArtists = [],
  existingArtistKeys = [],
  includeGlobalTop = false,
  lastfmHealth = null,
} = {}) => {
  const health = lastfmHealth || createLastfmHealth();
  const { runRustDiscoveryRefresh } = await import("./rustWorkerRunner.js");
  const { buildRustDiscoveryRefreshPayload } = await import(
    "./rustDiscoveryBridge.js"
  );
  const rustPayload = buildRustDiscoveryRefreshPayload({
    recentLibraryArtists,
    allLibraryArtists,
    historyArtists,
    existingArtistKeys,
    includeGlobalTop,
  });
  const rustResponse = await runRustDiscoveryRefresh(rustPayload);
  const rustResult = rustResponse?.result || {};
  const seeds = Array.isArray(rustResult.seeds) ? rustResult.seeds : [];
  const recSample = seeds.slice(
    0,
    getDiscoveryRecommendationSeedLimit(
      seeds.length,
      getLastfmFailureRatio(health),
    ),
  );
  const globalTop = Array.isArray(rustResult.globalTop)
    ? applyProxiedRecommendationImages(rustResult.globalTop)
    : [];
  return { seeds, recSample, globalTop, historyArtists };
};

export const getDiscoveryFlowsPerRefresh = () => {
  const settings = dbOps.getSettings();
  const parsed = parseInt(
    settings.integrations?.lastfm?.discoveryFlowsPerRefresh,
    10,
  );
  if (!Number.isFinite(parsed)) return DISCOVERY_FLOWS_DEFAULT;
  return Math.min(
    DISCOVERY_FLOWS_MAX,
    Math.max(BASE_DISCOVER_FLOW_COUNT, parsed),
  );
};

export const getMaxFocusPlaylists = () =>
  Math.max(0, getDiscoveryFlowsPerRefresh() - BASE_DISCOVER_FLOW_COUNT);

export const getDiscoveryMode = () => {
  const settings = dbOps.getSettings();
  const value = String(
    settings.integrations?.lastfm?.discoveryMode || "balanced",
  )
    .trim()
    .toLowerCase();
  return value === "safer" || value === "deeper" ? value : "balanced";
};

export const getLocalDiscoveryPreferences = () => {
  const settings = dbOps.getSettings();
  return {
    includeRecommendations:
      settings.integrations?.ticketmaster
        ?.localDiscoveryIncludeRecommendations !== false,
    includeTrending:
      settings.integrations?.ticketmaster?.localDiscoveryIncludeTrending !==
      false,
  };
};

const getDiscoveryFeedbackKey = (userId = "global") =>
  `discoveryFeedback:${String(userId || "global").trim()}`;

const normalizeFeedbackAction = (value) => {
  const action = String(value || "")
    .trim()
    .toLowerCase();
  return ["more_like_this", "less_like_this"].includes(action) ? action : null;
};

const normalizeFeedbackList = (value) =>
  (Array.isArray(value) ? value : [])
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      id: String(entry.id || "").trim() || null,
      artistId: String(entry.artistId || "").trim() || null,
      artistName: String(entry.artistName || "").trim() || null,
      action: normalizeFeedbackAction(entry.action),
      sourceContext: String(entry.sourceContext || "").trim() || null,
      tagContext: normalizeTextList(entry.tagContext).slice(0, 8),
      seedContext: normalizeTextList(entry.seedContext).slice(0, 8),
      createdAt: entry.createdAt || null,
      expiresAt: entry.expiresAt || null,
    }))
    .filter((entry) => entry.action && (entry.artistId || entry.artistName))
    .filter((entry) => {
      if (!entry.expiresAt) return true;
      const time = new Date(entry.expiresAt).getTime();
      return Number.isFinite(time) ? time > Date.now() : true;
    });

export const getDiscoveryFeedback = (userId = "global") =>
  normalizeFeedbackList(dbOps.getJSONSetting(getDiscoveryFeedbackKey(userId)));

export const addDiscoveryFeedback = (userId = "global", entry = {}) => {
  const action = normalizeFeedbackAction(entry.action);
  if (!action) throw new Error("Invalid discovery feedback action");
  const artistId = String(entry.artistId || "").trim() || null;
  const artistName = String(entry.artistName || "").trim() || null;
  if (!artistId && !artistName) {
    throw new Error("artistId or artistName is required");
  }

  const existing = getDiscoveryFeedback(userId);
  const now = new Date();
  const normalizedEntry = {
    id:
      String(entry.id || "").trim() ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    artistId,
    artistName,
    action,
    sourceContext: String(entry.sourceContext || "").trim() || null,
    tagContext: normalizeTextList(entry.tagContext).slice(0, 8),
    seedContext: normalizeTextList(entry.seedContext).slice(0, 8),
    createdAt: now.toISOString(),
    expiresAt: null,
  };
  const deduped = existing.filter((item) => {
    const sameArtist =
      (artistId && item.artistId && artistId === item.artistId) ||
      (artistName &&
        item.artistName &&
        artistName.toLowerCase() === item.artistName.toLowerCase());
    return !(sameArtist && item.action === action);
  });
  deduped.unshift(normalizedEntry);
  dbOps.setJSONSetting(getDiscoveryFeedbackKey(userId), deduped.slice(0, 200));
  return normalizedEntry;
};

export const removeDiscoveryFeedback = (userId = "global", feedbackId) => {
  const target = String(feedbackId || "").trim();
  const next = getDiscoveryFeedback(userId).filter(
    (entry) => entry.id !== target,
  );
  dbOps.setJSONSetting(getDiscoveryFeedbackKey(userId), next);
  return next;
};

export const resetDiscoveryFeedback = (userId = "global") => {
  dbOps.setJSONSetting(getDiscoveryFeedbackKey(userId), []);
  return [];
};

export const rerankCachedRecommendations = ({
  recommendations = [],
  feedback = [],
  discoveryMode = getDiscoveryMode(),
  limit = getDiscoveryRecommendationsPerRefresh(),
} = {}) =>
  rerankRecommendations(recommendations, limit, {
    feedback,
    discoveryMode,
  });

export const serveCachedRecommendations = ({
  recommendations = [],
  feedback = [],
} = {}) => filterRecommendationsForServe(recommendations, feedback);

const createLastfmHealth = () => ({
  success: 0,
  failure: 0,
});

const getLastfmFailureRatio = (health) => {
  const total = health.success + health.failure;
  if (total === 0) return 0;
  return health.failure / total;
};

const recordLastfmResult = (health, payload) => {
  if (payload && !payload.error) {
    health.success += 1;
  } else {
    health.failure += 1;
  }
};

export const recordDiscoveryUpdateProgress = (
  phase,
  progressMessage,
  progress,
  extra = {},
) => {
  const normalizedProgress = Math.max(
    0,
    Math.min(100, Math.round(Number(progress) || 0)),
  );
  if (phase === "completed") {
    discoveryCache.isUpdating = false;
    discoveryCache.updatePhase = "completed";
    discoveryCache.updateProgress = normalizedProgress;
    discoveryCache.updateProgressMessage = progressMessage || "";
    websocketService.emitDiscoveryUpdate({
      phase: "completed",
      progress: normalizedProgress,
      progressMessage: discoveryCache.updateProgressMessage,
      isUpdating: false,
      configured: true,
    });
    clearDiscoveryUpdateProgress();
    return;
  }
  const reset =
    extra?.refreshReset === true || phase === "starting" || phase === "queued";
  if (
    phase !== "queued" &&
    discoveryCache.isUpdating !== true &&
    !reset
  ) {
    return;
  }
  if (!reset) {
    const currentProgress =
      typeof discoveryCache.updateProgress === "number"
        ? discoveryCache.updateProgress
        : 0;
    if (normalizedProgress < currentProgress) {
      return;
    }
  }
  discoveryCache.isUpdating = true;
  discoveryCache.updatePhase = phase || null;
  discoveryCache.updateProgress = normalizedProgress;
  discoveryCache.updateProgressMessage = progressMessage || "";
  websocketService.emitDiscoveryUpdate({
    phase: discoveryCache.updatePhase,
    progress: discoveryCache.updateProgress,
    progressMessage: discoveryCache.updateProgressMessage,
    isUpdating: true,
    configured: true,
    ...(reset ? { refreshReset: true } : {}),
    ...extra,
  });
};

export const beginDiscoveryRefreshProgress = (
  progressMessage = "Preparing discovery refresh",
  extra = {},
) => {
  recordDiscoveryUpdateProgress("starting", progressMessage, DISCOVERY_REFRESH_PROGRESS.START, {
    refreshReset: true,
    ...extra,
  });
};

export const clearDiscoveryUpdateProgress = () => {
  discoveryCache.updatePhase = null;
  discoveryCache.updateProgress = null;
  discoveryCache.updateProgressMessage = null;
};

export const getDiscoveryUpdateStatus = () => ({
  updatePhase: discoveryCache.updatePhase || null,
  updateProgress:
    typeof discoveryCache.updateProgress === "number"
      ? discoveryCache.updateProgress
      : null,
  updateProgressMessage: discoveryCache.updateProgressMessage || null,
});

export const getDiscoveryPlaylistBuildStatus = (cacheNamespace = null) => {
  const cached = getDiscoveryCache(cacheNamespace);
  const updating = cached.isEnriching === true || discoveryPlaylistsBuilding;
  return {
    playlistsUpdating: updating,
    playlistsUpdateMessage: updating
      ? cached.enrichmentProgressMessage || "Improving recommendations"
      : null,
  };
};

const emitDiscoveryProgress = (
  phase,
  progressMessage,
  progress,
  extra = {},
) => {
  recordDiscoveryUpdateProgress(phase, progressMessage, progress, extra);
};

const EMPTY_CACHE = {
  recommendations: [],
  globalTop: [],
  basedOn: [],
  topTags: [],
  topGenres: [],
  fallbackGenres: [],
  fallbackGenrePools: {},
  discoverPlaylists: [],
  provider: DISCOVERY_PROVIDER_LASTFM,
  capabilities: getDiscoveryCapabilities(true),
  lastUpdated: null,
  metadata: {},
  recommendationQuality: null,
  isEnriching: false,
  discoveryRunId: null,
  enrichmentStartedAt: null,
  enrichmentCompletedAt: null,
  enrichmentProgressMessage: null,
  isUpdating: false,
  updatePhase: null,
  updateProgress: null,
  updateProgressMessage: null,
};

let discoveryCache = { ...EMPTY_CACHE };

const dbData = dbOps.getDiscoveryCache();
if (
  dbData.lastUpdated ||
  dbData.recommendations?.length > 0 ||
  dbData.globalTop?.length > 0 ||
  dbData.topGenres?.length > 0 ||
  dbData.fallbackGenres?.length > 0 ||
  Object.keys(dbData.fallbackGenrePools || {}).length > 0
) {
  discoveryCache = {
    recommendations: dbData.recommendations || [],
    globalTop: dbData.globalTop || [],
    basedOn: dbData.basedOn || [],
    topTags: dbData.topTags || [],
    topGenres: dbData.topGenres || [],
    fallbackGenres: dbData.fallbackGenres || [],
    fallbackGenrePools: dbData.fallbackGenrePools || {},
    discoverPlaylists: dbData.discoverPlaylists || [],
    provider: dbData.provider || DISCOVERY_PROVIDER_LASTFM,
    capabilities: getDiscoveryCapabilities(
      (dbData.provider || DISCOVERY_PROVIDER_LASTFM) ===
        DISCOVERY_PROVIDER_LASTFM,
    ),
    lastUpdated: dbData.lastUpdated || null,
    metadata: dbData.metadata || {},
    recommendationQuality: dbData.recommendationQuality || null,
    isEnriching: dbData.isEnriching === true,
    discoveryRunId: dbData.discoveryRunId || null,
    enrichmentStartedAt: dbData.enrichmentStartedAt || null,
    enrichmentCompletedAt: dbData.enrichmentCompletedAt || null,
    enrichmentProgressMessage: dbData.enrichmentProgressMessage || null,
    isUpdating: false,
  };
}

export const getDiscoveryCache = (listenHistoryProfile = null) => {
  const cacheNamespace =
    typeof listenHistoryProfile === "string"
      ? String(listenHistoryProfile).trim() || null
      : getListenHistoryCacheNamespace(listenHistoryProfile);
  if (cacheNamespace) {
    const userDbData = dbOps.getDiscoveryCache(cacheNamespace);
    const hasUserRecommendations = userDbData.recommendations?.length > 0;
    const hasUserBasedOn = userDbData.basedOn?.length > 0;
    if (hasUserRecommendations || hasUserBasedOn) {
      const globalDbData = dbOps.getDiscoveryCache();
      const recommendations = hasUserRecommendations
        ? userDbData.recommendations
        : globalDbData.recommendations || [];
      return {
        recommendations,
        globalTop: discoveryCache.globalTop.length
          ? discoveryCache.globalTop
          : globalDbData.globalTop || [],
        basedOn: userDbData.basedOn || [],
        topTags:
          userDbData.topTags?.length > 0
            ? userDbData.topTags
            : discoveryCache.topTags || [],
        topGenres:
          userDbData.topGenres?.length > 0
            ? userDbData.topGenres
            : discoveryCache.topGenres || [],
        fallbackGenres: discoveryCache.fallbackGenres || [],
        fallbackGenrePools: discoveryCache.fallbackGenrePools || {},
        discoverPlaylists:
          userDbData.discoverPlaylists?.length > 0
            ? userDbData.discoverPlaylists
            : discoveryCache.discoverPlaylists || [],
        provider: discoveryCache.provider || DISCOVERY_PROVIDER_LASTFM,
        capabilities:
          discoveryCache.capabilities ||
          getDiscoveryCapabilities(
            (discoveryCache.provider || DISCOVERY_PROVIDER_LASTFM) ===
              DISCOVERY_PROVIDER_LASTFM,
          ),
        lastUpdated:
          userDbData.lastUpdated || discoveryCache.lastUpdated || null,
        metadata: userDbData.metadata || discoveryCache.metadata || {},
        recommendationQuality:
          userDbData.recommendationQuality ||
          discoveryCache.recommendationQuality ||
          null,
        isEnriching:
          userDbData.isEnriching === true ||
          (!userDbData.recommendationQuality &&
            discoveryCache.isEnriching === true),
        discoveryRunId:
          userDbData.discoveryRunId || discoveryCache.discoveryRunId || null,
        enrichmentStartedAt:
          userDbData.enrichmentStartedAt ||
          discoveryCache.enrichmentStartedAt ||
          null,
        enrichmentCompletedAt:
          userDbData.enrichmentCompletedAt ||
          discoveryCache.enrichmentCompletedAt ||
          null,
        enrichmentProgressMessage:
          userDbData.enrichmentProgressMessage ||
          discoveryCache.enrichmentProgressMessage ||
          null,
        isUpdating: discoveryCache.isUpdating,
        updatePhase: discoveryCache.updatePhase || null,
        updateProgress:
          typeof discoveryCache.updateProgress === "number"
            ? discoveryCache.updateProgress
            : null,
        updateProgressMessage: discoveryCache.updateProgressMessage || null,
      };
    }
  }

  const dbData = dbOps.getDiscoveryCache();
  if (
    (dbData.lastUpdated && !discoveryCache.lastUpdated) ||
    (dbData.recommendations?.length > 0 &&
      (!discoveryCache.recommendations ||
        discoveryCache.recommendations.length === 0)) ||
    (dbData.globalTop?.length > 0 &&
      (!discoveryCache.globalTop || discoveryCache.globalTop.length === 0)) ||
    (dbData.topGenres?.length > 0 &&
      (!discoveryCache.topGenres || discoveryCache.topGenres.length === 0)) ||
    (dbData.fallbackGenres?.length > 0 &&
      (!discoveryCache.fallbackGenres ||
        discoveryCache.fallbackGenres.length === 0)) ||
    (Object.keys(dbData.fallbackGenrePools || {}).length > 0 &&
      Object.keys(discoveryCache.fallbackGenrePools || {}).length === 0)
  ) {
    Object.assign(discoveryCache, {
      recommendations:
        dbData.recommendations || discoveryCache.recommendations || [],
      globalTop: dbData.globalTop || discoveryCache.globalTop || [],
      basedOn: dbData.basedOn || discoveryCache.basedOn || [],
      topTags: dbData.topTags || discoveryCache.topTags || [],
      topGenres: dbData.topGenres || discoveryCache.topGenres || [],
      fallbackGenres:
        dbData.fallbackGenres || discoveryCache.fallbackGenres || [],
      fallbackGenrePools:
        dbData.fallbackGenrePools || discoveryCache.fallbackGenrePools || {},
      discoverPlaylists:
        dbData.discoverPlaylists || discoveryCache.discoverPlaylists || [],
      provider:
        dbData.provider || discoveryCache.provider || DISCOVERY_PROVIDER_LASTFM,
      capabilities: getDiscoveryCapabilities(
        (dbData.provider ||
          discoveryCache.provider ||
          DISCOVERY_PROVIDER_LASTFM) === DISCOVERY_PROVIDER_LASTFM,
      ),
      lastUpdated: dbData.lastUpdated || discoveryCache.lastUpdated || null,
      metadata: dbData.metadata || discoveryCache.metadata || {},
      recommendationQuality:
        dbData.recommendationQuality ||
        discoveryCache.recommendationQuality ||
        null,
      isEnriching:
        dbData.isEnriching === true || discoveryCache.isEnriching === true,
      discoveryRunId: dbData.discoveryRunId || discoveryCache.discoveryRunId || null,
      enrichmentStartedAt:
        dbData.enrichmentStartedAt || discoveryCache.enrichmentStartedAt || null,
      enrichmentCompletedAt:
        dbData.enrichmentCompletedAt ||
        discoveryCache.enrichmentCompletedAt ||
        null,
      enrichmentProgressMessage:
        dbData.enrichmentProgressMessage ||
        discoveryCache.enrichmentProgressMessage ||
        null,
    });
  }
  return discoveryCache;
};

export const isGlobalDiscoveryRefreshInProgress = () =>
  isHonkerLockHeld("discovery-global-refresh") ||
  isDiscoveryRefreshQueueLocked();

const hasListeningHistoryUsers = () =>
  userOps
    .getAllListeningHistoryUsers()
    .some((user) => hasListenHistoryProfile(user));

const pendingUserDiscoveryProfiles = new Map();

const collectListeningHistoryRefreshProfiles = () => {
  const profiles = new Map();
  for (const user of userOps.getAllListeningHistoryUsers()) {
    const profile = getListenHistoryProfile(user);
    const cacheNamespace = getListenHistoryCacheNamespace(profile);
    if (!cacheNamespace || !hasListenHistoryProfile(profile)) continue;
    profiles.set(cacheNamespace, {
      profile,
      feedbackUserId: user.id || null,
    });
  }
  for (const [cacheNamespace, entry] of pendingUserDiscoveryProfiles) {
    profiles.set(
      cacheNamespace,
      entry?.profile
        ? entry
        : {
            profile: entry,
            feedbackUserId: null,
          },
    );
  }
  pendingUserDiscoveryProfiles.clear();
  return [...profiles.values()];
};

const enqueueListeningHistoryUserRefreshes = ({
  reason = "global_refresh_completed",
  delaySeconds = getDiscoveryUserRefreshDelaySeconds(),
  staggerSeconds = 30,
  onProgress,
} = {}) => {
  const profiles = collectListeningHistoryRefreshProfiles();
  if (profiles.length === 0) return 0;

  profiles.forEach((entry, index) => {
    enqueueDiscoveryUserRefreshJob(
      {
        listenHistoryProfile: entry.profile,
        feedbackUserId: entry.feedbackUserId || null,
        requestedAt: Date.now(),
        reason,
      },
      {
        delaySeconds: delaySeconds + index * Math.max(0, staggerSeconds),
        priority: -10,
      },
    );
    onProgress?.({ completed: index + 1, total: profiles.length });
  });
  return profiles.length;
};

export const requestUserDiscoveryRefresh = (
  listenHistoryProfile,
  { feedbackUserId = null } = {},
) => {
  const profile = getListenHistoryProfile(listenHistoryProfile);
  const cacheNamespace = getListenHistoryCacheNamespace(profile);
  if (!cacheNamespace || !getLastfmApiKey()) {
    return Promise.resolve(null);
  }
  if (isGlobalDiscoveryRefreshInProgress()) {
    pendingUserDiscoveryProfiles.set(cacheNamespace, {
      profile,
      feedbackUserId,
    });
    enqueueDiscoveryUserRefreshJob(
      {
        listenHistoryProfile: profile,
        feedbackUserId,
        requestedAt: Date.now(),
        reason: "global_refresh_in_progress",
      },
      { delaySeconds: getDiscoveryUserRefreshDelaySeconds(), priority: -10 },
    );
    return Promise.resolve({
      enqueued: true,
      reason: "global_refresh_in_progress",
    });
  }
  const operationId = enqueueDiscoveryUserRefreshJob({
    listenHistoryProfile: profile,
    feedbackUserId,
    requestedAt: Date.now(),
    reason: "manual",
  });
  return Promise.resolve({ enqueued: true, operationId });
};

const fetchListenHistoryArtists = async (
  listenHistoryProfile,
  discoveryPeriod,
  lastfmHealth,
) => {
  const profile = getListenHistoryProfile(listenHistoryProfile);
  if (!hasListenHistoryProfile(profile) || discoveryPeriod === "none") {
    return [];
  }

  if (profile.listenHistoryProvider === "listenbrainz") {
    const data = await listenbrainzRequest(
      `/1/stats/user/${encodeURIComponent(profile.listenHistoryUsername)}/artists`,
      {
        count: 50,
        range: getListenbrainzRange(discoveryPeriod),
      },
    );
    const artists = Array.isArray(data?.payload?.artists)
      ? data.payload.artists
      : [];
    return artists
      .map((artist) => {
        const mbid = Array.isArray(artist.artist_mbids)
          ? artist.artist_mbids.find(Boolean)
          : artist.artist_mbid || null;
        const resolvedMbid =
          mbid || musicbrainzGetCachedArtistMbidByName(artist.artist_name);
        return {
          mbid: resolvedMbid || null,
          artistName: artist.artist_name,
          playcount: parseInt(artist.listen_count || 0, 10) || 0,
        };
      })
      .filter((artist) => artist.artistName);
  }

  if (profile.listenHistoryProvider === "koito") {
    const { fetchKoitoTopArtists } = await import("./koitoClient.js");
    return fetchKoitoTopArtists(profile.listenHistoryUrl, {
      discoveryPeriod,
      limit: 50,
    });
  }

  const userTopArtists = await lastfmRequest(
    "user.getTopArtists",
    {
      user: profile.listenHistoryUsername,
      limit: 50,
      period: discoveryPeriod,
    },
    { timeoutMs: 12000, maxRetries: 2 },
  );
  recordLastfmResult(lastfmHealth, userTopArtists);

  if (!userTopArtists?.topartists?.artist) {
    return [];
  }

  const artists = Array.isArray(userTopArtists.topartists.artist)
    ? userTopArtists.topartists.artist
    : [userTopArtists.topartists.artist];

    return artists
    .map((artist) => {
      const artistName = String(artist?.name || "").trim();
      if (!artistName) return null;
      return {
        mbid:
          String(artist.mbid || "").trim() ||
          musicbrainzGetCachedArtistMbidByName(artistName) ||
          null,
        artistName,
        playcount: parseInt(artist.playcount || 0, 10) || 0,
      };
    })
    .filter(Boolean);
};

const buildDiscoveryUpdatePayload = (
  discoveryData,
  {
    phase = "completed",
    progress = 100,
    progressMessage = "Discovery refresh completed",
    isUpdating = false,
    partial = false,
  } = {},
) => {
  const base = {
    provider: discoveryData.provider || DISCOVERY_PROVIDER_LASTFM,
    capabilities:
      discoveryData.capabilities ||
      getDiscoveryCapabilities(
        (discoveryData.provider || DISCOVERY_PROVIDER_LASTFM) ===
          DISCOVERY_PROVIDER_LASTFM,
      ),
    lastUpdated: discoveryData.lastUpdated,
    recommendationQuality:
      discoveryData.recommendationQuality ||
      discoveryData.metadata?.recommendationQuality ||
      null,
    isEnriching:
      discoveryData.isEnriching === true ||
      discoveryData.metadata?.isEnriching === true,
    discoveryRunId:
      discoveryData.discoveryRunId ||
      discoveryData.metadata?.discoveryRunId ||
      null,
    enrichmentStartedAt:
      discoveryData.enrichmentStartedAt ||
      discoveryData.metadata?.enrichmentStartedAt ||
      null,
    enrichmentCompletedAt:
      discoveryData.enrichmentCompletedAt ||
      discoveryData.metadata?.enrichmentCompletedAt ||
      null,
    enrichmentProgressMessage:
      discoveryData.enrichmentProgressMessage ||
      discoveryData.metadata?.enrichmentProgressMessage ||
      null,
    isUpdating,
    configured: true,
    phase,
    progress,
    progressMessage,
    discoveryMode: getDiscoveryMode(),
  };

  if (partial) {
    return base;
  }

  return {
    ...base,
    recommendations: discoveryData.recommendations || [],
    globalTop: discoveryData.globalTop || [],
    basedOn: discoveryData.basedOn || [],
    topTags: discoveryData.topTags || [],
    topGenres: discoveryData.topGenres || [],
    fallbackGenres: discoveryData.fallbackGenres || [],
    discoverPlaylists: discoveryData.discoverPlaylists || [],
  };
};

const emitDiscoveryDataUpdate = (discoveryData, options = {}) => {
  websocketService.emitDiscoveryUpdate(
    buildDiscoveryUpdatePayload(discoveryData, options),
  );
};

const normalizePlaylistBuildStringList = (value, limit = 10) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    const text = String(entry || "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
};

const applyDiscoveryCacheMetadata = (cacheNamespace, metadata = {}) => {
  if (!metadata || typeof metadata !== "object") return;
  dbOps.updateDiscoveryCache(metadata, cacheNamespace);
  if (!cacheNamespace) {
    Object.assign(discoveryCache, metadata, {
      metadata: {
        ...(discoveryCache.metadata || {}),
        ...metadata,
      },
    });
  }
};

const scheduleDiscoveryRecommendationEnrichment = ({
  cacheNamespace = null,
  discoveryRunId,
  recommendationRunStartedAt,
  seeds = [],
  listenHistoryProfile = null,
  feedbackUserId = null,
  historyTopArtists = [],
  discoveryMode,
} = {}) => {
  if (!getLastfmApiKey() || !discoveryRunId || seeds.length === 0) return null;
  return enqueueDiscoveryRecommendationEnrichmentJob({
    cacheNamespace,
    discoveryRunId,
    recommendationRunStartedAt,
    seeds,
    listenHistoryProfile,
    feedbackUserId,
    historyTopArtists: normalizePlaylistBuildStringList(historyTopArtists, 3),
    discoveryMode: discoveryMode || getDiscoveryMode(),
    requestedAt: Date.now(),
  });
};

export const runDiscoveryRecommendationEnrichment = async (payload = {}) => {
  const cacheNamespace = String(payload?.cacheNamespace || "").trim() || null;
  const discoveryRunId = String(payload?.discoveryRunId || "").trim();
  if (!discoveryRunId || !getLastfmApiKey()) {
    return { skipped: true, reason: "not_configured" };
  }

  const currentCache = getDiscoveryCache(cacheNamespace);
  if (currentCache.discoveryRunId !== discoveryRunId) {
    return { skipped: true, reason: "stale_run" };
  }

  applyDiscoveryCacheMetadata(cacheNamespace, {
    recommendationQuality: DISCOVERY_QUALITY_ENRICHING,
    isEnriching: true,
    discoveryRunId,
    enrichmentStartedAt:
      currentCache.enrichmentStartedAt || new Date().toISOString(),
    enrichmentProgressMessage: "Improving recommendations",
  });
  if (!cacheNamespace) {
    emitDiscoveryDataUpdate(
      {
        ...currentCache,
        recommendationQuality: DISCOVERY_QUALITY_ENRICHING,
        isEnriching: true,
        discoveryRunId,
        enrichmentProgressMessage: "Finding similar artists and tags",
      },
      {
        phase: "enriching_recommendations",
        progress: 30,
        progressMessage: "Finding similar artists and tags",
        isUpdating: true,
        partial: true,
      },
    );
  } else {
    websocketService.emitDiscoveryUpdate({
      isUpdating: false,
      configured: true,
      phase: "enriching_recommendations",
      progressMessage: "Improving discovery recommendations",
    });
  }

  const seeds = Array.isArray(payload?.seeds) ? payload.seeds : [];
  if (seeds.length === 0) {
    applyDiscoveryCacheMetadata(cacheNamespace, {
      recommendationQuality: DISCOVERY_QUALITY_INITIAL,
      isEnriching: false,
      discoveryRunId,
      enrichmentCompletedAt: new Date().toISOString(),
      enrichmentProgressMessage: null,
    });
    return { skipped: true, reason: "no_seeds" };
  }

  const allLibraryArtistsRaw = await libraryManager.getAllArtists();
  const allLibraryArtists = Array.isArray(allLibraryArtistsRaw)
    ? allLibraryArtistsRaw
    : [];
  const existingArtistKeys = buildExistingArtistKeySet(allLibraryArtists);
  const latestCacheForInput = getDiscoveryCache(cacheNamespace);
  const feedback = payload?.feedbackUserId
    ? getDiscoveryFeedback(payload.feedbackUserId)
    : cacheNamespace
      ? []
      : getDiscoveryFeedback("global");

  let recommendationsArray = [];
  let freshRecommendations = [];

  const { runRustDiscoveryRun } = await import("./rustWorkerRunner.js");
  const { buildRustDiscoveryRunPayload } = await import(
    "./rustDiscoveryBridge.js"
  );
  const rustPayload = await buildRustDiscoveryRunPayload({
    payload,
    seeds,
    existingArtistKeys,
    existingRecommendations: latestCacheForInput.recommendations || [],
    feedback,
    limits: {
      poolCap: getDiscoveryRecommendationPoolLimit(),
      perRefresh: getDiscoveryRecommendationsPerRefresh(),
    },
    baseDiscoveryData: latestCacheForInput,
    libraryArtists: allLibraryArtists,
    historyTopArtists: payload?.historyTopArtists || [],
    imageHydration: {
      freshLimit: getDiscoveryRecommendationsPerRefresh(),
      poolLimit: getDiscoveryRecommendationResolveLimit(
        latestCacheForInput.recommendations?.length || 0,
      ),
    },
  });
  const rustResponse = await runRustDiscoveryRun(rustPayload);
  const rustResult = rustResponse?.result || {};
  recommendationsArray = rustResult.recommendations || [];
  freshRecommendations =
    rustResult.freshRecommendations || rustResult.fresh_recommendations || [];
  let discoverPlaylists = rustResult.playlists || [];

  const latestCache = getDiscoveryCache(cacheNamespace);
  if (latestCache.discoveryRunId !== discoveryRunId) {
    return { skipped: true, reason: "stale_run" };
  }

  const finalizeResult = finalizeDiscoveryEnrichmentResult({
    rustResult: {
      ...rustResult,
      recommendations: recommendationsArray,
      playlists: rustResult.playlists || [],
    },
    discoveryRunId,
    cacheNamespace,
    latestCache,
    recommendationRunStartedAt: latestCache.lastUpdated,
  });

  return {
    enriched: true,
    recommendationCount: finalizeResult.recommendationCount,
    playlistCount: finalizeResult.playlistCount,
  };
};

export const markDiscoveryRecommendationEnrichmentFailed = (
  payload = {},
  error = null,
) => {
  const cacheNamespace = String(payload?.cacheNamespace || "").trim() || null;
  const discoveryRunId = String(payload?.discoveryRunId || "").trim();
  if (!discoveryRunId) return;
  const currentCache = getDiscoveryCache(cacheNamespace);
  if (currentCache.discoveryRunId !== discoveryRunId) return;
  const message = error?.message || String(error || "Unknown error");
  applyDiscoveryCacheMetadata(cacheNamespace, {
    recommendationQuality:
      currentCache.recommendationQuality || DISCOVERY_QUALITY_INITIAL,
    isEnriching: false,
    discoveryRunId,
    enrichmentCompletedAt: new Date().toISOString(),
    enrichmentProgressMessage: null,
  });
  console.warn(
    `[Discovery] Recommendation enrichment failed for ${cacheNamespace || "global"}: ${message}`,
  );
  websocketService.emitDiscoveryUpdate({
    isUpdating: false,
    configured: true,
    phase: "completed",
    progress: 100,
    progressMessage: "Discovery recommendations are available",
  });
};

export const updateDiscoveryCache = async (options = {}) => {
  if (options.skipHonkerLock !== true) {
    return withHonkerLock(
      "discovery-global-refresh",
      () =>
        updateDiscoveryCache({
          ...options,
          skipHonkerLock: true,
        }),
      {
        ttlSeconds: 3600,
        waitTimeoutMs: 30 * 60 * 1000,
        retryDelayMs: 500,
      },
    );
  }
  discoveryCache.isUpdating = true;
  console.log("Starting background update of discovery recommendations...");
  beginDiscoveryRefreshProgress("Preparing discovery refresh");
  import("./aurralHistoryService.js")
    .then(({ recordDiscoveryRefreshStarted }) =>
      recordDiscoveryRefreshStarted(),
    )
    .catch(() => {});

  try {
    const { libraryManager } = await import("./libraryManager.js");
    emitDiscoveryProgress("loading_sources", "Loading library artists", DISCOVERY_REFRESH_PROGRESS.LOADING);
    const [recentLibraryArtists, allLibraryArtistsRaw] = await Promise.all([
      libraryManager.getRecentArtists(40),
      libraryManager.getAllArtists(),
    ]);
    const allLibraryArtists = Array.isArray(allLibraryArtistsRaw)
      ? allLibraryArtistsRaw
      : [];
    const libraryArtists =
      recentLibraryArtists.length > 0
        ? recentLibraryArtists
        : allLibraryArtists.slice(0, 40);
    console.log(`Found ${allLibraryArtists.length} artists in library.`);

    const { playlistSource } = await import("./weeklyFlowPlaylistSource.js");
    const libraryMixPromise =
      playlistSource.buildLibraryMixContext(allLibraryArtists);

    const hasLastfmKey = !!getLastfmApiKey();
    const lastfmHealth = createLastfmHealth();

    if (!hasLastfmKey) {
      console.log(
        "No Last.fm API key configured. Building ListenBrainz fallback discovery.",
      );
      emitDiscoveryProgress(
        "fetching_trending",
        "Fetching ListenBrainz trending artists",
        45,
        {
          provider: "listenbrainz-fallback",
          capabilities: getDiscoveryCapabilities(false),
        },
      );
      const fallbackData = await buildListenbrainzFallbackDiscovery({
        existingArtistKeys: buildExistingArtistKeySet(allLibraryArtists),
        onProgress: ({ phase, progress, progressMessage }) =>
          emitDiscoveryProgress(phase, progressMessage, progress, {
            provider: "listenbrainz-fallback",
            capabilities: getDiscoveryCapabilities(false),
          }),
      });
      discoveryCache.isUpdating = false;
      Object.assign(discoveryCache, fallbackData, {
        isUpdating: false,
      });
      dbOps.updateDiscoveryCache(fallbackData);
      websocketService.emitDiscoveryUpdate({
        ...fallbackData,
        isUpdating: false,
        configured: true,
        phase: "completed",
        progress: 100,
        progressMessage: "Discovery refresh completed",
      });
      const { recordDiscoveryUpdated } =
        await import("./aurralHistoryService.js");
      recordDiscoveryUpdated({
        recommendationCount: fallbackData.recommendations?.length || 0,
        genreCount: fallbackData.topGenres?.length || 0,
      });
      return;
    }

    emitDiscoveryProgress(
      "collecting_seeds",
      "Collecting recommendation seed artists",
      DISCOVERY_REFRESH_PROGRESS.SEEDS,
    );

    const historyArtists = [];
    const defaultListenHistoryProfile = getDefaultListenHistoryProfile(
      dbOps.getSettings(),
    );
    const discoveryPeriod = getLastfmDiscoveryPeriod();
    const listeningHistoryUsersConfigured = hasListeningHistoryUsers();
    if (
      defaultListenHistoryProfile &&
      discoveryPeriod !== "none" &&
      !listeningHistoryUsersConfigured
    ) {
      try {
        const fetched = await fetchListenHistoryArtists(
          defaultListenHistoryProfile,
          discoveryPeriod,
          lastfmHealth,
        );
        historyArtists.push(
          ...fetched.map((artist) => ({
            ...artist,
            source: defaultListenHistoryProfile.listenHistoryProvider,
          })),
        );
      } catch (error) {
        console.warn(
          `[Discovery] Failed to load default listening history for ${defaultListenHistoryProfile.listenHistoryUsername}: ${error.message}`,
        );
      }
    }

    const existingArtistKeys = buildExistingArtistKeySet(allLibraryArtists);

    const recommendationRunStartedAt = new Date().toISOString();
    const discoveryRunId = createDiscoveryRunId();
    const seedLimit = getDiscoveryRecommendationSeedLimit(
      allLibraryArtists.length + historyArtists.length,
      getLastfmFailureRatio(lastfmHealth),
    );
    const recommendationsArray = discoveryCache.recommendations || [];

    applyDiscoveryCacheMetadata(null, {
      recommendationQuality: DISCOVERY_QUALITY_ENRICHING,
      isEnriching: true,
      discoveryRunId,
      enrichmentStartedAt: recommendationRunStartedAt,
      enrichmentProgressMessage: "Finding similar artists and tags",
      lastUpdated: recommendationRunStartedAt,
    });
    emitDiscoveryDataUpdate(
      {
        ...getDiscoveryCache(null),
        recommendationQuality: DISCOVERY_QUALITY_ENRICHING,
        isEnriching: true,
        discoveryRunId,
        enrichmentProgressMessage: "Finding similar artists and tags",
      },
      {
        phase: "enriching_recommendations",
        progress: DISCOVERY_REFRESH_PROGRESS.ENRICHING,
        progressMessage: "Finding similar artists and tags",
        isUpdating: true,
        partial: true,
      },
    );

    const rustResponse = await runDiscoveryPipelineWithRust({
      recentLibraryArtists,
      allLibraryArtists,
      historyArtists,
      existingArtistKeys,
      includeGlobalTop: Boolean(getLastfmApiKey()),
      discoveryRunId,
      recommendationRunStartedAt,
      existingRecommendations: recommendationsArray,
      feedback: getDiscoveryFeedback("global"),
      historyTopArtists: historyArtists
        .slice(0, 3)
        .map((artist) => artist.artistName)
        .filter(Boolean),
      seedLimit,
      libraryMixPromise,
      buildPlaylists: false,
      onProgress: ({ phase, progressMessage, progress }) =>
        emitDiscoveryProgress(phase, progressMessage, progress),
    });
    const rustResult = rustResponse?.result || {};
    if ((rustResult.globalTop || []).length > 0) {
      console.log(
        `Found ${rustResult.globalTop.length} trending artists (from top tracks).`,
      );
    }

    emitDiscoveryProgress(
      "saving_recommendations",
      "Saving recommendations",
      DISCOVERY_REFRESH_PROGRESS.SAVING,
    );
    const finalizeResult = finalizeDiscoveryEnrichmentResult({
      rustResult: {
        ...rustResult,
        playlists: discoveryCache.discoverPlaylists || [],
      },
      discoveryRunId,
      cacheNamespace: null,
      latestCache: getDiscoveryCache(null),
      recommendationRunStartedAt,
      completionPhase: "completed",
      completionMessage: "Recommendations updated",
    });

    emitDiscoveryProgress(
      "completed",
      "Recommendations updated",
      DISCOVERY_REFRESH_PROGRESS.COMPLETE,
    );

    scheduleDiscoveryPlaylistBuild({
      rustResult,
      latestCache: finalizeResult.enrichedData,
      allLibraryArtists,
      existingArtistKeys,
      historyTopArtists: historyArtists
        .slice(0, 3)
        .map((artist) => artist.artistName)
        .filter(Boolean),
      libraryMixArtists: rustResponse.libraryMixArtists || [],
      releaseAlbums: rustResponse.releaseAlbums || [],
    });

    const { notifyDiscoveryUpdated } = await import("./notificationService.js");
    notifyDiscoveryUpdated().catch((err) =>
      console.warn("[Discovery] Notification failed:", err.message),
    );
    console.log(
      `Discovery data written to database: ${finalizeResult.recommendationCount} recommendations, ${finalizeResult.enrichedData.topGenres.length} genres, ${finalizeResult.enrichedData.globalTop.length} trending`,
    );
    console.log("Discovery cache updated successfully.");

    if (listeningHistoryUsersConfigured) {
      const queuedUserRefreshes = enqueueListeningHistoryUserRefreshes({
        reason: "global_refresh_completed",
      });
      if (queuedUserRefreshes > 0) {
        console.log(
          `[Discovery] Queued ${queuedUserRefreshes} per-user refresh${
            queuedUserRefreshes === 1 ? "" : "es"
          } after global refresh.`,
        );
      }
    }

    const { recordDiscoveryUpdated } =
      await import("./aurralHistoryService.js");
    recordDiscoveryUpdated({
      recommendationCount: finalizeResult.recommendationCount,
      genreCount: finalizeResult.enrichedData.topGenres?.length || 0,
    });

    try {
      const cleaned = dbOps.cleanOldImageCache(30);
      if (cleaned?.changes > 0) {
        console.log(
          `[Discovery] Cleaned ${cleaned.changes} old image cache entries`,
        );
      }
      dbOps.cleanOldMusicbrainzArtistMbidCache(90);
    } catch (e) {
      console.warn("[Discovery] Failed to clean old image cache:", e.message);
    }
  } catch (error) {
    console.error("Failed to update discovery cache:", error.message);
    console.error("Stack trace:", error.stack);
    websocketService.emitDiscoveryUpdate({
      isUpdating: false,
      configured: true,
      phase: "error",
      progress: 100,
      progressMessage: "Discovery refresh failed",
      error: error.message,
    });
    import("./aurralHistoryService.js")
      .then(({ recordDiscoveryRefreshFailed }) =>
        recordDiscoveryRefreshFailed(error.message),
      )
      .catch(() => {});
  } finally {
    if (pendingUserDiscoveryProfiles.size > 0) {
      const queuedUserRefreshes = enqueueListeningHistoryUserRefreshes({
        reason: "global_refresh_finished",
      });
      if (queuedUserRefreshes > 0) {
        console.log(
          `[Discovery] Queued ${queuedUserRefreshes} deferred per-user refresh${
            queuedUserRefreshes === 1 ? "" : "es"
          }.`,
        );
      }
    }
    discoveryCache.isUpdating = false;
    clearDiscoveryUpdateProgress();
  }
};

export const updateUserDiscoveryCache = async (
  listenHistoryProfile,
  options = {},
) => {
  const { duringGlobalRefresh = false } = options;
  const profile = getListenHistoryProfile(listenHistoryProfile);
  const cacheNamespace = getListenHistoryCacheNamespace(profile);
  if (!cacheNamespace) return null;
  if (!getLastfmApiKey()) return null;
  if (options.skipHonkerLock !== true) {
    return withHonkerLock(
      `discovery-user-refresh:${cacheNamespace}`,
      () =>
        updateUserDiscoveryCache(profile, {
          ...options,
          skipHonkerLock: true,
        }),
      {
        ttlSeconds: 300,
        waitTimeoutMs: 30 * 60 * 1000,
        retryDelayMs: 500,
      },
    );
  }
  if (!duringGlobalRefresh && isGlobalDiscoveryRefreshInProgress()) {
    pendingUserDiscoveryProfiles.set(cacheNamespace, {
      profile,
      feedbackUserId: options.feedbackUserId || null,
    });
    enqueueDiscoveryUserRefreshJob(
      {
        listenHistoryProfile: profile,
        feedbackUserId: options.feedbackUserId || null,
        requestedAt: Date.now(),
        reason: "global_refresh_in_progress",
      },
      { delaySeconds: 300 },
    );
    return { skipped: true, reason: "global_refresh_in_progress" };
  }
  const shouldPublishRefreshState = !duringGlobalRefresh;
  console.log(
    `[Discovery] Starting per-user refresh for ${profile.listenHistoryProvider} user ${profile.listenHistoryUsername}...`,
  );

  if (shouldPublishRefreshState) {
    discoveryCache.isUpdating = true;
    emitDiscoveryProgress(
      "generating_recommendations",
      "Preparing personalized discovery",
      65,
    );
  }

  try {
    const [recentLibraryArtistsRaw, allLibraryArtistsRaw] = await Promise.all([
      libraryManager.getRecentArtists(40),
      libraryManager.getAllArtists(),
    ]);
    const recentLibraryArtists = Array.isArray(recentLibraryArtistsRaw)
      ? recentLibraryArtistsRaw
      : [];
    const allLibraryArtists = Array.isArray(allLibraryArtistsRaw)
      ? allLibraryArtistsRaw
      : [];
    const existingArtistKeys = buildExistingArtistKeySet(allLibraryArtists);
    const { playlistSource } = await import("./weeklyFlowPlaylistSource.js");
    const libraryMixPromise =
      playlistSource.buildLibraryMixContext(allLibraryArtists);

    const lastfmHealth = createLastfmHealth();
    const discoveryPeriod = getLastfmDiscoveryPeriod();
    const historyArtists = [];

    if (discoveryPeriod !== "none") {
      console.log(
        `[Discovery] Fetching ${profile.listenHistoryProvider} top artists for ${profile.listenHistoryUsername} (period: ${discoveryPeriod})...`,
      );
      try {
        const fetchedHistoryArtists = await fetchListenHistoryArtists(
          profile,
          discoveryPeriod,
          lastfmHealth,
        );
        historyArtists.push(
          ...fetchedHistoryArtists.map((artist) => ({
            ...artist,
            source: profile.listenHistoryProvider,
          })),
        );
        console.log(
          `[Discovery] Found ${historyArtists.length} ${profile.listenHistoryProvider} artists for ${profile.listenHistoryUsername}.`,
        );
      } catch (e) {
        console.error(
          `[Discovery] Failed to fetch ${profile.listenHistoryProvider} artists for ${profile.listenHistoryUsername}: ${e.message}`,
        );
      }
    }

    const recommendationRunStartedAt = new Date().toISOString();
    const discoveryRunId = createDiscoveryRunId();
    const recommendationsArray =
      dbOps.getDiscoveryCache(cacheNamespace).recommendations || [];
    const seedLimit = getDiscoveryRecommendationSeedLimit(
      allLibraryArtists.length + historyArtists.length,
      getLastfmFailureRatio(lastfmHealth),
    );

    applyDiscoveryCacheMetadata(cacheNamespace, {
      recommendationQuality: DISCOVERY_QUALITY_ENRICHING,
      isEnriching: true,
      discoveryRunId,
      enrichmentStartedAt: recommendationRunStartedAt,
      enrichmentProgressMessage: "Finding similar artists and tags",
    });
    if (shouldPublishRefreshState) {
      websocketService.emitDiscoveryUpdate({
        isUpdating: false,
        configured: true,
        phase: "enriching_recommendations",
        progressMessage: "Improving discovery recommendations",
      });
    }

    const feedback = options.feedbackUserId
      ? getDiscoveryFeedback(options.feedbackUserId)
      : [];
    const rustResponse = await runDiscoveryPipelineWithRust({
      recentLibraryArtists,
      allLibraryArtists,
      historyArtists,
      existingArtistKeys,
      includeGlobalTop: false,
      cacheNamespace,
      discoveryRunId,
      recommendationRunStartedAt,
      existingRecommendations: recommendationsArray,
      feedback,
      historyTopArtists: historyArtists
        .slice(0, 3)
        .map((artist) => artist.artistName)
        .filter(Boolean),
      seedLimit,
      libraryMixPromise,
    });
    const rustResult = rustResponse?.result || {};
    const finalizeResult = finalizeDiscoveryEnrichmentResult({
      rustResult,
      discoveryRunId,
      cacheNamespace,
      latestCache: getDiscoveryCache(cacheNamespace),
      recommendationRunStartedAt,
    });

    console.log(
      `[Discovery] ${profile.listenHistoryProvider}:${profile.listenHistoryUsername} refresh complete: ${finalizeResult.recommendationCount} recommendations.`,
    );
    if (shouldPublishRefreshState) {
      websocketService.emitDiscoveryUpdate({
        isUpdating: false,
        configured: true,
        phase: "completed",
        progress: 100,
        progressMessage: "Discovery refresh completed",
      });
    }
    return finalizeResult.enrichedData;
  } catch (error) {
    console.error(
      `[Discovery] Failed to update cache for ${profile.listenHistoryProvider}:${profile.listenHistoryUsername}: ${error.message}`,
    );
    if (shouldPublishRefreshState) {
      websocketService.emitDiscoveryUpdate({
        isUpdating: false,
        configured: true,
        phase: "error",
        progress: 100,
        progressMessage: "Discovery refresh failed",
        error: error.message,
      });
    }
    return null;
  } finally {
    if (shouldPublishRefreshState) {
      discoveryCache.isUpdating = false;
      clearDiscoveryUpdateProgress();
    }
  }
};

export const getUserDiscoveryCacheStaleness = (cacheNamespace) => {
  const data = dbOps.getDiscoveryCache(cacheNamespace);
  if (!data.lastUpdated) return Infinity;
  return Date.now() - new Date(data.lastUpdated).getTime();
};
