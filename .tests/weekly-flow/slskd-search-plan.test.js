import test from "node:test";
import assert from "node:assert/strict";

import { importFromRepo } from "../helpers/backendTestHarness.js";

const {
  buildSlskdSearchTierGroups,
  shouldStopSlskdSearching,
} = await importFromRepo("backend/services/slskdOrchestrator.js");

const fataTrack = {
  artistName: "From Autumn to Ashes",
  trackName: "The After Dinner Payback",
  albumName: "The Fiction We Live",
  releaseYear: "2003",
  artistAliases: [],
};

test("buildSlskdSearchTierGroups uses a short album-first search plan", () => {
  const tiers = buildSlskdSearchTierGroups(fataTrack);

  assert.equal(tiers[0]?.name, "base_album");
  assert.ok(
    tiers[0].queries.includes(
      "From Autumn to Ashes The Fiction We Live 2003",
    ),
  );
  assert.ok(
    tiers.some(
      (tier) =>
        tier.name === "wildcard_album" &&
        tier.queries.includes("*rom *utumn *o *shes The Fiction We Live"),
    ),
  );
  assert.ok(
    tiers.some(
      (tier) =>
        tier.name === "album_track" &&
        tier.queries.includes("The Fiction We Live The After Dinner Payback"),
    ),
  );
});

test("shouldStopSlskdSearching only stops when valid candidates exist", () => {
  const rawResults = Array.from({ length: 60 }, (_, index) => ({
    user: `user-${index}`,
    file: `music\\Artist\\Album\\Track ${index}.flac`,
  }));

  assert.equal(
    shouldStopSlskdSearching(rawResults, fataTrack, { preferredFormat: "flac" }),
    false,
  );
});

test("shouldStopSlskdSearching does not stop on a small result set without valid candidates", () => {
  const rawResults = [
    {
      user: "user-1",
      file: "music\\Artist\\Wrong Album\\Other Song.flac",
    },
  ];

  assert.equal(
    shouldStopSlskdSearching(rawResults, fataTrack, { preferredFormat: "flac" }),
    false,
  );
});

test("shouldStopSlskdSearching stops after the first valid candidate", () => {
  const validResults = Array.from({ length: 3 }, (_, index) => ({
    user: `valid-user-${index}`,
    file: `music\\From Autumn to Ashes\\The Fiction We Live\\01 The After Dinner Payback.flac`,
    slots: 1,
    speed: 700000,
  }));

  assert.equal(
    shouldStopSlskdSearching(validResults.slice(0, 1), fataTrack, {
      preferredFormat: "flac",
    }),
    true,
  );
});
