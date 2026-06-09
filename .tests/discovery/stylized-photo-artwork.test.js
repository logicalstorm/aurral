import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { importFromRepo } from "../helpers/backendTestHarness.js";

const { renderStylizedPhotoArtwork } = await importFromRepo(
  "backend/services/stylizedPhotoArtwork.js",
);

test("renderStylizedPhotoArtwork returns a square JPEG cover", async () => {
  const sourceBuffer = await sharp({
    create: {
      width: 800,
      height: 800,
      channels: 3,
      background: { r: 72, g: 96, b: 128 },
    },
  })
    .jpeg()
    .toBuffer();

  const output = await renderStylizedPhotoArtwork({
    imageBuffer: sourceBuffer,
    title: "Discover Weekly",
    signature: "discover-weekly",
  });

  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 1200);
  assert.equal(metadata.format, "jpeg");
  assert.ok(output.length > 10_000);
});
