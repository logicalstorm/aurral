export const QUALITY_PRESETS = {
  low: {
    name: "Low",
    allowedFormats: ["mp3-192", "mp3-256", "mp3-320"],
    preferLossless: false,
    preferredGroups: [],
    preferCD: false,
    preferWEB: false,
    avoidVinyl: false,
  },
  standard: {
    name: "Standard",
    allowedFormats: ["mp3-320", "flac"],
    preferLossless: true,
    preferredGroups: ["DeVOiD", "PERFECT", "ENRiCH"],
    preferCD: true,
    preferWEB: true,
    avoidVinyl: true,
  },
  max: {
    name: "Max",
    allowedFormats: ["flac"],
    preferLossless: true,
    preferredGroups: ["DeVOiD", "PERFECT", "ENRiCH"],
    preferCD: true,
    preferWEB: true,
    avoidVinyl: true,
  },
};

export function getQualityProfiles() {
  return Object.keys(QUALITY_PRESETS).map((key) => ({
    id: key,
    ...QUALITY_PRESETS[key],
  }));
}
