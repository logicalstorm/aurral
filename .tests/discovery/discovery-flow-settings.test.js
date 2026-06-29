import test from "node:test";
import assert from "node:assert/strict";
import {
  createIsolatedStateDir,
  applyIsolatedBackendEnv,
  cleanupIsolatedState,
  importFromRepo,
} from "../helpers/backendTestHarness.js";

const isolatedState = await createIsolatedStateDir("discovery-flow-settings");
applyIsolatedBackendEnv(isolatedState);

const { dbOps } = await importFromRepo("backend/db/helpers/index.js");
const {
  getDiscoveryRecommendationsPerRefresh,
  isDiscoveryPersonalizedEnabled,
} = await importFromRepo("backend/services/discovery/index.js");

test.after(async () => {
  await cleanupIsolatedState(isolatedState);
});

test("discovery flow settings use defaults when unset", () => {
  assert.equal(getDiscoveryRecommendationsPerRefresh(), 200);
  assert.equal(isDiscoveryPersonalizedEnabled(), true);
});

test("discovery personalized toggle", () => {
  const settings = dbOps.getSettings();
  assert.equal(isDiscoveryPersonalizedEnabled(), true);

  dbOps.updateSettings({
    ...settings,
    integrations: {
      ...settings.integrations,
      lastfm: {
        ...(settings.integrations?.lastfm || {}),
        discoveryPersonalizedEnabled: false,
      },
    },
  });
  assert.equal(isDiscoveryPersonalizedEnabled(), false);
});
