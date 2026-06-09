import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { importFromRepo } from "../helpers/backendTestHarness.js";

const {
  buildGeneratedPlaylistArtworkBuffer,
  resolvePlaylistSourceImageUrl,
} = await importFromRepo("backend/services/playlistArtworkGenerator.js");

test("resolvePlaylistSourceImageUrl keeps a stable seed by default", async () => {
  const first = await resolvePlaylistSourceImageUrl({ signature: "flow-1" });
  const second = await resolvePlaylistSourceImageUrl({ signature: "flow-1" });
  assert.equal(first, second);
  assert.match(first, /seed\/flow-1\//);
});

test("resolvePlaylistSourceImageUrl rotates the seed when requested", async () => {
  const first = await resolvePlaylistSourceImageUrl({
    signature: "flow-1",
    rotate: true,
  });
  const second = await resolvePlaylistSourceImageUrl({
    signature: "flow-1",
    rotate: true,
  });
  assert.notEqual(first, second);
  assert.match(first, /seed\/flow-1%3A/);
});

test("buildGeneratedPlaylistArtworkBuffer returns aurral WebP artwork", async () => {
  const buffer = await buildGeneratedPlaylistArtworkBuffer({
    title: "Road Trip",
    kind: "Playlist",
    signature: "playlist-1",
    style: "aurral",
  });
  const metadata = await sharp(buffer).metadata();
  assert.equal(metadata.width, 1000);
  assert.equal(metadata.height, 1000);
  assert.equal(metadata.format, "webp");
});
