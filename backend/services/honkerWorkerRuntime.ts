const workers: Map<string, any> = new Map();
const restartTimers: Map<string, any> = new Map();
const restartAttempts: Map<string, number> = new Map();
const shutdownHandlers: Array<() => void | Promise<void>> = [];
const DEFAULT_WORKER_IDLE_STOP_MS = 60 * 1000;

let shuttingDown = false;

export function getWorkerIdleStopMs() {
  const configured = Number(process.env.AURRAL_WORKER_IDLE_STOP_MS);
  if (!Number.isFinite(configured)) return DEFAULT_WORKER_IDLE_STOP_MS;
  if (configured <= 0) return 0;
  return Math.max(5000, Math.floor(configured));
}

export function isHonkerShuttingDown() {
  return shuttingDown;
}

export function isHonkerDatabaseClosedError(error: any) {
  return String(error?.message || '')
    .toLowerCase()
    .includes('database is closed');
}

export async function withJobHeartbeat(job: any, queue: any, fn: any, extendSeconds: any = null) {
  let runId = null;
  let recordFinished = null;
  try {
    const taskStatus = await import('./honkerTaskStatus.js');
    runId = taskStatus.recordHonkerTaskRunStarted(job, queue);
    recordFinished = taskStatus.recordHonkerTaskRunFinished;
  } catch {}

  const visibilityTimeoutS = Number(queue?.visibilityTimeoutS) || 300;
  const extendS =
    extendSeconds != null
      ? Number(extendSeconds)
      : Math.max(60, Math.floor(visibilityTimeoutS * 0.5));
  const heartbeatMs = Math.max(1000, Math.floor(extendS * 1000 * 0.33));
  const heartbeat = setInterval(() => {
    try {
      job.heartbeat(extendS);
    } catch {}
  }, heartbeatMs);
  try {
    const result = await Promise.resolve(fn());
    if (recordFinished) {
      recordFinished(runId, 'completed');
    }
    return result;
  } catch (error: any) {
    if (recordFinished) {
      recordFinished(runId, 'failed', error?.message || String(error));
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

export function createIdleAbortController({ idleStopMs = 0, onIdleStop = null } = {}) {
  const controller = new AbortController();
  const timeoutMs = Math.max(0, Math.floor(Number(idleStopMs) || 0));
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idleStopped = false;

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const arm = () => {
    clear();
    if (!timeoutMs || controller.signal.aborted) return;
    timer = setTimeout(() => {
      timer = null;
      idleStopped = true;
      if (typeof onIdleStop === 'function') {
        try {
          (onIdleStop as () => void)();
        } catch {}
      }
      controller.abort();
    }, timeoutMs);
    if (timer && typeof (timer as any).unref === 'function') (timer as any).unref();
  };

  const abort = () => {
    clear();
    controller.abort();
  };

  return {
    signal: controller.signal,
    arm,
    disarm: clear,
    abort,
    dispose: clear,
    get idleStopped() {
      return idleStopped;
    },
  };
}

export function registerHonkerWorker(
  name: any,
  { start, stop, isRunning }: { start: () => void; stop: () => void; isRunning: () => boolean },
) {
  workers.set(String(name), { start, stop, isRunning });
}

export function getHonkerWorkerStatuses() {
  return [...workers.entries()]
    .map(([name, entry]) => ({
      name,
      running: entry?.isRunning?.() === true,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function registerHonkerShutdownHandler(handler: any) {
  if (typeof handler === 'function') {
    shutdownHandlers.push(handler);
  }
}

export function scheduleHonkerComponentRestart(name: any, startFn: any, options: any = {}) {
  if (shuttingDown || process.env.NODE_ENV === 'test') return;
  const safeName = String(name || 'component');
  const shouldRestart =
    typeof options.shouldRestart === 'function' ? options.shouldRestart : () => true;
  if (!shouldRestart()) return;

  const attempts = Number(restartAttempts.get(safeName) || 0);
  const delayMs = Math.min(30000, 1000 * 2 ** Math.min(attempts, 5));
  restartAttempts.set(safeName, attempts + 1);

  const existing = restartTimers.get(safeName);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    restartTimers.delete(safeName);
    if (shuttingDown || !shouldRestart()) return;
    try {
      startFn();
      restartAttempts.set(safeName, 0);
    } catch (error: any) {
      console.error(`[honkerRuntime] failed to restart ${safeName}:`, error);
      scheduleHonkerComponentRestart(safeName, startFn, options);
    }
  }, delayMs);
  if (typeof timer.unref === 'function') timer.unref();
  restartTimers.set(safeName, timer);
}

export function markHonkerWorkerLoopEnded(name: any, startFn: any, options: any = {}) {
  const safeName = String(name || 'worker');
  if (options.intentional || shuttingDown) return;
  const entry = workers.get(safeName);
  if (entry?.isRunning?.()) return;
  scheduleHonkerComponentRestart(safeName, startFn, options);
}

export async function shutdownHonkerInfrastructure({ timeoutMs = 30000 } = {}) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const timer of restartTimers.values()) {
    clearTimeout(timer);
  }
  restartTimers.clear();

  try {
    const { stopHonkerScheduler } = await import('./honkerDb.js');
    stopHonkerScheduler();
  } catch {}

  for (const [, entry] of workers) {
    try {
      entry.stop?.();
    } catch {}
  }

  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  while (Date.now() < deadline) {
    const anyRunning = [...workers.values()].some((entry) => entry.isRunning?.());
    if (!anyRunning) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  for (const handler of shutdownHandlers) {
    try {
      await handler();
    } catch (error: any) {
      console.error('[honkerRuntime] shutdown handler error:', error);
    }
  }

  try {
    const { closeHonkerDb } = await import('./honkerDb.js');
    closeHonkerDb();
  } catch {}
}
