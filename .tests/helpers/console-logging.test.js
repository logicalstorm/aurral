import test from "node:test";
import assert from "node:assert/strict";

import {
  isVerboseConsoleEnabled,
} from "../../backend/loadEnv.js";

test("verbose console mode accepts explicit truthy environment values", () => {
  assert.equal(isVerboseConsoleEnabled({ AURRAL_VERBOSE_LOGS: "true" }), true);
  assert.equal(isVerboseConsoleEnabled({ AURRAL_VERBOSE_LOGS: "1" }), true);
  assert.equal(isVerboseConsoleEnabled({ AURRAL_VERBOSE_LOGS: "debug" }), true);
});

test("verbose console mode stays off unless explicitly enabled", () => {
  assert.equal(isVerboseConsoleEnabled({}), false);
  assert.equal(isVerboseConsoleEnabled({ AURRAL_VERBOSE_LOGS: "false" }), false);
  assert.equal(isVerboseConsoleEnabled({ AURRAL_VERBOSE_LOGS: "0" }), false);
});

test("simplified logger writes to console with level and category", async () => {
  const output = [];
  const original = {
    log: console.log,
    error: console.error,
    warn: console.warn,
  };
  console.log = (...args) => output.push(["log", ...args]);
  console.error = (...args) => output.push(["error", ...args]);
  console.warn = (...args) => output.push(["warn", ...args]);

  try {
    const { logger } = await import(
      `../../backend/services/logger.js?console-test=${Date.now()}`
    );
    logger.info("test", "info message", { key: "val" });
    logger.warn("test", "warn message");
    logger.error("test", "error message");

    assert.ok(output.some((entry) => entry[0] === "log" && String(entry[1]).includes("[info]") && String(entry[1]).includes("[test]") && String(entry[1]).includes("info message")));
    assert.ok(output.some((entry) => entry[0] === "warn" && String(entry[1]).includes("[warn]")));
    assert.ok(output.some((entry) => entry[0] === "error" && String(entry[1]).includes("[error]")));
  } finally {
    console.log = original.log;
    console.error = original.error;
    console.warn = original.warn;
  }
});
