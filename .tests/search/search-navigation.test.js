import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMixedSearchPageItems,
  buildMixedSuggestionItems,
  buildUnifiedSuggestionSections,
  compareSearchResults,
  getSearchRankScore,
  pickTopSearchArtist,
} from "../../frontend/src/utils/searchNavigation.js";

test("buildMixedSuggestionItems dedupes artists with the same display name", () => {
  const items = buildMixedSuggestionItems({
    catalog: {
      artists: [
        { type: "artist", id: "a1", name: "Bear", score: 115 },
        { type: "artist", id: "a2", name: "Bear", score: 110 },
        { type: "artist", id: "a3", name: "Beartooth", score: 90 },
      ],
      albums: [],
      tracks: [],
    },
    library: { artists: [], tracks: [], playlists: [] },
  });

  assert.equal(items.filter((item) => item.type === "artist").length, 2);
  assert.equal(items[0].name, "Bear");
  assert.equal(items[0].id, "a1");
});

test("buildMixedSuggestionItems mixes entity types by score", () => {
  const items = buildMixedSuggestionItems({
    catalog: {
      artists: [{ type: "artist", id: "a1", name: "Bear", score: 80 }],
      albums: [
        {
          type: "album",
          id: "rg1",
          title: "Bear",
          artistName: "Remute",
          score: 120,
        },
      ],
      tracks: [
        {
          type: "track",
          id: "r1",
          title: "Bear",
          artistName: "Support Lesbiens",
          score: 100,
        },
      ],
    },
    library: { artists: [], tracks: [], playlists: [] },
  });

  assert.deepEqual(
    items.map((item) => item.type),
    ["album", "track", "artist"],
  );
});

test("pickTopSearchArtist prefers library artists over catalog top results", () => {
  const artist = pickTopSearchArtist({
    top: { type: "artist", id: "a1", name: "Beartooth", score: 115 },
    catalog: {
      artists: [{ type: "artist", id: "a1", name: "Beartooth", score: 115 }],
      albums: [],
      tracks: [],
    },
    library: {
      artists: [
        {
          type: "artist",
          id: "lib-1",
          name: "Bear",
          score: 90,
          inLibrary: true,
        },
      ],
      tracks: [],
      playlists: [],
    },
  });

  assert.equal(artist.id, "lib-1");
});

test("buildMixedSuggestionItems ranks strong playlist matches ahead of catalog", () => {
  const items = buildMixedSuggestionItems({
    catalog: {
      artists: [],
      albums: [],
      tracks: [
        {
          type: "track",
          id: "r1",
          title: "Bear",
          artistName: "Support Lesbiens",
          score: 115,
        },
      ],
    },
    library: {
      artists: [],
      tracks: [],
      playlists: [
        {
          type: "playlist",
          id: "pl-1",
          name: "Bear Mix",
          score: 90,
          inLibrary: true,
        },
      ],
    },
  });

  assert.equal(items[0].type, "playlist");
});

test("buildMixedSuggestionItems prefers catalog for album title queries over weak library matches", () => {
  const items = buildMixedSuggestionItems({
    query: "the black parade",
    catalog: {
      artists: [
        {
          type: "artist",
          id: "mcr",
          name: "My Chemical Romance",
          score: 127,
        },
      ],
      albums: [
        {
          type: "album",
          id: "tbp",
          title: "The Black Parade",
          artistName: "My Chemical Romance",
          score: 92,
        },
      ],
      tracks: [],
    },
    library: {
      artists: [
        {
          type: "artist",
          id: "bk",
          name: "The Black Keys",
          score: 67,
          inLibrary: true,
        },
      ],
      playlists: [
        {
          type: "playlist",
          id: "dw",
          name: "Discover Weekly",
          score: 67,
          inLibrary: true,
        },
      ],
      tracks: [],
    },
  });

  assert.equal(items[0].name, "My Chemical Romance");
  assert.equal(
    items.some((item) => item.type === "album" && item.title === "The Black Parade"),
    true,
  );
});

test("pickTopSearchArtist falls back to best catalog artist without library matches", () => {
  const artist = pickTopSearchArtist({
    query: "bear",
    top: { type: "artist", id: "a1", name: "Bear", score: 115 },
    catalog: {
      artists: [
        { type: "artist", id: "a1", name: "Bear", score: 115 },
        { type: "artist", id: "a3", name: "Beartooth", score: 90 },
      ],
      albums: [],
      tracks: [],
    },
    library: { artists: [], tracks: [], playlists: [] },
  });

  assert.equal(artist.id, "a1");
});

test("buildMixedSearchPageItems excludes the highlighted top artist", () => {
  const topArtist = { type: "artist", id: "a1", name: "Bear", score: 115 };
  const items = buildMixedSearchPageItems(
    {
      catalog: {
        artists: [
          topArtist,
          { type: "artist", id: "a2", name: "Beartooth", score: 90 },
        ],
        albums: [
          {
            type: "album",
            id: "rg1",
            title: "Bear",
            artistName: "Remute",
            score: 100,
          },
        ],
        tracks: [],
      },
      library: { artists: [], tracks: [], playlists: [] },
    },
    { excludeArtist: topArtist },
  );

  assert.equal(
    items.some((item) => item.type === "artist" && item.name === "Bear"),
    false,
  );
  assert.equal(items.some((item) => item.type === "album"), true);
});

test("compareSearchResults boosts in-library catalog artists with strong matches", () => {
  const libraryArtist = {
    type: "artist",
    score: 95,
    inLibrary: true,
  };
  const catalogArtist = {
    type: "artist",
    score: 115,
    inLibrary: false,
  };

  assert.ok(getSearchRankScore(libraryArtist) > getSearchRankScore(catalogArtist));
  assert.ok(compareSearchResults(libraryArtist, catalogArtist) < 0);
});

test("buildUnifiedSuggestionSections avoids repeating the top artist name", () => {
  const sections = buildUnifiedSuggestionSections({
    top: { type: "artist", id: "a1", name: "Bear", score: 115 },
    catalog: {
      artists: [
        { type: "artist", id: "a1", name: "Bear", score: 115 },
        { type: "artist", id: "a2", name: "Bear", score: 110 },
        { type: "artist", id: "a3", name: "Beartooth", score: 90 },
      ],
      albums: [],
      tracks: [],
    },
    library: { artists: [], tracks: [], playlists: [] },
  });

  const artistItems =
    sections.find((section) => section.key === "artists")?.items || [];
  assert.equal(artistItems.length, 1);
  assert.equal(artistItems[0].name, "Beartooth");
});
