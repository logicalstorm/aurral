import fs from 'fs';
import path from 'path';
import honker from '@russellthehippo/honker-node';
import type { JsonValue } from '@russellthehippo/honker-node';
import type { SchedulerAddOptions } from '@russellthehippo/honker-node';
import { resolveAurralDataDir } from '../config/data-dir.js';
import { scheduleHonkerComponentRestart } from './honkerWorkerRuntime.js';

function resolveHonkerDbPath() {
  return process.env.AURRAL_DB_PATH
    ? path.resolve(process.env.AURRAL_DB_PATH)
    : path.join(resolveAurralDataDir(), 'aurral.db');
}

let honkerDb: ReturnType<typeof honker.open> | null = null;
let openedHonkerDbPath: string | null = null;
let pipelineQueue: ReturnType<ReturnType<typeof honker.open>['queue']> | null = null;
let discoveryRefreshQueue: ReturnType<ReturnType<typeof honker.open>['queue']> | null = null;
let discoveryRecommendationEnrichmentQueue: ReturnType<ReturnType<typeof honker.open>['queue']> | null = null;
let discoveryUserRefreshQueue: ReturnType<ReturnType<typeof honker.open>['queue']> | null = null;
let weeklyFlowOperationQueue: ReturnType<ReturnType<typeof honker.open>['queue']> | null = null;
let playlistRetryQueue: ReturnType<ReturnType<typeof honker.open>['queue']> | null = null;
let playlistMbidEnrichmentQueue: ReturnType<ReturnType<typeof honker.open>['queue']> | null = null;
let systemTaskQueue: ReturnType<ReturnType<typeof honker.open>['queue']> | null = null;
let libraryScanQueue: ReturnType<ReturnType<typeof honker.open>['queue']> | null = null;
let imagePrefetchQueue: ReturnType<ReturnType<typeof honker.open>['queue']> | null = null;
let notificationOutbox: ReturnType<ReturnType<typeof honker.open>['outbox']> | null = null;
let honkerSchedulerStarted = false;
let honkerSchedulerAbort: AbortController | null = null;
const WORKER_ID = `aurral-${process.pid}`;

export const SCHEDULED_SYSTEM_TASKS = [
  {
    name: 'weekly-flow-refresh',
    queue: 'system-task',
    schedule: '@every 1h',
    payload: { kind: 'weekly-flow-refresh' },
  },
  {
    name: 'session-cleanup',
    queue: 'system-task',
    schedule: '@every 1h',
    payload: { kind: 'session-cleanup' },
  },
  {
    name: 'weekly-flow-reuse-repair',
    queue: 'system-task',
    schedule: '@every 30m',
    payload: { kind: 'weekly-flow-reuse-repair' },
  },
  {
    name: 'discovery-refresh-check',
    queue: 'system-task',
    schedule: '@every 15m',
    payload: { kind: 'discovery-refresh-check' },
  },
  {
    name: 'stale-pipeline-sweep',
    queue: 'system-task',
    schedule: '@every 10m',
    payload: { kind: 'stale-pipeline-sweep' },
  },
  {
    name: 'playlist-mbid-enrichment-sweep',
    queue: 'playlist-mbid-enrichment',
    schedule: '@every 6h',
    payload: { kind: 'playlist-mbid-enrichment-sweep', reason: 'schedule' },
  },
];

const PIPELINE_PHASE_PRIORITY: Record<string, number> = {
  search: 0,
  poll: 10,
  download: 20,
  finalize: 30,
};

export function getPipelinePriorityForPhase(phase: unknown): number {
  return PIPELINE_PHASE_PRIORITY[String(phase || '').toLowerCase()] ?? 0;
}

export function getHonkerDb() {
  const dbPath = resolveHonkerDbPath();
  if (honkerDb && openedHonkerDbPath !== dbPath) {
    closeHonkerDb();
  }
  if (!honkerDb) {
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    honkerDb = honker.open(dbPath);
    openedHonkerDbPath = dbPath;
  }
  return honkerDb;
}

