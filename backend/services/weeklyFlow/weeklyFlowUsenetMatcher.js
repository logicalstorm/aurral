import path from "path";

const AUDIO_CATEGORY_MIN = 3000;
const AUDIO_CATEGORY_MAX = 3999;
const DEFAULT_MAX_RELEASE_SIZE_MB = 2500;
const TITLE_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "feat",
  "featuring",
  "ft",
  "with",
]);

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\b(deluxe|expanded|anniversary|remaster(?:ed)?|bonus|edition|explicit|clean)\b/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(value) {
  return normalizeText(value)
    .split(" ")
    .filter((word) => word && !TITLE_STOP_WORDS.has(word))
    .join(" ");
}

function splitWords(value) {
  return normalizeText(value)
    .split(" ")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function scoreTextMatch(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) {
    const aWords = a.split(" ").filter(Boolean).length;
    const bWords = b.split(" ").filter(Boolean).length;
    const ratio = Math.min(aWords, bWords) / Math.max(aWords, bWords, 1);
    if (ratio >= 0.6) return 92;
    if (ratio >= 0.35) return 70;
    return 45;
  }
  const leftWords = new Set(splitWords(a));
  const rightWords = new Set(splitWords(b));
  if (leftWords.size === 0 || rightWords.size === 0) return 0;
  let overlap = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) overlap += 1;
  }
  return Math.round(((2 * overlap) / Math.max(1, leftWords.size + rightWords.size)) * 100);
}

function getYear(value) {
  const match = String(value || "").match(/\b(19\d{2}|20\d{2})\b/);
  return match ? match[1] : null;
}

function hasAudioCategory(release) {
  const categories = Array.isArray(release?.categories) ? release.categories : [];
  if (categories.length === 0) return true;
  return categories.some((category) => {
    const id = Number(category);
    return Number.isFinite(id) && id >= AUDIO_CATEGORY_MIN && id <= AUDIO_CATEGORY_MAX;
  });
}

function hasConflictingYear(title, expectedYear) {
  const expected = getYear(expectedYear);
  if (!expected) return false;
  const years = [...String(title || "").matchAll(/\b(19\d{2}|20\d{2})\b/g)].map(
    (match) => match[1],
  );
  return years.length > 0 && !years.includes(expected);
}

function scoreFormat(title) {
  const text = normalizeText(title);
  if (/\bflac\b|\blossless\b|\blossless\b|\b24bit\b|\b24 bit\b/.test(text)) {
    return 12;
  }
  if (/\bmp3\b|\b320\b|\bscene\b/.test(text)) return 7;
  return 0;
}

function scoreNoise(title) {
  const text = normalizeText(title);
  let penalty = 0;
  if (/\bdiscography\b|\bcomplete\b|\bcollection\b|\bbox set\b/.test(text)) {
    penalty -= 30;
  }
  if (/\bvideo\b|\bdvd\b|\bbluray\b|\bblu ray\b/.test(text)) {
    penalty -= 35;
  }
  if (/\bkaraoke\b|\binstrumental\b/.test(text)) {
    penalty -= 25;
  }
  return penalty;
}

function scoreReleaseSize(release, context, options) {
  const size = Number(release?.size || 0);
  if (!size) return 0;
  const sizeMb = size / (1024 * 1024);
  const maxReleaseSizeMb = Math.max(
    50,
    Number(options?.maxReleaseSizeMb || DEFAULT_MAX_RELEASE_SIZE_MB),
  );
  if (sizeMb > maxReleaseSizeMb) return -80;
  if (context?.albumTrackCount && context.albumTrackCount > 1) {
    if (sizeMb >= 40 && sizeMb <= maxReleaseSizeMb) return 8;
    return -8;
  }
  if (sizeMb >= 3 && sizeMb <= 250) return 8;
  if (sizeMb > 250 && sizeMb <= 700) return -8;
  return -18;
}

