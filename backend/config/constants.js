export const GENRE_KEYWORDS = [
  "rock",
  "pop",
  "electronic",
  "metal",
  "jazz",
  "hip-hop",
  "indie",
  "alternative",
  "punk",
  "soul",
  "r&b",
  "folk",
  "classical",
  "blues",
  "country",
  "reggae",
  "disco",
  "funk",
];

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MUSICBRAINZ_API = "https://musicbrainz.org/ws/2";
export const LASTFM_API = "https://ws.audioscrobbler.com/2.0/";
export const APP_NAME = "Aurral";
export const APP_VERSION = "1.0.0";

export const defaultData = {
  discovery: {
    recommendations: [],
    globalTop: [],
    basedOn: [],
    topTags: [],
    topGenres: [],
    lastUpdated: null,
  },
  images: {},
  requests: [], // Legacy artist-based requests (kept for backward compatibility)
  albumRequests: [], // New album-based requests
  library: {
    artists: [],
    albums: [],
    tracks: [],
    rootFolder: null,
    lastScan: null,
  },
  qualityProfiles: [],
  customFormats: [],
  settings: {
    rootFolderPath: null,
    quality: "standard", // "low", "standard", "max"
    releaseTypes: ["Album", "EP", "Single", "Broadcast", "Soundtrack", "Spokenword", "Remix", "Live", "Compilation", "Demo"],
    integrations: {
      navidrome: { url: "", username: "", password: "" },
      lastfm: { username: "" },
      slskd: { url: "", apiKey: "" },
      musicbrainz: { email: "" },
      spotify: { clientId: "", clientSecret: "" },
      general: { authUser: "", authPassword: "" },
    },
    queueCleaner: {
      enabled: true,
      blocklist: true,
      remove: false,
      rename: true,
      cleanImports: "missing", // "missing", "incomplete", "always"
      retryFindingRelease: true,
      retryDelayMinutes: 5,
      maxRetries: 3,
    },
  },
  blocklist: [],
  activityLog: [], // Activity log for tracking all operations
};
