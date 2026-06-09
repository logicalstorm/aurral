import { performance } from "node:perf_hooks";
import { playlistSource } from "../../backend/services/weeklyFlowPlaylistSource.js";
import { getLastfmApiKey } from "../../backend/services/apiClients.js";
import { getDiscoveryCache } from "../../backend/services/discoveryService.js";

const BENCHMARK_FLOW = {
  size: 30,
  mix: { discover: 34, mix: 33, trending: 33, focus: 0 },
  deepDive: false,
  tags: [],
  relatedArtists: [],
};

const FOCUS_FLOW = {
  size: 30,
  mix: { discover: 0, mix: 0, trending: 0, focus: 100 },
  deepDive: false,
  tags: ["shoegaze", "dream pop"],
  relatedArtists: ["Slowdive"],
};

async function runBenchmark(label, flow, options = {}) {
  const started = performance.now();
  const plan = await playlistSource.buildFlowRunPlan(flow, options);
  const elapsedMs = Math.round(performance.now() - started);
  const primary = Array.isArray(plan?.primaryTracks) ? plan.primaryTracks : [];
  const reserve = Array.isArray(plan?.reserveTracks) ? plan.reserveTracks : [];
  const sourceCounts = primary.reduce((acc, track) => {
    const source = String(track?.source || "unknown");
    acc[source] = Number(acc[source] || 0) + 1;
    return acc;
  }, {});
  return {
    label,
    elapsedMs,
    primary: primary.length,
    reserve: reserve.length,
    sourceCounts,
    artists: primary.map((track) => track.artistName).sort(),
  };
}

async function main() {
  if (!getLastfmApiKey()) {
    console.error("LASTFM_API_KEY not configured — benchmark skipped");
    process.exit(1);
  }
  const cache = getDiscoveryCache();
  if (
    !Array.isArray(cache?.recommendations) ||
    cache.recommendations.length === 0
  ) {
    console.error("Discovery cache empty — refresh discovery before benchmarking");
    process.exit(1);
  }

  console.log("Warming caches...");
  await runBenchmark("warmup", { ...BENCHMARK_FLOW, size: 8 });

  const results = [];
  for (let i = 0; i < 2; i += 1) {
    results.push(await runBenchmark(`mixed-${i + 1}`, BENCHMARK_FLOW));
  }
  results.push(await runBenchmark("focus", FOCUS_FLOW));
  results.push(
    await runBenchmark("mixed-defer-reserve", BENCHMARK_FLOW, {
      deferReserve: true,
    }),
  );
  results.push(
    await runBenchmark("mixed-full-plan", BENCHMARK_FLOW, {
      deferReserve: false,
    }),
  );

  const mixed = results.filter((entry) => entry.label.startsWith("mixed-"));
  const avgMixed =
    mixed.reduce((sum, entry) => sum + entry.elapsedMs, 0) / mixed.length;
  console.log(
    JSON.stringify(
      {
        results,
        summary: {
          avgMixedMs: Math.round(avgMixed),
          fastestMixedMs: Math.min(...mixed.map((entry) => entry.elapsedMs)),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
