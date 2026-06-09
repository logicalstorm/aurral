export const DEFAULT_WORKER_SETTINGS = {
  concurrency: 2,
  retryCycleMinutes: 360,
  existingFileMode: "reuse",
};

export const FLOW_WORKER_EXISTING_FILE_MODES = ["download", "reuse"];

export const normalizeRetryCycleMinutes = () =>
  DEFAULT_WORKER_SETTINGS.retryCycleMinutes;

export const normalizeExistingFileMode = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "download") return "download";
  if (
    normalized === "reuse" ||
    normalized === "hardlink" ||
    normalized === "copy"
  ) {
    return "reuse";
  }
  return DEFAULT_WORKER_SETTINGS.existingFileMode;
};

export const getWorkerSettingsFromStatus = (status) => {
  const raw = status?.worker?.settings || {};
  const parsedConcurrency = Number(raw.concurrency);
  const concurrency =
    Number.isFinite(parsedConcurrency) && parsedConcurrency >= 1
      ? Math.min(3, Math.floor(parsedConcurrency))
      : DEFAULT_WORKER_SETTINGS.concurrency;
  const retryCycleMinutes = normalizeRetryCycleMinutes();
  const existingFileMode = normalizeExistingFileMode(raw.existingFileMode);
  return {
    concurrency,
    retryCycleMinutes,
    existingFileMode,
  };
};
