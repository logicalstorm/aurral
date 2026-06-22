import { spawnSync } from "node:child_process";
import { resolveRustWorkerBinary } from "./rustWorkerRunner.js";
import { buildSlskdPeerStatsSnapshot } from "./slskdTransferHistory.js";

const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

export function isRustSlskdMatcherAvailable() {
  return Boolean(resolveRustWorkerBinary());
}

const mapFlowTrackContext = (context = {}) => ({
  artistName: String(context.artistName || "").trim(),
  trackName: String(context.trackName || "").trim(),
  albumName: context.albumName != null ? String(context.albumName) : null,
  artistMbid: context.artistMbid || context.mbid || null,
  albumMbid: context.albumMbid || null,
  trackMbid: context.trackMbid || null,
  releaseYear:
    context.releaseYear != null ? String(context.releaseYear) : null,
  durationMs:
    context.durationMs != null && Number.isFinite(Number(context.durationMs))
      ? Number(context.durationMs)
      : null,
  trackNumber:
    context.trackNumber != null && Number.isFinite(Number(context.trackNumber))
      ? Number(context.trackNumber)
      : null,
  albumTrackCount:
    context.albumTrackCount != null &&
    Number.isFinite(Number(context.albumTrackCount))
      ? Number(context.albumTrackCount)
      : null,
  albumTrackTitles: Array.isArray(context.albumTrackTitles)
    ? context.albumTrackTitles.map((entry) => String(entry || ""))
    : [],
  artistAliases: Array.isArray(context.artistAliases)
    ? context.artistAliases.map((entry) => String(entry || ""))
    : [],
});

export function serializeMatcherOptionsForRust(options = {}, results = []) {
  const peerStats =
    options.peerStats && typeof options.peerStats === "object"
      ? { ...options.peerStats }
      : { ...buildSlskdPeerStatsSnapshot() };
  if (
    typeof options.isUserBlacklisted === "function" ||
    typeof options.getUserQueuePenalty === "function"
  ) {
    const users = new Set();
    for (const item of Array.isArray(results) ? results : []) {
      const user = String(item?.user || "").trim();
      if (user) users.add(user);
    }
    for (const user of users) {
      const key = user.toLowerCase();
      if (!key) continue;
      const existing = peerStats[key] || {
        successes: 0,
        failures: 0,
        validationFailures: 0,
        active: 0,
      };
      if (
        typeof options.isUserBlacklisted === "function" &&
        options.isUserBlacklisted(user)
      ) {
        existing.failures = Math.max(existing.failures, 5);
        existing.successes = 0;
      }
      if (typeof options.getUserQueuePenalty === "function") {
        const penalty = Number(options.getUserQueuePenalty(user) || 0);
        if (penalty > 0) {
          existing.failures = Math.max(
            existing.failures,
            Math.ceil(penalty / 25),
          );
        }
      }
      peerStats[key] = existing;
    }
  }
  return {
    preferredFormat: options.preferredFormat === "mp3" ? "mp3" : "flac",
    strictFormat: options.strictFormat === true,
    peerStats,
  };
}

