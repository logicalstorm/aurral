import { db } from "../config/db-sqlite.js";
import { SCHEDULED_SYSTEM_TASKS } from "./honkerDb.js";

const RUN_LEDGER_MAX_AGE_MS = 60 * 60 * 1000;
const LIVE_JOB_LIMIT = 500;
const DEAD_JOB_LIMIT = 50;

const QUEUE_DEFINITIONS = [
  {
    queue: "system-task",
    label: "System Maintenance",
    workerLabel: "System Maintenance Worker",
    description: "Runs housekeeping, startup checks, and scheduled playlist maintenance.",
    worker: "system-task",
  },
  {
    queue: "weekly-flow-operation",
    label: "Playlist Operations",
    workerLabel: "Playlist Operation Worker",
    description: "Applies playlist edits, manual runs, flow changes, and track actions.",
    worker: "weekly-flow-operation",
  },
  {
    queue: "slskd-pipeline",
    label: "Download Pipeline",
    workerLabel: "Download Pipeline Worker",
    description: "Searches, downloads, validates, and finalizes playlist tracks.",
    worker: "slskd-pipeline",
  },
  {
    queue: "playlist-retry",
    label: "Playlist Retry",
    workerLabel: "Playlist Retry Worker",
    description: "Retries incomplete playlist tracks after temporary download failures.",
    worker: "playlist-retry",
  },
  {
    queue: "playlist-reserve-build",
    label: "Reserve Playlist Builds",
    workerLabel: "Reserve Playlist Builder",
    description: "Builds backup candidate tracks for playlists before they are needed.",
    worker: "playlist-reserve-build",
  },
  {
    queue: "playlist-mbid-enrichment",
    label: "Playlist MBID Enrichment",
    workerLabel: "Playlist MBID Worker",
    description: "Finds and fills missing MusicBrainz IDs on imported playlist tracks.",
    worker: "playlist-mbid-enrichment",
  },
  {
    queue: "library-scan",
    label: "Library Scans",
    workerLabel: "Library Scan Worker",
    description: "Refreshes Aurral's view of files after playlist or library changes.",
    worker: "library-scan",
  },
  {
    queue: "discovery-refresh",
    label: "Discovery Refreshes",
    workerLabel: "Discovery Refresh Worker",
    description: "Refreshes discovery recommendations from library and listening data.",
    worker: "discovery-refresh",
  },
  {
    queue: "discovery-playlist-build",
    label: "Discovery Playlist Builds",
    workerLabel: "Discovery Playlist Builder",
    description: "Creates generated discovery playlists in the background.",
    worker: "discovery-playlist-build",
  },
  {
    queue: "discovery-recommendation-enrichment",
    label: "Discovery Recommendation Enrichment",
    workerLabel: "Discovery Enrichment Worker",
    description:
      "Hydrates, expands, and reranks discovery recommendations after the initial pool is available.",
    worker: "discovery-recommendation-enrichment",
  },
  {
    queue: "discovery-user-refresh",
    label: "Listening History Refreshes",
    workerLabel: "Listening History Worker",
    description: "Refreshes user listening profiles used by discovery.",
    worker: "discovery-user-refresh",
  },
  {
    queue: "image-prefetch",
    label: "Image Prefetch",
    workerLabel: "Image Prefetch Worker",
    description: "Warms artist and playlist artwork so pages load faster.",
    worker: "image-prefetch",
  },
  {
    queue: "_outbox:notifications",
    label: "Notifications",
    workerLabel: "Notification Worker",
    description: "Delivers queued Gotify and webhook notifications.",
    worker: "notification-outbox",
  },
];

