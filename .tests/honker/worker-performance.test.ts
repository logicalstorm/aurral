import test from "node:test";
import assert from "node:assert/strict";
import {
  HEAVY_WORK_TYPES,
  getResourceBudgetStatus,
  withHeavyWorkBudget,
} from "../../backend/services/resourceBudget.ts";

test("resource budget serializes competing heavy work", async () => {
  process.env.AURRAL_RESOURCE_BUDGET_ENABLED = "1";
  const events = [];

  const first = withHeavyWorkBudget(
    HEAVY_WORK_TYPES.DISCOVERY_ENRICHMENT,
    async () => {
      events.push("first-start");
      assert.equal(
        getResourceBudgetStatus().activeType,
        HEAVY_WORK_TYPES.DISCOVERY_ENRICHMENT,
      );
      await new Promise((resolve) => setTimeout(resolve, 40));
      events.push("first-end");
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 5));

  const second = withHeavyWorkBudget(
    HEAVY_WORK_TYPES.FLOW_HARVEST,
    async () => {
      events.push("second-start");
      events.push("second-end");
    },
  );

  await Promise.all([first, second]);
  assert.deepEqual(events, ["first-start", "first-end", "second-start", "second-end"]);
  assert.equal(getResourceBudgetStatus().activeType, null);
});

test("worker perf records span metrics", async () => {
  const { withWorkerPerfSpan, getWorkerPerfHistory } = await import(
    "../../backend/services/workerPerfMetrics.ts"
  );
  await withWorkerPerfSpan("test-span", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return true;
  });
  const history = getWorkerPerfHistory(1);
  assert.equal(history[0]?.name, "test-span");
  assert.ok(Number(history[0]?.durationMs) >= 0);
});
