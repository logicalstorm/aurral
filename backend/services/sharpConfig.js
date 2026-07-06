import sharp from "sharp";

sharp.concurrency(
  Math.min(8, Math.max(1, Math.floor(Number(process.env.AURRAL_SHARP_CONCURRENCY)) || 4)),
);
sharp.cache({
  memory: Math.min(
    256,
    Math.max(8, Math.floor(Number(process.env.AURRAL_SHARP_CACHE_MEMORY_MB)) || 32),
  ),
  files: 20,
  items: 100,
});

export default sharp;
