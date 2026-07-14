import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("image proxy cache size and clear operations are asynchronous", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "aurral-image-cache-"));
  const previousDataDir = process.env.AURRAL_DATA_DIR;
  process.env.AURRAL_DATA_DIR = dataDir;
  try {
    const { clearImageProxyCache, getImageProxyCacheSizeBytes } = await import(
      `../backend/services/imageProxyService.js?cache-test=${Date.now()}`
    );
    const cacheDir = path.join(dataDir, "image-proxy");
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(path.join(cacheDir, "sample.webp"), "abc");

    assert.equal(await getImageProxyCacheSizeBytes(), 3);
    await clearImageProxyCache();
    assert.deepEqual(await fs.readdir(cacheDir), []);
  } finally {
    if (previousDataDir === undefined) delete process.env.AURRAL_DATA_DIR;
    else process.env.AURRAL_DATA_DIR = previousDataDir;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
