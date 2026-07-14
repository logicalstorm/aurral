import axios from "../../../lib/axiosFetch.js";
import createRateLimiter from "./rateLimiter.js";
import createCache from "./simpleCache.js";
import { dbOps } from "../../db/helpers/index.js";
import {
  MUSICBRAINZ_API,
  APP_NAME,
  APP_VERSION,
} from "../../config/constants.js";
import {
  getArtistNameByMbid as getMetadataArtistNameByMbid,
  legacyMusicbrainzRequest,
  listArtistAlbums as listMetadataArtistAlbums,
  resolveArtistByName as resolveMetadataArtistByName,
} from "../providers/brainzmashProvider.js";
import { getMusicBrainzContact } from "./config.js";

const musicbrainzArtistNameCache = createCache(3600);
const musicbrainzReleaseGroupsCache = createCache(300);
const PRIMARY_RELEASE_TYPES = ["Album", "EP", "Single"];
const SECONDARY_RELEASE_TYPES = [
  "Live",
  "Remix",
  "Compilation",
  "Demo",
  "Broadcast",
  "Soundtrack",
  "Spokenword",
  "Other",
];

const mbLimiter = createRateLimiter(1000);

export const musicbrainzRequest = async (endpoint, params = {}) =>
  legacyMusicbrainzRequest(endpoint, params);

export async function musicbrainzGetArtistReleaseGroups(
  mbid,
  selectedReleaseTypes = null,
  { includeTrackCounts = true, hydrateLimit = includeTrackCounts ? 30 : 6 } = {},
) {
  const safeHydrateLimit =
    Number.isFinite(Number(hydrateLimit)) && Number(hydrateLimit) > 0
      ? Math.min(100, Math.floor(Number(hydrateLimit)))
      : includeTrackCounts
        ? 30
        : 6;
  const cacheKey = `full:${mbid}:${JSON.stringify(selectedReleaseTypes || [])}:${includeTrackCounts ? "rated" : "dated"}:${safeHydrateLimit}`;
  const cached = musicbrainzReleaseGroupsCache.get(cacheKey);
  if (cached) return cached;
  try {
    const items = await listMetadataArtistAlbums(mbid, {
      releaseTypes: selectedReleaseTypes || [],
      includeTrackCounts,
      hydrateLimit: safeHydrateLimit,
    });
    const mapped = items.map((item) => ({
      id: item.id,
      title: item.title || "",
      "first-release-date": item.firstReleaseDate || null,
      "primary-type": item.type || "Album",
      "secondary-types": Array.isArray(item.secondaryTypes)
        ? item.secondaryTypes
        : [],
      rating: item.rating || null,
      "artist-credit": item.artistName
        ? [
            {
              name: item.artistName,
              artist: item.artistId
                ? { id: item.artistId, name: item.artistName }
                : { name: item.artistName },
            },
          ]
        : [],
    }));
    musicbrainzReleaseGroupsCache.set(cacheKey, mapped);
    return mapped;
  } catch {
    return [];
  }
}

const artistCreditIncludesMbid = (artistCredit, mbid) => {
  const normalizedMbid = String(mbid || "")
    .trim()
    .toLowerCase();
  if (!normalizedMbid || !Array.isArray(artistCredit)) return false;
  return artistCredit.some(
    (credit) =>
      String(credit?.artist?.id || "")
        .trim()
        .toLowerCase() === normalizedMbid,
  );
};

const getReleaseGroupArtistId = (releaseGroup) => {
  const artistCredit = Array.isArray(releaseGroup?.["artist-credit"])
    ? releaseGroup["artist-credit"]
    : [];
  return String(artistCredit[0]?.artist?.id || "").trim() || null;
};

const officialMusicbrainzRecordingSearch = async (
  mbid,
  { limit = 100, offset = 0 } = {},
) => {
  const contact =
    (getMusicBrainzContact() || "").trim() || "https://github.com/aurral";
  const userAgent = `${APP_NAME}/${APP_VERSION} ( ${contact} )`;
  const safeLimit = Math.min(
    100,
    Math.max(1, Number.parseInt(limit, 10) || 100),
  );
  const safeOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
  return mbLimiter.schedule(async () => {
    const response = await axios.get(`${MUSICBRAINZ_API}/recording`, {
      params: {
        fmt: "json",
        query: `arid:${mbid}`,
        inc: "artist-credits+releases",
        limit: safeLimit,
        offset: safeOffset,
      },
      headers: { "User-Agent": userAgent },
      timeout: 8000,
    });
    return response.data;
  });
};

const mapAppearsOnReleaseGroup = (releaseGroup, release, recording, mbid) => {
  const artistCredit = Array.isArray(releaseGroup?.["artist-credit"])
    ? releaseGroup["artist-credit"]
    : Array.isArray(release?.["artist-credit"])
      ? release["artist-credit"]
      : [];
  return {
    id: releaseGroup?.id,
    title: releaseGroup?.title || release?.title || "Untitled release",
    "first-release-date":
      releaseGroup?.["first-release-date"] || release?.date || null,
    "primary-type": releaseGroup?.["primary-type"] || "Album",
    "secondary-types": Array.isArray(releaseGroup?.["secondary-types"])
      ? releaseGroup["secondary-types"]
      : [],
    rating: null,
    "artist-credit": artistCredit,
    _appearsOn: true,
    _appearsOnTrack: recording?.title || null,
    _appearsOnArtistMbid: mbid,
    releases: release?.id
      ? [
          {
            id: release.id,
            status: release.status || null,
            date: release.date || null,
            title: release.title || releaseGroup?.title || "Untitled release",
          },
        ]
      : [],
  };
};

