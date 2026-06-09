import { dbOps } from "../config/db-helpers.js";
import { enqueueLibraryScanJob, getLibraryScanQueue, getWorkerId } from "./honkerDb.js";

const LIBRARY_SCAN_REGISTRY_KEY = "pendingLibraryScanJob";
const SCAN_DEBOUNCE_SECONDS = 30;

function getScanRegistry() {
  const raw = dbOps.getJSONSetting(LIBRARY_SCAN_REGISTRY_KEY);
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function setScanRegistry(registry) {
  dbOps.setJSONSetting(LIBRARY_SCAN_REGISTRY_KEY, registry);
}

export function getScheduledLibraryScanJobId() {
  const jobId = Number(getScanRegistry().jobId);
  return Number.isFinite(jobId) ? jobId : null;
}

export function clearScheduledLibraryScan(jobId = null) {
  const registry = getScanRegistry();
  if (!("jobId" in registry)) return;
  if (jobId != null && Number(registry.jobId) !== Number(jobId)) return;
  delete registry.jobId;
  setScanRegistry(registry);
}

export function scheduleLibraryScan(force = false) {
  if (force) {
    clearScheduledLibraryScan();
    const jobId = enqueueLibraryScanJob(
      { force: true, requestedAt: Date.now() },
      { priority: 10 },
    );
    setScanRegistry({ jobId });
    return jobId;
  }
  if (getScheduledLibraryScanJobId() != null) {
    return getScheduledLibraryScanJobId();
  }
  const jobId = enqueueLibraryScanJob(
    { force: false, requestedAt: Date.now() },
    { delaySeconds: SCAN_DEBOUNCE_SECONDS },
  );
  setScanRegistry({ jobId });
  return jobId;
}

let running = false;
let loopPromise = null;

async function runLoop() {
  const queue = getLibraryScanQueue();
  const workerId = getWorkerId();
  try {
    for await (const job of queue.claim(workerId, { idlePollS: 10 })) {
      if (!running) break;
      const scheduledJobId = getScheduledLibraryScanJobId();
      if (scheduledJobId != null && scheduledJobId !== job.id) {
        job.ack();
        continue;
      }
      clearScheduledLibraryScan(job.id);
      try {
        const { playlistManager } = await import("./weeklyFlowPlaylistManager.js");
        await playlistManager.scanLibrary();
        job.ack();
      } catch (error) {
        const message = error?.message || String(error);
        if (job.attempts >= 3) {
          job.fail(message);
        } else {
          setScanRegistry({ jobId: job.id });
          job.retry(60, message);
        }
      }
    }
  } catch (error) {
    console.error("[libraryScanWorker] loop error:", error);
  } finally {
    running = false;
    loopPromise = null;
  }
}

export function startLibraryScanWorker() {
  if (running) return;
  running = true;
  loopPromise = runLoop();
}

export function stopLibraryScanWorker() {
  running = false;
}

export function isLibraryScanWorkerRunning() {
  return running;
}
