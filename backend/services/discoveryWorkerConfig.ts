const clampInt = (value: any, min: number, max: number, fallback: number) => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

export const getLastfmNetworkConcurrency = () =>
  clampInt(process.env.AURRAL_LASTFM_CONCURRENCY, 1, 16, 12);

export const getRustWorkerBinaryPath = () =>
  String(process.env.AURRAL_RUST_WORKER_PATH || "").trim() || null;