export function getPipelineQueue() {
  if (!pipelineQueue) {
    pipelineQueue = getHonkerDb().queue('slskd-pipeline', {
      visibilityTimeoutS: 1200,
      maxAttempts: 5,
    });
  }
  return pipelineQueue;
}

type EnqueueOptions = {
  runAt?: number;
  delaySeconds?: number;
  priority?: number;
};

export function enqueuePipelineJob(payload: Record<string, unknown>, options: EnqueueOptions = {}): number {
  const queue = getPipelineQueue();
  const runAt =
    options.runAt != null
      ? Math.floor(Number(options.runAt) / 1000)
      : options.delaySeconds != null
        ? Math.floor(Date.now() / 1000) + Number(options.delaySeconds)
        : null;
  const priority =
    options.priority != null
      ? Number(options.priority)
      : getPipelinePriorityForPhase(payload?.phase);
  const jobId = queue.enqueue(payload as JsonValue, {
    priority,
    runAt,
  });
  import('./slskdOrchestratorWorker.js')
    .then(({ startSlskdOrchestratorWorker }) => startSlskdOrchestratorWorker())
    .catch(() => {});
  return jobId;
}

export function getDiscoveryRefreshQueue() {
  if (!discoveryRefreshQueue) {
    discoveryRefreshQueue = getHonkerDb().queue('discovery-refresh', {
      visibilityTimeoutS: 3600,
      maxAttempts: 4,
    });
  }
  return discoveryRefreshQueue;
}

export function enqueueDiscoveryRefreshJob(payload: unknown, options: EnqueueOptions = {}): number {
  const queue = getDiscoveryRefreshQueue();
  const runAt =
    options.runAt != null
      ? Math.floor(Number(options.runAt) / 1000)
      : options.delaySeconds != null
        ? Math.floor(Date.now() / 1000) + Number(options.delaySeconds)
        : null;
  const jobId = queue.enqueue(payload as JsonValue, {
    priority: Number(options.priority || 0),
    runAt,
  });
  if (process.env.NODE_ENV !== 'test') {
    import('./discoveryRefreshWorker.js')
      .then(({ startDiscoveryRefreshWorker }) => startDiscoveryRefreshWorker())
      .catch(() => {});
  }
  return jobId;
}

export function getDiscoveryRecommendationEnrichmentQueue() {
  if (!discoveryRecommendationEnrichmentQueue) {
    discoveryRecommendationEnrichmentQueue = getHonkerDb().queue(
      'discovery-recommendation-enrichment',
      {
        visibilityTimeoutS: 3600,
        maxAttempts: 4,
      },
    );
  }
  return discoveryRecommendationEnrichmentQueue;
}

export function enqueueDiscoveryRecommendationEnrichmentJob(payload: unknown, options: EnqueueOptions = {}): number {
  const queue = getDiscoveryRecommendationEnrichmentQueue();
  const runAt =
    options.runAt != null
      ? Math.floor(Number(options.runAt) / 1000)
      : options.delaySeconds != null
        ? Math.floor(Date.now() / 1000) + Number(options.delaySeconds)
        : null;
  const jobId = queue.enqueue(payload as JsonValue, {
    priority: Number(options.priority || 0),
    runAt,
  });
  import('./discoveryRecommendationEnrichmentWorker.js')
    .then(({ startDiscoveryRecommendationEnrichmentWorker }) =>
      startDiscoveryRecommendationEnrichmentWorker(),
    )
    .catch(() => {});
  return jobId;
}

export function getDiscoveryUserRefreshQueue() {
  if (!discoveryUserRefreshQueue) {
    discoveryUserRefreshQueue = getHonkerDb().queue('discovery-user-refresh', {
      visibilityTimeoutS: 3600,
      maxAttempts: 4,
    });
  }
  return discoveryUserRefreshQueue;
}

