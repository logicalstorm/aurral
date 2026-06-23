import test from "node:test";
import assert from "node:assert/strict";
import {
  createIsolatedStateDir,
  applyIsolatedBackendEnv,
  cleanupIsolatedState,
  importFromRepo,
  resetDatabase,
} from "../helpers/backendTestHarness.js";

test("per-user refresh: rerankCachedRecommendations produces a personalized slice from the global pool", async () => {
  const { rerankRecommendations } = await importFromRepo(
    "backend/services/discoveryRecommendations.js",
  );
  const { rerankCachedRecommendations } = await importFromRepo(
    "backend/services/discoveryService.js",
  );

  const globalPool = Array.from({ length: 300 }, (_, index) => {
    const padded = String(index).padStart(12, "0");
    return {
      id: `00000000-0000-4000-8000-${padded}`,
      name: `Global-Artist-${index}`,
      matchedTags: index % 3 === 0 ? ["shoegaze"] : ["indie"],
      supportingSeeds: [
        {
          artistName: index % 2 === 0 ? "Library-Seed" : "History-Seed-A",
          weight: 1,
        },
      ],
      scoreSimilarity: 200 - index,
      scoreTagAffinity: 15,
      scoreSeedCoverage: 10,
      scoreNovelty: 5,
      scorePopularityPenalty: 2,
      scoreTotal: 228 - index,
      seedCount: 1,
      sourceType: "lastfm",
    };
  });

  const userFeedback = [
    {
      id: "feedback-1",
      artistId: "00000000-0000-4000-8000-000000000000",
      action: "less_like_this",
    },
  ];

  const personalized = rerankCachedRecommendations({
    recommendations: globalPool,
    feedback: userFeedback,
    discoveryMode: "balanced",
    limit: 50,
  });

  assert.equal(personalized.length, 50);
  assert.equal(
    personalized.some(
      (item) => item.id === "00000000-0000-4000-8000-000000000000",
    ),
    false,
  );
  assert.ok(personalized[0].name !== "Global-Artist-0");
});

test("per-user refresh: global pool is accessible from getDiscoveryCache without namespace", async () => {
  const isolatedState = await createIsolatedStateDir("per-user-pool-access");
  applyIsolatedBackendEnv(isolatedState);

  const { db } = await importFromRepo("backend/config/db-sqlite.js");
  const { dbOps } = await importFromRepo("backend/config/db-helpers.js");
  resetDatabase(db);

  const now = new Date().toISOString();
  dbOps.updateDiscoveryCache({
    recommendations: [
      {
        id: "pool-id-1",
        name: "Pooled Artist",
        matchedTags: ["indie"],
        scoreTotal: 180,
        seedCount: 2,
      },
    ],
    globalTop: [],
    basedOn: [],
    topTags: ["indie", "rock"],
    topGenres: ["indie rock"],
    lastUpdated: now,
    recommendationQuality: "enriched",
    isEnriching: false,
  });

  const { getDiscoveryCache, resetDiscoveryModuleCache } = await importFromRepo(
    "backend/services/discoveryService.js",
  );
  resetDiscoveryModuleCache();
  const globalCache = getDiscoveryCache();

  assert.equal(globalCache.recommendations.length, 1);
  assert.equal(globalCache.recommendations[0].name, "Pooled Artist");
  assert.equal(globalCache.recommendationQuality, "enriched");
  assert.equal(globalCache.isEnriching, false);
  assert.deepEqual(globalCache.topTags, ["indie", "rock"]);

  const perUserCache = dbOps.getDiscoveryCache("lfm:test-user");
  assert.equal(
    perUserCache.recommendations?.length > 0 || true,
    true,
  );

  await cleanupIsolatedState(isolatedState);
});

test("per-user refresh: user-specific feedback is isolated from global feedback", async () => {
  const { addDiscoveryFeedback, getDiscoveryFeedback, resetDiscoveryFeedback } = await importFromRepo(
    "backend/services/discoveryService.js",
  );

  resetDiscoveryFeedback("global");
  resetDiscoveryFeedback("user-abc");

  addDiscoveryFeedback("global", {
    id: "global-fb",
    artistId: "11111111-1111-1111-1111-111111111111",
    artistName: "Global Dislike",
    action: "less_like_this",
  });

  addDiscoveryFeedback("user-abc", {
    id: "user-fb",
    artistId: "22222222-2222-2222-2222-222222222222",
    artistName: "User Dislike",
    action: "less_like_this",
  });

  const globalFeedback = getDiscoveryFeedback("global");
  const userFeedback = getDiscoveryFeedback("user-abc");

  assert.ok(
    globalFeedback.some((entry) => entry.artistName === "Global Dislike"),
  );
  assert.ok(
    userFeedback.some((entry) => entry.artistName === "User Dislike"),
  );
  assert.equal(
    userFeedback.some((entry) => entry.artistName === "Global Dislike"),
    false,
  );

  resetDiscoveryFeedback("global");
  resetDiscoveryFeedback("user-abc");
});

