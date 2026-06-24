import { dbOps, userOps } from "../config/db-helpers.js";
import { GENRE_KEYWORDS } from "../config/constants.js";
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
  musicbrainzResolveArtistMbidByName,
} from "./apiClients.js";
import { hydrateArtistImages } from "./artistImageHydration.js";
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
  addRecommendationCandidate,
  applyHydratedCandidateTags,
  buildDiscoverySeedList,
  buildExistingArtistKeySet,
  finalizeRecommendationAccumulator,
  filterRecommendationsForServe,
  mergeRetainedRecommendationPool,
  mergeResolvedRecommendations,
  rerankRecommendations,
} from "./discoveryRecommendations.js";
import { logger } from "./logger.js";
import {
  enqueueDiscoveryPlaylistBuildJob,
  enqueueDiscoveryUserRefreshJob,
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


const DISCOVERY_RECOMMENDATIONS_MAX = 500;
const DISCOVERY_RECOMMENDATIONS_DEFAULT = 200;
export const DISCOVERY_QUALITY_INITIAL = "initial";
export const DISCOVERY_QUALITY_ENRICHING = "enriching";
export const DISCOVERY_QUALITY_ENRICHED = "enriched";
const DISCOVERY_NETWORK_CONCURRENCY = 6;
const DISCOVERY_CANDIDATE_MULTIPLIER = 2.5;

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
    Math.max(50, parsed),
  );
};

export const getDiscoveryRecommendationPoolLimit = () =>
  DISCOVERY_RECOMMENDATIONS_MAX;

const getDiscoveryCandidateLimit = () =>
  Math.min(
    getDiscoveryRecommendationPoolLimit(),
    Math.max(
      160,
      Math.ceil(
        getDiscoveryRecommendationsPerRefresh() * DISCOVERY_CANDIDATE_MULTIPLIER,
      ),
    ),
  );

const createDiscoveryRunId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const shrinkByFailureRatio = (base, failureRatio, shrink05, shrink03) => {
  if (failureRatio >= 0.5) return Math.min(shrink05, base);
  if (failureRatio >= 0.3) return Math.min(shrink03, base);
  return base;
};

const getDiscoveryTagSeedLimit = (count, failureRatio) => {
  const target = getDiscoveryRecommendationsPerRefresh();
  const sampleBase = Math.min(
    count,
    Math.max(25, Math.min(45, Math.ceil(target / 5))),
  );
  return shrinkByFailureRatio(sampleBase, failureRatio, 12, 24);
};

const getDiscoveryRecommendationSeedLimit = (count, failureRatio) => {
  const target = getDiscoveryRecommendationsPerRefresh();
  const sampleBase = Math.min(
    count,
    Math.max(32, Math.min(56, Math.ceil(target / 4))),
  );
  return shrinkByFailureRatio(sampleBase, failureRatio, 16, 32);
};

const getSimilarArtistSampling = (failureRatio) => {
  if (failureRatio >= 0.5) {
    return { similarLimit: 12, maxPerSeed: 10 };
  }
  if (failureRatio >= 0.3) {
    return { similarLimit: 20, maxPerSeed: 14 };
  }
  const target = getDiscoveryRecommendationsPerRefresh();
  const maxPerSeed = Math.min(24, Math.max(16, Math.ceil(target / 9)));
  return {
    similarLimit: Math.min(40, Math.max(25, maxPerSeed + 12)),
    maxPerSeed,
  };
};

const getSecondHopArtistSampling = (failureRatio) => {
  if (failureRatio >= 0.5) {
    return { seedLimit: 0, similarLimit: 0, maxPerSeed: 0 };
  }
  if (failureRatio >= 0.3) {
    return { seedLimit: 16, similarLimit: 10, maxPerSeed: 5 };
  }
  const target = getDiscoveryRecommendationsPerRefresh();
  return {
    seedLimit: Math.min(40, Math.max(25, Math.ceil(target / 6))),
    similarLimit: 15,
    maxPerSeed: 8,
  };
};

const getSecondHopRecommendationLimit = () =>
  Math.ceil(getDiscoveryRecommendationsPerRefresh() * 0.35);

const getCandidateTagHydrationLimit = (count, failureRatio, depth = 1) => {
  if (count <= 0) return 0;
  const target = getDiscoveryRecommendationsPerRefresh();
  if (failureRatio >= 0.5) return Math.min(count, depth >= 2 ? 0 : 40);
  if (failureRatio >= 0.3) {
    return Math.min(
      count,
      depth >= 2 ? 24 : Math.max(80, Math.ceil(target * 0.75)),
    );
  }
  return Math.min(
    count,
    depth >= 2
      ? getSecondHopRecommendationLimit()
      : Math.max(target, Math.ceil(target * 1.5)),
  );
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

const buildWeightedTopList = (map, limit) =>
  Array.from(map.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return String(left[0] || "").localeCompare(String(right[0] || ""));
    })
    .slice(0, limit)
    .map(([name]) => name);

