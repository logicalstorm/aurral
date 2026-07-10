import test from "node:test";
import assert from "node:assert/strict";
import {
  setupIsolatedBackend,
  cleanupIsolatedState,
} from "./helpers/backendTestHarness.js";
import {
  defaultData,
  DEFAULT_METADATA_BASE_URL,
} from "../backend/config/constants.js";

const [isolatedState, { dbOps }, apiClients] = await setupIsolatedBackend(
  "metadata-providers",
  "backend/db/helpers/index.js",
  "backend/services/apiClients/index.js",
);

const {
  getMetadataProviderHealthSnapshot,
  getMusicbrainzApiBaseUrl,
} = apiClients;

test.after(async () => {
  await cleanupIsolatedState(isolatedState);
});

test("default settings and unset backend config use BrainzMash metadata", () => {
  assert.equal(
    defaultData.settings.integrations.metadata.provider,
    "brainzmash",
  );
  assert.equal(
    defaultData.settings.integrations.metadata.baseUrl,
    DEFAULT_METADATA_BASE_URL,
  );
  assert.equal(getMusicbrainzApiBaseUrl(), DEFAULT_METADATA_BASE_URL);

  dbOps.updateSettings({
    ...dbOps.getSettings(),
    integrations: {
      ...(dbOps.getSettings().integrations || {}),
      metadata: {
        provider: "brainzmash",
        baseUrl: "",
        userAgentSuffix: "",
        enableNarrowFallbacks: true,
      },
    },
  });

  assert.equal(getMusicbrainzApiBaseUrl(), DEFAULT_METADATA_BASE_URL);
});

test("custom BrainzMash base URL is respected end to end", () => {
  dbOps.updateSettings({
    ...dbOps.getSettings(),
    integrations: {
      ...(dbOps.getSettings().integrations || {}),
      metadata: {
        provider: "brainzmash",
        baseUrl: "https://brainzmash.example.net",
        userAgentSuffix: "AurralTest",
        enableNarrowFallbacks: false,
      },
    },
  });

  assert.equal(getMusicbrainzApiBaseUrl(), "https://brainzmash.example.net");
});

test("provider health snapshot reports BrainzMash state", () => {
  const snapshot = getMetadataProviderHealthSnapshot();
  assert.ok(snapshot.brainzmash);
  assert.equal(snapshot.brainzmash.configuredProvider, "brainzmash");
  assert.equal(snapshot.brainzmash.activeBaseUrl, getMusicbrainzApiBaseUrl());
  assert.equal(snapshot.brainzmash.failoverActive, false);
});
