import sharp from "sharp";

const clampInteger = (value, min, max, fallback) => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const SHARP_CONCURRENCY = clampInteger(process.env.AURRAL_SHARP_CONCURRENCY, 1, 8, 1);
const SHARP_CACHE_MEMORY_MB = clampInteger(process.env.AURRAL_SHARP_CACHE_MEMORY_MB, 8, 256, 32);

sharp.concurrency(SHARP_CONCURRENCY);
sharp.cache({
  memory: SHARP_CACHE_MEMORY_MB,
  files: 20,
  items: 100,
});

export default sharp;
