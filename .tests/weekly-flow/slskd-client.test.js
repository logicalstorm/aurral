import test from "node:test";
import assert from "node:assert/strict";
import http from "http";

import { importFromRepo } from "../helpers/backendTestHarness.js";

const [
  { isSearchComplete, isSearchInProgress, slskdClient },
  { dbOps },
] = await Promise.all([
  importFromRepo("backend/services/slskdClient.js"),
  importFromRepo("backend/config/db-helpers.js"),
]);

function createMockServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

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
  assert.equal(results[0].locked, false);
  assert.equal(results[1].locked, true);
});

test("flattenSearchResults reads slskd collection wrapper payloads", () => {
  const results = slskdClient.flattenSearchResults({
    responses: {
      $values: [
        {
          username: "peerTwo",
          files: {
            $values: [
              {
                filename: "Artist/Album/03 - Wrapped.flac",
                size: 789,
                bitRate: 1411,
              },
            ],
          },
        },
      ],
    },
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].user, "peerTwo");
  assert.equal(results[0].file, "Artist/Album/03 - Wrapped.flac");
  assert.equal(results[0].bitrate, 1411);
});

test("enqueueBatch rejects slskd all-failed batch responses", async () => {
  const originalSettings = dbOps.getSettings();
  const mock = await createMockServer(async (request, response) => {
    request.resume();
    if (
      request.method === "POST" &&
      request.url === "/api/v0/transfers/downloads/batches"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          batch: {
            id: "00000000-0000-4000-8000-000000000001",
            transfers: [],
          },
          failures: [
            {
              filename: "Artist/Album/Locked.flac",
              message: "File not shared",
            },
          ],
        }),
      );
      return;
    }
    response.writeHead(404);
    response.end();
  });

  dbOps.updateSettings({
    ...originalSettings,
    integrations: {
      ...(originalSettings.integrations || {}),
      slskd: {
        url: mock.url,
        apiKey: "test-key",
      },
    },
  });

  try {
    await assert.rejects(
      () =>
        slskdClient.enqueueBatch({
          username: "peer",
          files: [{ filename: "Artist/Album/Locked.flac", size: 123 }],
        }),
      /File not shared/,
    );
  } finally {
    dbOps.updateSettings(originalSettings);
    await mock.close();
  }
});
