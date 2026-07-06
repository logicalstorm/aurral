import {
  createIdleAbortController,
  getWorkerIdleStopMs,
  isHonkerShuttingDown,
  markHonkerWorkerLoopEnded,
  registerHonkerWorker,
  withJobHeartbeat,
} from "./honkerWorkerRuntime.js";
import { getWorkerId } from "./honkerDb.js";

export default function createHonkerWorker({
  name,
  getQueue,
  processJob,
  idlePollS,
  retryDelayS = 300,
  maxAttempts = 3,
  shouldRestart,
  onStart,
  filterJob,
  resolveRetry,
  onJobDequeue,
  onJobSuccess,
  onJobError,
  onFinalFailure,
  onLoopError,
}) {
  let running = false;
  let stopRequested = false;
  let loopPromise = null;
  let idleController = null;

  async function handleJobFailure(error, job) {
    const message = error?.message || String(error);
    if (typeof onJobError === "function") {
      onJobError(error, job);
    }
    if (typeof resolveRetry === "function") {
      const decision = resolveRetry(error, job);
      if (decision?.action === "fail") {
        job.fail(decision.message ?? message);
        if (typeof onFinalFailure === "function") {
          await onFinalFailure(job, error);
        }
        return;
      }
      if (decision?.action === "retry") {
        job.retry(decision.delayS ?? retryDelayS, decision.message ?? message);
        return;
      }
    }
    if (job.attempts >= maxAttempts) {
      job.fail(message);
      if (typeof onFinalFailure === "function") {
        await onFinalFailure(job, error);
      }
    } else {
      job.retry(retryDelayS, message);
    }
  }

  async function runLoop() {
    const queue = getQueue();
    const workerId = getWorkerId();
    idleController = createIdleAbortController({
      idleStopMs: getWorkerIdleStopMs(),
    });
    idleController.arm();
    try {
      for await (const job of queue.claim(workerId, {
        idlePollS,
        signal: idleController.signal,
      })) {
        idleController.disarm();
        if (!running || stopRequested) break;
        if (typeof filterJob === "function" && filterJob(job) === false) {
          job.ack();
          idleController.arm();
          continue;
        }
        if (typeof onJobDequeue === "function") {
          onJobDequeue(job.payload, job);
        }
        try {
          await withJobHeartbeat(job, queue, () => processJob(job.payload, job));
          job.ack();
          if (typeof onJobSuccess === "function") {
            onJobSuccess(job.payload, job);
          }
        } catch (error) {
          await handleJobFailure(error, job);
        }
        idleController.arm();
      }
    } catch (error) {
      if (typeof onLoopError === "function") {
        onLoopError(error);
      } else if (!idleController?.idleStopped && !stopRequested) {
        console.error(`[${name}] loop error:`, error);
      }
    } finally {
      const idleStopped = idleController?.idleStopped === true;
      idleController?.dispose();
      idleController = null;
      running = false;
      loopPromise = null;
      const intentional = stopRequested || idleStopped;
      stopRequested = false;
      const restartAllowed = typeof shouldRestart === "function" ? shouldRestart() : true;
      markHonkerWorkerLoopEnded(name, restartAllowed ? start : null, {
        intentional,
        ...(typeof shouldRestart === "function" ? { shouldRestart } : {}),
      });
    }
  }

  function start() {
    if (running || isHonkerShuttingDown()) return;
    if (typeof onStart === "function" && onStart() === false) return;
    running = true;
    stopRequested = false;
    loopPromise = runLoop();
  }

  function stop() {
    stopRequested = true;
    running = false;
    idleController?.abort();
  }

  function isRunning() {
    return running;
  }

  registerHonkerWorker(name, { start, stop, isRunning });
  return { start, stop, isRunning };
}
