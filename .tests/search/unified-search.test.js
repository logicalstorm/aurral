import test from "node:test";
import assert from "node:assert/strict";

import { searchLocalFromData } from "../../backend/services/unifiedSearchService.js";

test("searchLocalFromData returns playlist matches", () => {
  const result = searchLocalFromData(
    "paranoid android",
    {
      playlists: [
        {
          id: "pl-1",
          name: "Radiohead Favorites",
          tracks: [
            { artistName: "Radiohead", trackName: "Paranoid Android" },
          ],
        },
      ],
    },
    5,
  );

  assert.equal(result.playlists.length, 1);
  assert.equal(result.playlists[0].name, "Radiohead Favorites");
  assert.equal(result.artists.length, 0);
  assert.equal(result.tracks.length, 0);
});