const buildTasteProfile = ({
  recentLibraryArtists = [],
  allLibraryArtists = [],
  historyArtists = [],
  tagMap = new Map(),
  tagWeights = new Map(),
  genreWeights = new Map(),
} = {}) => {
  const recentIds = new Set(
    recentLibraryArtists
      .map((artist) =>
        String(artist?.mbid || "")
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean),
  );
  const bucketedLibrarySeeds = [];

  recentLibraryArtists.slice(0, 28).forEach((artist, index) => {
    if (!artist?.mbid || !artist?.artistName) return;
    bucketedLibrarySeeds.push({
      mbid: artist.mbid,
      artistName: artist.artistName,
      source: "library",
      profileBucket: index < 12 ? "recent_interest" : "core_favorites",
      affinityWeight: 1.7 - Math.min(index, 20) * 0.035,
    });
  });

  allLibraryArtists.slice(0, 42).forEach((artist, index) => {
    if (!artist?.mbid || !artist?.artistName) return;
    if (recentIds.has(String(artist.mbid).trim().toLowerCase())) return;
    bucketedLibrarySeeds.push({
      mbid: artist.mbid,
      artistName: artist.artistName,
      source: "library",
      profileBucket: index < 16 ? "collection_anchor" : "exploratory_seed",
      affinityWeight: index < 16 ? 1.12 : 0.92,
    });
  });

  const bucketedHistorySeeds = historyArtists.map((artist, index) => ({
    ...artist,
    source: artist.source || "lastfm",
    profileBucket:
      index < 12
        ? "core_favorites"
        : index < 24
          ? "recent_interest"
          : "exploratory_seed",
    affinityWeight:
      1.35 +
      Math.min(
        1.2,
        Math.log10(Math.max(0, Number(artist.playcount || 0)) + 1) * 0.35,
      ),
  }));

  const profileTagWeights = new Map();
  for (const [tag, weight] of tagWeights.entries()) {
    const normalized = String(tag || "")
      .trim()
      .toLowerCase();
    if (!normalized) continue;
    profileTagWeights.set(normalized, Number(weight || 0));
  }

  return {
    tagMap,
    profileTagWeights,
    topTags: buildWeightedTopList(tagWeights, 20),
    topGenres: buildWeightedTopList(genreWeights, 24),
    historySeeds: bucketedHistorySeeds,
    librarySeeds: bucketedLibrarySeeds,
  };
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

const getLastfmFailureRatio = (health) => {
  const total = health.success + health.failure;
  if (total === 0) return 0;
  return health.failure / total;
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
  discoveryCache.updatePhase = phase || null;
  discoveryCache.updateProgress = normalizedProgress;
  discoveryCache.updateProgressMessage = progressMessage || "";
  websocketService.emitDiscoveryUpdate({
    phase: discoveryCache.updatePhase,
    progress: discoveryCache.updateProgress,
    progressMessage: discoveryCache.updateProgressMessage,
    isUpdating: true,
    configured: true,
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

const recordDiscoverPlaylistBuildProgress = (
  progressMessage = "Updating recommended playlists...",
  extra = {},
) => {
  discoveryCache.playlistsUpdating = true;
  discoveryCache.playlistsUpdateMessage = progressMessage || "";
  websocketService.emitDiscoveryUpdate({
    playlistsUpdating: true,
    playlistsUpdateMessage: progressMessage,
    phase: "playlists_building",
    progress: 98,
    progressMessage,
    isUpdating: false,
    configured: true,
    ...extra,
  });
};

export const clearDiscoverPlaylistBuildProgress = () => {
  discoveryCache.playlistsUpdating = false;
  discoveryCache.playlistsUpdateMessage = null;
};

export const getDiscoveryPlaylistBuildStatus = (cacheNamespace = null) => {
  const buildKey = getDiscoveryPlaylistBuildKey(cacheNamespace);
  const lockHeld = isHonkerLockHeld(`discovery-playlist-build:${buildKey}`);
  const tokenPending = discoveryPlaylistBuildTokens.has(buildKey);
  const cacheFlag = !cacheNamespace && !!discoveryCache.playlistsUpdating;
  const updating = cacheFlag || lockHeld || tokenPending;
  const message = cacheFlag
    ? discoveryCache.playlistsUpdateMessage ||
      "Updating recommended playlists..."
    : "Updating recommended playlists...";
  return {
    playlistsUpdating: updating,
    playlistsUpdateMessage: updating ? message : null,
  };
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
  playlistsUpdating: false,
  playlistsUpdateMessage: null,
};

let discoveryCache = { ...EMPTY_CACHE };

export function resetDiscoveryModuleCache() {
  discoveryCache = { ...EMPTY_CACHE };
}

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

  return discoveryCache;
};

export const isGlobalDiscoveryRefreshInProgress = () =>
  isHonkerLockHeld("discovery-global-refresh");

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
  if (userTopArtists && !userTopArtists.error) lastfmHealth.success++; else lastfmHealth.failure++;

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

const selectDiscoverySeedSample = (seeds, failureRatio) => {
  const sampleSize = getDiscoveryTagSeedLimit(seeds.length, failureRatio);
  return [...seeds].slice(0, sampleSize);
};

const pickLastfmImage = (images) => {
  if (!Array.isArray(images)) return null;
  const image =
    images.find((entry) => entry.size === "extralarge") ||
    images.find((entry) => entry.size === "large") ||
    images.slice(-1)[0];
  if (
    image &&
    image["#text"] &&
    !image["#text"].includes("2a96cbd8b46e442fc41c2b86b821562f")
  ) {
    return image["#text"];
  }
  return null;
};

const formatTrendingPopularity = (artist) => {
  const listeners = parseInt(artist?.listeners || 0, 10) || 0;
  if (listeners > 0) {
    return `${new Intl.NumberFormat("en-US", {
      notation: listeners >= 100000 ? "compact" : "standard",
      maximumFractionDigits: listeners >= 100000 ? 1 : 0,
    }).format(listeners)} listeners on Last.fm`;
  }
  const playcount = parseInt(artist?.playcount || 0, 10) || 0;
  if (playcount > 0) {
    return `${new Intl.NumberFormat("en-US", {
      notation: playcount >= 100000 ? "compact" : "standard",
      maximumFractionDigits: playcount >= 100000 ? 1 : 0,
    }).format(playcount)} plays on Last.fm`;
  }
  const rank = parseInt(artist?.["@attr"]?.rank || artist?.rank || 0, 10) || 0;
  if (rank > 0) {
    return `Trending #${rank} on Last.fm`;
  }
  return "Trending on Last.fm";
};

const buildTrendingArtistEntry = (artist) => {
  const name = String(artist?.name || artist?.["#text"] || "").trim();
  if (!name) return null;
  return {
    id: String(artist?.mbid || "").trim() || null,
    name,
    image: pickLastfmImage(artist?.image),
    type: "Artist",
    popularityLabel: formatTrendingPopularity(artist),
    listeners: parseInt(artist?.listeners || 0, 10) || 0,
    playcount: parseInt(artist?.playcount || 0, 10) || 0,
    popularityRank:
      parseInt(artist?.["@attr"]?.rank || artist?.rank || 0, 10) || null,
  };
};

const wait = (delayMs) =>
  delayMs > 0
    ? new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      })
    : Promise.resolve();

const mapWithConcurrency = async (items, concurrency, worker) => {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Number(concurrency) || 1);
  if (list.length === 0) return [];
  const results = new Array(list.length);
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(limit, list.length) },
    async () => {
      while (nextIndex < list.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(list[index], index);
      }
    },
  );
  await Promise.all(runners);
  return results;
};

