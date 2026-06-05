import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTrackFileIndex,
  enrichLidarrTrackWithFiles,
  albumNeedsTrackFiles,
} from "../../backend/services/libraryManager.js";

test("buildTrackFileIndex maps trackFileId and trackIds", () => {
  const index = buildTrackFileIndex([
    {
      id: 10915,
      path: "/data/music/Artist/Album/track.mp3",
      trackIds: [42],
    },
  ]);

  assert.equal(index.get(10915)?.path, "/data/music/Artist/Album/track.mp3");
  assert.equal(index.get("track:42")?.path, "/data/music/Artist/Album/track.mp3");
});

test("enrichLidarrTrackWithFiles attaches trackFile from trackFileId", () => {
  const index = buildTrackFileIndex([
    {
      id: 10915,
      path: "/data/music/Actual Water/Call 4 Fun/track.mp3",
      size: 123,
    },
  ]);

  const enriched = enrichLidarrTrackWithFiles(
    {
      id: 7,
      title: "Take the Stairs",
      hasFile: true,
      trackFileId: 10915,
      path: null,
      trackFile: null,
    },
    index,
  );

  assert.equal(enriched.trackFile.path, "/data/music/Actual Water/Call 4 Fun/track.mp3");
});

test("albumNeedsTrackFiles returns true when album has files on disk", () => {
  assert.equal(
    albumNeedsTrackFiles({
      albumSizeOnDisk: 1,
      isAlbumComplete: false,
      tracks: [],
    }),
    true,
  );
  assert.equal(
    albumNeedsTrackFiles({
      albumSizeOnDisk: 0,
      isAlbumComplete: false,
      tracks: [{ hasFile: true, trackFileId: 1 }],
    }),
    true,
  );
  assert.equal(
    albumNeedsTrackFiles({
      albumSizeOnDisk: 0,
      isAlbumComplete: false,
      tracks: [{ hasFile: false }],
    }),
    false,
  );
});
