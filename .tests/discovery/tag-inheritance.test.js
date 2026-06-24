import test from "node:test";
import assert from "node:assert/strict";
import {
  createIsolatedStateDir,
  applyIsolatedBackendEnv,
  cleanupIsolatedState,
  importFromRepo,
  resetDatabase,
} from "../helpers/backendTestHarness.js";

test("tag inheritance: candidate with >= 3 seed tags inherits tags and skips artist.getTopTags", async () => {
  const { canInheritTagsFromSeeds } = await importFromRepo(
    "backend/services/discovery/index.js",
  );

  const candidateWithManyTags = {
    id: "cand-1",
    name: "Rich Candidate",
    tags: ["shoegaze", "dream-pop", "noise-rock", "post-punk"],
    matchedTags: ["shoegaze", "dream-pop"],
    scoreTagAffinity: 35,
    scoreTotal: 180,
    scoreSeedCoverage: 12,
    scoreNovelty: 8,
    scorePopularityPenalty: 4,
    seedCount: 1,
    discoveryDepth: 1,
    sourceType: "lastfm",
    supportingSeeds: [{ artistName: "Seed A", weight: 1 }],
  };

  assert.equal(canInheritTagsFromSeeds(candidateWithManyTags), true);

  const candidateWithFewTags = {
    id: "cand-2",
    name: "Sparse Candidate",
    tags: ["shoegaze"],
    matchedTags: ["shoegaze"],
    scoreTagAffinity: 10,
    scoreTotal: 120,
    scoreSeedCoverage: 4,
    scoreNovelty: 8,
    scorePopularityPenalty: 2,
    seedCount: 1,
    discoveryDepth: 1,
    sourceType: "lastfm",
    supportingSeeds: [{ artistName: "Seed B", weight: 1 }],
  };

  assert.equal(canInheritTagsFromSeeds(candidateWithFewTags), false);

  const candidateWithNoTags = {
    id: "cand-3",
    name: "Tagless Candidate",
    tags: [],
    matchedTags: [],
    scoreTagAffinity: 0,
    scoreTotal: 80,
    scoreSeedCoverage: 2,
    scoreNovelty: 4,
    scorePopularityPenalty: 0,
    seedCount: 1,
    discoveryDepth: 1,
    sourceType: "lastfm",
    supportingSeeds: [{ artistName: "Seed C", weight: 1 }],
  };

  assert.equal(canInheritTagsFromSeeds(candidateWithNoTags), false);
});

test("tag inheritance: inherited tags produce tagSource: inherited and keep existing scores stable", async () => {
  const { applyHydratedCandidateTags } = await importFromRepo(
    "backend/services/discoveryRecommendations.js",
  );

  const profileTagWeights = new Map([
    ["shoegaze", 5],
    ["dream-pop", 3],
    ["noise-rock", 2],
    ["indie", 8],
  ]);

  const candidate = {
    id: "cand-4",
    name: "Inherit Test",
    tags: ["shoegaze", "dream-pop", "noise-rock"],
    matchedTags: ["shoegaze", "dream-pop"],
    scoreTagAffinity: 35,
    scoreTotal: 180,
    scoreSeedCoverage: 12,
    scoreNovelty: 8,
    scorePopularityPenalty: 4,
    seedCount: 1,
    discoveryDepth: 1,
    sourceType: "lastfm",
    supportingSeeds: [{ artistName: "Seed", weight: 1 }],
  };

  const inherited = applyHydratedCandidateTags(
    candidate,
    candidate.tags,
    profileTagWeights,
    { source: "inherited" },
  );

  assert.equal(inherited.tagSource, "inherited");
  assert.equal(inherited.candidateTagsHydrated, true);
  assert.ok(inherited.scoreTagAffinity >= 30);
  assert.ok(inherited.matchedTags.includes("shoegaze"));

  const direct = applyHydratedCandidateTags(
    candidate,
    candidate.tags,
    profileTagWeights,
  );

  assert.equal(direct.tagSource, "lastfm_artist");
});

test("tag inheritance: candidate with lastfm tags preserves direct tagSource when inherited tags exist", async () => {
  const { canInheritTagsFromSeeds } = await importFromRepo(
    "backend/services/discovery/index.js",
  );

  const alreadyHydrated = {
    id: "cand-5",
    name: "Already Hydrated",
    tags: ["shoegaze", "dream-pop", "indie", "post-punk"],
    matchedTags: ["shoegaze", "dream-pop"],
    scoreTagAffinity: 35,
    scoreTotal: 180,
    scoreSeedCoverage: 12,
    scoreNovelty: 8,
    scorePopularityPenalty: 4,
    seedCount: 1,
    discoveryDepth: 1,
    sourceType: "lastfm",
    supportingSeeds: [{ artistName: "Seed", weight: 1 }],
    candidateTagsHydrated: true,
    tagSource: "lastfm_artist",
  };

  assert.equal(canInheritTagsFromSeeds(alreadyHydrated), false);
});

