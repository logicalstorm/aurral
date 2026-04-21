import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeAlbumSearchItem,
  normalizeArtistSearchItem,
} from "../../backend/services/searchService.js";
import { libraryManager } from "../../backend/services/libraryManager.js";
import { lidarrClient } from "../../backend/services/lidarrClient.js";

test("normalizeArtistSearchItem preserves sort name and cached image", () => {
  const item = normalizeArtistSearchItem(
    {
      id: "artist-mbid",
      name: "Boards of Canada",
      "sort-name": "Canada, Boards of",
    },
    {
      "artist-mbid": { imageUrl: "https://images.example/artist.jpg" },
    },
  );

  assert.deepEqual(item, {
    type: "artist",
    id: "artist-mbid",
    name: "Boards of Canada",
    sortName: "Canada, Boards of",
    image: "https://images.example/artist.jpg",
    imageUrl: "https://images.example/artist.jpg",
    inLibrary: false,
  });
});

test("normalizeAlbumSearchItem preserves compilation metadata and library state", () => {
  const item = normalizeAlbumSearchItem(
    {
      id: "release-group-mbid",
      title: "Chrono Trigger Original Sound Version",
      "artist-credit": [
        {
          name: "Various Artists",
          artist: { id: "various-artists-mbid", name: "Various Artists" },
        },
      ],
      "first-release-date": "1995-03-11",
      "primary-type": "Album",
      "secondary-types": ["Soundtrack", "Compilation"],
    },
    {
      libraryAlbumId: "42",
      libraryArtistId: "7",
      status: "inLibrary",
    },
  );

  assert.deepEqual(item, {
    type: "album",
    id: "release-group-mbid",
    title: "Chrono Trigger Original Sound Version",
    artistName: "Various Artists",
    artistMbid: "various-artists-mbid",
    releaseDate: "1995-03-11",
    primaryType: "Album",
    secondaryTypes: ["Soundtrack", "Compilation"],
    coverUrl: null,
    inLibrary: true,
    libraryAlbumId: "42",
    libraryArtistId: "7",
    status: "inLibrary",
  });
});

test("requestAlbumFromSearch creates an album-only artist and triggers search", async () => {
  const originalIsConfigured = lidarrClient.isConfigured;
  const originalGetAlbumByMbid = lidarrClient.getAlbumByMbid;
  const originalGetArtist = libraryManager.getArtist;
  const originalAddArtist = libraryManager.addArtist;
  const originalAddAlbum = libraryManager.addAlbum;

  lidarrClient.isConfigured = () => true;
  lidarrClient.getAlbumByMbid = async () => null;
  libraryManager.getArtist = async () => null;
  libraryManager.addArtist = async (_mbid, _name, options = {}) => ({
    id: "7",
    mbid: "artist-mbid",
    foreignArtistId: "artist-mbid",
    artistName: "Various Artists",
    albumOnly: options.albumOnly,
  });
  libraryManager.addAlbum = async () => ({
    id: "42",
    artistId: "7",
    mbid: "album-mbid",
    foreignAlbumId: "album-mbid",
    albumName: "Chrono Trigger",
    monitored: true,
    statistics: {
      percentOfTracks: 0,
      sizeOnDisk: 0,
    },
  });

  try {
    const result = await libraryManager.requestAlbumFromSearch({
      albumMbid: "album-mbid",
      albumName: "Chrono Trigger",
      artistMbid: "artist-mbid",
      artistName: "Various Artists",
      triggerSearch: true,
      user: {
        role: "user",
        permissions: { addAlbum: true, addArtist: true },
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.createdArtist, true);
    assert.equal(result.createdAlbum, true);
    assert.equal(result.triggeredSearch, true);
    assert.equal(result.status, "searching");
    assert.equal(result.artist.id, "7");
    assert.equal(result.album.id, "42");
  } finally {
    lidarrClient.isConfigured = originalIsConfigured;
    lidarrClient.getAlbumByMbid = originalGetAlbumByMbid;
    libraryManager.getArtist = originalGetArtist;
    libraryManager.addArtist = originalAddArtist;
    libraryManager.addAlbum = originalAddAlbum;
  }
});

test("requestAlbumFromSearch rejects when artist must be created without addArtist permission", async () => {
  const originalIsConfigured = lidarrClient.isConfigured;
  const originalGetArtist = libraryManager.getArtist;

  lidarrClient.isConfigured = () => true;
  libraryManager.getArtist = async () => null;

  try {
    await assert.rejects(
      () =>
        libraryManager.requestAlbumFromSearch({
          albumMbid: "album-mbid",
          albumName: "Chrono Trigger",
          artistMbid: "artist-mbid",
          artistName: "Various Artists",
          user: {
            role: "user",
            permissions: { addAlbum: true, addArtist: false },
          },
        }),
      (error) => {
        assert.equal(error.statusCode, 403);
        assert.match(error.message, /Permission required: addArtist/);
        return true;
      },
    );
  } finally {
    lidarrClient.isConfigured = originalIsConfigured;
    libraryManager.getArtist = originalGetArtist;
  }
});