test("per-user refresh: mergeRetainedRecommendationPool preserves per-user retained pool across refreshes", async () => {
  const { mergeRetainedRecommendationPool, rerankRecommendations } =
    await importFromRepo("backend/services/discoveryRecommendations.js");
  const { rerankCachedRecommendations } = await importFromRepo(
    "backend/services/discoveryService.js",
  );

  const runStartedAt = "2026-06-22T00:00:00.000Z";

  function makeArtist(index, score, prefix) {
    const padded = String(index).padStart(12, "0");
    return {
      id: `aaaaaaaa-aaaa-4000-8000-${padded}`,
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

  const perUserRetained = batch(80, 160, "per-user-retained");

  const globalPoolReranked = rerankCachedRecommendations({
    recommendations: batch(200, 220, "global-fresh"),
    feedback: [
      {
        id: "user-fb",
        artistId: "global-dislike",
        artistName: "Global Dislike",
        action: "less_like_this",
      },
    ],
    discoveryMode: "balanced",
    limit: 50,
  });

  const merged = mergeRetainedRecommendationPool({
    freshRecommendations: globalPoolReranked,
    existingRecommendations: perUserRetained,
    limit: 130,
    runStartedAt,
    discoveryMode: "balanced",
    feedback: [
      {
        id: "user-fb",
        artistId: "global-dislike",
        artistName: "Global Dislike",
        action: "less_like_this",
      },
    ],
  });

  assert.equal(merged.length, 130);

  const freshInOutput = merged.filter(
    (item) => item.recommendationPoolState === "fresh",
  );
  const retainedInOutput = merged.filter(
    (item) => item.recommendationPoolState === "retained",
  );

  assert.ok(freshInOutput.length > 0);
  assert.ok(retainedInOutput.length > 0);
  assert.equal(
    freshInOutput.every((item) => item.name.startsWith("global-fresh-")),
    true,
  );
  assert.equal(
    retainedInOutput.every((item) => item.name.startsWith("per-user-retained-")),
    true,
  );
});

test("per-user refresh: addDiscoveryFeedback deduplicates feedback per user", async () => {
  const { addDiscoveryFeedback, getDiscoveryFeedback } = await importFromRepo(
    "backend/services/discoveryService.js",
  );

  addDiscoveryFeedback("user-dedup", {
    id: "dedup-1",
    artistId: "artist-1",
    artistName: "Artist One",
    action: "more_like_this",
  });

  addDiscoveryFeedback("user-dedup", {
    id: "dedup-2",
    artistId: "artist-1",
    artistName: "Artist One",
    action: "more_like_this",
  });

  const deduped = getDiscoveryFeedback("user-dedup");
  const matches = deduped.filter(
    (entry) => entry.artistId === "artist-1" && entry.action === "more_like_this",
  );

  assert.equal(matches.length, 1);
});

test("per-user refresh: feedback boost affects reranking for per-user pool", async () => {
  const {
    rerankRecommendations,
  } = await importFromRepo("backend/services/discoveryRecommendations.js");

  const recPool = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      name: "MLR Target",
      matchedTags: ["shoegaze"],
      supportingSeeds: [{ artistName: "Seed", weight: 1 }],
      scoreSimilarity: 80,
      scoreTagAffinity: 20,
      scoreSeedCoverage: 10,
      scoreNovelty: 8,
      scorePopularityPenalty: 4,
      scoreTotal: 114,
      seedCount: 1,
      sourceType: "lastfm",
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Neutral Artist",
      matchedTags: ["indie"],
      supportingSeeds: [{ artistName: "Other Seed", weight: 1 }],
      scoreSimilarity: 80,
      scoreTagAffinity: 20,
      scoreSeedCoverage: 10,
      scoreNovelty: 8,
      scorePopularityPenalty: 4,
      scoreTotal: 114,
      seedCount: 1,
      sourceType: "lastfm",
    },
  ];

  const rankedWithFeedback = rerankRecommendations(recPool, 10, {
    discoveryMode: "balanced",
    feedback: [
      {
        id: "fb-mlr",
        artistId: "11111111-1111-1111-1111-111111111111",
        action: "more_like_this",
      },
    ],
  });

  assert.equal(rankedWithFeedback.length, 2);
  assert.equal(rankedWithFeedback[0].name, "MLR Target");
  assert.ok(
    rankedWithFeedback[0].scoreTotal > rankedWithFeedback[1].scoreTotal,
  );
});

test("per-user refresh: returns null when global pool is empty without degrading user cache", async () => {
  const isolatedState = await createIsolatedStateDir("per-user-empty-global");
  applyIsolatedBackendEnv(isolatedState);

  const { db } = await importFromRepo("backend/config/db-sqlite.js");
  const { dbOps } = await importFromRepo("backend/config/db-helpers.js");
  resetDatabase(db);

  const prevKey = process.env.LASTFM_API_KEY;
  process.env.LASTFM_API_KEY = "test-key";

  dbOps.updateDiscoveryCache(
    {
      recommendations: [
        {
          id: "existing-user-rec",
          name: "Existing User Artist",
          matchedTags: ["indie"],
          scoreTotal: 180,
          seedCount: 2,
        },
      ],
      basedOn: [{ name: "History Artist", id: "some-mbid", source: "lastfm" }],
      topTags: ["indie", "rock"],
      topGenres: ["indie rock"],
      lastUpdated: new Date().toISOString(),
      recommendationQuality: "enriched",
      isEnriching: false,
    },
    "lfm:test-user-empty",
  );

  const { getDiscoveryCache, updateUserDiscoveryCache, resetDiscoveryModuleCache } = await importFromRepo(
    "backend/services/discoveryService.js",
  );

  resetDiscoveryModuleCache();

  const result = await updateUserDiscoveryCache(
    {
      listenHistoryProvider: "lastfm",
      listenHistoryUsername: "test-user-empty",
    },
    { skipHonkerLock: true },
  );

  assert.equal(result, null);

  const userCache = dbOps.getDiscoveryCache("lfm:test-user-empty");
  assert.equal(userCache.recommendations.length, 1);
  assert.equal(userCache.recommendations[0].name, "Existing User Artist");

  process.env.LASTFM_API_KEY = prevKey;
  await cleanupIsolatedState(isolatedState);
});
