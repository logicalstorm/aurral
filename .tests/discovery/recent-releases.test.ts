import test from "node:test";
import assert from "node:assert/strict";

import { getRecentMissingReleases } from "../../backend/services/recentReleasesService.ts";
import { lidarrClient } from "../../backend/services/lidarrClient.ts";

const artist = {
  id: 1,
  name: "Library Artist",
  foreignArtistId: "artist-mbid",
};

const buildAlbum = ({ id, title, releaseDate }) => ({
  id,
  artistId: artist.id,
  foreignAlbumId: `album-${id}`,
  title,
  releaseDate,
  monitored: true,
  statistics: {
    trackCount: 10,
    trackFileCount: 0,
    percentOfTracks: 0,
    sizeOnDisk: 0,
  },
});

test("recent missing releases can exclude future releases for Release Radar", async () => {
  const originalIsConfigured = lidarrClient.isConfigured;
  lidarrClient.isConfigured = () => true;

  try {
    const releases = await getRecentMissingReleases(10, {
      artists: [artist],
      albums: [
        buildAlbum({
          id: 1,
          title: "Released Album",
          releaseDate: "2026-06-11",
        }),
        buildAlbum({
          id: 2,
          title: "Future Album",
          releaseDate: "2026-08-20",
        }),
      ],
      includeFuture: false,
      now: "2026-06-15T12:00:00Z",
    });

    assert.deepEqual(
      releases.map((album) => album.albumName),
      ["Released Album"],
    );
  } finally {
    lidarrClient.isConfigured = originalIsConfigured;
  }
});

test("recent missing releases keep upcoming albums by default for the Discover rail", async () => {
  const originalIsConfigured = lidarrClient.isConfigured;
  lidarrClient.isConfigured = () => true;

  try {
    const releases = await getRecentMissingReleases(10, {
      artists: [artist],
      albums: [
        buildAlbum({
          id: 1,
          title: "Released Album",
          releaseDate: "2026-06-11",
        }),
        buildAlbum({
          id: 2,
          title: "Future Album",
          releaseDate: "2026-08-20",
        }),
      ],
      now: "2026-06-15T12:00:00Z",
    });

    assert.deepEqual(
      releases.map((album) => album.albumName),
      ["Future Album", "Released Album"],
    );
  } finally {
    lidarrClient.isConfigured = originalIsConfigured;
  }
});
