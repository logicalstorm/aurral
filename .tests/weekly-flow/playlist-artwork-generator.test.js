import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { buildGeneratedPlaylistArtworkBuffer } from "../../backend/services/playlistArtworkGenerator.js";

test("buildGeneratedPlaylistArtworkBuffer returns aurral WebP artwork", async () => {
  const buffer = await buildGeneratedPlaylistArtworkBuffer({
    title: "Road Trip",
    kind: "Playlist",
    style: "aurral",
  });
  const metadata = await sharp(buffer).metadata();
  assert.equal(metadata.width, 1000);
  assert.equal(metadata.height, 1000);
  assert.equal(metadata.format, "webp");
});
