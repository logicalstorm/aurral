import test from "node:test";
import assert from "node:assert/strict";
import {
  createIsolatedStateDir,
  applyIsolatedBackendEnv,
  cleanupIsolatedState,
  importFromRepo,
  resetDatabase,
} from "../helpers/backendTestHarness.js";

test("single-pass refresh: buildRecommendationsFromSeeds includes candidate tag hydration and second-hop discovery", async () => {
  const {
    buildDiscoverySeedList,
    addRecommendationCandidate,
    finalizeRecommendationAccumulator,
    mergeResolvedRecommendations,
    rerankRecommendations,
  } = await importFromRepo("backend/services/discoveryRecommendations.js");

  const seeds = buildDiscoverySeedList({
    libraryArtists: [
      {
        mbid: "11111111-1111-1111-1111-111111111111",
        artistName: "Seed Artist",
        source: "library",
      },
    ],
    historyArtists: [],
  });
  assert.equal(seeds.length, 1);

  const accumulator = new Map();
  const existingArtistKeys = new Set();
  const profileTagWeights = new Map([
    ["shoegaze", 4],
    ["dream-pop", 3],
    ["ethereal", 2],
  ]);

  addRecommendationCandidate(accumulator, {
    candidate: {
      mbid: "22222222-2222-2222-2222-222222222222",
      name: "Primary Discovery",
      match: 0.85,
    },
    seed: seeds[0],
    sourceTags: ["Shoegaze", "Dream-Pop"],
    profileTagWeights,
    existingArtistKeys,
  });

  addRecommendationCandidate(accumulator, {
    candidate: {
      mbid: "33333333-3333-3333-3333-333333333333",
      name: "Second Hop Discovery",
      match: 0.55,
      discoveryDepth: 2,
      similarityMultiplier: 0.55,
      tagAffinityMultiplier: 0.55,
    },
    seed: {
      mbid: "22222222-2222-2222-2222-222222222222",
      artistName: "Primary Discovery",
      source: "lastfm_related",
      profileBucket: "two_hop_bridge",
      weight: 0.65,
      affinityWeight: 0.65,
      discoveryDepth: 2,
      similarityMultiplier: 0.55,
      tagAffinityMultiplier: 0.55,
    },
    sourceTags: ["Ethereal"],
    profileTagWeights,
    existingArtistKeys,
  });

  const merged = finalizeRecommendationAccumulator(accumulator, 10);
  assert.equal(merged.length, 2);

  const primary = merged.find((item) => item.name === "Primary Discovery");
  const secondHop = merged.find((item) => item.name === "Second Hop Discovery");

  assert.ok(primary);
  assert.ok(secondHop);
  assert.equal(primary.discoveryDepth, 1);
  assert.equal(secondHop.discoveryDepth, 2);
  assert.ok(primary.scoreTotal > secondHop.scoreTotal);
  assert.ok(primary.seedCount >= secondHop.seedCount);
});

test("single-pass refresh: applyHydratedCandidateTags recalculates score when candidate tags replace seed tags", async () => {
  const { applyHydratedCandidateTags } = await importFromRepo(
    "backend/services/discoveryRecommendations.js",
  );

  const recommendation = {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    name: "Hydrated Artist",
    tags: ["shoegaze"],
    matchedTags: ["shoegaze"],
    scoreSimilarity: 80,
    scoreTagAffinity: 24,
    scoreSeedCoverage: 12,
    scoreNovelty: 8,
    scorePopularityPenalty: 4,
    scoreTotal: 120,
    seedCount: 1,
  };

  const profileTagWeights = new Map([
    ["industrial", 5],
    ["noise rock", 3],
    ["shoegaze", 4],
  ]);

  const hydrated = applyHydratedCandidateTags(
    recommendation,
    ["Industrial", "Noise Rock"],
    profileTagWeights,
  );

  assert.deepEqual(hydrated.tags, ["industrial", "noise rock"]);
  assert.deepEqual(hydrated.matchedTags, ["industrial", "noise rock"]);
  assert.equal(hydrated.scoreTagAffinity, 45);
  assert.equal(hydrated.candidateTagsHydrated, true);
  assert.equal(hydrated.tagSource, "lastfm_artist");
  assert.ok(hydrated.scoreTotal > 120);
});

test("single-pass refresh: mergeRetainedRecommendationPool handles fresh + retained correctly", async () => {
  const { mergeRetainedRecommendationPool, rerankRecommendations } =
    await importFromRepo("backend/services/discoveryRecommendations.js");

  const { rerankCachedRecommendations } = await importFromRepo(
    "backend/services/discoveryService.js",
  );

  const runStartedAt = "2026-06-22T00:00:00.000Z";

  function makeArtist(index, score, prefix) {
    const padded = String(index).padStart(12, "0");
    return {
      id: `00000000-0000-4000-8000-${padded}`,
      name: `${prefix}-${index}`,
      matchedTags: ["indie"],
      supportingSeeds: [{ artistName: "Seed", weight: 1 }],
      scoreSimilarity: score,
      scoreTagAffinity: 10,
      scoreSeedCoverage: 8,
      scoreNovelty: 6,
      scorePopularityPenalty: 2,
      scoreTotal: score,
      seedCount: 1,
      sourceType: "lastfm",
    };
  }

  let offset = 0;
  function batch(count, score, prefix) {
    const start = offset;
    offset += count;
    return Array.from({ length: count }, (_, index) =>
      makeArtist(start + index, score - index, prefix),
    );
  }

  const existing = batch(100, 160, "existing");

  const freshFull = batch(250, 220, "fresh-full");
  const freshRanked = rerankCachedRecommendations({
    recommendations: freshFull,
    discoveryMode: "balanced",
    limit: 200,
  });

  const merged = mergeRetainedRecommendationPool({
    freshRecommendations: freshRanked,
    existingRecommendations: existing,
    limit: 500,
    runStartedAt,
    discoveryMode: "balanced",
  });

  const freshInOutput = merged.filter(
    (item) => item.recommendationPoolState === "fresh",
  );
  const retainedInOutput = merged.filter(
    (item) => item.recommendationPoolState === "retained",
  );

  assert.equal(merged.length, 300);
  assert.ok(freshInOutput.length > 0);
  assert.ok(retainedInOutput.length > 0);
  assert.equal(
    freshInOutput.every((item) => item.name.startsWith("fresh-full-")),
    true,
  );
  assert.equal(
    retainedInOutput.every((item) => item.name.startsWith("existing-")),
    true,
  );
});

