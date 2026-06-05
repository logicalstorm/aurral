import test from "node:test";
import assert from "node:assert/strict";

import {
  createIsolatedStateDir,
  applyIsolatedBackendEnv,
  cleanupIsolatedState,
  importFromRepo,
} from "../helpers/backendTestHarness.js";

const isolatedState = await createIsolatedStateDir("weekly-flow-paths");
applyIsolatedBackendEnv(isolatedState);

const { resolveWeeklyFlowRoot } = await importFromRepo(
  "backend/services/weeklyFlowPaths.js",
);

test.after(async () => {
  await cleanupIsolatedState(isolatedState);
});

test("resolveWeeklyFlowRoot prefers WEEKLY_FLOW_FOLDER", () => {
  const previousWeekly = process.env.WEEKLY_FLOW_FOLDER;
  const previousDownload = process.env.DOWNLOAD_FOLDER;
  process.env.WEEKLY_FLOW_FOLDER = "/custom/flow";
  process.env.DOWNLOAD_FOLDER = "/data/downloads/tmp";
  try {
    assert.equal(resolveWeeklyFlowRoot(), "/custom/flow");
  } finally {
    if (previousWeekly === undefined) delete process.env.WEEKLY_FLOW_FOLDER;
    else process.env.WEEKLY_FLOW_FOLDER = previousWeekly;
    if (previousDownload === undefined) delete process.env.DOWNLOAD_FOLDER;
    else process.env.DOWNLOAD_FOLDER = previousDownload;
  }
});

test("resolveWeeklyFlowRoot uses absolute DOWNLOAD_FOLDER when WEEKLY_FLOW_FOLDER is unset", () => {
  const previousWeekly = process.env.WEEKLY_FLOW_FOLDER;
  const previousDownload = process.env.DOWNLOAD_FOLDER;
  delete process.env.WEEKLY_FLOW_FOLDER;
  process.env.DOWNLOAD_FOLDER = "/data/downloads/tmp";
  try {
    assert.equal(resolveWeeklyFlowRoot(), "/data/downloads/tmp");
  } finally {
    if (previousWeekly === undefined) delete process.env.WEEKLY_FLOW_FOLDER;
    else process.env.WEEKLY_FLOW_FOLDER = previousWeekly;
    if (previousDownload === undefined) delete process.env.DOWNLOAD_FOLDER;
    else process.env.DOWNLOAD_FOLDER = previousDownload;
  }
});

test("resolveWeeklyFlowRoot falls back to /app/downloads for relative DOWNLOAD_FOLDER", () => {
  const previousWeekly = process.env.WEEKLY_FLOW_FOLDER;
  const previousDownload = process.env.DOWNLOAD_FOLDER;
  delete process.env.WEEKLY_FLOW_FOLDER;
  process.env.DOWNLOAD_FOLDER = "./data/downloads";
  try {
    assert.equal(resolveWeeklyFlowRoot(), "/app/downloads");
  } finally {
    if (previousWeekly === undefined) delete process.env.WEEKLY_FLOW_FOLDER;
    else process.env.WEEKLY_FLOW_FOLDER = previousWeekly;
    if (previousDownload === undefined) delete process.env.DOWNLOAD_FOLDER;
    else process.env.DOWNLOAD_FOLDER = previousDownload;
  }
});