export function enqueueDiscoveryUserRefreshJob(payload: unknown, options: EnqueueOptions = {}): number {
  const queue = getDiscoveryUserRefreshQueue();
  const runAt =
    options.runAt != null
      ? Math.floor(Number(options.runAt) / 1000)
      : options.delaySeconds != null
        ? Math.floor(Date.now() / 1000) + Number(options.delaySeconds)
        : null;
  const jobId = queue.enqueue(payload as JsonValue, {
    priority: Number(options.priority || 0),
    runAt,
  });
  import('./discoveryUserRefreshWorker.js')
    .then(({ startDiscoveryUserRefreshWorker }) => startDiscoveryUserRefreshWorker())
    .catch(() => {});
  return jobId;
}

export function getWeeklyFlowOperationQueue() {
  if (!weeklyFlowOperationQueue) {
    weeklyFlowOperationQueue = getHonkerDb().queue('weekly-flow-operation', {
      visibilityTimeoutS: 3600,
      maxAttempts: 3,
    });
  }
  return weeklyFlowOperationQueue;
}

export function enqueueWeeklyFlowOperationJob(payload: unknown, options: EnqueueOptions = {}): number {
  const queue = getWeeklyFlowOperationQueue();
  const runAt =
    options.runAt != null
      ? Math.floor(Number(options.runAt) / 1000)
      : options.delaySeconds != null
        ? Math.floor(Date.now() / 1000) + Number(options.delaySeconds)
        : null;
  const jobId = queue.enqueue(payload as JsonValue, {
    priority: Number(options.priority || 0),
    runAt,
  });
  import('./weeklyFlowOperationWorker.js')
    .then(({ startWeeklyFlowOperationWorker }) => startWeeklyFlowOperationWorker())
    .catch(() => {});
  return jobId;
}

export function getPlaylistRetryQueue() {
  if (!playlistRetryQueue) {
    playlistRetryQueue = getHonkerDb().queue('playlist-retry', {
      visibilityTimeoutS: 1800,
      maxAttempts: 5,
    });
  }
  return playlistRetryQueue;
}

export function enqueuePlaylistRetryJob(payload: unknown, options: EnqueueOptions = {}): number {
  const queue = getPlaylistRetryQueue();
  const runAt =
    options.runAt != null
      ? Math.floor(Number(options.runAt) / 1000)
      : options.delaySeconds != null
        ? Math.floor(Date.now() / 1000) + Number(options.delaySeconds)
        : null;
  const jobId = queue.enqueue(payload as JsonValue, {
    priority: Number(options.priority || 0),
    runAt,
  });
  import('./weeklyFlowPlaylistRetryWorker.js')
    .then(({ startWeeklyFlowPlaylistRetryWorker }) => startWeeklyFlowPlaylistRetryWorker())
    .catch(() => {});
  return jobId;
}

export function getPlaylistMbidEnrichmentQueue() {
  if (!playlistMbidEnrichmentQueue) {
    playlistMbidEnrichmentQueue = getHonkerDb().queue('playlist-mbid-enrichment', {
      visibilityTimeoutS: 3600,
      maxAttempts: 4,
    });
  }
  return playlistMbidEnrichmentQueue;
}

export function enqueuePlaylistMbidEnrichmentJob(payload: unknown = {}, options: EnqueueOptions = {}): number {
  const queue = getPlaylistMbidEnrichmentQueue();
  const runAt =
    options.runAt != null
      ? Math.floor(Number(options.runAt) / 1000)
      : options.delaySeconds != null
        ? Math.floor(Date.now() / 1000) + Number(options.delaySeconds)
        : null;
  const jobId = queue.enqueue(payload as JsonValue, {
    priority: Number(options.priority || 0),
    runAt,
  });
  import('./playlistMbidEnrichmentWorker.js')
    .then(({ startPlaylistMbidEnrichmentWorker }) => startPlaylistMbidEnrichmentWorker())
    .catch(() => {});
  return jobId;
}

