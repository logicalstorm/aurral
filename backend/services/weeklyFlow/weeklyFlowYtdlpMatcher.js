import {
  normalizeReleaseText as normalizeText,
  scoreTextMatch,
} from "../providers/brainzmashRanking.js";

const MAX_CANDIDATES = 5;
const REJECT_PATTERNS =
  /\b(karaoke|instrumental|cover|nightcore|sped up|slowed|8d audio|10 hour|10hr|hours? long|full album|discography|reaction|tutorial|lesson|remix|mashup|live performance|concert|fan.?made)\b/i;
const PREFER_PATTERNS =
  /\b(official audio|official video|official lyric|topic|audio)\b/i;

function readContext(context) {
  return {
    trackName: String(context?.trackName || context?.title || "").trim(),
    artistName: String(context?.artistName || context?.artist || "").trim(),
    albumName: String(context?.albumName || context?.album || "").trim(),
    durationMs: Number(context?.durationMs || 0),
  };
}

function scoreDuration(durationSec, expectedMs) {
  if (!Number.isFinite(expectedMs) || expectedMs <= 0) return { ok: true, score: 0 };
  if (!Number.isFinite(durationSec) || durationSec <= 0) return { ok: true, score: -8 };
  const diff = Math.abs(durationSec * 1000 - expectedMs);
  const ok =
    diff <= 25000 || diff <= Math.max(12000, expectedMs * 0.18);
  if (!ok) return { ok: false, score: -40 };
  if (diff <= 5000) return { ok: true, score: 25 };
  if (diff <= 12000) return { ok: true, score: 18 };
  if (diff <= 25000) return { ok: true, score: 10 };
  return { ok: true, score: 0 };
}

function scoreNoise(title, channel) {
  let score = 0;
  if (PREFER_PATTERNS.test(`${title} ${channel}`)) score += 12;
  if (/\btopic\b/i.test(channel)) score += 18;
  if (/\bofficial\b/i.test(channel)) score += 8;
  return score;
}

export function buildYtdlpSearchQueries(context) {
  const ctx = readContext(context);
  if (!ctx.trackName) return [];
  const queries = [];
  if (ctx.artistName) {
    queries.push(`${ctx.artistName} ${ctx.trackName}`);
    queries.push(`${ctx.artistName} ${ctx.trackName} official audio`);
  } else {
    queries.push(ctx.trackName);
  }
  const seen = new Set();
  return queries.filter((query) => {
    const key = normalizeText(query);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function rankYtdlpResults(results, context) {
  const ctx = readContext(context);
  const ranked = [];
  for (const result of Array.isArray(results) ? results : []) {
    const title = String(result?.title || "").trim();
    const channel = String(result?.channel || "").trim();
    const id = String(result?.id || "").trim();
    if (!id || !title) continue;
    if (String(result?.liveStatus || "").includes("live")) continue;
    if (REJECT_PATTERNS.test(`${title} ${channel}`)) continue;
    const duration = scoreDuration(result.durationSec, ctx.durationMs);
    if (!duration.ok) continue;

    const titleScore = Math.max(
      scoreTextMatch(title, ctx.trackName),
      scoreTextMatch(title, `${ctx.artistName} ${ctx.trackName}`),
    );
    const artistScore = Math.max(
      scoreTextMatch(title, ctx.artistName),
      scoreTextMatch(channel, ctx.artistName),
    );
    const noiseScore = scoreNoise(title, channel);
    if (titleScore < 40 || artistScore < 25) continue;
    ranked.push({
      raw: {
        id,
        title,
        url: result.url,
        channel,
        durationSec: result.durationSec,
        file: title,
      },
      score: titleScore + artistScore + duration.score + noiseScore,
      scores: {
        title: titleScore,
        artist: artistScore,
        duration: duration.score,
        noise: noiseScore,
      },
      resolvedAlbumName: ctx.albumName || null,
      preDownloadValid:
        titleScore >= 55 &&
        artistScore >= 40 &&
        duration.score >= -8 &&
        noiseScore >= -20,
    });
  }
  ranked.sort((left, right) => right.score - left.score);
  return ranked.slice(0, MAX_CANDIDATES);
}

if (process.argv[1] && process.argv[1].endsWith("weeklyFlowYtdlpMatcher.js")) {
  const ranked = rankYtdlpResults(
    [
      {
        id: "good",
        title: "Daft Punk - Get Lucky (Official Audio)",
        channel: "Daft Punk",
        durationSec: 248,
        url: "https://www.youtube.com/watch?v=good",
      },
      {
        id: "bad",
        title: "Get Lucky karaoke version",
        channel: "Random",
        durationSec: 248,
        url: "https://www.youtube.com/watch?v=bad",
      },
      {
        id: "long",
        title: "Daft Punk Get Lucky 10 hour",
        channel: "Loops",
        durationSec: 36000,
        url: "https://www.youtube.com/watch?v=long",
      },
    ],
    {
      artistName: "Daft Punk",
      trackName: "Get Lucky",
      durationMs: 248000,
    },
  );
  console.assert(ranked[0]?.raw?.id === "good", "preferred official audio");
  console.assert(!ranked.some((entry) => entry.raw.id === "long"), "reject long junk");
  console.assert(!ranked.some((entry) => entry.raw.id === "bad"), "reject karaoke");
  console.log("weeklyFlowYtdlpMatcher self-check ok");
}
