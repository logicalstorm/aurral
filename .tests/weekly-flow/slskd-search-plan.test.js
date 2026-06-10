import test from "node:test";
import assert from "node:assert/strict";

import { importFromRepo } from "../helpers/backendTestHarness.js";

const { buildSlskdSearchTierGroups, shouldStopSlskdSearching } =
  await importFromRepo("backend/services/slskdOrchestrator.js");

const fataTrack = {
  artistName: "From Autumn to Ashes",
  trackName: "The After Dinner Payback",
  albumName: "The Fiction We Live",
  releaseYear: "2003",
  artistAliases: [],
};

test("buildSlskdSearchTierGroups keeps wildcard searches separate from plain searches", () => {
  const { plain, wildcard } = buildSlskdSearchTierGroups(fataTrack);

  assert.ok(plain[0].includes("From Autumn to Ashes The Fiction We Live"));
  assert.ok(!plain.flat().some((query) => query.startsWith("*")));
  assert.ok(wildcard.flat().some((query) => query.startsWith("*rom Autumn")));
});

test("shouldStopSlskdSearching stops after enough raw results even without valid candidates", () => {
  const rawResults = Array.from({ length: 60 }, (_, index) => ({
    user: `user-${index}`,
    file: `music\\Artist\\Album\\Track ${index}.flac`,
  }));

  assert.equal(
    shouldStopSlskdSearching(rawResults, fataTrack, { preferredFormat: "flac" }),
    true,
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