const collectSeedTagsAndGenres = async (
  seeds,
  lastfmHealth,
  progressPhase = null,
) => {
  const tagCounts = new Map();
  const genreCounts = new Map();
  const tagMap = new Map();

  if (progressPhase) {
    recordDiscoveryUpdateProgress(progressPhase, "Building genre and tag profile", 35);
  }

  let tagsFound = 0;
  await mapWithConcurrency(
    seeds,
    DISCOVERY_NETWORK_CONCURRENCY,
    async (seed) => {
      try {
        const data = await lastfmRequest(
          "artist.getTopTags",
          seed.mbid ? { mbid: seed.mbid } : { artist: seed.artistName },
        );
        if (data && !data.error) lastfmHealth.success++; else lastfmHealth.failure++;
        if (!data?.toptags?.tag) return;

        const tags = Array.isArray(data.toptags.tag)
          ? data.toptags.tag
          : [data.toptags.tag];
        const names = tags
          .slice(0, 15)
          .map((tag) => String(tag?.name || "").trim())
          .filter(Boolean);
        if (names.length === 0) return;

        const tagMapKey = getSeedTagMapKey(seed);
        if (tagMapKey) {
          tagMap.set(tagMapKey, names);
        }
        tagsFound += 1;

        for (const tag of tags.slice(0, 15)) {
          const name = String(tag?.name || "").trim();
          if (!name) continue;
          const tagWeight = parseInt(tag?.count || 0, 10) || 1;
          tagCounts.set(
            name,
            (tagCounts.get(name) || 0) +
              tagWeight * Math.max(0.5, seed.weight || 1),
          );
          const normalized = name.toLowerCase();
          if (GENRE_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
            genreCounts.set(
              name,
              (genreCounts.get(name) || 0) +
                Math.max(1, Math.round(tagWeight / 25)) *
                  Math.max(0.5, seed.weight || 1),
            );
          }
        }
      } catch (error) {
        logger.warn(
          'discovery',
          `Failed to get Last.fm tags for ${seed.artistName}: ${error.message}`,
        );
      }
    },
  );

  return {
    tagMap,
    tagWeights: tagCounts,
    genreWeights: genreCounts,
    tagsFound,
    topTags: buildWeightedTopList(tagCounts, 20),
    topGenres: buildWeightedTopList(genreCounts, 24),
  };
};

const getSeedTagMapKey = (seed) =>
  String(seed?.mbid || seed?.id || seed?.artistName || seed?.name || "")
    .trim()
    .toLowerCase();

const normalizeSeedTagList = (tags) =>
  (Array.isArray(tags) ? tags : [])
    .slice(0, 15)
    .map((tag) => String(tag || "").trim())
    .filter(Boolean);

const fetchArtistTagNames = async (artist, lastfmHealth) => {
  const artistName = String(artist?.name || artist?.artistName || "").trim();
  const mbid = String(artist?.id || artist?.mbid || "").trim();
  if (!artistName && !mbid) return [];

  const data = await lastfmRequest(
    "artist.getTopTags",
    mbid ? { mbid } : { artist: artistName },
  );
  if (data && !data.error) lastfmHealth.success++; else lastfmHealth.failure++;
  if (!data?.toptags?.tag) return [];

  const tags = Array.isArray(data.toptags.tag)
    ? data.toptags.tag
    : [data.toptags.tag];
  return normalizeSeedTagList(tags.map((tag) => tag?.name));
};

const INHERITED_TAG_MINIMUM = 3;

const canInheritTagsFromSeeds = (item) => {
  if (item.candidateTagsHydrated && item.tagSource === "lastfm_artist") return false;
  const seedTagCount = Array.isArray(item.tags) ? item.tags.length : 0;
  return seedTagCount >= INHERITED_TAG_MINIMUM;
};

export { canInheritTagsFromSeeds, INHERITED_TAG_MINIMUM };

const hydrateRecommendationCandidateTags = async ({
  recommendations = [],
  lastfmHealth,
  profileTagWeights,
  limit,
  depth = 1,
}) => {
  const items = Array.isArray(recommendations) ? [...recommendations] : [];
  const hydrationLimit = Math.min(items.length, Math.max(0, Number(limit) || 0));
  if (hydrationLimit <= 0) return items;

  const batchSize = 8;
  const delayMs = 25;
  for (let index = 0; index < hydrationLimit; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const hydrated = await Promise.all(
      batch.map(async (item) => {
        try {
          if (canInheritTagsFromSeeds(item)) {
            return applyHydratedCandidateTags(item, item.tags, profileTagWeights, {
              tagAffinityMultiplier: depth >= 2 ? 0.55 : 1,
              source: "inherited",
            });
          }
          const tags = await fetchArtistTagNames(item, lastfmHealth);
          return applyHydratedCandidateTags(item, tags, profileTagWeights, {
            tagAffinityMultiplier: depth >= 2 ? 0.55 : 1,
          });
        } catch (error) {
          logger.warn(
            'discovery',
            `Failed to hydrate candidate tags for ${item?.name || "artist"}: ${error.message}`,
          );
          return item;
        }
      }),
    );
    hydrated.forEach((item, offset) => {
      items[index + offset] = item;
    });
    if (index + batchSize < hydrationLimit) {
      await wait(delayMs);
    }
  }

  return items;
};

const resolveRecommendationCandidates = async (
  recommendations,
  existingArtistKeys,
  maxResolve,
  options = {},
) => {
  const resolveLimit =
    options.resolveLimit != null
      ? Math.max(0, Number(options.resolveLimit) || 0)
      : Math.max(maxResolve, getDiscoveryRecommendationsPerRefresh() * 3);
  const requireResolved = options.requireResolved !== false;
  const shortlist = recommendations.slice(
    0,
    Math.min(recommendations.length, resolveLimit),
  );

  await mapWithConcurrency(
    shortlist,
    DISCOVERY_NETWORK_CONCURRENCY,
    async (item) => {
      if (item?.id || !item?.name) return;
      const cached = musicbrainzGetCachedArtistMbidByName(item.name);
      const resolved =
        cached || (await musicbrainzResolveArtistMbidByName(item.name));
      if (!resolved) return;
      item.id = resolved;
      item.navigateTo = resolved;
    },
  );

  const merged = mergeResolvedRecommendations(
    recommendations,
    existingArtistKeys,
  )
    .filter((item) => !requireResolved || item?.id || item?.navigateTo)
    .sort((left, right) => {
      if (
        (right.scoreTotal || right.score || 0) !==
        (left.scoreTotal || left.score || 0)
      ) {
        return (
          (right.scoreTotal || right.score || 0) -
          (left.scoreTotal || left.score || 0)
        );
      }
      if ((right.seedCount || 0) !== (left.seedCount || 0)) {
        return (right.seedCount || 0) - (left.seedCount || 0);
      }
      return String(left.name || "").localeCompare(String(right.name || ""));
    });

  return merged.slice(
    0,
    Math.max(120, getDiscoveryRecommendationsPerRefresh() * 2),
  );
};