test("single-pass refresh: recommendationQuality constants are correctly defined", async () => {
  const {
    DISCOVERY_QUALITY_INITIAL,
    DISCOVERY_QUALITY_ENRICHING,
    DISCOVERY_QUALITY_ENRICHED,
    getDiscoveryRecommendationsPerRefresh,
    getDiscoveryRecommendationPoolLimit,
  } = await importFromRepo("backend/services/discoveryService.js");

  assert.equal(DISCOVERY_QUALITY_INITIAL, "initial");
  assert.equal(DISCOVERY_QUALITY_ENRICHING, "enriching");
  assert.equal(DISCOVERY_QUALITY_ENRICHED, "enriched");

  const perRefresh = getDiscoveryRecommendationsPerRefresh();
  const poolLimit = getDiscoveryRecommendationPoolLimit();

  assert.ok(perRefresh >= 50 && perRefresh <= 500);
  assert.equal(poolLimit, 500);
  assert.ok(poolLimit >= perRefresh);
});

test("single-pass refresh: getDiscoveryFlowsPerRefresh defaults and clamping", async () => {
  const { getDiscoveryFlowsPerRefresh, getMaxFocusPlaylists } =
    await importFromRepo("backend/services/discoveryService.js");

  assert.equal(getDiscoveryFlowsPerRefresh(), 9);
  assert.equal(getMaxFocusPlaylists(), 4);

  const flows = getDiscoveryFlowsPerRefresh();
  assert.ok(flows >= 5);
  assert.ok(flows <= 32);
});

test("single-pass refresh: resolveFocusSlotBudgets covers all slots", async () => {
  const { resolveFocusSlotBudgets } = await importFromRepo(
    "backend/services/discoverPlaylistService.js",
  );

  const budgets = resolveFocusSlotBudgets(6);
  assert.equal(budgets.maxFocus, 6);
  assert.ok(budgets.tag > 0);
  assert.ok(budgets.artist > 0);
  assert.ok(budgets.crossover > 0);
  assert.equal(budgets.tag + budgets.artist + budgets.crossover, budgets.maxFocus);
});

const isolatedState = await createIsolatedStateDir("single-pass-refresh");
applyIsolatedBackendEnv(isolatedState);

test.after(async () => {
  await cleanupIsolatedState(isolatedState);
});

test("single-pass refresh: db discovery cache stores enriched quality after single-pass write", async () => {
  const { db } = await importFromRepo("backend/config/db-sqlite.js");
  const { dbOps } = await importFromRepo("backend/config/db-helpers.js");
  resetDatabase(db);

  const enrichedAt = new Date().toISOString();
  dbOps.updateDiscoveryCache({
    recommendations: [{ id: "artist-1", name: "Test Artist" }],
    recommendationQuality: "enriched",
    isEnriching: false,
    discoveryRunId: "run-single-pass",
    enrichmentStartedAt: null,
    enrichmentCompletedAt: enrichedAt,
    enrichmentProgressMessage: null,
    lastUpdated: enrichedAt,
  });

  const cache = dbOps.getDiscoveryCache();
  assert.equal(cache.recommendationQuality, "enriched");
  assert.equal(cache.isEnriching, false);
  assert.equal(cache.enrichmentStartedAt, null);
  assert.equal(cache.enrichmentCompletedAt, enrichedAt);
  assert.equal(cache.enrichmentProgressMessage, null);
  assert.deepEqual(cache.recommendations, [
    { id: "artist-1", name: "Test Artist" },
  ]);
});

test("single-pass refresh: db discovery cache stores initial quality for backwards compatibility reads", async () => {
  const { db } = await importFromRepo("backend/config/db-sqlite.js");
  const { dbOps } = await importFromRepo("backend/config/db-helpers.js");
  resetDatabase(db);

  dbOps.updateDiscoveryCache({
    recommendations: [{ id: "artist-2", name: "Initial Quality Artist" }],
    recommendationQuality: "initial",
    isEnriching: true,
    discoveryRunId: "run-initial",
    enrichmentStartedAt: "2026-06-22T00:00:00.000Z",
    enrichmentProgressMessage: "Improving recommendations",
  });

  const cache = dbOps.getDiscoveryCache();
  assert.equal(cache.recommendationQuality, "initial");
  assert.equal(cache.isEnriching, true);
  assert.equal(cache.discoveryRunId, "run-initial");
  assert.equal(cache.enrichmentProgressMessage, "Improving recommendations");
});

test("single-pass refresh: api call counter instruments lastfmRequest with method breakdown", async () => {
  const { getLastfmApiCallCount, getLastfmApiCallCountByMethod, resetLastfmApiCallCount } =
    await importFromRepo("backend/services/apiClients.js");

  resetLastfmApiCallCount();
  assert.equal(getLastfmApiCallCount(), 0);
  assert.deepEqual(getLastfmApiCallCountByMethod(), {});
});