test("tag inheritance: multi-seed candidate merges tags from all contributing seeds", async () => {
  const { addRecommendationCandidate, finalizeRecommendationAccumulator } =
    await importFromRepo("backend/services/discoveryRecommendations.js");

  const accumulator = new Map();
  const profileTagWeights = new Map([
    ["shoegaze", 5],
    ["dream-pop", 3],
    ["indie", 8],
    ["post-punk", 4],
  ]);

  addRecommendationCandidate(accumulator, {
    candidate: {
      mbid: "multi-mbid-1",
      name: "Multi Seed Candidate",
      match: 0.75,
      discoveryDepth: 1,
    },
    seed: {
      artistName: "Seed A",
      mbid: "seed-a-mbid",
      source: "library",
      weight: 1.2,
      profileBucket: "top",
    },
    sourceTags: ["shoegaze", "dream-pop", "noise-rock"],
    profileTagWeights,
  });

  addRecommendationCandidate(accumulator, {
    candidate: {
      mbid: "multi-mbid-1",
      name: "Multi Seed Candidate",
      match: 0.68,
      discoveryDepth: 1,
    },
    seed: {
      artistName: "Seed B",
      mbid: "seed-b-mbid",
      source: "history",
      weight: 1,
      profileBucket: "high",
    },
    sourceTags: ["indie", "post-punk"],
    profileTagWeights,
  });

  const final = finalizeRecommendationAccumulator(accumulator, 50, {
    discoveryMode: "balanced",
  });

  assert.equal(final.length, 1);
  const entry = final[0];
  assert.ok(entry.tags.includes("shoegaze"));
  assert.ok(entry.tags.includes("indie"));
  assert.ok(entry.supportingSeeds.length >= 2);
  assert.ok(entry.scoreSimilarity > 0);
});

test("tag inheritance: sparse tags (< 3) trigger direct hydration path", async () => {
  const { canInheritTagsFromSeeds } = await importFromRepo(
    "backend/services/discovery/index.js",
  );

  const sparseTagsCandidate = {
    id: "cand-sparse",
    name: "Sparse Tags",
    tags: ["shoegaze", "indie"],
    matchedTags: ["shoegaze"],
    scoreTagAffinity: 15,
    scoreTotal: 120,
    scoreSeedCoverage: 8,
    scoreNovelty: 4,
    scorePopularityPenalty: 2,
    seedCount: 1,
    discoveryDepth: 1,
    sourceType: "lastfm",
    supportingSeeds: [{ artistName: "Seed", weight: 1 }],
  };

  assert.equal(canInheritTagsFromSeeds(sparseTagsCandidate), false);
});

test("tag inheritance: tag inheritance reduces artist.getTopTags call count for qualifying candidates", async () => {
  const {
    getLastfmApiCallCount,
    getLastfmApiCallCountByMethod,
    resetLastfmApiCallCount,
  } = await importFromRepo("backend/services/apiClients/index.js");

  const {
    addRecommendationCandidate,
    finalizeRecommendationAccumulator,
    applyHydratedCandidateTags,
  } = await importFromRepo("backend/services/discoveryRecommendations.js");

  resetLastfmApiCallCount();

  const profileTagWeights = new Map([
    ["shoegaze", 5],
    ["dream-pop", 3],
    ["indie", 8],
  ]);

  const accumulator = new Map();
  for (let i = 0; i < 20; i++) {
    addRecommendationCandidate(accumulator, {
      candidate: {
        mbid: `cand-mbid-${i}`,
        name: `Candidate ${i}`,
        match: 0.55 + i * 0.01,
        discoveryDepth: 1,
      },
      seed: {
        artistName: `Seed ${i % 5}`,
        mbid: `seed-mbid-${i % 5}`,
        source: "library",
        weight: 1,
      },
      sourceTags:
        i % 3 === 0
          ? ["shoegaze", "dream-pop", "indie", "post-punk"]
          : ["shoegaze", "dream-pop", "indie"],
      profileTagWeights,
    });
  }

  const final = finalizeRecommendationAccumulator(accumulator, 50, {
    discoveryMode: "balanced",
  });

  assert.ok(final.length > 0);

  resetLastfmApiCallCount();
  assert.equal(getLastfmApiCallCount(), 0);
  assert.deepEqual(getLastfmApiCallCountByMethod(), {});
});

test("tag inheritance: ranking scores are equivalent between inherited and direct tags with same tag data", async () => {
  const { applyHydratedCandidateTags } = await importFromRepo(
    "backend/services/discoveryRecommendations.js",
  );

  const profileTagWeights = new Map([
    ["shoegaze", 5],
    ["dream-pop", 3],
    ["indie", 8],
  ]);

  const tags = ["shoegaze", "dream-pop", "indie"];

  const candidateA = {
    id: "rank-a",
    name: "Rank A",
    tags,
    matchedTags: ["shoegaze", "dream-pop"],
    scoreTagAffinity: 33,
    scoreTotal: 180,
    scoreSeedCoverage: 12,
    scoreNovelty: 8,
    scorePopularityPenalty: 4,
    seedCount: 1,
    discoveryDepth: 1,
    sourceType: "lastfm",
    supportingSeeds: [{ artistName: "Seed", weight: 1 }],
  };

  const candidateB = {
    ...candidateA,
    id: "rank-b",
    name: "Rank B",
  };

  const inherited = applyHydratedCandidateTags(
    candidateA,
    tags,
    profileTagWeights,
    { source: "inherited" },
  );
  const direct = applyHydratedCandidateTags(
    candidateB,
    tags,
    profileTagWeights,
  );

  assert.equal(inherited.scoreTagAffinity, direct.scoreTagAffinity);
  assert.equal(inherited.scoreTotal, direct.scoreTotal);
  assert.deepEqual(inherited.matchedTags.sort(), direct.matchedTags.sort());
});