const buildRecommendationsFromSeeds = async ({
  seeds,
  existingArtistKeys,
  lastfmHealth,
  profileTagWeights,
  seedTagMap = new Map(),
  discoveryMode,
  includeCandidateTagHydration = true,
  includeSecondHop = true,
}) => {
  const directRecommendations = new Map();
  const { similarLimit, maxPerSeed } = getSimilarArtistSampling(
    getLastfmFailureRatio(lastfmHealth),
  );

  console.time('[Discovery] 1st-hop similar artist fetches');
  await mapWithConcurrency(
    seeds,
    DISCOVERY_NETWORK_CONCURRENCY,
    async (seed) => {
      try {
        const seedTagKey = getSeedTagMapKey(seed);
        let sourceTags = normalizeSeedTagList(seedTagMap.get(seedTagKey));
        if (sourceTags.length > 0) {
          lastfmHealth.success++;
        } else {
          const tagData = await lastfmRequest(
            "artist.getTopTags",
            seed.mbid ? { mbid: seed.mbid } : { artist: seed.artistName },
          );
          if (tagData && !tagData.error) lastfmHealth.success++; else lastfmHealth.failure++;
          if (tagData?.toptags?.tag) {
            const tags = Array.isArray(tagData.toptags.tag)
              ? tagData.toptags.tag
              : [tagData.toptags.tag];
            sourceTags = normalizeSeedTagList(
              tags.map((tag) => tag?.name),
            );
          }
        }

        const similar = await lastfmRequest(
          "artist.getSimilar",
          seed.mbid
            ? { mbid: seed.mbid, limit: similarLimit }
            : { artist: seed.artistName, limit: similarLimit },
        );
        if (similar && !similar.error) lastfmHealth.success++; else lastfmHealth.failure++;
        if (!similar?.similarartists?.artist) return;

        const artists = Array.isArray(similar.similarartists.artist)
          ? similar.similarartists.artist
          : [similar.similarartists.artist];
        for (const artist of artists.slice(0, maxPerSeed)) {
          addRecommendationCandidate(directRecommendations, {
            candidate: {
              mbid: artist?.mbid,
              name: artist?.name,
              image: pickLastfmImage(artist?.image),
              match: artist?.match,
              discoveryDepth: 1,
            },
            seed,
            sourceTags,
            profileTagWeights,
            existingArtistKeys,
          });
        }
      } catch (error) {
        logger.warn(
          'discovery',
          `Error getting similar artists for ${seed.artistName}: ${error.message}`,
        );
      }
    },
  );
  console.timeEnd('[Discovery] 1st-hop similar artist fetches');

  const candidateLimit = getDiscoveryCandidateLimit();
  let directList = finalizeRecommendationAccumulator(
    directRecommendations,
    candidateLimit,
    { discoveryMode },
  );
  if (includeCandidateTagHydration) {
    console.time('[Discovery] 1st-hop tag hydration');
    directList = await hydrateRecommendationCandidateTags({
      recommendations: directList,
      lastfmHealth,
      profileTagWeights,
      limit: getCandidateTagHydrationLimit(
        directList.length,
        getLastfmFailureRatio(lastfmHealth),
        1,
      ),
      depth: 1,
    });
    console.timeEnd('[Discovery] 1st-hop tag hydration');
  }
  directList = rerankRecommendations(directList, candidateLimit, {
    discoveryMode,
  });

  if (!includeSecondHop) {
    return directList;
  }

  const secondHopSampling = getSecondHopArtistSampling(
    getLastfmFailureRatio(lastfmHealth),
  );
  if (secondHopSampling.seedLimit <= 0 || directList.length === 0) {
    return directList;
  }

  const secondHopRecommendations = new Map();
  const bridgeSeeds = directList
    .filter((candidate) => candidate?.name)
    .filter((candidate) => {
      const tags = Array.isArray(candidate.matchedTags)
        ? candidate.matchedTags
        : candidate.tags || [];
      return tags.length > 0;
    })
    .slice(0, secondHopSampling.seedLimit);

  console.time('[Discovery] 2nd-hop similar artist fetches');
  await mapWithConcurrency(
    bridgeSeeds,
    DISCOVERY_NETWORK_CONCURRENCY,
    async (bridge) => {
      try {
        const bridgeTags = normalizeSeedTagList(
          bridge.matchedTags?.length ? bridge.matchedTags : bridge.tags,
        );
        if (bridgeTags.length === 0) return;

        const bridgeWeight = Math.min(
          0.78,
          Math.max(
            0.45,
            0.42 +
              Number(bridge.bestMatch || 0) * 0.25 +
              Math.min(Number(bridge.seedCount || 0), 3) * 0.04,
          ),
        );
        const bridgeSeed = {
          mbid: bridge.id || bridge.mbid || null,
          artistName: bridge.name,
          source: "lastfm_related",
          profileBucket: "two_hop_bridge",
          weight: bridgeWeight,
          affinityWeight: bridgeWeight,
          discoveryDepth: 2,
          similarityMultiplier: 0.55,
          tagAffinityMultiplier: 0.55,
        };
        const similar = await lastfmRequest(
          "artist.getSimilar",
          bridgeSeed.mbid
            ? { mbid: bridgeSeed.mbid, limit: secondHopSampling.similarLimit }
            : {
                artist: bridgeSeed.artistName,
                limit: secondHopSampling.similarLimit,
              },
        );
        if (similar && !similar.error) lastfmHealth.success++; else lastfmHealth.failure++;
        if (!similar?.similarartists?.artist) return;

        const artists = Array.isArray(similar.similarartists.artist)
          ? similar.similarartists.artist
          : [similar.similarartists.artist];
        for (const artist of artists.slice(0, secondHopSampling.maxPerSeed)) {
          addRecommendationCandidate(secondHopRecommendations, {
            candidate: {
              mbid: artist?.mbid,
              name: artist?.name,
              image: pickLastfmImage(artist?.image),
              match: artist?.match,
              discoveryDepth: 2,
              similarityMultiplier: 0.55,
              tagAffinityMultiplier: 0.55,
            },
            seed: bridgeSeed,
            sourceTags: bridgeTags,
            profileTagWeights,
            existingArtistKeys,
          });
        }
      } catch (error) {
        logger.warn(
          'discovery',
          `Error getting second-hop similar artists for ${bridge.name}: ${error.message}`,
        );
      }
    },
  );
  console.timeEnd('[Discovery] 2nd-hop similar artist fetches');

  let secondHopList = finalizeRecommendationAccumulator(
    secondHopRecommendations,
    getSecondHopRecommendationLimit(),
    { discoveryMode },
  );
  console.time('[Discovery] 2nd-hop tag hydration');
  secondHopList = await hydrateRecommendationCandidateTags({
    recommendations: secondHopList,
    lastfmHealth,
    profileTagWeights,
    limit: getCandidateTagHydrationLimit(
      secondHopList.length,
      getLastfmFailureRatio(lastfmHealth),
      2,
    ),
    depth: 2,
  });
  console.timeEnd('[Discovery] 2nd-hop tag hydration');
  secondHopList = rerankRecommendations(
    secondHopList,
    getSecondHopRecommendationLimit(),
    { discoveryMode },
  );
  if (secondHopList.length === 0) {
    console.timeEnd('[Discovery] buildRecommendationsFromSeeds total');
    return directList;
  }

  const result = rerankRecommendations(
    mergeResolvedRecommendations(
      [...directList, ...secondHopList],
      existingArtistKeys,
    ),
    candidateLimit,
    { discoveryMode },
  );
  console.timeEnd('[Discovery] buildRecommendationsFromSeeds total');
  return result;
};

