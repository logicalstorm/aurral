const sleep = (ms) =>
  Number(ms) > 0
    ? new Promise((resolve) => {
        const timeout = setTimeout(resolve, ms);
        timeout.unref?.();
      })
    : Promise.resolve();

const isMonitoringComplete = (result) =>
  Boolean(result?.artist && result?.album) &&
  result.artist.monitored !== false &&
  result.album.monitored !== false;

export const runMonitoringRepairSequence = async ({
  repair,
  delaysMs = [1_000, 3_000, 8_000, 15_000],
} = {}) => {
  if (typeof repair !== "function") {
    throw new TypeError("repair must be a function");
  }

  let lastResult = null;
  let lastError = null;
  for (const delayMs of delaysMs) {
    await sleep(delayMs);
    try {
      lastResult = await repair();
      lastError = null;
      if (isMonitoringComplete(lastResult)) {
        return { complete: true, result: lastResult };
      }
    } catch (error) {
      lastError = error;
    }
  }

  return { complete: false, result: lastResult, error: lastError };
};
