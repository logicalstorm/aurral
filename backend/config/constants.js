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

export const LIDARR_CACHE_TTL = 5 * 60 * 1000;

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
  requests: [],
  settings: {
    rootFolderPath: null,
    qualityProfileId: null,
    metadataProfileId: null,
    monitored: true,
    searchForMissingAlbums: false,
    albumFolders: true,
    metadataProfileReleaseTypes: ["Album", "EP", "Single", "Broadcast", "Soundtrack", "Spokenword", "Remix", "Live", "Compilation", "Demo"],
  },
};