const SYSTEM_TASK_LABELS = {
  "weekly-flow-refresh": {
    label: "Playlist Schedule Check",
    description: "Queues enabled playlist flows that are due to run.",
  },
  "session-cleanup": {
    label: "Session Cleanup",
    description: "Removes expired login sessions from the app database.",
  },
  "weekly-flow-reuse-repair": {
    label: "Playlist File Reuse Repair",
    description: "Repairs reusable playlist file links when source files move.",
  },
  "weekly-flow-startup-reuse-repair": {
    label: "Startup Playlist Reuse Repair",
    description: "Checks reusable playlist links after Aurral starts.",
  },
  "weekly-flow-startup-check": {
    label: "Startup Playlist Schedule Check",
    description: "Resumes pending playlist work after Aurral starts.",
  },
  "discovery-refresh-check": {
    label: "Discovery Auto Refresh Check",
    description: "Checks whether discovery recommendations need a scheduled refresh.",
  },
  "discovery-bootstrap": {
    label: "Discovery Startup Check",
    description: "Initializes discovery data and schedules the next refresh.",
  },
  "playlist-startup-migration": {
    label: "Playlist Startup Migration",
    description: "Migrates legacy playlist files and reconciles playlist folders.",
  },
  "lidarr-retry": {
    label: "Lidarr Retry",
    description: "Retries Lidarr library access after a temporary connection problem.",
  },
};

const queueDefinitionByName = new Map(
  QUEUE_DEFINITIONS.map((definition) => [definition.queue, definition]),
);

let schemaEnsured = false;
let insertRunStatement = null;
let updateRunStatement = null;
let pruneRunsStatement = null;