export function getSystemTaskQueue() {
  if (!systemTaskQueue) {
    systemTaskQueue = getHonkerDb().queue('system-task', {
      visibilityTimeoutS: 3600,
      maxAttempts: 3,
    });
  }
  return systemTaskQueue;
}

export function enqueueSystemTaskJob(payload: unknown, options: EnqueueOptions = {}): number {
  const queue = getSystemTaskQueue();
  const runAt =
    options.runAt != null
      ? Math.floor(Number(options.runAt) / 1000)
      : options.delaySeconds != null
        ? Math.floor(Date.now() / 1000) + Number(options.delaySeconds)
        : null;
  const jobId = queue.enqueue(payload as JsonValue, {
    priority: Number(options.priority || 0),
    runAt,
  });
  import('./systemTaskWorker.js')
    .then(({ startSystemTaskWorker }) => startSystemTaskWorker())
    .catch(() => {});
  return jobId;
}

export function getLibraryScanQueue() {
  if (!libraryScanQueue) {
    libraryScanQueue = getHonkerDb().queue('library-scan', {
      visibilityTimeoutS: 600,
      maxAttempts: 3,
    });
  }
  return libraryScanQueue;
}

export function enqueueLibraryScanJob(payload: unknown = {}, options: EnqueueOptions = {}): number {
  const queue = getLibraryScanQueue();
  const runAt =
    options.runAt != null
      ? Math.floor(Number(options.runAt) / 1000)
      : options.delaySeconds != null
        ? Math.floor(Date.now() / 1000) + Number(options.delaySeconds)
        : null;
  const jobId = queue.enqueue(payload as JsonValue, {
    priority: Number(options.priority || 0),
    runAt,
  });
  import('./libraryScanWorker.js')
    .then(({ startLibraryScanWorker }) => startLibraryScanWorker())
    .catch(() => {});
  return jobId;
}

export function getImagePrefetchQueue() {
  if (!imagePrefetchQueue) {
    imagePrefetchQueue = getHonkerDb().queue('image-prefetch', {
      visibilityTimeoutS: 600,
      maxAttempts: 4,
    });
  }
  return imagePrefetchQueue;
}

export function enqueueImagePrefetchJob(payload: unknown, options: EnqueueOptions = {}): number {
  const queue = getImagePrefetchQueue();
  const runAt =
    options.runAt != null
      ? Math.floor(Number(options.runAt) / 1000)
      : options.delaySeconds != null
        ? Math.floor(Date.now() / 1000) + Number(options.delaySeconds)
        : null;
  const jobId = queue.enqueue(payload as JsonValue, {
    priority: Number(options.priority || 0),
    runAt,
  });
  import('./imagePrefetchWorker.js')
    .then(({ startImagePrefetchWorker }) => startImagePrefetchWorker())
    .catch(() => {});
  return jobId;
}

export function getNotificationOutbox() {
  if (!notificationOutbox) {
    notificationOutbox = getHonkerDb().outbox(
      'notifications',
      async (payload: unknown, job: unknown) => {
        const { deliverQueuedNotification } = await import('./notificationService.js');
        const { withJobHeartbeat } = await import('./honkerWorkerRuntime.js');
        const outbox = getNotificationOutbox();
        await withJobHeartbeat(job, outbox.queue, () => deliverQueuedNotification(payload as Record<string, unknown>));
      },
      {
        visibilityTimeoutS: 120,
        maxAttempts: 5,
        baseBackoffS: 30,
      },
    );
  }
  return notificationOutbox;
}

export function enqueueNotification(payload: unknown): number {
  const jobId = getNotificationOutbox().enqueue(payload as JsonValue);
  import('./notificationOutboxWorker.js')
    .then(({ startNotificationOutboxWorker }) => startNotificationOutboxWorker())
    .catch(() => {});
  return jobId;
}

export function bootstrapHonkerSchedules() {
  const scheduler = getHonkerDb().scheduler();
  for (const task of SCHEDULED_SYSTEM_TASKS) {
    try {
      scheduler.remove(task.name);
    } catch {}
    scheduler.add(task as SchedulerAddOptions);
  }
}

