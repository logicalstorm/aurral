import path from "path";
import { fileURLToPath } from "url";
import honker from "@russellthehippo/honker-node";
import { db as sqliteDb } from "../config/db-sqlite.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.AURRAL_DB_PATH
  ? path.resolve(process.env.AURRAL_DB_PATH)
  : path.join(
      process.env.AURRAL_DATA_DIR
        ? path.resolve(process.env.AURRAL_DATA_DIR)
        : path.join(__dirname, "..", "data"),
      "aurral.db",
    );

let honkerDb = null;
let pipelineQueue = null;
let discoveryRefreshQueue = null;
const WORKER_ID = `aurral-${process.pid}`;

export function getHonkerDb() {
  if (!honkerDb) {
    honkerDb = honker.open(DB_PATH);
  }
  return honkerDb;
}

export function getPipelineQueue() {
  if (!pipelineQueue) {
    pipelineQueue = getHonkerDb().queue("slskd-pipeline", {
      visibilityTimeoutS: 1200,
      maxAttempts: 5,
    });
  }
  return pipelineQueue;
}

export function enqueuePipelineJob(payload, options = {}) {
  const queue = getPipelineQueue();
  const runAt =
    options.runAt != null
      ? Math.floor(Number(options.runAt) / 1000)
      : options.delaySeconds != null
        ? Math.floor(Date.now() / 1000) + Number(options.delaySeconds)
        : null;
  const jobId = queue.enqueue(payload, {
    priority: Number(options.priority || 0),
    runAt,
  });
  import("./slskdOrchestratorWorker.js")
    .then(({ startSlskdOrchestratorWorker }) => startSlskdOrchestratorWorker())
    .catch(() => {});
  return jobId;
}

export function getDiscoveryRefreshQueue() {
  if (!discoveryRefreshQueue) {
    discoveryRefreshQueue = getHonkerDb().queue("discovery-refresh", {
      visibilityTimeoutS: 3600,
      maxAttempts: 4,
    });
  }
  return discoveryRefreshQueue;
}

export function enqueueDiscoveryRefreshJob(payload, options = {}) {
  const queue = getDiscoveryRefreshQueue();
  const runAt =
    options.runAt != null
      ? Math.floor(Number(options.runAt) / 1000)
      : options.delaySeconds != null
        ? Math.floor(Date.now() / 1000) + Number(options.delaySeconds)
        : null;
  return queue.enqueue(payload, {
    priority: Number(options.priority || 0),
    runAt,
  });
}

export function tryAcquireSlskdLock(ttlSeconds = 120) {
  return getHonkerDb().tryLock("slskd-api", WORKER_ID, ttlSeconds);
}

export async function withHonkerLock(
  name,
  fn,
  {
    ttlSeconds = 120,
    waitTimeoutMs = 300000,
    retryDelayMs = 250,
  } = {},
) {
  const safeName = String(name || "").trim();
  if (!safeName) {
    throw new Error("Honker lock name is required");
  }
  const deadline = Date.now() + Math.max(0, Number(waitTimeoutMs) || 0);
  let lock = null;
  while (!lock) {
    lock = getHonkerDb().tryLock(safeName, WORKER_ID, ttlSeconds);
    if (lock) break;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for Honker lock: ${safeName}`);
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(50, Number(retryDelayMs) || 250)),
    );
  }

  const heartbeatMs = Math.max(
    1000,
    Math.floor((Number(ttlSeconds) || 120) * 1000 * 0.33),
  );
  const heartbeat = setInterval(() => {
    try {
      lock.heartbeat(ttlSeconds);
    } catch {}
  }, heartbeatMs);

  try {
    return await fn();
  } finally {
    clearInterval(heartbeat);
    try {
      lock.release();
    } catch {}
  }
}

export function getWorkerId() {
  return WORKER_ID;
}

export function withBetterSqliteTransaction(fn) {
  const tx = sqliteDb.transaction(fn);
  return tx();
}
