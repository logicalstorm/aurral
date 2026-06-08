import test from "node:test";
import assert from "node:assert/strict";

import { importFromRepo } from "../helpers/backendTestHarness.js";

const [
  { isSearchComplete, isSearchInProgress, slskdClient },
] = await Promise.all([importFromRepo("backend/services/slskdClient.js")]);

test("isSearchInProgress treats Requested and InProgress as active", () => {
  assert.equal(isSearchInProgress({ state: "Requested" }), true);
  assert.equal(isSearchInProgress({ state: "InProgress" }), true);
  assert.equal(isSearchInProgress({ state: "Queued" }), true);
  assert.equal(isSearchInProgress({ state: "InProgress, Completed" }), false);
  assert.equal(isSearchInProgress({ isComplete: true }), false);
});

test("isSearchComplete recognizes completed search states", () => {
  assert.equal(isSearchComplete({ state: "Completed" }), true);
  assert.equal(isSearchComplete({ state: "InProgress, Completed" }), true);
  assert.equal(isSearchComplete({ isComplete: true }), true);
  assert.equal(isSearchComplete({ state: "InProgress" }), false);
  assert.equal(isSearchComplete({ state: "Requested" }), false);
});

test("flattenSearchResults reads files and lockedFiles payloads", () => {
  const results = slskdClient.flattenSearchResults({
    responses: [
      {
        username: "peerOne",
        files: [
          {
            filename: "Artist\\Album\\01 - Track.flac",
            size: 123,
          },
        ],
        lockedFiles: [
          {
            filename: "Artist\\Album\\02 - Bonus.flac",
            size: 456,
          },
        ],
        hasFreeUploadSlot: true,
        uploadSpeed: 250000,
      },
    ],
  });

  assert.equal(results.length, 2);
  assert.equal(results[0].user, "peerOne");
  assert.equal(results[0].file, "Artist\\Album\\01 - Track.flac");
  assert.equal(results[1].file, "Artist\\Album\\02 - Bonus.flac");
  assert.equal(results[0].slots, 1);
  assert.equal(results[0].speed, 250000);
});
