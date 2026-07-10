import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeDiscoveryHttp,
  stripDiscoveryStatusForStorage,
} from "../../frontend/src/pages/discoverUtils.js";

test("HTTP must not clear live WS playlistsUpdating while socket owns status", () => {
  const afterWs = mergeDiscoveryHttp(
    { playlistsUpdating: false, isUpdating: false, lastUpdated: "2026-01-01" },
    {
      playlistsUpdating: true,
      playlistsUpdateMessage: "Building...",
      isUpdating: false,
      lastUpdated: "2026-01-01",
    },
    { allowClearStatus: true },
  );
  assert.equal(afterWs.playlistsUpdating, true);

  const afterRace = mergeDiscoveryHttp(
    afterWs,
    {
      playlistsUpdating: false,
      isUpdating: false,
      lastUpdated: "2026-01-01",
      recommendations: [{ name: "A" }],
    },
    { allowClearStatus: false },
  );
  assert.equal(afterRace.playlistsUpdating, true);
  assert.equal(afterRace.playlistsUpdateMessage, "Building...");
  assert.equal(afterRace.recommendations.length, 1);
});

test("HTTP must not clear live WS isUpdating while socket owns status", () => {
  const live = mergeDiscoveryHttp(
    null,
    {
      isUpdating: true,
      updateProgressMessage: "Scanning...",
      updateProgress: 40,
      recommendations: [],
    },
    { allowClearStatus: true },
  );
  const raced = mergeDiscoveryHttp(
    live,
    {
      isUpdating: false,
      lastUpdated: "2026-01-01",
      recommendations: [{ name: "B" }],
    },
    { allowClearStatus: false },
  );
  assert.equal(raced.isUpdating, true);
  assert.equal(raced.updateProgressMessage, "Scanning...");
  assert.equal(raced.updateProgress, 40);
  assert.equal(raced.recommendations[0].name, "B");
});

test("HTTP may clear status when allowClearStatus is true", () => {
  const cleared = mergeDiscoveryHttp(
    {
      isUpdating: true,
      playlistsUpdating: true,
      updateProgressMessage: "Scanning...",
    },
    { isUpdating: false, playlistsUpdating: false, lastUpdated: "2026-01-02" },
    { allowClearStatus: true },
  );
  assert.equal(cleared.isUpdating, false);
  assert.equal(cleared.playlistsUpdating, false);
});

test("storage strip drops ephemeral status flags", () => {
  const stored = stripDiscoveryStatusForStorage({
    recommendations: [{ name: "C" }],
    isUpdating: true,
    playlistsUpdating: true,
    updateProgressMessage: "nope",
    lastUpdated: "2026-01-03",
  });
  assert.equal(stored.isUpdating, false);
  assert.equal(stored.playlistsUpdating, false);
  assert.equal(stored.updateProgressMessage, null);
  assert.equal(stored.recommendations[0].name, "C");
  assert.equal(stored.lastUpdated, "2026-01-03");
});
