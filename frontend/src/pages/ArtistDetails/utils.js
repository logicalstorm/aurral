import { TAG_COLORS, allReleaseTypes } from "./constants";

export const getTagColor = (name) => {
  if (!name) return "#211f27";
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
};

export const starsFromCount = (count) => {
  if (count == null || count <= 0) return null;
  return Math.min(
    5,
    Math.max(1, Math.round(1 + (4 * Math.log10(count + 1)) / 7))
  );
};

export const deduplicateAlbums = (albums) => {
  const seen = new Map();
  return albums.filter((album) => {
    const key = album.id || `${album.mbid}-${album.artistId}`;
    if (seen.has(key)) return false;
    seen.set(key, true);
    return true;
  });
};

export const formatLifeSpan = (lifeSpan) => {
  if (!lifeSpan) return null;
  const { begin, end, ended } = lifeSpan;
  if (!begin) return null;
  const beginYear = begin.split("-")[0];
  if (ended && end) {
    const endYear = end.split("-")[0];
    return `${beginYear} - ${endYear}`;
  }
  return `${beginYear} - Present`;
};

export const getArtistType = (type) => {
  const types = {
    Person: "Solo Artist",
    Group: "Band",
    Orchestra: "Orchestra",
    Choir: "Choir",
    Character: "Character",
    Other: "Other",
  };
  return types[type] || type;
};

export const matchesReleaseTypeFilter = (releaseGroup, selectedReleaseTypes) => {
  if (!selectedReleaseTypes || selectedReleaseTypes.length === 0) return true;
  const primaryType = releaseGroup["primary-type"];
  const secondaryTypes = releaseGroup["secondary-types"] || [];
  if (!selectedReleaseTypes.includes(primaryType)) return false;
  if (secondaryTypes.length > 0) {
    return secondaryTypes.every((secondaryType) =>
      selectedReleaseTypes.includes(secondaryType)
    );
  }
  return true;
};

export const hasActiveFilters = (selectedReleaseTypes) => {
  if (selectedReleaseTypes.length !== allReleaseTypes.length) return true;
  return !allReleaseTypes.every((type) => selectedReleaseTypes.includes(type));
};

export const getCoverImage = (coverImages) => {
  if (!coverImages?.length) return null;
  const front = coverImages.find((img) => img.front);
  return front?.image || coverImages[0]?.image;
};
