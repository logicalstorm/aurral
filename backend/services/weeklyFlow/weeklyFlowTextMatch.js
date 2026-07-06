export const TITLE_STOP_WORDS = new Set([
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

const USENET_STRIP =
  /\b(deluxe|expanded|anniversary|remaster(?:ed)?|bonus|edition|explicit|clean)\b/g;
const MATCHER_STRIP =
  /\b(deluxe|expanded|anniversary|remaster(?:ed)?|bonus|edition|live|mono|stereo|single|ep|explicit|clean)\b/g;

export function normalizeReleaseText(value, { extended = false } = {}) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(extended ? MATCHER_STRIP : USENET_STRIP, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTitle(value, { extended = false } = {}) {
  return normalizeReleaseText(value, { extended })
    .split(" ")
    .filter((word) => word && !TITLE_STOP_WORDS.has(word))
    .join(" ");
}

export function splitWords(value, options) {
  return normalizeReleaseText(value, options)
    .split(" ")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function scoreTextMatch(left, right, options) {
  const a = normalizeReleaseText(left, options);
  const b = normalizeReleaseText(right, options);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) {
    const aWords = a.split(" ").filter(Boolean).length;
    const bWords = b.split(" ").filter(Boolean).length;
    const ratio = Math.min(aWords, bWords) / Math.max(aWords, bWords, 1);
    if (ratio >= 0.6) return 92;
    if (ratio >= 0.25) return 70;
    return 45;
  }
  const leftWords = new Set(splitWords(a, options));
  const rightWords = new Set(splitWords(b, options));
  if (leftWords.size === 0 || rightWords.size === 0) return 0;
  let overlap = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) overlap += 1;
  }
  return Math.round(((2 * overlap) / Math.max(1, leftWords.size + rightWords.size)) * 100);
}

export function getYear(value) {
  const match = String(value || "").match(/\b(19\d{2}|20\d{2})\b/);
  return match ? match[1] : null;
}
