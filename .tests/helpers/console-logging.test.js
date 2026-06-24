import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import {
  isVerboseConsoleEnabled,
  shouldEmitDefaultConsoleMessage,
} from "../../backend/loadEnv.js";

const runConsoleProbe = (env = {}) => {
  const result = spawnSync("node", [".tests/helpers/consolePatchProbe.js"], {
    cwd: new URL("../..", import.meta.url),
    env: {
      ...process.env,
      AURRAL_VERBOSE_LOGS: "",
      ...env,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return `${result.stdout}${result.stderr}`;
};

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

test("default server console keeps only important startup and problem output", () => {
  assert.equal(
    shouldEmitDefaultConsoleMessage("log", ["Server running on port 3001"]),
    true,
  );
  assert.equal(
    shouldEmitDefaultConsoleMessage("log", [
      "Discovery cache needs update. Starting...",
    ]),
    false,
  );
  assert.equal(
    shouldEmitDefaultConsoleMessage("warn", [
      "Failed to broadcast download statuses",
    ]),
    true,
  );
  assert.equal(
    shouldEmitDefaultConsoleMessage("error", [
      "Unhandled Rejection:",
      new Error("boom"),
    ]),
    true,
  );
  assert.equal(
    shouldEmitDefaultConsoleMessage("debug", ["Lidarr getArtistByMbid completed"]),
    false,
  );
});

test("patched default server console suppresses routine detail output", () => {
  const output = runConsoleProbe();

  assert.match(output, /Server running on port 3001/);
  assert.match(output, /Unhandled Rejection: probe failure/);
  assert.doesNotMatch(output, /Discovery cache needs update/);
  assert.doesNotMatch(output, /debug detail/);
});

test("patched verbose server console includes full detail output", () => {
  const output = runConsoleProbe({ AURRAL_VERBOSE_LOGS: "true" });

  assert.match(output, /Discovery cache needs update/);
  assert.match(output, /Server running on port 3001/);
  assert.match(output, /debug detail/);
  assert.match(output, /Unhandled Rejection:/);
  assert.match(output, /probe failure/);
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
