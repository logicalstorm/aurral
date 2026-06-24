import test from "node:test";
import assert from "node:assert/strict";
import {
  createIsolatedStateDir,
  applyIsolatedBackendEnv,
  cleanupIsolatedState,
  importFromRepo,
} from "../helpers/backendTestHarness.js";

const isolatedState = await createIsolatedStateDir("discovery-recommendation-pool");
applyIsolatedBackendEnv(isolatedState);

const { mergeRetainedRecommendationPool, filterRecommendationsForServe } =
  await importFromRepo("backend/services/discovery/recommendationPipeline.js");
const {
  getDiscoveryRecommendationsPerRefresh,
  getDiscoveryRecommendationPoolLimit,
  rerankCachedRecommendations,
} = await importFromRepo("backend/services/discovery/index.js");

test.after(async () => {
  await cleanupIsolatedState(isolatedState);
});

const PER_REFRESH = getDiscoveryRecommendationsPerRefresh();
const POOL_LIMIT = getDiscoveryRecommendationPoolLimit();

function makeArtist(index, score, prefix = "artist") {
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

let nextArtistOffset = 0;

function makeBatch(count, baseScore, prefix = "artist") {
  const start = nextArtistOffset;
  nextArtistOffset += count;
  return Array.from({ length: count }, (_, offset) =>
    makeArtist(start + offset, baseScore - offset, prefix),
  );
}

function resetArtistIds() {
  nextArtistOffset = 0;
}

function simulatePhase({
  existingRecommendations = [],
  candidateCount = PER_REFRESH * 2,
  baseScore = 200,
  prefix = "artist",
  runStartedAt = new Date().toISOString(),
} = {}) {
  const candidates = makeBatch(candidateCount, baseScore, prefix);
  const freshRecommendations = rerankCachedRecommendations({
    recommendations: candidates,
    discoveryMode: "balanced",
    limit: PER_REFRESH,
  });
  return mergeRetainedRecommendationPool({
    freshRecommendations,
    existingRecommendations,
    limit: POOL_LIMIT,
    runStartedAt,
    discoveryMode: "balanced",
  });
}

test("two-phase refresh grows pool from initial hydration through enrichment", () => {
  resetArtistIds();
  const runStartedAt = "2026-06-18T00:00:00.000Z";
  const phaseOnePool = simulatePhase({
    existingRecommendations: [],
    candidateCount: PER_REFRESH + 40,
    baseScore: 220,
    prefix: "phase1",
    runStartedAt,
  });
  assert.equal(phaseOnePool.length, PER_REFRESH);
  assert.equal(
    phaseOnePool.every((item) => item.recommendationPoolState === "fresh"),
    true,
  );

  const phaseTwoPool = simulatePhase({
    existingRecommendations: phaseOnePool,
    candidateCount: PER_REFRESH + 40,
    baseScore: 210,
    prefix: "phase2",
    runStartedAt: "2026-06-18T01:00:00.000Z",
  });
  assert.equal(phaseTwoPool.length, PER_REFRESH * 2);
  assert.equal(
    phaseTwoPool.filter((item) => item.recommendationPoolState === "fresh").length,
    PER_REFRESH,
  );
  assert.equal(
    phaseTwoPool.filter((item) => item.recommendationPoolState === "retained").length,
    PER_REFRESH,
  );
  assert.equal(
    phaseTwoPool.some((item) => item.name.startsWith("phase1-")),
    true,
  );
  assert.equal(
    phaseTwoPool.some((item) => item.name.startsWith("phase2-")),
    true,
  );
});

test("repeated refreshes build the pool to the 500 cap", () => {
  resetArtistIds();
  let pool = [];
  for (let cycle = 0; cycle < 4; cycle += 1) {
    pool = simulatePhase({
      existingRecommendations: pool,
      candidateCount: PER_REFRESH + 20,
      baseScore: 300 - cycle * 10,
      prefix: `cycle-${cycle}`,
      runStartedAt: `2026-06-${10 + cycle}T00:00:00.000Z`,
    });
  }

  const oldestRemaining = pool.filter((item) =>
    item.name.startsWith("cycle-0-"),
  ).length;
  const newestRemaining = pool.filter((item) =>
    item.name.startsWith("cycle-3-"),
  ).length;

  assert.equal(pool.length, POOL_LIMIT);
  assert.ok(oldestRemaining > 0);
  assert.ok(oldestRemaining < PER_REFRESH);
  assert.ok(newestRemaining > 0);
});

test("rotation drops lowest retained artists when fresh batch arrives", () => {
  resetArtistIds();
  const weakRetained = makeBatch(POOL_LIMIT, 40, "weak");
  const freshBatch = makeBatch(PER_REFRESH, 250, "fresh");
  const freshRecommendations = rerankCachedRecommendations({
    recommendations: freshBatch,
    discoveryMode: "balanced",
    limit: PER_REFRESH,
  });

  const rotated = mergeRetainedRecommendationPool({
    freshRecommendations,
    existingRecommendations: weakRetained,
    limit: POOL_LIMIT,
    runStartedAt: "2026-06-18T12:00:00.000Z",
    discoveryMode: "balanced",
  });

  assert.equal(rotated.length, POOL_LIMIT);
  assert.equal(
    rotated.filter((item) => item.name.startsWith("fresh-")).length,
    PER_REFRESH,
  );
  assert.equal(
    rotated.filter((item) => item.name.startsWith("weak-")).length,
    POOL_LIMIT - PER_REFRESH,
  );
  assert.equal(
    rotated.some((item) => item.name === `weak-${POOL_LIMIT - 1}`),
    false,
  );
  assert.equal(rotated.some((item) => item.name === "weak-0"), true);
});

test("full two-phase refresh cycles reach the 500 pool cap", () => {
  resetArtistIds();
  let pool = [];
  for (let cycle = 0; cycle < 3; cycle += 1) {
    pool = simulatePhase({
      existingRecommendations: pool,
      candidateCount: PER_REFRESH + 20,
      baseScore: 280 - cycle * 15,
      prefix: `c${cycle}-initial`,
      runStartedAt: `2026-06-${10 + cycle * 2}T00:00:00.000Z`,
    });
    pool = simulatePhase({
      existingRecommendations: pool,
      candidateCount: PER_REFRESH + 20,
      baseScore: 260 - cycle * 15,
      prefix: `c${cycle}-enriched`,
      runStartedAt: `2026-06-${10 + cycle * 2 + 1}T00:00:00.000Z`,
    });
  }

  assert.equal(pool.length, POOL_LIMIT);
  assert.ok(
    pool.filter((item) => item.name.startsWith("c2-enriched-")).length > 0,
  );
  assert.ok(
    pool.filter((item) => item.name.startsWith("c0-initial-")).length <
      PER_REFRESH,
  );
});

test("filterRecommendationsForServe keeps stored order and hides exact negative feedback", () => {
  const storedPool = makeBatch(5, 180, "stored");
  const hidden = storedPool[2];
  const filtered = filterRecommendationsForServe(storedPool, [
    {
      artistId: hidden.id,
      action: "less_like_this",
    },
  ]);

  assert.equal(filtered.length, 4);
  assert.deepEqual(
    filtered.map((item) => item.name),
    storedPool.filter((item) => item.id !== hidden.id).map((item) => item.name),
  );
});

test("rerankCachedRecommendations still trims refresh batches to the per-refresh limit", () => {
  resetArtistIds();
  const storedPool = makeBatch(350, 180, "stored");
  const servedWithRefreshLimit = rerankCachedRecommendations({
    recommendations: storedPool,
    discoveryMode: "balanced",
  });
  const servedWithPoolLimit = rerankCachedRecommendations({
    recommendations: storedPool,
    discoveryMode: "balanced",
    limit: POOL_LIMIT,
  });

  assert.equal(servedWithRefreshLimit.length, PER_REFRESH);
  assert.equal(servedWithPoolLimit.length, 350);
});

test("enrichment marks returning artists as fresh while preserving firstDiscoveredAt", () => {
  resetArtistIds();
  const runStartedAt = "2026-06-18T00:00:00.000Z";
  const initialPool = simulatePhase({
    existingRecommendations: [],
    candidateCount: PER_REFRESH,
    baseScore: 200,
    prefix: "seed",
    runStartedAt,
  });
  const returningArtist = initialPool[0];
  const enrichedCandidate = {
    ...returningArtist,
    scoreTotal: returningArtist.scoreTotal + 25,
    scoreSimilarity: returningArtist.scoreSimilarity + 25,
    matchedTags: ["indie", "shoegaze"],
  };
  const enrichmentFresh = rerankCachedRecommendations({
    recommendations: [
      enrichedCandidate,
      ...makeBatch(PER_REFRESH - 1, 190, "enriched"),
    ],
    discoveryMode: "balanced",
    limit: PER_REFRESH,
  });
  const enrichedPool = mergeRetainedRecommendationPool({
    freshRecommendations: enrichmentFresh,
    existingRecommendations: initialPool,
    limit: POOL_LIMIT,
    runStartedAt: "2026-06-18T01:00:00.000Z",
    discoveryMode: "balanced",
  });
  const updatedReturning = enrichedPool.find(
    (item) => item.id === returningArtist.id,
  );

  assert.ok(updatedReturning);
  assert.equal(
    updatedReturning.firstDiscoveredAt,
    returningArtist.firstDiscoveredAt || runStartedAt,
  );
  assert.equal(updatedReturning.lastRecommendedAt, "2026-06-18T01:00:00.000Z");
  assert.equal(updatedReturning.recommendationPoolState, "fresh");
});