export function enqueueHonkerStartupTasks() {
  enqueueSystemTaskJob({ kind: 'playlist-startup-migration' }, { delaySeconds: 3, priority: 10 });
  enqueueSystemTaskJob({ kind: 'weekly-flow-startup-check' }, { delaySeconds: 5, priority: 5 });
  enqueueSystemTaskJob(
    { kind: 'weekly-flow-startup-reuse-repair' },
    { delaySeconds: 15, priority: 5 },
  );
  enqueueSystemTaskJob({ kind: 'discovery-bootstrap' }, { delaySeconds: 15, priority: 5 });
  enqueuePlaylistMbidEnrichmentJob(
    { kind: 'playlist-mbid-enrichment-sweep', reason: 'startup' },
    { delaySeconds: 30, priority: -5 },
  );
}

export function startHonkerScheduler() {
  if (honkerSchedulerStarted || process.env.NODE_ENV === 'test') return;
  honkerSchedulerStarted = true;
  const abort = new AbortController();
  honkerSchedulerAbort = abort;
  getHonkerDb()
    .scheduler()
    .run(WORKER_ID, abort.signal)
    .catch((error: unknown) => {
      console.error('[honkerScheduler] loop error:', error);
      honkerSchedulerStarted = false;
      honkerSchedulerAbort = null;
      scheduleHonkerComponentRestart('scheduler', startHonkerScheduler);
    });
}

export function stopHonkerScheduler() {
  if (!honkerSchedulerAbort) return;
  honkerSchedulerAbort.abort();
  honkerSchedulerAbort = null;
  honkerSchedulerStarted = false;
}

export function closeHonkerDb() {
  stopHonkerScheduler();
  if (discoveryRefreshQueueLock) {
    try {
      discoveryRefreshQueueLock.release();
    } catch {}
    discoveryRefreshQueueLock = null;
  }
  if (honkerDb) {
    try {
      honkerDb.close();
    } catch {}
  }
  honkerDb = null;
  openedHonkerDbPath = null;
  pipelineQueue = null;
  discoveryRefreshQueue = null;
  discoveryRecommendationEnrichmentQueue = null;
  discoveryUserRefreshQueue = null;
  weeklyFlowOperationQueue = null;
  playlistRetryQueue = null;
  playlistMbidEnrichmentQueue = null;
  systemTaskQueue = null;
  libraryScanQueue = null;
  imagePrefetchQueue = null;
  notificationOutbox = null;
}

const DISCOVERY_REFRESH_QUEUE_LOCK = 'discovery-refresh-queue';

let discoveryRefreshQueueLock: { release: () => void } | null = null;

export function isHonkerLockHeld(name: unknown): boolean {
  const probeOwner = `probe-${WORKER_ID}-${Date.now()}`;
  const lock = getHonkerDb().tryLock(String(name || '').trim(), probeOwner, 1);
  if (lock) {
    try {
      lock.release();
    } catch {}
    return false;
  }
  return true;
}

export function tryAcquireDiscoveryRefreshQueueLock() {
  if (discoveryRefreshQueueLock) return true;
  const lock = getHonkerDb().tryLock(DISCOVERY_REFRESH_QUEUE_LOCK, WORKER_ID, 3600);
  if (!lock) return false;
  discoveryRefreshQueueLock = lock;
  return true;
}

export function releaseDiscoveryRefreshQueueLock() {
  if (!discoveryRefreshQueueLock) return;
  try {
    discoveryRefreshQueueLock.release();
  } catch {}
  discoveryRefreshQueueLock = null;
}

export function isDiscoveryRefreshQueueLocked() {
  return discoveryRefreshQueueLock != null || isHonkerLockHeld(DISCOVERY_REFRESH_QUEUE_LOCK);
}

const inProcessLockTails = new Map();

