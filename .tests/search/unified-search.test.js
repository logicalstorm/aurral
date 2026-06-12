import test from "node:test";
import assert from "node:assert/strict";

import { searchLocalFromData } from "../../backend/services/unifiedSearchService.js";
import {
  compareSearchResults,
  getSearchRankScore,
} from "../../backend/services/searchRanking.js";

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

test("searchLocalFromData returns library artist and track matches", () => {
  const result = searchLocalFromData(
    "radiohead",
    {
      artists: [
        {
          mbid: "a1b2c3",
          artistName: "Radiohead",
        },
      ],
      tracks: [
        {
          id: "lib-track-1",
          title: "Creep",
          artist: "Radiohead",
          album: "Pablo Honey",
          streamPath: "/library/file-stream/1/2",
        },
      ],
    },
    5,
  );

  assert.equal(result.artists.length, 1);
  assert.equal(result.artists[0].name, "Radiohead");
  assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0].title, "Creep");
  assert.equal(result.artists[0].inLibrary, true);
  assert.equal(result.tracks[0].inLibrary, true);
});

test("search ranking prioritizes strong playlist matches over catalog tracks", () => {
  const playlist = {
    type: "playlist",
    score: 90,
    inLibrary: true,
  };
  const libraryTrack = {
    type: "track",
    score: 100,
    inLibrary: true,
  };
  const catalogTrack = {
    type: "track",
    score: 115,
    inLibrary: false,
  };

  assert.ok(getSearchRankScore(playlist) > getSearchRankScore(catalogTrack));
  assert.ok(getSearchRankScore(libraryTrack) > getSearchRankScore(catalogTrack));
});

test("search ranking ignores weak library partial matches", () => {
  const weakLibraryArtist = {
    type: "artist",
    score: 67,
    inLibrary: true,
  };
  const catalogArtist = {
    type: "artist",
    score: 127,
    inLibrary: false,
  };

  assert.ok(getSearchRankScore(catalogArtist) > getSearchRankScore(weakLibraryArtist));
});
