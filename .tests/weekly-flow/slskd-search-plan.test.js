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

test("buildSlskdSearchTierGroups starts with track search then album tiers", () => {
  const tiers = buildSlskdSearchTierGroups(fataTrack);

  assert.equal(tiers[0]?.name, "primary_track");
  assert.ok(
    tiers[0].queries.includes(
      "From Autumn to Ashes The After Dinner Payback",
    ),
  );
  assert.ok(
    tiers.some(
      (tier) =>
        tier.name === "base_album" &&
        tier.queries.includes("From Autumn to Ashes The Fiction We Live"),
    ),
  );
  assert.ok(
    tiers.some((tier) =>
      tier.queries.some((query) => query.startsWith("*rom Autumn")),
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
