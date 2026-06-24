import test from "node:test";
import assert from "node:assert/strict";
import { WeeklyFlowPlaylistSource } from "../../../../backend/services/weeklyFlow/weeklyFlowPlaylistSource.js";

test("harvest limit scales with target without over-fetching", () => {
  const source = new WeeklyFlowPlaylistSource();
  assert.equal(source._harvestLimitFor(10), 30);
  assert.equal(source._harvestLimitFor(30), 72);
  assert.equal(source._harvestLimitFor(100), 72);
});

test("mix album pick prefers top track list metadata before track.getInfo", () => {
  const source = new WeeklyFlowPlaylistSource();
  const ownedTitles = new Set(["owned track"]);
  const ownedAlbums = new Set(["owned album"]);
  const trackList = [
    { name: "Owned Track", album: { title: "Owned Album" } },
    { name: "Fresh Track", album: { title: "New Album" } },
  ];
  const picked = source._pickTrackFromRangesWithOwnedAlbumsUsingListMetadata(
    trackList,
    ownedTitles,
    ownedAlbums,
    [{ start: 0, end: 5 }],
  );
  assert.equal(picked?.pick?.name, "Fresh Track");
  assert.equal(picked?.albumName, "New Album");
});

test("discover tracks use injected discovery cache when provided", async () => {
  const source = new WeeklyFlowPlaylistSource();
  source._harvestTopTracksFromArtists = async (artists) =>
    artists.map((artist) => ({
      artistName: artist.name,
      trackName: "Preview",
    }));

  const tracks = await source.getDiscoverTracks(1, {
    discoveryCache: {
      recommendations: [{ name: "Injected Artist" }],
    },
  });

  assert.equal(tracks[0]?.artistName, "Injected Artist");
});

test("library artist key set can be built from preloaded artists", async () => {
  const source = new WeeklyFlowPlaylistSource();
  const keys = await source._getLibraryArtistKeySet({
    libraryArtists: [
      {
        id: "artist-id",
        mbid: "artist-mbid",
        artistName: "Library Artist",
      },
    ],
  });

  assert.ok(keys.has("artist-id"));
  assert.ok(keys.has("artist-mbid"));
  assert.ok(keys.has("library artist"));
});

test("release radar picks a release track from metadata before Last.fm fallbacks", async () => {
  const source = new WeeklyFlowPlaylistSource();
  source._getMetadataAlbumTrackList = async () => [
    {
      title: "Opening Track",
      trackNumber: 1,
      recordingId: "recording-mbid",
      durationMs: 185000,
    },
  ];
  source._getLastfmAlbumInfo = async () => {
    throw new Error("Last.fm should not be needed");
  };

  const track = await source._pickTrackFromRelease({
    artistName: "Library Artist",
    albumTitle: "New Album",
    albumMbid: "album-mbid",
    artistMbid: "artist-mbid",
    releaseYear: "2026",
  });

  assert.equal(track?.trackName, "Opening Track");
  assert.equal(track?.albumName, "New Album");
  assert.equal(track?.trackMbid, "recording-mbid");
  assert.equal(track?.durationMs, 185000);
});

test("release radar does not substitute an unrelated artist top track", async () => {
  const previousLastfmApiKey = process.env.LASTFM_API_KEY;
  process.env.LASTFM_API_KEY = "test-key";
  const source = new WeeklyFlowPlaylistSource();
  source._getMetadataAlbumTrackList = async () => [];
  source._getLastfmAlbumInfo = async () => null;
  source._getArtistTopTrackList = async () => [
    { name: "Sober to Death", album: { title: "Twin Fantasy (Face to Face)" } },
  ];

  try {
    const track = await source._pickTrackFromRelease({
      artistName: "Car Seat Headrest",
      albumTitle: "Teen of Denial (Joe's Story)",
      albumMbid: "album-mbid",
      artistMbid: "artist-mbid",
      releaseYear: "2026",
    });

    assert.equal(track, null);
  } finally {
    if (previousLastfmApiKey == null) {
      delete process.env.LASTFM_API_KEY;
    } else {
      process.env.LASTFM_API_KEY = previousLastfmApiKey;
    }
  }
});

test("release radar accepts artist top track fallback only when the album matches", async () => {
  const previousLastfmApiKey = process.env.LASTFM_API_KEY;
  process.env.LASTFM_API_KEY = "test-key";
  const source = new WeeklyFlowPlaylistSource();
  source._getMetadataAlbumTrackList = async () => [];
  source._getLastfmAlbumInfo = async () => null;
  source._getArtistTopTrackList = async () => [
    { name: "Sober to Death", album: { title: "Twin Fantasy (Face to Face)" } },
    { name: "Joe Gets Kicked", album: { title: "Teen of Denial (Joe's Story)" } },
  ];

  try {
    const track = await source._pickTrackFromRelease({
      artistName: "Car Seat Headrest",
      albumTitle: "Teen of Denial (Joe's Story)",
      albumMbid: "album-mbid",
      artistMbid: "artist-mbid",
      releaseYear: "2026",
    });

    assert.equal(track?.trackName, "Joe Gets Kicked");
    assert.equal(track?.albumName, "Teen of Denial (Joe's Story)");
  } finally {
    if (previousLastfmApiKey == null) {
      delete process.env.LASTFM_API_KEY;
    } else {
      process.env.LASTFM_API_KEY = previousLastfmApiKey;
    }
  }
});