export async function musicbrainzGetArtistAppearsOnReleaseGroups(
  mbid,
  directReleaseGroups = [],
  { limit = 24 } = {},
) {
  if (!mbid) return [];
  const safeLimit = Math.min(
    250,
    Math.max(1, Number.parseInt(limit, 10) || 24),
  );
  const cacheKey = `appears-on:${mbid}:${safeLimit}`;
  const cached = musicbrainzReleaseGroupsCache.get(cacheKey);
  if (cached) return cached;

  const directIds = new Set(
    (Array.isArray(directReleaseGroups) ? directReleaseGroups : [])
      .map((item) => String(item?.id || "").trim())
      .filter(Boolean),
  );

  try {
    const byReleaseGroupId = new Map();
    const pageSize = 100;
    const maxRecordingCount = Math.min(1000, Math.max(pageSize, safeLimit * 4));

    for (let offset = 0; offset < maxRecordingCount; offset += pageSize) {
      const data = await officialMusicbrainzRecordingSearch(mbid, {
        limit: pageSize,
        offset,
      });
      const recordings = Array.isArray(data?.recordings) ? data.recordings : [];

      for (const recording of recordings) {
        if (!artistCreditIncludesMbid(recording?.["artist-credit"], mbid)) {
          continue;
        }
        for (const release of Array.isArray(recording?.releases)
          ? recording.releases
          : []) {
          const releaseGroup = release?.["release-group"];
          const releaseGroupId = String(releaseGroup?.id || "").trim();
          if (!releaseGroupId || directIds.has(releaseGroupId)) continue;
          if (getReleaseGroupArtistId(releaseGroup) === mbid) continue;
          if (!byReleaseGroupId.has(releaseGroupId)) {
            byReleaseGroupId.set(
              releaseGroupId,
              mapAppearsOnReleaseGroup(releaseGroup, release, recording, mbid),
            );
          }
        }
      }

      if (byReleaseGroupId.size >= safeLimit || recordings.length < pageSize) {
        break;
      }
    }

    const mapped = [...byReleaseGroupId.values()]
      .sort((left, right) =>
        String(right["first-release-date"] || "").localeCompare(
          String(left["first-release-date"] || ""),
        ),
      )
      .slice(0, safeLimit);
    musicbrainzReleaseGroupsCache.set(cacheKey, mapped);
    return mapped;
  } catch {
    return [];
  }
}

export async function musicbrainzGetArtistNameByMbid(mbid) {
  if (!mbid) return null;
  const cached = musicbrainzArtistNameCache.get(mbid);
  if (cached !== undefined) return cached;
  try {
    const name = await getMetadataArtistNameByMbid(mbid);
    const normalized = name && typeof name === "string" ? name.trim() : null;
    musicbrainzArtistNameCache.set(mbid, normalized);
    return normalized;
  } catch (e) {
    musicbrainzArtistNameCache.set(mbid, null);
    return null;
  }
}

function normalizeArtistNameKey(artistName) {
  return String(artistName || "")
    .trim()
    .toLowerCase();
}

export function musicbrainzGetCachedArtistMbidByName(artistName) {
  const normalized = normalizeArtistNameKey(artistName);
  if (!normalized) return null;
  const cached = dbOps.getMusicbrainzArtistMbidCache(normalized);
  if (!cached?.updatedAt) return null;
  const ageMs = Date.now() - cached.updatedAt;
  const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const NEGATIVE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
  const cacheTtl = cached.mbid ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
  if (ageMs < 0 || ageMs >= cacheTtl) return null;
  return cached.mbid || null;
}

export async function musicbrainzResolveArtistMbidByName(artistName) {
  const rawName = String(artistName || "").trim();
  if (!rawName) return null;
  const normalized = normalizeArtistNameKey(rawName);
  const cached = dbOps.getMusicbrainzArtistMbidCache(normalized);
  const now = Date.now();
  const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const NEGATIVE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
  if (cached?.updatedAt) {
    const ageMs = now - cached.updatedAt;
    const cacheTtl = cached.mbid ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
    if (ageMs >= 0 && ageMs < cacheTtl) {
      return cached.mbid || null;
    }
  }
  try {
    const resolved = await resolveMetadataArtistByName(rawName);
    dbOps.setMusicbrainzArtistMbidCache(normalized, resolved);
    return resolved;
  } catch (e) {
    if (cached) {
      return cached.mbid || null;
    }
    return null;
  }
}

export {
  PRIMARY_RELEASE_TYPES,
  SECONDARY_RELEASE_TYPES,
  musicbrainzArtistNameCache,
  musicbrainzReleaseGroupsCache,
};
