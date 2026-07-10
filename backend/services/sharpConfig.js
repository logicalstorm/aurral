import sharp from "sharp";

sharp.concurrency(4);
sharp.cache({
  memory: 32,
  files: 20,
  items: 100,
});

export default sharp;