const discoveryPlaylistBuildTokens = new Map();

const getDiscoveryPlaylistBuildKey = (cacheNamespace = null) =>
  String(cacheNamespace || "global");

const buildDiscoveryUpdatePayload = (
  discoveryData,
  {
    phase = "completed",
    progress = 100,
    progressMessage = "Discovery refresh completed",
  } = {},
) => {
  if (phase === "playlists_completed") {
    clearDiscoverPlaylistBuildProgress();
  }
  return {
    recommendations: discoveryData.recommendations || [],
    globalTop: discoveryData.globalTop || [],
    basedOn: discoveryData.basedOn || [],
    topTags: discoveryData.topTags || [],
    topGenres: discoveryData.topGenres || [],
    fallbackGenres: discoveryData.fallbackGenres || [],
    discoverPlaylists: discoveryData.discoverPlaylists || [],
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
    isUpdating: false,
    configured: true,
    phase,
    progress,
    progressMessage,
    discoveryMode: getDiscoveryMode(),
    ...(phase === "playlists_completed"
      ? { playlistsUpdating: false, playlistsUpdateMessage: null }
      : {}),
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

export async function runQueuedDiscoverPlaylistBuild(payload = {}) {
  const cacheNamespace = String(payload?.cacheNamespace || "").trim() || null;
  const buildKey = getDiscoveryPlaylistBuildKey(cacheNamespace);
  const buildToken = String(payload?.buildToken || "").trim();
  const activeToken = discoveryPlaylistBuildTokens.get(buildKey);
  if (activeToken && buildToken && activeToken !== buildToken) {
    return { skipped: true, reason: "stale_build" };
  }
  if (!getLastfmApiKey()) {
    return { skipped: true, reason: "lastfm_not_configured" };
  }

  return withHonkerLock(
    `discovery-playlist-build:${buildKey}`,
    async () => {
      const lockedToken = discoveryPlaylistBuildTokens.get(buildKey);
      if (lockedToken && buildToken && lockedToken !== buildToken) {
        return { skipped: true, reason: "stale_build" };
      }
      try {
        const baseDiscoveryData = getDiscoveryCache(cacheNamespace);
        if (
          baseDiscoveryData.recommendations.length === 0 &&
          baseDiscoveryData.globalTop.length === 0
        ) {
          return { skipped: true, reason: "empty_discovery_data" };
        }

        if (payload?.publishUpdate !== false) {
          recordDiscoverPlaylistBuildProgress("Building recommended playlists...");
        }

        const allLibraryArtistsRaw = await libraryManager.getAllArtists();
        const allLibraryArtists = Array.isArray(allLibraryArtistsRaw)
          ? allLibraryArtistsRaw
          : [];
        const existingArtistKeys = buildExistingArtistKeySet(allLibraryArtists);
        const { generateDiscoverPlaylists } =
          await import("./discoverPlaylistService.js");
        const discoverPlaylists = await generateDiscoverPlaylists({
          listenHistoryProfile: payload?.listenHistoryProfile || null,
          discoveryCache: baseDiscoveryData,
          basedOn: baseDiscoveryData.basedOn,
          topGenres: baseDiscoveryData.topGenres,
          topTags: baseDiscoveryData.topTags,
          recommendations: baseDiscoveryData.recommendations,
          globalTop: baseDiscoveryData.globalTop,
          libraryArtists: allLibraryArtists,
          libraryArtistKeys: existingArtistKeys,
          historyTopArtists: normalizePlaylistBuildStringList(
            payload?.historyTopArtists,
            3,
          ),
        });

        const currentToken = discoveryPlaylistBuildTokens.get(buildKey);
        if (currentToken && buildToken && currentToken !== buildToken) {
          return { skipped: true, reason: "stale_build" };
        }

        const playlistData = { discoverPlaylists };
        if (!cacheNamespace) {
          discoveryCache.discoverPlaylists = discoverPlaylists;
        }
        dbOps.updateDiscoveryCache(playlistData, cacheNamespace);

        if (payload?.publishUpdate !== false) {
          emitDiscoveryDataUpdate(
            {
              ...baseDiscoveryData,
              discoverPlaylists,
            },
            {
              phase: "playlists_completed",
              progressMessage: "Discover playlists updated",
            },
          );
        }
        return { built: true, playlistCount: discoverPlaylists.length };
      } finally {
        if (discoveryPlaylistBuildTokens.get(buildKey) === buildToken) {
          discoveryPlaylistBuildTokens.delete(buildKey);
        }
      }
    },
    {
      ttlSeconds: 300,
      waitTimeoutMs: 30 * 60 * 1000,
      retryDelayMs: 500,
    },
  );
}

export function emitDiscoverPlaylistBuildFailure(payload = {}, error) {
  if (payload?.publishUpdate === false) return;
  const message = error?.message || String(error || "Unknown error");
  clearDiscoverPlaylistBuildProgress();
  websocketService.emitDiscoveryUpdate({
    isUpdating: false,
    playlistsUpdating: false,
    playlistsUpdateMessage: null,
    configured: true,
    phase: "playlists_error",
    progress: 100,
    progressMessage: "Discover playlists failed to update",
    error: message,
  });
}

const scheduleDiscoverPlaylistBuild = ({
  cacheNamespace = null,
  listenHistoryProfile = null,
  historyTopArtists = [],
  publishUpdate = true,
} = {}) => {
  if (!getLastfmApiKey()) return;

  const buildKey = getDiscoveryPlaylistBuildKey(cacheNamespace);
  const buildToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  discoveryPlaylistBuildTokens.set(buildKey, buildToken);

  const payload = {
    cacheNamespace,
    buildToken,
    publishUpdate,
    requestedAt: Date.now(),
    listenHistoryProfile,
    historyTopArtists: normalizePlaylistBuildStringList(historyTopArtists, 3),
  };

  enqueueDiscoveryPlaylistBuildJob(payload);
  if (publishUpdate) {
    recordDiscoverPlaylistBuildProgress("Updating recommended playlists...");
  }
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
  logger.info('discovery', "Starting background update of discovery recommendations...");
  recordDiscoveryUpdateProgress("starting", "Preparing discovery refresh", 5);
    import("./aurralHistoryService.js")
      .then(({ recordDiscoveryRefreshStarted }) =>
        recordDiscoveryRefreshStarted(),
      )
      .catch((err) => { logger.warn('discovery', err); });

  try {
    console.time('[Discovery] TOTAL global refresh');
    const { libraryManager } = await import("./libraryManager.js");
    recordDiscoveryUpdateProgress("loading_sources", "Loading library artists", 12);
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
    logger.info('discovery', `Found ${allLibraryArtists.length} artists in library.`);

    const hasLastfmKey = !!getLastfmApiKey();
    const lastfmHealth = { success: 0, failure: 0 };

    if (!hasLastfmKey) {
      logger.info(
        'discovery',
        "No Last.fm API key configured. Building ListenBrainz fallback discovery.",
      );
      recordDiscoveryUpdateProgress(
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
          recordDiscoveryUpdateProgress(phase, progressMessage, progress, {
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

    recordDiscoveryUpdateProgress(
      "collecting_seeds",
      "Collecting recommendation seed artists",
      20,
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
        logger.warn(
          'discovery',
          `[Discovery] Failed to load default listening history for ${defaultListenHistoryProfile.listenHistoryUsername}: ${error.message}`,
        );
      }
    }

    const profileSampleSeedCount = selectDiscoverySeedSample(
      buildDiscoverySeedList({
        libraryArtists: libraryArtists.map((a) => ({
          mbid: a.mbid,
          artistName: a.artistName,
          source: "library",
        })),
        historyArtists,
      }),
      getLastfmFailureRatio(lastfmHealth),
    ).length;
    const existingArtistKeys = buildExistingArtistKeySet(allLibraryArtists);

    const provisionalSeeds = buildDiscoverySeedList({
      libraryArtists: libraryArtists.map((a) => ({
        mbid: a.mbid,
        artistName: a.artistName,
        source: "library",
      })),
      historyArtists,
    });
    const profileSample = provisionalSeeds.slice(0, profileSampleSeedCount);

    logger.info(
      'discovery',
      `Sampling tags/genres from ${profileSample.length} artists (${libraryArtists.length} library, ${historyArtists.length} history)...`,
    );
    console.time('[Discovery] seed tag collection');
    const { tagsFound, topTags, topGenres, tagMap, tagWeights, genreWeights } =
      getLastfmApiKey()
        ? await collectSeedTagsAndGenres(
            profileSample,
            lastfmHealth,
            "building_genres",
          )
        : {
            tagsFound: 0,
            topTags: [],
            topGenres: [],
            tagMap: new Map(),
            tagWeights: new Map(),
            genreWeights: new Map(),
          };
    const tasteProfile = buildTasteProfile({
      recentLibraryArtists,
      allLibraryArtists,
      historyArtists,
      tagMap,
      tagWeights,
      genreWeights,
    });
    const seeds = buildDiscoverySeedList({
      libraryArtists: tasteProfile.librarySeeds,
      historyArtists: tasteProfile.historySeeds,
    });
    logger.info(
      'discovery',
      `Found tags for ${tagsFound} out of ${profileSample.length} artists`,
    );
    console.timeEnd('[Discovery] seed tag collection');
    discoveryCache.topTags =
      tasteProfile.topTags.length > 0 ? tasteProfile.topTags : topTags;
    discoveryCache.topGenres =
      tasteProfile.topGenres.length > 0 ? tasteProfile.topGenres : topGenres;

    logger.info(
      'discovery',
      `Identified Top Genres: ${discoveryCache.topGenres.join(", ")}`,
    );

    if (getLastfmApiKey()) {
      logger.info('discovery', "Fetching Global Trending (real-time style) from Last.fm...");
      console.time('[Discovery] trending fetch');
      recordDiscoveryUpdateProgress(
        "fetching_trending",
        "Fetching global trending artists",
        50,
      );
      try {
        const trendingArtists = [];
        const trackData = await lastfmRequest("chart.getTopTracks", {
          limit: getLastfmFailureRatio(lastfmHealth) >= 0.3 ? 60 : 100,
        });
        if (trackData && !trackData.error) lastfmHealth.success++; else lastfmHealth.failure++;
        if (trackData?.tracks?.track) {
          const tracks = Array.isArray(trackData.tracks.track)
            ? trackData.tracks.track
            : [trackData.tracks.track];
          for (const track of tracks) {
            const artist = buildTrendingArtistEntry(track?.artist);
            if (!artist) continue;
            if (!artist.image) {
              artist.image = pickLastfmImage(track?.image);
            }
            const trackName = String(track?.name || "").trim();
            if (trackName) {
              artist.sampleTrack = {
                trackName,
                albumName:
                  String(
                    track?.album?.title || track?.album?.["#text"] || "",
                  ).trim() || null,
              };
            }
            trendingArtists.push(artist);
          }
        }
        let globalTop = mergeResolvedRecommendations(
          trendingArtists,
          existingArtistKeys,
        ).slice(0, 32);
        if (globalTop.length < 12) {
          const topData = await lastfmRequest("chart.getTopArtists", {
            limit: getLastfmFailureRatio(lastfmHealth) >= 0.3 ? 60 : 100,
          });
          if (topData && !topData.error) lastfmHealth.success++; else lastfmHealth.failure++;
          if (topData?.artists?.artist) {
            const topArtists = Array.isArray(topData.artists.artist)
              ? topData.artists.artist
              : [topData.artists.artist];
            globalTop = mergeResolvedRecommendations(
              [
                ...globalTop,
                ...topArtists.map(buildTrendingArtistEntry).filter(Boolean),
              ],
              existingArtistKeys,
            ).slice(0, 32);
          }
        }

        const globalFailureRatio = getLastfmFailureRatio(lastfmHealth);
        const maxGlobalResolve =
          globalFailureRatio >= 0.5 ? 10 : globalFailureRatio >= 0.3 ? 18 : 30;
        await mapWithConcurrency(
          globalTop.slice(0, maxGlobalResolve),
          DISCOVERY_NETWORK_CONCURRENCY,
          async (item) => {
            if (!item?.name || item?.id) return;
            const resolved =
              musicbrainzGetCachedArtistMbidByName(item.name) ||
              (await musicbrainzResolveArtistMbidByName(item.name));
            if (!resolved) return;
            item.id = resolved;
            item.navigateTo = resolved;
          },
        );

        discoveryCache.globalTop = mergeResolvedRecommendations(
          globalTop,
          existingArtistKeys,
        )
          .filter((item) => item?.id || item?.navigateTo)
          .slice(0, 32);
        logger.info(
          'discovery',
          `Found ${discoveryCache.globalTop.length} trending artists (from top tracks).`,
        );
      } catch (e) {
        logger.error('discovery', `Failed to fetch Global Top: ${e.message}`);
      }
      console.timeEnd('[Discovery] trending fetch');
    }

    const recSample = seeds.slice(
      0,
      getDiscoveryRecommendationSeedLimit(
        seeds.length,
        getLastfmFailureRatio(lastfmHealth),
      ),
    );
    const recommendationRunStartedAt = new Date().toISOString();
    const discoveryRunId = createDiscoveryRunId();

    logger.info(
      'discovery',
      `Generating recommendations based on ${recSample.length} seed artists...`,
    );
    console.time('[Discovery] buildRecommendationsFromSeeds total');
    recordDiscoveryUpdateProgress(
      "generating_recommendations",
      "Generating personalized recommendations",
      65,
    );

    let recommendationsArray = [];
    if (getLastfmApiKey()) {
      const rawRecommendations = await buildRecommendationsFromSeeds({
        seeds: recSample,
        existingArtistKeys,
        lastfmHealth,
        profileTagWeights: tasteProfile.profileTagWeights,
        seedTagMap: tagMap,
        discoveryMode: getDiscoveryMode(),
        includeCandidateTagHydration: true,
        includeSecondHop: true,
      });
      const recommendationFailureRatio = getLastfmFailureRatio(lastfmHealth);
      const maxResolve =
        recommendationFailureRatio >= 0.5
          ? 12
          : recommendationFailureRatio >= 0.3
            ? 24
            : 40;
      recommendationsArray = await resolveRecommendationCandidates(
        rawRecommendations,
        existingArtistKeys,
        maxResolve,
        {
          resolveLimit: Math.max(
            maxResolve,
            getDiscoveryRecommendationsPerRefresh(),
          ),
        },
      );
      const freshRecommendations = rerankCachedRecommendations({
        recommendations: recommendationsArray,
        discoveryMode: getDiscoveryMode(),
        limit: getDiscoveryRecommendationsPerRefresh(),
      });
      recommendationsArray = mergeRetainedRecommendationPool({
        freshRecommendations,
        existingRecommendations: discoveryCache.recommendations || [],
        existingArtistKeys,
        limit: getDiscoveryRecommendationPoolLimit(),
        runStartedAt: recommendationRunStartedAt,
        discoveryMode: getDiscoveryMode(),
        feedback: getDiscoveryFeedback("global"),
      });

      console.time('[Discovery] image hydration');
      await hydrateArtistImages(recommendationsArray, {
        limit: recommendationsArray.length,
        batchSize: 6,
        delayMs: 50,
      });
      console.timeEnd('[Discovery] image hydration');
    } else {
      logger.warn('discovery', "Last.fm API key required for similar artist discovery.");
    }

    logger.info(
      'discovery',
      `Generated ${recommendationsArray.length} total recommendations.`,
    );

    const discoveryData = {
      provider: DISCOVERY_PROVIDER_LASTFM,
      capabilities: getDiscoveryCapabilities(true),
      recommendations: recommendationsArray,
      basedOn: recSample.map((a) => ({
        name: a.artistName,
        id: a.mbid,
        source: a.source || "library",
        profileBucket: a.profileBucket || null,
      })),
      topTags: discoveryCache.topTags || [],
      topGenres: discoveryCache.topGenres || [],
      globalTop: discoveryCache.globalTop || [],
      fallbackGenres: [],
      fallbackGenrePools: {},
      discoverPlaylists: discoveryCache.discoverPlaylists || [],
      lastUpdated: recommendationRunStartedAt,
      recommendationQuality: DISCOVERY_QUALITY_ENRICHED,
      isEnriching: false,
      discoveryRunId,
      enrichmentStartedAt: null,
      enrichmentCompletedAt: recommendationRunStartedAt,
      enrichmentProgressMessage: null,
    };

    Object.assign(discoveryCache, discoveryData, { isUpdating: false });
    dbOps.updateDiscoveryCache(discoveryData);
    recordDiscoveryUpdateProgress(
      "saving_results",
      "Saving discovery recommendations",
      96,
    );
    const { notifyDiscoveryUpdated } = await import("./notificationService.js");
    notifyDiscoveryUpdated().catch((err) =>
      logger.warn('discovery', "[Discovery] Notification failed:", err.message),
    );
    logger.info(
      'discovery',
      `Discovery data written to database: ${discoveryData.recommendations.length} recommendations, ${discoveryData.topGenres.length} genres, ${discoveryData.globalTop.length} trending`,
    );

    logger.info('discovery', "Discovery cache updated successfully.");
    logger.info(
      'discovery',
      `Summary: ${recommendationsArray.length} recommendations, ${discoveryCache.topGenres.length} genres, ${discoveryCache.globalTop.length} trending artists`,
    );
    discoveryCache.isUpdating = false;
    clearDiscoveryUpdateProgress();

    if (listeningHistoryUsersConfigured) {
      emitDiscoveryDataUpdate(discoveryData, {
        progressMessage: "Discovery refresh completed",
      });
      const queuedUserRefreshes = enqueueListeningHistoryUserRefreshes({
        reason: "global_refresh_completed",
      });
      if (queuedUserRefreshes > 0) {
        logger.info(
          'discovery',
          `[Discovery] Queued ${queuedUserRefreshes} per-user refresh${
            queuedUserRefreshes === 1 ? "" : "es"
          } after global refresh.`,
        );
      }
    } else {
      scheduleDiscoverPlaylistBuild({
        historyTopArtists: historyArtists
          .slice(0, 3)
          .map((artist) => artist.artistName)
          .filter(Boolean),
      });
      emitDiscoveryDataUpdate(discoveryData, {
        progressMessage: "Discovery refresh completed",
      });
    }

    const { recordDiscoveryUpdated } =
      await import("./aurralHistoryService.js");
    recordDiscoveryUpdated({
      recommendationCount: discoveryData.recommendations?.length || 0,
      genreCount: discoveryData.topGenres?.length || 0,
    });

    try {
      const cleaned = dbOps.cleanOldImageCache(30);
      if (cleaned?.changes > 0) {
        logger.info(
          'discovery',
          `[Discovery] Cleaned ${cleaned.changes} old image cache entries`,
        );
      }
      dbOps.cleanOldMusicbrainzArtistMbidCache(90);
    } catch (e) {
      logger.warn('discovery', "[Discovery] Failed to clean old image cache:", e.message);
    }
  } catch (error) {
    logger.error('discovery', "Failed to update discovery cache:", error.message);
    logger.error('discovery', "Stack trace:", error.stack);
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
      .catch((err) => { logger.warn('discovery', err); });
  } finally {
    if (pendingUserDiscoveryProfiles.size > 0) {
      const queuedUserRefreshes = enqueueListeningHistoryUserRefreshes({
        reason: "global_refresh_finished",
      });
      if (queuedUserRefreshes > 0) {
        logger.info(
          'discovery',
          `[Discovery] Queued ${queuedUserRefreshes} deferred per-user refresh${
            queuedUserRefreshes === 1 ? "" : "es"
          }.`,
        );
      }
    }
    console.timeEnd('[Discovery] TOTAL global refresh');
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
  logger.info(
    'discovery',
    `[Discovery] Starting per-user refresh for ${profile.listenHistoryProvider} user ${profile.listenHistoryUsername}...`,
  );

  if (shouldPublishRefreshState) {
    discoveryCache.isUpdating = true;
    recordDiscoveryUpdateProgress(
      "generating_recommendations",
      "Personalizing discovery recommendations",
      35,
    );
  }

  try {
    const allLibraryArtistsRaw = await libraryManager.getAllArtists();
    const allLibraryArtists = Array.isArray(allLibraryArtistsRaw)
      ? allLibraryArtistsRaw
      : [];
    const existingArtistKeys = buildExistingArtistKeySet(allLibraryArtists);

    const lastfmHealth = { success: 0, failure: 0 };
    const discoveryPeriod = getLastfmDiscoveryPeriod();
    const historyArtists = [];

    if (discoveryPeriod !== "none") {
      logger.info(
        'discovery',
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
        logger.info(
          'discovery',
          `[Discovery] Found ${historyArtists.length} ${profile.listenHistoryProvider} artists for ${profile.listenHistoryUsername}.`,
        );
      } catch (e) {
        logger.error(
          'discovery',
          `[Discovery] Failed to fetch ${profile.listenHistoryProvider} artists for ${profile.listenHistoryUsername}: ${e.message}`,
        );
      }
    }

    const recommendationRunStartedAt = new Date().toISOString();
    const discoveryRunId = createDiscoveryRunId();
    const feedback = options.feedbackUserId
      ? getDiscoveryFeedback(options.feedbackUserId)
      : [];

    const globalCache = getDiscoveryCache();
    const globalPool = globalCache.recommendations || [];
    const globalTop = globalCache.globalTop || [];
    const globalTopTags = globalCache.topTags || [];
    const globalTopGenres = globalCache.topGenres || [];

    if (globalPool.length === 0) {
      logger.info(
        'discovery',
        `[Discovery] Per-user refresh skipped for ${profile.listenHistoryUsername}: global pool is empty.`,
      );
      if (shouldPublishRefreshState) {
        discoveryCache.isUpdating = false;
        websocketService.emitDiscoveryUpdate({
          isUpdating: false,
          phase: "completed",
          progress: 100,
          progressMessage: "Discovery refresh completed (global pool unavailable)",
        });
      }
      return null;
    }

    let recommendationsArray = [];
    recommendationsArray = rerankCachedRecommendations({
      freshRecommendations: recommendationsArray,
      existingRecommendations:
        dbOps.getDiscoveryCache(cacheNamespace).recommendations || [],
      existingArtistKeys,
      limit: getDiscoveryRecommendationPoolLimit(),
      runStartedAt: recommendationRunStartedAt,
      discoveryMode: getDiscoveryMode(),
      feedback,
    });

    await hydrateArtistImages(recommendationsArray, {
      limit: recommendationsArray.length,
      batchSize: 6,
      delayMs: 50,
    });

    const basedOnArtists = historyArtists
      .map((artist) => ({
        name: artist.artistName,
        id: artist.mbid,
        source: artist.source || profile.listenHistoryProvider,
        profileBucket: null,
      }));
    const userData = {
      recommendations: recommendationsArray,
      basedOn: basedOnArtists,
      topTags: globalTopTags,
      topGenres: globalTopGenres,
      recommendationQuality: DISCOVERY_QUALITY_ENRICHED,
      isEnriching: false,
      discoveryRunId,
      enrichmentStartedAt: null,
      enrichmentCompletedAt: recommendationRunStartedAt,
      enrichmentProgressMessage: null,
    };

    dbOps.updateDiscoveryCache(userData, cacheNamespace);
    scheduleDiscoverPlaylistBuild({
      cacheNamespace,
      listenHistoryProfile: profile,
      historyTopArtists: historyArtists
        .slice(0, 3)
        .map((artist) => artist.artistName)
        .filter(Boolean),
    });
    logger.info(
      'discovery',
      `[Discovery] ${profile.listenHistoryProvider}:${profile.listenHistoryUsername} refresh complete: ${recommendationsArray.length} recommendations from global pool.`,
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
    return userData;
  } catch (error) {
    logger.error(
      'discovery',
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
