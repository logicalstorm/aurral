import assert from "node:assert/strict";
import { tracksShareMembership } from "./weeklyFlow/weeklyFlowPlaylistConfig.js";

const playlistTrack = {
  artistName: "Radiohead",
  trackName: "Creep",
  albumName: "Pablo Honey",
  artistMbid: "a74b1b7f-71a5-4011-9441-d0b5e4122711",
  albumMbid: "cd76f76b-ff15-3784-a71d-4da3078a6851",
  trackMbid: "f432e39b-6af5-46cc-9d53-04f5946b73c1",
  releaseYear: null,
};

const job = {
  ...playlistTrack,
  releaseYear: "1993",
  status: "done",
  finalPath: "/tmp/creep.flac",
};

assert.equal(tracksShareMembership(playlistTrack, job), true);
console.log("playlistM3u.check.js ok");
