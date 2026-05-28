import test from "node:test";
import assert from "node:assert/strict";

import { selectBestArtistImage } from "../backend/services/imageService.js";

test("artist image selection prefers poster art over banners for square displays", () => {
  const selected = selectBestArtistImage([
    {
      kind: "Banner",
      url: "https://assets.fanart.tv/fanart/bieber-justin-50788c8b98378.jpg",
    },
    {
      kind: "Fanart",
      url: "https://assets.fanart.tv/fanart/bieber-justin-56167e6110c53.jpg",
    },
    {
      kind: "Logo",
      url: "https://assets.fanart.tv/fanart/bieber-justin-5c19a40664655.png",
    },
    {
      kind: "Poster",
      url: "https://assets.fanart.tv/fanart/bieber-justin-5375fe939e307.jpg",
    },
  ]);

  assert.equal(
    selected?.url,
    "https://assets.fanart.tv/fanart/bieber-justin-5375fe939e307.jpg",
  );
});

test("artist image selection keeps source order when image types tie", () => {
  const selected = selectBestArtistImage([
    { kind: "Fanart", url: "https://example.test/first.jpg" },
    { kind: "Fanart", url: "https://example.test/second.jpg" },
  ]);

  assert.equal(selected?.url, "https://example.test/first.jpg");
});
