import assert from "node:assert/strict";
import test from "node:test";

import { enrichPlaylistTracksForAdoption } from "../../backend/services/discovery/playlistAdoptionEnrichment.js";

test("discover playlist enrichment is deferred and does not mutate the cached preview", async () => {
  const cached = {
    presetId: "top-rock",
    tracks: [
      { artistName: "Artist One", trackName: "Track One", albumName: null },
      { artistName: "Artist Two", trackName: "Track Two", albumName: "Known Album" },
    ],
  };
  const calls = [];

  const enriched = await enrichPlaylistTracksForAdoption(
    cached,
    async (tracks) => {
      calls.push(tracks);
      return tracks.map((track) => ({ ...track, albumName: "Resolved Album" }));
    },
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [cached.tracks[0]]);
  assert.equal(enriched.tracks[0].albumName, "Resolved Album");
  assert.equal(enriched.tracks[1].albumName, "Known Album");
  assert.equal(cached.tracks[0].albumName, null);
  assert.notEqual(enriched, cached);
});
