import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMixedSearchPageItems,
  buildMixedSuggestionItems,
  buildUnifiedSuggestionSections,
  getReleaseNavigationTarget,
} from "../../frontend/src/utils/searchNavigation.js";

test("buildMixedSuggestionItems uses API top as the first item", () => {
  const top = {
    type: "artist",
    id: "mcr",
    name: "My Chemical Romance",
    score: 0.998,
  };
  const items = buildMixedSuggestionItems({
    query: "my chemical romance",
    top,
    catalog: {
      artists: [top],
      albums: [],
      tracks: [],
    },
    library: { artists: [], tracks: [], playlists: [] },
  });

  assert.equal(items[0]?.type, "artist");
  assert.equal(items[0]?.name, "My Chemical Romance");
});

test("buildMixedSuggestionItems dedupes artists with the same display name", () => {
  const items = buildMixedSuggestionItems({
    catalog: {
      artists: [
        { type: "artist", id: "a1", name: "Bear", score: 0.92 },
        { type: "artist", id: "a2", name: "Bear", score: 0.88 },
        { type: "artist", id: "a3", name: "Beartooth", score: 0.75 },
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

test("buildMixedSuggestionItems preserves catalog bucket order", () => {
  const items = buildMixedSuggestionItems({
    catalog: {
      artists: [{ type: "artist", id: "a1", name: "Bear", score: 0.72 }],
      albums: [
        {
          type: "album",
          id: "rg1",
          title: "Bear",
          artistName: "Remute",
          score: 0.95,
        },
      ],
      tracks: [
        {
          type: "track",
          id: "r1",
          title: "Bear",
          artistName: "Support Lesbiens",
          score: 0.84,
        },
      ],
    },
    library: { artists: [], tracks: [], playlists: [] },
  });

  assert.deepEqual(
    items.map((item) => item.type),
    ["artist", "album", "track"],
  );
});

test("getReleaseNavigationTarget preserves focused track album metadata", () => {
  const target = getReleaseNavigationTarget({
    type: "track",
    id: "track-1",
    title: "Welcome to the Black Parade",
    artistMbid: "artist-1",
    artistName: "My Chemical Romance",
    albumMbid: "album-1",
    albumTitle: "The Black Parade",
    releaseYear: "2006",
    primaryType: "Album",
    coverUrl: "https://example.test/cover.jpg",
  });

  assert.equal(
    target.pathname,
    "/artist/artist-1/release/album-1",
  );
  assert.equal(target.state.focusReleaseGroupMbid, "album-1");
  assert.equal(target.state.focusTrackMbid, "track-1");
  assert.equal(target.state.focusTrackTitle, "Welcome to the Black Parade");
  assert.deepEqual(target.state.focusReleaseGroup, {
    id: "album-1",
    title: "The Black Parade",
    firstReleaseDate: "2006",
    primaryType: "Album",
    secondaryTypes: [],
    coverUrl: "https://example.test/cover.jpg",
    deezerAlbumId: "",
  });
});

test("buildMixedSuggestionItems places library playlists before catalog buckets", () => {
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
          score: 0.94,
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
          score: 0.88,
          inLibrary: true,
        },
      ],
    },
  });

  assert.equal(items[0].type, "playlist");
  assert.equal(items[1].type, "track");
});

test("buildMixedSuggestionItems prefers catalog for album title queries when API top is set", () => {
  const album = {
    type: "album",
    id: "tbp",
    title: "The Black Parade",
    artistName: "My Chemical Romance",
    artistMbid: "mcr",
    score: 0.94,
  };
  const items = buildMixedSuggestionItems(
    {
      query: "the black parade",
      top: album,
      catalog: {
        artists: [
          {
            type: "artist",
            id: "shadow",
            name: "The Black Parade",
            score: 0.91,
          },
        ],
        albums: [album],
        tracks: [
          {
            type: "track",
            id: "willie",
            title: "The Black Parade",
            artistName: "Willie Nile",
            artistMbid: "willie",
            score: 0.86,
          },
        ],
      },
      library: { artists: [], tracks: [], playlists: [] },
    },
    8,
  );

  assert.equal(items[0].type, "album");
  assert.equal(items[0].title, "The Black Parade");
});

test("buildMixedSearchPageItems excludes the highlighted top item", () => {
  const topArtist = {
    type: "artist",
    id: "bear-mbid",
    name: "Bear",
    score: 0.94,
  };
  const items = buildMixedSearchPageItems(
    {
      query: "bear",
      top: topArtist,
      catalog: {
        artists: [topArtist, { type: "artist", id: "a2", name: "Beartooth", score: 0.82 }],
        albums: [{ type: "album", id: "rg1", title: "Bear", artistName: "Remute", score: 0.88 }],
        tracks: [],
      },
      library: { artists: [], tracks: [], playlists: [] },
    },
    { excludeItem: topArtist },
  );

  assert.equal(
    items.some((item) => item.type === "artist" && item.name === "Bear"),
    false,
  );
  assert.equal(items.some((item) => item.type === "album"), true);
});

test("buildUnifiedSuggestionSections avoids repeating the top artist name", () => {
  const topArtist = {
    type: "artist",
    id: "bear-mbid",
    name: "Bear",
    score: 0.94,
  };
  const sections = buildUnifiedSuggestionSections({
    query: "bear",
    top: topArtist,
    catalog: {
      artists: [
        topArtist,
        { type: "artist", id: "a2", name: "Beartooth", score: 0.82 },
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
