export const SHOWS_FILTERS = [
  { id: "all", label: "All" },
  { id: "library", label: "Library" },
  { id: "discover", label: "Discover" },
];

export const DEFAULT_SHOWS_FILTER = "all";

export const SHOWS_FILTER_IDS = SHOWS_FILTERS.map((filter) => filter.id);

export function normalizeShowsFilter(filter) {
  if (!filter) return DEFAULT_SHOWS_FILTER;
  return SHOWS_FILTER_IDS.includes(filter) ? filter : DEFAULT_SHOWS_FILTER;
}
