import test from "node:test";
import assert from "node:assert/strict";

import { pickResolvedDurationMs } from "../../backend/services/providers/brainzmashRanking.js";

test("pickResolvedDurationMs prefers Last.fm only when albums agree", () => {
  assert.equal(
    pickResolvedDurationMs({
      playlistDurationMs: 282973,
      lastfmDurationMs: 207000,
      lastfmAlbumName: "Stages: Volume III",
      albumName: "Stages: Volume III",
      matchedTrackDurationMs: 282973,
    }),
    207000,
  );
  assert.equal(
    pickResolvedDurationMs({
      playlistDurationMs: 282973,
      lastfmDurationMs: 207000,
      lastfmAlbumName: "Other",
      albumName: "Stages: Volume III",
    }),
    282973,
  );
  assert.equal(
    pickResolvedDurationMs({
      playlistDurationMs: 282973,
      lastfmDurationMs: 207000,
      lastfmAlbumName: "",
      albumName: "Stages: Volume III",
    }),
    282973,
  );
  assert.equal(
    pickResolvedDurationMs({ lastfmDurationMs: null, matchedTrackDurationMs: 207000 }),
    207000,
  );
});
