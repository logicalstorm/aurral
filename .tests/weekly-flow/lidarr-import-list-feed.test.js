import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLidarrImportListItems,
  resolveLidarrFeedBaseUrl,
  verifyFlowLidarrFeedToken,
} from "../../backend/services/lidarrImportListFeed.js";

test("buildLidarrImportListItems maps jobs to lidarr custom list rows", () => {
  const items = buildLidarrImportListItems([
    {
      artistMbid: "11111111-1111-4111-8111-111111111111",
      albumMbid: "22222222-2222-4222-8222-222222222222",
    },
    {
      artistMbid: "11111111-1111-4111-8111-111111111111",
      albumMbid: "22222222-2222-4222-8222-222222222222",
    },
    {
      artistMbid: "33333333-3333-4333-8333-333333333333",
      albumMbid: null,
    },
    { artistMbid: null, albumMbid: "44444444-4444-4444-8444-444444444444" },
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    MusicBrainzId: "11111111-1111-4111-8111-111111111111",
    AlbumId: "22222222-2222-4222-8222-222222222222",
  });
  assert.deepEqual(items[1], {
    MusicBrainzId: "33333333-3333-4333-8333-333333333333",
  });
});

test("verifyFlowLidarrFeedToken rejects missing or mismatched tokens", () => {
  assert.equal(verifyFlowLidarrFeedToken("missing-flow", "token"), null);
});

test("resolveLidarrFeedBaseUrl uses docker service host when lidarr url is internal", () => {
  const baseUrl = resolveLidarrFeedBaseUrl({
    req: { get: (name) => (name === "host" ? "localhost:3001" : "") },
    lidarrUrl: "http://lidarr:8686",
    publicUrl: "",
    port: 3001,
  });
  assert.equal(baseUrl, "http://aurral:3001");
});

test("resolveLidarrFeedBaseUrl honors AURRAL_PUBLIC_URL", () => {
  const baseUrl = resolveLidarrFeedBaseUrl({
    req: { get: () => "localhost:3001" },
    lidarrUrl: "http://lidarr:8686",
    publicUrl: "http://aurral.example.com",
    port: 3001,
  });
  assert.equal(baseUrl, "http://aurral.example.com");
});
