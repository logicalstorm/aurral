import { getNotificationOutbox, getWorkerId } from "./honkerDb.js";

let running = false;
let loopPromise = null;

export function startNotificationOutboxWorker() {
  if (running) return;
  running = true;
  loopPromise = getNotificationOutbox()
    .runWorker(getWorkerId(), { idlePollS: 5 })
    .catch((error) => {
      console.error("[notificationOutboxWorker] loop error:", error);
    })
    .finally(() => {
      running = false;
      loopPromise = null;
    });
}

export function stopNotificationOutboxWorker() {
  running = false;
}

export function isNotificationOutboxWorkerRunning() {
  return running;
}