function ensureRunSchema() {
  if (schemaEnsured) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS honker_task_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      queue TEXT NOT NULL,
      name TEXT,
      payload TEXT,
      worker_id TEXT,
      attempt INTEGER,
      status TEXT NOT NULL,
      error TEXT,
      queued_at INTEGER,
      run_at INTEGER,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      duration_ms INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_honker_task_runs_started_at ON honker_task_runs(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_honker_task_runs_queue_started ON honker_task_runs(queue, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_honker_task_runs_job ON honker_task_runs(job_id, queue);
  `);
  insertRunStatement = db.prepare(`
    INSERT INTO honker_task_runs (
      job_id,
      queue,
      name,
      payload,
      worker_id,
      attempt,
      status,
      queued_at,
      run_at,
      started_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)
  `);
  updateRunStatement = db.prepare(`
    UPDATE honker_task_runs
    SET status = ?,
        error = ?,
        ended_at = ?,
        duration_ms = ?
    WHERE id = ?
  `);
  pruneRunsStatement = db.prepare(`
    DELETE FROM honker_task_runs
    WHERE status != 'running'
      AND COALESCE(ended_at, started_at) < ?
  `);
  schemaEnsured = true;
}

function getRunLedgerCutoffUnix() {
  return Math.floor((Date.now() - RUN_LEDGER_MAX_AGE_MS) / 1000);
}

function pruneExpiredRuns() {
  ensureRunSchema();
  pruneRunsStatement.run(getRunLedgerCutoffUnix());
}

function safeQuery(sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch {
    return [];
  }
}

function safeGet(sql, params = []) {
  try {
    return db.prepare(sql).get(...params) || null;
  } catch {
    return null;
  }
}

function parsePayload(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return value;
  }
}

function stableValue(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      if (key === "requestedAt") return acc;
      acc[key] = stableValue(value[key]);
      return acc;
    }, {});
}

function payloadKey(payload) {
  try {
    return JSON.stringify(stableValue(payload ?? null));
  } catch {
    return String(payload ?? "");
  }
}

function taskMatchKey(queue, payload) {
  return `${queue || ""}:${payloadKey(payload)}`;
}

function titleize(value) {
  return String(value || "")
    .replace(/^_outbox:/, "")
    .replace(/[-_:]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function queueLabel(queue) {
  return queueDefinitionByName.get(queue)?.label || titleize(queue) || "Task";
}

function queueDescription(queue) {
  return queueDefinitionByName.get(queue)?.description || "";
}

function workerLabel(queue, worker) {
  const definition = queueDefinitionByName.get(queue);
  return definition?.workerLabel || definition?.label || titleize(worker || queue);
}

function formatPayloadLabel(value) {
  const trimmed = String(value || "").trim();
  return trimmed ? titleize(trimmed) : "";
}

function systemTaskInfo(kind) {
  return SYSTEM_TASK_LABELS[kind] || {
    label: formatPayloadLabel(kind) || "System Task",
    description: queueDescription("system-task"),
  };
}

function discoveryRefreshInfo(payload = {}) {
  const reason = String(payload?.reason || "").trim();
  if (reason === "scheduled") {
    return {
      label: "Discovery Auto Refresh",
      description: "Refreshes discovery recommendations on the configured schedule.",
    };
  }
  if (reason === "startup" || reason === "startup_incomplete") {
    return {
      label: "Discovery Startup Refresh",
      description: "Refreshes discovery data after startup when the cache is missing or stale.",
    };
  }
  if (reason === "interval") {
    return {
      label: "Discovery Refresh Check",
      description: "Checks whether discovery data is stale enough to refresh.",
    };
  }
  if (reason === "manual") {
    return {
      label: "Manual Discovery Refresh",
      description: "Refreshes discovery recommendations after a manual request.",
    };
  }
  return {
    label: "Discovery Refresh",
    description: queueDescription("discovery-refresh"),
  };
}

export function describeHonkerTask(queue, payloadValue) {
  const payload = parsePayload(payloadValue) || {};
  const safeQueue = String(queue || "").trim();
  const kind = String(payload?.kind || "").trim();
  const phase = String(payload?.phase || "").trim();
  const label = String(payload?.label || "").trim();

  if (safeQueue === "system-task") {
    return systemTaskInfo(kind).label;
  }

  if (safeQueue === "slskd-pipeline") {
    return phase
      ? `Download Pipeline: ${formatPayloadLabel(phase)}`
      : "Download Pipeline";
  }

  if (safeQueue === "weekly-flow-operation") {
    return label || formatPayloadLabel(kind) || "Playlist Operation";
  }

  if (safeQueue === "playlist-retry") {
    return payload?.playlistType
      ? `Playlist Retry: ${formatPayloadLabel(payload.playlistType)}`
      : "Playlist Retry";
  }

  if (safeQueue === "playlist-reserve-build") {
    return payload?.playlistType
      ? `Reserve Build: ${formatPayloadLabel(payload.playlistType)}`
      : "Reserve Build";
  }

  if (safeQueue === "playlist-mbid-enrichment") {
    return payload?.playlistId
      ? `Playlist MBID Enrichment: ${formatPayloadLabel(payload.playlistId)}`
      : "Playlist MBID Enrichment";
  }

  if (safeQueue === "library-scan") {
    return payload?.force ? "Manual Library Scan" : "Library Scan";
  }

  if (safeQueue === "discovery-refresh") {
    return discoveryRefreshInfo(payload).label;
  }

  if (safeQueue === "discovery-playlist-build") {
    return payload?.playlistId
      ? `Discovery Playlist Build: ${formatPayloadLabel(payload.playlistId)}`
      : "Discovery Playlist Build";
  }

  if (safeQueue === "discovery-recommendation-enrichment") {
    return payload?.cacheNamespace
      ? `Discovery Enrichment: ${formatPayloadLabel(payload.cacheNamespace)}`
      : "Discovery Enrichment";
  }

  if (safeQueue === "discovery-user-refresh") {
    const profile = payload?.listenHistoryProfile || {};
    return profile?.listenHistoryUsername
      ? `Discovery User Refresh: ${profile.listenHistoryUsername}`
      : "Discovery User Refresh";
  }

  if (safeQueue === "image-prefetch") {
    const mbids = Array.isArray(payload?.mbids) ? payload.mbids : [];
    return mbids.length > 0
      ? `Image Prefetch: ${mbids.length} artist${mbids.length === 1 ? "" : "s"}`
      : "Image Prefetch";
  }

  if (safeQueue === "_outbox:notifications") {
    return payload?.event
      ? `Notification: ${formatPayloadLabel(payload.event)}`
      : "Notification";
  }

  return queueLabel(safeQueue);
}

function describeHonkerTaskDetail(queue, payloadValue) {
  const payload = parsePayload(payloadValue) || {};
  const safeQueue = String(queue || "").trim();
  const kind = String(payload?.kind || "").trim();

  if (safeQueue === "system-task") {
    return systemTaskInfo(kind).description;
  }
  if (safeQueue === "discovery-refresh") {
    return discoveryRefreshInfo(payload).description;
  }
  if (safeQueue === "slskd-pipeline") {
    const phase = String(payload?.phase || "").trim();
    return phase
      ? `${queueDescription(safeQueue)} Current phase: ${formatPayloadLabel(phase)}.`
      : queueDescription(safeQueue);
  }
  if (safeQueue === "weekly-flow-operation") {
    return queueDescription(safeQueue);
  }
  if (safeQueue === "playlist-retry") {
    return payload?.playlistType
      ? `Retries incomplete tracks for ${formatPayloadLabel(payload.playlistType)}.`
      : queueDescription(safeQueue);
  }
  if (safeQueue === "playlist-reserve-build") {
    return payload?.playlistType
      ? `Builds reserve tracks for ${formatPayloadLabel(payload.playlistType)}.`
      : queueDescription(safeQueue);
  }
  if (safeQueue === "playlist-mbid-enrichment") {
    return payload?.playlistId
      ? `Finds missing MusicBrainz IDs for ${formatPayloadLabel(payload.playlistId)}.`
      : "Scans playlists for tracks missing MusicBrainz IDs and queues enrichment jobs.";
  }
  if (safeQueue === "library-scan") {
    return payload?.force
      ? "Refreshes Aurral's library view after startup or a forced scan."
      : queueDescription(safeQueue);
  }
  if (safeQueue === "discovery-playlist-build") {
    return queueDescription(safeQueue);
  }
  if (safeQueue === "discovery-recommendation-enrichment") {
    return payload?.discoveryRunId
      ? `Finishes recommendation scoring for run ${formatPayloadLabel(payload.discoveryRunId)}.`
      : queueDescription(safeQueue);
  }
  if (safeQueue === "discovery-user-refresh") {
    const profile = payload?.listenHistoryProfile || {};
    return profile?.listenHistoryUsername
      ? `Refreshes listening history for ${profile.listenHistoryUsername}.`
      : queueDescription(safeQueue);
  }
  if (safeQueue === "image-prefetch") {
    const mbids = Array.isArray(payload?.mbids) ? payload.mbids : [];
    return mbids.length > 0
      ? `Fetches artwork for ${mbids.length} artist${mbids.length === 1 ? "" : "s"}.`
      : queueDescription(safeQueue);
  }
  if (safeQueue === "_outbox:notifications") {
    return queueDescription(safeQueue);
  }
  return queueDescription(safeQueue);
}

function summarizePayload(queue, payloadValue) {
  const payload = parsePayload(payloadValue);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }

  if (queue === "system-task") {
    return "";
  }

  if (queue === "discovery-refresh" && payload.reason) {
    return "";
  }

  const parts = [];
  const keys = [
    "kind",
    "reason",
    "phase",
    "playlistType",
    "playlistId",
    "flowId",
    "jobId",
    "source",
    "event",
  ];
  for (const key of keys) {
    const value = payload[key];
    if (value == null || value === "") continue;
    parts.push(`${titleize(key)}: ${String(value)}`);
  }

  if (Array.isArray(payload.mbids)) {
    parts.push(`MBIDs: ${payload.mbids.length}`);
  }

  const profile = payload.listenHistoryProfile;
  if (profile && typeof profile === "object") {
    const username = profile.listenHistoryUsername || profile.username;
    const provider = profile.listenHistoryProvider || profile.provider;
    if (provider || username) {
      parts.push(
        `Profile: ${[provider, username].filter(Boolean).join(" / ")}`,
      );
    }
  }

  if (!parts.length && queue && !queueDefinitionByName.has(queue)) {
    return queueLabel(queue);
  }
  return parts.slice(0, 4).join(" · ");
}

function unixToIso(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function normalizeIntervalUnit(unit, value) {
  const units = {
    ms: "millisecond",
    s: "second",
    m: "minute",
    h: "hour",
    d: "day",
    w: "week",
  };
  const label = units[String(unit || "").toLowerCase()] || unit;
  return `${value} ${label}${Number(value) === 1 ? "" : "s"}`;
}

function formatSchedule(expr) {
  const value = String(expr || "").trim();
  const every = value.match(/^@every\s+(\d+)\s*(ms|s|m|h|d|w)$/i);
  if (every) {
    return normalizeIntervalUnit(every[2], Number(every[1]));
  }
  return value || "Manual";
}

function normalizeRunRow(row) {
  const payload = parsePayload(row.payload);
  return {
    id: row.id,
    jobId: row.job_id,
    queue: row.queue,
    queueLabel: queueLabel(row.queue),
    name: describeHonkerTask(row.queue, payload) || row.name,
    description: describeHonkerTaskDetail(row.queue, payload),
    payloadSummary: summarizePayload(row.queue, payload),
    workerId: row.worker_id || null,
    attempt: row.attempt,
    status: row.status || "completed",
    error: row.error || null,
    queuedAt: unixToIso(row.queued_at),
    runAt: unixToIso(row.run_at),
    startedAt: unixToIso(row.started_at),
    endedAt: unixToIso(row.ended_at),
    durationMs: row.duration_ms,
  };
}

function normalizeLiveJobRow(row) {
  const payload = parsePayload(row.payload);
  const currentTime = nowUnix();
  const state = String(row.state || "pending");
  const status =
    state === "processing"
      ? "running"
      : Number(row.run_at) > currentTime
        ? "scheduled"
        : "queued";

  return {
    source: "live",
    id: `live-${row.queue}-${row.id}`,
    jobId: row.id,
    queue: row.queue,
    queueLabel: queueLabel(row.queue),
    name: describeHonkerTask(row.queue, payload),
    description: describeHonkerTaskDetail(row.queue, payload),
    payloadSummary: summarizePayload(row.queue, payload),
    workerId: row.worker_id || null,
    attempt: row.attempts,
    maxAttempts: row.max_attempts,
    status,
    state,
    priority: row.priority,
    queuedAt: unixToIso(row.created_at),
    runAt: unixToIso(row.run_at),
    startedAt: null,
    endedAt: null,
    durationMs: null,
    error: null,
    sortAt: Number(row.run_at || row.created_at || 0),
    duplicateCount: 1,
  };
}

function normalizeDeadJobRow(row) {
  const payload = parsePayload(row.payload);
  return {
    source: "dead",
    id: `dead-${row.queue}-${row.id}`,
    jobId: row.id,
    queue: row.queue,
    queueLabel: queueLabel(row.queue),
    name: describeHonkerTask(row.queue, payload),
    description: describeHonkerTaskDetail(row.queue, payload),
    payloadSummary: summarizePayload(row.queue, payload),
    workerId: null,
    attempt: row.attempts,
    maxAttempts: row.max_attempts,
    status: "failed",
    state: "failed",
    priority: row.priority,
    queuedAt: unixToIso(row.created_at),
    runAt: unixToIso(row.run_at),
    startedAt: null,
    endedAt: unixToIso(row.died_at),
    durationMs: null,
    error: row.last_error || null,
    sortAt: Number(row.died_at || row.created_at || 0),
    duplicateCount: 1,
  };
}

function readScheduledRows() {
  const rows = safeQuery(`
    SELECT name, queue, cron_expr, payload, priority, expires_s, next_fire_at
    FROM _honker_scheduler_tasks
    ORDER BY next_fire_at ASC, name ASC
  `);
  if (rows.length > 0) return rows;

  return SCHEDULED_SYSTEM_TASKS.map((task) => ({
    name: task.name,
    queue: task.queue,
    cron_expr: task.schedule,
    payload: JSON.stringify(task.payload || {}),
    priority: Number(task.priority || 0),
    expires_s: task.expiresS ?? null,
    next_fire_at: null,
  }));
}

function readRecentRuns() {
  ensureRunSchema();
  const cutoff = getRunLedgerCutoffUnix();
  return safeQuery(
    `
      SELECT *
      FROM honker_task_runs
      WHERE started_at >= ?
         OR status = 'running'
      ORDER BY started_at DESC, id DESC
    `,
    [cutoff],
  );
}

function readLatestRunsByTask() {
  const cutoff = getRunLedgerCutoffUnix();
  const rows = safeQuery(
    `
      SELECT *
      FROM honker_task_runs
      WHERE started_at >= ?
         OR status = 'running'
      ORDER BY started_at DESC, id DESC
    `,
    [cutoff],
  );
  const latest = new Map();
  for (const row of rows) {
    const payload = parsePayload(row.payload);
    const key = taskMatchKey(row.queue, payload);
    if (!latest.has(key)) latest.set(key, row);
  }
  return latest;
}

function readLiveJobs() {
  return safeQuery(
    `
      SELECT id, queue, payload, state, priority, run_at, worker_id,
             claim_expires_at, attempts, max_attempts, created_at, expires_at
      FROM _honker_live
      ORDER BY
        CASE state WHEN 'processing' THEN 0 ELSE 1 END,
        run_at ASC,
        created_at DESC
      LIMIT ?
    `,
    [LIVE_JOB_LIMIT],
  );
}

function readDeadJobs() {
  return safeQuery(
    `
      SELECT id, queue, payload, priority, run_at, attempts, max_attempts,
             last_error, created_at, died_at
      FROM _honker_dead
      ORDER BY died_at DESC, id DESC
      LIMIT ?
    `,
    [DEAD_JOB_LIMIT],
  );
}

function readQueueStats(liveRows = []) {
  const currentTime = nowUnix();
  const deadStats = safeQuery(`
    SELECT queue, COUNT(*) AS failed_count
    FROM _honker_dead
    GROUP BY queue
  `);
  const runStats = safeQuery(
    `
    SELECT queue, MAX(started_at) AS last_run_at
    FROM honker_task_runs
    WHERE started_at >= ?
    GROUP BY queue
  `,
    [getRunLedgerCutoffUnix()],
  );

  const stats = new Map();
  for (const definition of QUEUE_DEFINITIONS) {
    stats.set(definition.queue, {
      queue: definition.queue,
      liveCount: 0,
      runningCount: 0,
      queuedCount: 0,
      scheduledCount: 0,
      scheduledKeys: new Set(),
      failedCount: 0,
      nextRunAt: null,
      lastRunAt: null,
    });
  }

  const ensure = (queue) => {
    if (!stats.has(queue)) {
      stats.set(queue, {
        queue,
        liveCount: 0,
        runningCount: 0,
        queuedCount: 0,
        scheduledCount: 0,
        scheduledKeys: new Set(),
        failedCount: 0,
        nextRunAt: null,
        lastRunAt: null,
      });
    }
    return stats.get(queue);
  };

  for (const row of liveRows) {
    const entry = ensure(row.queue);
    const state = String(row.state || "pending");
    const runAt = Number(row.run_at || 0);
    entry.liveCount += 1;
    if (state === "processing") {
      entry.runningCount += 1;
    } else if (runAt > currentTime) {
      const payload = parsePayload(row.payload);
      entry.scheduledKeys.add(taskMatchKey(row.queue, payload));
      if (!entry.nextRunAt || runAt < Number(Date.parse(entry.nextRunAt) / 1000)) {
        entry.nextRunAt = unixToIso(runAt);
      }
    } else {
      entry.queuedCount += 1;
    }
  }
  for (const row of deadStats) {
    ensure(row.queue).failedCount = Number(row.failed_count || 0);
  }
  for (const row of runStats) {
    ensure(row.queue).lastRunAt = unixToIso(row.last_run_at);
  }

  for (const entry of stats.values()) {
    entry.scheduledCount = entry.scheduledKeys.size;
    delete entry.scheduledKeys;
  }

  return stats;
}

async function readWorkerStatuses() {
  try {
    const { getHonkerWorkerStatuses } = await import("./honkerWorkerRuntime.js");
    return getHonkerWorkerStatuses();
  } catch {
    return [];
  }
}

function normalizeWorkerRows(workerStatuses, queueStats) {
  const workerByName = new Map(
    workerStatuses.map((worker) => [worker.name, worker]),
  );
  const rows = [];
  const seenQueues = new Set();

  for (const definition of QUEUE_DEFINITIONS) {
    seenQueues.add(definition.queue);
    const stats = queueStats.get(definition.queue) || {};
    const worker = definition.worker
      ? workerByName.get(definition.worker)
      : null;
    const processing = Number(stats.runningCount || 0);
    const loopRunning = worker?.running === true;
    rows.push({
      queue: definition.queue,
      queueLabel: definition.label,
      worker: definition.worker || null,
      name: workerLabel(definition.queue, definition.worker),
      description: definition.description || "",
      status: processing > 0 ? "running" : loopRunning ? "idle" : "not_loaded",
      running: loopRunning,
      queued: Number(stats.queuedCount || 0),
      scheduled: Number(stats.scheduledCount || 0),
      processing,
      failed: Number(stats.failedCount || 0),
      nextRunAt: stats.nextRunAt || null,
      lastRunAt: stats.lastRunAt || null,
    });
  }

  for (const [queue, stats] of queueStats.entries()) {
    if (seenQueues.has(queue)) continue;
    rows.push({
      queue,
      queueLabel: queueLabel(queue),
      worker: null,
      name: workerLabel(queue, null),
      description: queueDescription(queue),
      status: "not_loaded",
      running: false,
      queued: Number(stats.queuedCount || 0),
      scheduled: Number(stats.scheduledCount || 0),
      processing: Number(stats.runningCount || 0),
      failed: Number(stats.failedCount || 0),
      nextRunAt: stats.nextRunAt || null,
      lastRunAt: stats.lastRunAt || null,
    });
  }

  return rows;
}

function normalizeScheduledRows(rows, latestRunsByTask) {
  return rows.map((row) => {
    const payload = parsePayload(row.payload);
    const latestRun = latestRunsByTask.get(taskMatchKey(row.queue, payload));
    return {
      id: row.name,
      name: describeHonkerTask(row.queue, payload),
      scheduleName: row.name,
      queue: row.queue,
      queueLabel: queueLabel(row.queue),
      description: describeHonkerTaskDetail(row.queue, payload),
      interval: formatSchedule(row.cron_expr),
      schedule: row.cron_expr,
      priority: Number(row.priority || 0),
      payloadSummary: summarizePayload(row.queue, payload),
      lastExecutionAt: unixToIso(latestRun?.started_at),
      lastDurationMs: latestRun?.duration_ms ?? null,
      lastStatus: latestRun?.status || null,
      nextExecutionAt: unixToIso(row.next_fire_at),
    };
  });
}

function normalizeQueueRows(liveRows, deadRows, runRows) {
  const normalizedLive = groupQueueRows(liveRows.map(normalizeLiveJobRow));
  const runJobKeys = new Set();
  const normalizedRuns = runRows.map((row) => {
    runJobKeys.add(`${row.queue}:${row.job_id}`);
    const run = normalizeRunRow(row);
    return {
      ...run,
      source: "run",
      id: `run-${run.id}`,
      maxAttempts: null,
      priority: null,
      state: run.status,
      sortAt: Date.parse(run.endedAt || run.startedAt || run.queuedAt || 0) / 1000,
      duplicateCount: 1,
    };
  });
  const normalizedDead = deadRows
    .filter((row) => !runJobKeys.has(`${row.queue}:${row.id}`))
    .map(normalizeDeadJobRow);

  return [...normalizedLive, ...groupQueueRows(normalizedRuns), ...normalizedDead]
    .sort((a, b) => {
      const activeOrder = { running: 0, queued: 1, scheduled: 2 };
      const aActive = activeOrder[a.status];
      const bActive = activeOrder[b.status];
      if (aActive != null || bActive != null) {
        return (aActive ?? 10) - (bActive ?? 10);
      }
      return Number(b.sortAt || 0) - Number(a.sortAt || 0);
    });
}

function shouldGroupQueueRow(row) {
  return row.status === "scheduled" || row.status === "completed";
}

function groupQueueRows(rows) {
  const grouped = [];
  const groupedByTask = new Map();

  for (const row of rows) {
    if (!shouldGroupQueueRow(row)) {
      grouped.push(row);
      continue;
    }

    const key = [
      row.queue,
      row.status,
      row.name,
      row.payloadSummary,
    ].join("|");
    const existing = groupedByTask.get(key);
    if (!existing) {
      groupedByTask.set(key, row);
      grouped.push(row);
      continue;
    }

    existing.duplicateCount = Number(existing.duplicateCount || 1) + 1;
    if (row.status === "scheduled") {
      const existingRunAt = Date.parse(existing.runAt || "") || Infinity;
      const rowRunAt = Date.parse(row.runAt || "") || Infinity;
      if (rowRunAt < existingRunAt) {
        existing.runAt = row.runAt;
        existing.sortAt = row.sortAt;
      }
    }
    const existingQueuedAt = Date.parse(existing.queuedAt || "") || 0;
    const rowQueuedAt = Date.parse(row.queuedAt || "") || 0;
    if (rowQueuedAt > existingQueuedAt) {
      existing.queuedAt = row.queuedAt;
      existing.jobId = row.jobId;
      existing.id = row.id;
    }
    const existingEndedAt = Date.parse(existing.endedAt || "") || 0;
    const rowEndedAt = Date.parse(row.endedAt || "") || 0;
    if (rowEndedAt > existingEndedAt) {
      existing.startedAt = row.startedAt;
      existing.endedAt = row.endedAt;
      existing.durationMs = row.durationMs;
      existing.sortAt = row.sortAt;
    }
  }

  return grouped;
}

export function recordHonkerTaskRunStarted(job, queue) {
  try {
    ensureRunSchema();
    const queueName = String(job?.queue || queue?.name || "").trim();
    if (!job?.id || !queueName) return null;
    const liveRow = safeGet(
      `
        SELECT created_at, run_at
        FROM _honker_live
        WHERE id = ?
      `,
      [job.id],
    );
    const startedAt = nowUnix();
    const payloadText = JSON.stringify(job.payload ?? null);
    const info = insertRunStatement.run(
      job.id,
      queueName,
      describeHonkerTask(queueName, job.payload),
      payloadText,
      job.workerId || null,
      Number(job.attempts || 0),
      liveRow?.created_at || null,
      liveRow?.run_at || null,
      startedAt,
    );
    return Number(info.lastInsertRowid);
  } catch {
    return null;
  }
}

export function recordHonkerTaskRunFinished(runId, status, error = null) {
  try {
    ensureRunSchema();
    const id = Number(runId);
    if (!Number.isFinite(id) || id <= 0) return;
    const row = safeGet(
      "SELECT started_at FROM honker_task_runs WHERE id = ?",
      [id],
    );
    const endedAt = nowUnix();
    const durationMs = row?.started_at
      ? Math.max(0, (endedAt - Number(row.started_at)) * 1000)
      : null;
    updateRunStatement.run(
      status || "completed",
      error ? String(error).slice(0, 2000) : null,
      endedAt,
      durationMs,
      id,
    );
    pruneExpiredRuns();
  } catch {}
}

export async function getHonkerTaskStatus() {
  ensureRunSchema();
  pruneExpiredRuns();
  const scheduledRows = readScheduledRows();
  const latestRunsByTask = readLatestRunsByTask();
  const liveRows = readLiveJobs();
  const deadRows = readDeadJobs();
  const runRows = readRecentRuns();
  const queueStats = readQueueStats(liveRows);
  const workerStatuses = await readWorkerStatuses();

  return {
    timestamp: new Date().toISOString(),
    scheduled: normalizeScheduledRows(scheduledRows, latestRunsByTask),
    workers: normalizeWorkerRows(workerStatuses, queueStats),
    queue: normalizeQueueRows(liveRows, deadRows, runRows),
  };
}
