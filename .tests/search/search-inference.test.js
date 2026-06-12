import test from "node:test";
import assert from "node:assert/strict";

import {
  demoteShadowArtists,
  enrichCatalogArtists,
  inferArtistsFromCatalog,
} from "../../backend/services/searchInference.js";
import {
  getCatalogArtists,
  pickTopSearchArtist,
} from "../../frontend/src/utils/searchNavigation.js";

const BLACK_PARADE_CATALOG = {
  artists: [
    {
      type: "artist",
      id: "c64661a8-3b42-401a-a33a-14f0aac5ce95",
      name: "The Black Parade",
      score: 115,
    },
  ],
  albums: [
    {
      type: "album",
      id: "bcba43e7-2f72-3b60-b234-577e77fd2d9e",
      title: "The Black Parade",
      artistName: "My Chemical Romance",
      artistMbid: "c07f0676-9143-4217-8a9f-4c26bd636f13",
      score: 92,
    },
  ],
  tracks: [],
};

test("inferArtistsFromCatalog promotes album artists for title matches", () => {
  const artists = inferArtistsFromCatalog(BLACK_PARADE_CATALOG, "the black parade");

  assert.equal(artists.length, 1);
  assert.equal(artists[0].name, "My Chemical Romance");
  assert.ok(artists[0].score > 115);
});

test("enrichCatalogArtists ranks My Chemical Romance above shadow artist names", () => {
  const artists = enrichCatalogArtists(BLACK_PARADE_CATALOG, "the black parade");
  const top = artists.sort((left, right) => right.score - left.score)[0];

  assert.equal(top.name, "My Chemical Romance");
});

test("demoteShadowArtists lowers artists that share the album title", () => {
  const artists = demoteShadowArtists(
    BLACK_PARADE_CATALOG.artists,
    BLACK_PARADE_CATALOG,
    "the black parade",
  );

  assert.ok(artists[0].score < 115);
});

test("pickTopSearchArtist surfaces album artist for album title queries", () => {
  const artist = pickTopSearchArtist(
    {
      query: "the black parade",
      top: BLACK_PARADE_CATALOG.artists[0],
      catalog: BLACK_PARADE_CATALOG,
      library: { artists: [], tracks: [], playlists: [] },
    },
    {},
    "the black parade",
  );

  assert.equal(artist.name, "My Chemical Romance");
});

test("getCatalogArtists mirrors backend inference in the frontend", () => {
  const artists = getCatalogArtists(
    {
      query: "the black parade",
      catalog: BLACK_PARADE_CATALOG,
    },
    "the black parade",
  );

  assert.equal(
    artists.sort((left, right) => right.score - left.score)[0].name,
    "My Chemical Romance",
  );
});
