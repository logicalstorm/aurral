import test from "node:test";
import assert from "node:assert/strict";
import {
  createIsolatedStateDir,
  applyIsolatedBackendEnv,
  cleanupIsolatedState,
  importFromRepo,
} from "../helpers/backendTestHarness.js";

const isolatedState = await createIsolatedStateDir("honker-worker-runtime");
applyIsolatedBackendEnv(isolatedState);

await importFromRepo("backend/config/db-sqlite.js");

const honkerDb = await importFromRepo("backend/services/honkerDb.js");
const runtime = await importFromRepo("backend/services/honkerWorkerRuntime.js");
const taskStatus = await importFromRepo("backend/services/honkerTaskStatus.js");
const operationQueueModule = await importFromRepo(
  "backend/services/weeklyFlowOperationQueue.js",
);

test.after(async () => {
  await cleanupIsolatedState(isolatedState);
});

test("getHonkerQueueDepth counts claimable pending jobs", () => {
  honkerDb.getWeeklyFlowOperationQueue().enqueue({ kind: "noop-test" });
  const depth = honkerDb.getHonkerQueueDepth("weekly-flow-operation");
  assert.ok(depth >= 1);
});

test("withJobHeartbeat extends job claim while work runs", async () => {
  const queue = honkerDb.getImagePrefetchQueue();
  const jobId = queue.enqueue({ mbids: ["test-mbid"] });
  const job = queue.claimOne(honkerDb.getWorkerId());
  assert.equal(job?.id, jobId);

  const initialExpiry = job.claimExpiresAt;
  await runtime.withJobHeartbeat(job, queue, async () => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
  });
  assert.ok(job.claimExpiresAt >= initialExpiry);
  job.ack();
});

test("withJobHeartbeat records completed task runs", async () => {
  const queue = honkerDb.getImagePrefetchQueue();
  const jobId = queue.enqueue({ mbids: ["recorded-mbid"] });
  const job = queue.claimOne(honkerDb.getWorkerId());
  assert.equal(job?.id, jobId);

  await runtime.withJobHeartbeat(job, queue, async () => {});
  job.ack();

  const status = await taskStatus.getHonkerTaskStatus();
  const recorded = status.queue.find(
    (entry) =>
      entry.source === "run" &&
      entry.jobId === jobId &&
      entry.queue === "image-prefetch",
  );
  assert.equal(recorded?.status, "completed");
  assert.match(recorded?.name || "", /Image Prefetch/);
});

test("task status groups duplicate scheduled live jobs", async () => {
  const queue = honkerDb.getDiscoveryRefreshQueue();
  const runAt = Math.floor(Date.now() / 1000) + 86400;
  queue.enqueue(
    { reason: "scheduled", requestedAt: Date.now(), scheduleOnly: true },
    { runAt },
  );
  queue.enqueue(
    {
      reason: "scheduled",
      requestedAt: Date.now() + 1000,
      scheduleOnly: true,
    },
    { runAt },
  );

  const status = await taskStatus.getHonkerTaskStatus();
  const grouped = status.queue.filter(
    (entry) =>
      entry.queue === "discovery-refresh" &&
      entry.name === "Discovery Auto Refresh",
  );

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].duplicateCount, 2);
  const worker = status.workers.find(
    (entry) => entry.queue === "discovery-refresh",
  );
  assert.equal(worker?.scheduled, 1);
});

test("task status groups duplicate completed system task runs", async () => {
  const queue = honkerDb.getSystemTaskQueue();
  for (let index = 0; index < 2; index += 1) {
    queue.enqueue({ kind: "discovery-bootstrap" });
    const job = queue.claimOne(honkerDb.getWorkerId());
    assert.ok(job);
    await runtime.withJobHeartbeat(job, queue, async () => {});
    job.ack();
  }

  const status = await taskStatus.getHonkerTaskStatus();
  const grouped = status.queue.filter(
    (entry) =>
      entry.queue === "system-task" &&
      entry.name === "Discovery Startup Check",
  );

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].duplicateCount, 2);
  assert.equal(grouped[0].payloadSummary, "");
});

test("weekly flow operation queue status reflects worker state and depth", () => {
  operationQueueModule.setWeeklyFlowOperationWorkerState({
    running: true,
    currentLabel: "manual-start-flow",
  });
  honkerDb.getWeeklyFlowOperationQueue().enqueue({ kind: "manual-start-flow" });
  const status = operationQueueModule.weeklyFlowOperationQueue.getStatus();
  assert.equal(status.processing, true);
  assert.equal(status.currentLabel, "manual-start-flow");
  assert.ok(status.pending >= 1);
  operationQueueModule.setWeeklyFlowOperationWorkerState({
    running: false,
    currentLabel: null,
  });
});
