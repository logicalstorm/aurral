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
  return queue.enqueue(payload, {
    priority: Number(options.priority || 0),
    runAt,
  });
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

export function getWorkerId() {
  return WORKER_ID;
}

export function withBetterSqliteTransaction(fn) {
  const tx = sqliteDb.transaction(fn);
  return tx();
}
