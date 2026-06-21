import "../backend/loadEnv.js";
import {
  isRustWorkerAvailable,
  resolveRustWorkerBinary,
  runRustDiscoveryRun,
} from "../backend/services/rustWorkerRunner.js";
import { buildRustDiscoveryRunPayload } from "../backend/services/rustDiscoveryBridge.js";
import {
  getDiscoveryCache,
  getDiscoveryRecommendationsPerRefresh,
  getDiscoveryRecommendationPoolLimit,
} from "../backend/services/discoveryService.js";
import { buildExistingArtistKeySet } from "../backend/services/discoveryRecommendations.js";
import { libraryManager } from "../backend/services/libraryManager.js";
import { requestDiscoveryRefresh } from "../backend/services/discoveryRefreshScheduler.js";
import { summarizeWorkerPerfHistory } from "../backend/services/workerPerfMetrics.js";
import { getResourceBudgetStatus } from "../backend/services/resourceBudget.js";

const mem = () => {
  const m = process.memoryUsage();
  return {
    heapMb: Math.round(m.heapUsed / 1048576),
    rssMb: Math.round(m.rss / 1048576),
  };
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDiscoveryIdle(timeoutMs = 20 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const cache = getDiscoveryCache();
    if (!cache.isUpdating && !cache.isEnriching) {
      return cache;
    }
    await wait(3000);
  }
  throw new Error("discovery refresh timed out");
}

console.log("rust binary:", resolveRustWorkerBinary());
console.log("rust available:", isRustWorkerAvailable());
console.log("memory before:", mem());

const cache = getDiscoveryCache();
const seeds = (cache.basedOn || []).slice(0, 8).map((entry) => ({
  mbid: entry.id || null,
  artistName: entry.name,
  source: entry.source || "library",
  weight: 1,
}));

if (seeds.length === 0) {
  console.error("No discovery seeds in cache — run a discovery refresh first");
  process.exit(1);
}

const artists = await libraryManager.getAllArtists();
const existingArtistKeys = buildExistingArtistKeySet(artists);

const payload = await buildRustDiscoveryRunPayload({
  payload: {
    discoveryMode: "balanced",
    recommendationRunStartedAt: new Date().toISOString(),
  },
  seeds,
  existingArtistKeys,
  existingRecommendations: cache.recommendations || [],
  feedback: [],
  limits: {
    poolCap: getDiscoveryRecommendationPoolLimit(),
    perRefresh: Math.min(40, getDiscoveryRecommendationsPerRefresh()),
  },
  baseDiscoveryData: cache,
  libraryArtists: artists,
  historyTopArtists: (cache.basedOn || [])
    .slice(0, 3)
    .map((entry) => entry.name)
    .filter(Boolean),
});

console.log(`Running rust discovery-run with ${seeds.length} seeds...`);
const started = Date.now();
const result = await runRustDiscoveryRun(payload);
const elapsed = Date.now() - started;

console.log("memory after:", mem());
console.log("elapsed ms:", elapsed);
console.log("stats:", result?.stats);
console.log(
  "recommendations:",
  result?.result?.recommendations?.length ?? 0,
  "fresh:",
  result?.result?.freshRecommendations?.length ?? 0,
  "playlists:",
  result?.result?.playlists?.length ?? 0,
);

console.log("\n--- Full pipeline via Honker ---");
const enqueue = requestDiscoveryRefresh({ reason: "rust-test", force: true });
console.log("enqueue:", enqueue);
if (enqueue.enqueued) {
  console.log("Waiting for discovery cycle to finish (may take several minutes)...");
  const finalCache = await waitForDiscoveryIdle();
  console.log("final quality:", finalCache.recommendationQuality);
  console.log("final recommendations:", finalCache.recommendations?.length);
  console.log("final playlists:", finalCache.discoverPlaylists?.length);
  console.log("worker perf:", summarizeWorkerPerfHistory(8));
  console.log("resource budget:", getResourceBudgetStatus());
}