export async function withHonkerLock(
  name: unknown,
  fn: () => unknown,
  { ttlSeconds = 120, waitTimeoutMs = 300000, retryDelayMs = 250 }: {
    ttlSeconds?: number;
    waitTimeoutMs?: number;
    retryDelayMs?: number;
  } = {},
): Promise<unknown> {
  const safeName = String(name || '').trim();
  if (!safeName) {
    throw new Error('Honker lock name is required');
  }
  const deadline = Date.now() + Math.max(0, Number(waitTimeoutMs) || 0);

  const previousTail = inProcessLockTails.get(safeName) || Promise.resolve();
  let releaseGate: ((value?: unknown) => void) | undefined;
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  const tail = previousTail.then(() => gate);
  inProcessLockTails.set(safeName, tail);

  try {
    const gateAcquired = await Promise.race([
      previousTail.then(() => true),
      new Promise((resolve) => {
        const waitMs = Math.max(0, deadline - Date.now());
        const timer = setTimeout(() => resolve(false), waitMs);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
    if (!gateAcquired) {
      throw new Error(`Timed out waiting for Honker lock: ${safeName}`);
    }

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

    const heartbeatMs = Math.max(1000, Math.floor((Number(ttlSeconds) || 120) * 1000 * 0.33));
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
  } finally {
    releaseGate?.();
    if (inProcessLockTails.get(safeName) === tail) {
      inProcessLockTails.delete(safeName);
    }
  }
}

export function getWorkerId() {
  return WORKER_ID;
}

export function getHonkerQueueDepth(queueName: unknown): number {
  const safeQueue = String(queueName || '').trim();
  if (!safeQueue) return 0;
  const now = Math.floor(Date.now() / 1000);
  const row = getHonkerDb().query(
    `SELECT COUNT(*) AS count
     FROM _honker_live
     WHERE queue = ?
       AND state = 'pending'
       AND run_at <= ?`,
    [safeQueue, now],
  )[0];
  return Number(row?.count) || 0;
}

export const HONKER_QUEUE_NAMES = [
  'system-task',
  'weekly-flow-operation',
  'slskd-pipeline',
  'playlist-retry',
  'playlist-mbid-enrichment',
  'library-scan',
  'discovery-refresh',
  'discovery-recommendation-enrichment',
  'discovery-user-refresh',
  'image-prefetch',
  '_outbox:notifications',
];

export function sweepAllHonkerQueues() {
  let swept = 0;
  for (const queueName of HONKER_QUEUE_NAMES) {
    const queue = getHonkerQueueByName(queueName);
    if (!queue) continue;
    try {
      swept += Number(queue.sweepExpired()) || 0;
    } catch {}
  }
  return swept;
}

export function getHonkerQueueByName(queueName: unknown) {
  switch (queueName) {
    case 'slskd-pipeline':
      return getPipelineQueue();
    case 'discovery-refresh':
      return getDiscoveryRefreshQueue();
    case 'discovery-recommendation-enrichment':
      return getDiscoveryRecommendationEnrichmentQueue();
    case 'discovery-user-refresh':
      return getDiscoveryUserRefreshQueue();
    case 'weekly-flow-operation':
      return getWeeklyFlowOperationQueue();
    case 'playlist-retry':
      return getPlaylistRetryQueue();
    case 'playlist-mbid-enrichment':
      return getPlaylistMbidEnrichmentQueue();
    case 'system-task':
      return getSystemTaskQueue();
    case 'library-scan':
      return getLibraryScanQueue();
    case 'image-prefetch':
      return getImagePrefetchQueue();
    case '_outbox:notifications':
      return getNotificationOutbox().queue;
    default:
      return null;
  }
}

export function getHonkerQueueNextClaimAt(queueName: unknown) {
  const safeQueue = String(queueName || '').trim();
  if (!safeQueue) return null;
  const queue = getHonkerQueueByName(safeQueue);
  const q = queue as Record<string, unknown> | null;
  const value = q && typeof q._nextClaimAt === 'function' ? (q._nextClaimAt as () => unknown)() : null;
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}
