export const SEARCH_RANK = {
  PLAYLIST: 5000,
  LIBRARY_TRACK: 4000,
  LIBRARY_ARTIST: 3500,
  LIBRARY_ITEM: 3000,
};

export const LIBRARY_PRIORITY_MIN_SCORE = 82;

export function getLocalMatchThreshold(query) {
  const wordCount = String(query || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  if (wordCount >= 3) return 78;
  if (wordCount === 2) return 45;
  return 16;
}

function getLibraryTierBoost(item, base) {
  if (base < LIBRARY_PRIORITY_MIN_SCORE) return 0;
  if (item?.type === "playlist") return SEARCH_RANK.PLAYLIST;
  if (item?.inLibrary) {
    if (item.type === "track") return SEARCH_RANK.LIBRARY_TRACK;
    if (item.type === "artist") return SEARCH_RANK.LIBRARY_ARTIST;
    return SEARCH_RANK.LIBRARY_ITEM;
  }
  return 0;
}

export function getSearchRankScore(item) {
  const base = Number(item?.score) || 0;
  return base + getLibraryTierBoost(item, base);
}

export function compareSearchResults(left, right) {
  return getSearchRankScore(right) - getSearchRankScore(left);
}