function readComparableAlbumName(context) {
  return String(context?.albumName || "")
    .replace(/\s+(?:-|–|—)\s+(?:single|ep|album)\s*$/i, "")
    .replace(/\s+[[(](?:single|ep|album)[)\]]\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function releaseKey(release) {
  return [release?.guid, release?.downloadUrl, release?.indexerId, normalizeTitle(release?.title)]
    .map((entry) =>
      String(entry || "")
        .trim()
        .toLowerCase(),
    )
    .join("\0");
}

export function rankUsenetReleases(releases, context, options = {}) {
  const albumName = readComparableAlbumName(context);
  const expectedYear = getYear(context?.releaseYear);
  const seen = new Set();
  const ranked = [];
  for (const release of Array.isArray(releases) ? releases : []) {
    if (!release?.downloadUrl || !release?.title) continue;
    if (String(release.protocol || "").toLowerCase() !== "usenet") continue;
    const key = releaseKey(release);
    if (seen.has(key)) continue;
    seen.add(key);
    const title = release.title;
    const artistScore = scoreTextMatch(title, context?.artistName);
    const trackScore = scoreTextMatch(title, context?.trackName);
    const albumScore = albumName ? scoreTextMatch(title, albumName) : 0;
    const yearScore = expectedYear && normalizeText(title).includes(expectedYear) ? 10 : 0;
    const audioCategoryScore = hasAudioCategory(release) ? 10 : -30;
    const formatScore = scoreFormat(title);
    const sizeScore = scoreReleaseSize(release, context, options);
    const noiseScore = scoreNoise(title);
    const yearPenalty = hasConflictingYear(title, expectedYear) ? -20 : 0;
    const score =
      artistScore * 0.35 +
      Math.max(trackScore, albumScore) * 0.35 +
      Math.min(trackScore, albumScore || trackScore) * 0.12 +
      yearScore +
      audioCategoryScore +
      formatScore +
      sizeScore +
      noiseScore +
      yearPenalty;
    const preDownloadValid =
      artistScore >= 45 &&
      (trackScore >= 55 || albumScore >= 65) &&
      audioCategoryScore >= 0 &&
      score >= 62;
    ranked.push({
      raw: {
        release,
        file: title,
        size: Number(release.size || 0),
        downloadUrl: release.downloadUrl,
        indexerId: release.indexerId,
        indexer: release.indexer,
        guid: release.guid,
      },
      score: Math.round(score),
      resolvedAlbumName: albumScore >= 65 ? albumName : null,
      preDownloadValid,
      scores: {
        artist: artistScore,
        track: trackScore,
        album: albumScore,
        year: yearScore,
        format: formatScore,
        size: sizeScore,
      },
    });
  }
  return ranked.sort((left, right) => {
    if (left.preDownloadValid !== right.preDownloadValid) {
      return left.preDownloadValid ? -1 : 1;
    }
    if (right.score !== left.score) return right.score - left.score;
    return String(left.raw.file).localeCompare(String(right.raw.file));
  });
}

export function selectRankedUsenetCandidates(ranked, limit = 5) {
  const max = Math.max(1, Math.floor(Number(limit) || 5));
  const selected = [];
  const seenIndexers = new Set();
  const seenKeys = new Set();
  for (const candidate of Array.isArray(ranked) ? ranked : []) {
    if (selected.length >= max) break;
    if (!candidate?.preDownloadValid) continue;
    const key = releaseKey(candidate.raw?.release);
    const indexerId = String(candidate.raw?.indexerId || "");
    if (seenKeys.has(key) || (indexerId && seenIndexers.has(indexerId))) continue;
    seenKeys.add(key);
    if (indexerId) seenIndexers.add(indexerId);
    selected.push(candidate);
  }
  for (const candidate of Array.isArray(ranked) ? ranked : []) {
    if (selected.length >= max) break;
    const key = releaseKey(candidate.raw?.release);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    selected.push(candidate);
  }
  return selected;
}

export function isAudioFile(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  return [
    ".flac",
    ".mp3",
    ".m4a",
    ".ogg",
    ".wav",
    ".aac",
    ".opus",
    ".alac",
    ".ape",
    ".wma",
  ].includes(ext);
}
