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
  onJobDequeue,
  onJobSuccess,
  onJobError,
  onFinalFailure,
}) {
  let running = false;
  let stopRequested = false;
  let loopPromise = null;
  let idleController = null;

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
        if (typeof onJobDequeue === "function") {
          onJobDequeue(job.payload);
        }
        try {
          await withJobHeartbeat(job, queue, () => processJob(job.payload));
          job.ack();
          if (typeof onJobSuccess === "function") {
            onJobSuccess(job.payload);
          }
        } catch (error) {
          const message = error?.message || String(error);
          if (typeof onJobError === "function") {
            onJobError(error, job);
          }
          if (job.attempts >= maxAttempts) {
            job.fail(message);
            if (typeof onFinalFailure === "function") {
              onFinalFailure(job, error);
            }
          } else {
            job.retry(retryDelayS, message);
          }
        }
        idleController.arm();
      }
    } catch (error) {
      if (!idleController?.idleStopped && !stopRequested) {
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
      const restart = typeof shouldRestart === "function" ? shouldRestart() : true;
      markHonkerWorkerLoopEnded(name, restart ? start : null, { intentional });
    }
  }

  function start() {
    if (running || isHonkerShuttingDown()) return;
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