function invokeRustMatcher(job) {
  const binaryPath = resolveRustWorkerBinary();
  if (!binaryPath) {
    throw new Error(
      "aurral-worker binary not found; build with: cd backend/native/aurral-worker && cargo build --release",
    );
  }
  const response = spawnSync(binaryPath, ["slskd-matcher"], {
    input: JSON.stringify(job),
    encoding: "utf8",
    maxBuffer: MAX_BUFFER_BYTES,
  });
  if (response.error) {
    throw response.error;
  }
  if (response.status !== 0) {
    throw new Error(
      `aurral-worker slskd-matcher exited ${response.status}: ${String(response.stderr || response.stdout || "").trim()}`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(String(response.stdout || "").trim() || "{}");
  } catch (error) {
    throw new Error(`aurral-worker slskd-matcher returned invalid JSON: ${error.message}`);
  }
  if (parsed?.ok === false) {
    throw new Error(parsed?.error || "aurral-worker slskd-matcher failed");
  }
  return parsed?.result || {};
}

const invokeString = (operation, payload = {}) => {
  const result = invokeRustMatcher({ operation, ...payload });
  return result?.value ?? "";
};

const invokeStringList = (operation, payload = {}) => {
  const result = invokeRustMatcher({ operation, ...payload });
  return Array.isArray(result?.values) ? result.values : [];
};

export function bypassBannedArtistTerm(name) {
  return invokeString("bypassBannedArtistTerm", { name });
}

export function stripReleaseTypeSuffix(value) {
  return invokeString("stripReleaseTypeSuffix", { value });
}

export function removeSearchAccents(value) {
  return invokeString("removeSearchAccents", { value });
}

export function buildTrimmedBypassText(value) {
  return invokeString("buildTrimmedBypassText", { value });
}

export function buildVolumeVariationTexts(value) {
  return invokeStringList("buildVolumeVariationTexts", { value });
}

export function buildHalfAlbumTitle(albumName) {
  return invokeString("buildHalfAlbumTitle", { albumName });
}

export function buildFlowAlbumSearchQueries(context) {
  return invokeStringList("buildFlowAlbumSearchQueries", {
    context: mapFlowTrackContext(context),
  });
}

export function buildFlowWildcardAlbumSearchQueries(context) {
  return invokeStringList("buildFlowWildcardAlbumSearchQueries", {
    context: mapFlowTrackContext(context),
  });
}

export function buildFlowTrackFallbackSearchQueries(context) {
  return invokeStringList("buildFlowTrackFallbackSearchQueries", {
    context: mapFlowTrackContext(context),
  });
}

export function buildFlowWildcardTrackFallbackSearchQueries(context) {
  return invokeStringList("buildFlowWildcardTrackFallbackSearchQueries", {
    context: mapFlowTrackContext(context),
  });
}

export function buildFlowArtistOnlySearchQueries(context) {
  return invokeStringList("buildFlowArtistOnlySearchQueries", {
    context: mapFlowTrackContext(context),
  });
}

export function buildFlowSearchQueries(context) {
  return invokeStringList("buildFlowSearchQueries", {
    context: mapFlowTrackContext(context),
  });
}

export function buildFlowSearchTiers(context) {
  const result = invokeRustMatcher({
    operation: "buildFlowSearchTiers",
    context: mapFlowTrackContext(context),
  });
  return Array.isArray(result?.tiers) ? result.tiers : [];
}

const normalizeRankedCandidate = (candidate = {}) => ({
  ...candidate,
  preDownloadRejectReason: candidate.preDownloadRejectReason ?? null,
  resolvedAlbumName: candidate.resolvedAlbumName ?? null,
  releaseFolderFit: candidate.releaseFolderFit ?? null,
  folderScore: candidate.folderScore ?? null,
});

export function rankFlowSearchResults(results, context, options = {}) {
  const payload = invokeRustMatcher({
    operation: "rankFlowSearchResults",
    results: Array.isArray(results) ? results : [],
    context: mapFlowTrackContext(context),
    options: serializeMatcherOptionsForRust(options, results),
  });
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  return candidates.map(normalizeRankedCandidate);
}

export function selectRankedMatchAttempts(matches, limit = 5) {
  const payload = invokeRustMatcher({
    operation: "selectRankedMatchAttempts",
    matches: (Array.isArray(matches) ? matches : []).map(normalizeRankedCandidate),
    limit,
  });
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  return candidates.map(normalizeRankedCandidate);
}

export function countPreDownloadValidCandidates(results, context, options = {}) {
  const payload = invokeRustMatcher({
    operation: "countPreDownloadValidCandidates",
    results: Array.isArray(results) ? results : [],
    context: mapFlowTrackContext(context),
    options: serializeMatcherOptionsForRust(options, results),
  });
  return Number(payload?.count) || 0;
}

export async function validateDownloadedTrack(filePath, candidate, context) {
  const payload = invokeRustMatcher({
    operation: "validateDownloadedTrack",
    filePath,
    candidate,
    context: mapFlowTrackContext(context),
  });
  return {
    valid: payload?.valid === true,
    reason: payload?.reason ?? null,
    scores: payload?.scores || {},
    actualDurationMs: payload?.actualDurationMs ?? null,
    remoteFilename: payload?.remoteFilename || "",
  };
}
