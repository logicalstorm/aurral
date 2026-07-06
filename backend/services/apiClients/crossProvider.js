import axios from "../../../lib/axiosFetch.js";
import createCache from "./simpleCache.js";
import {
  APP_NAME,
  APP_VERSION,
} from "../../config/constants.js";
import { getMusicBrainzContact } from "./config.js";
import { getLastfmApiKey } from "./config.js";
import { lastfmRequest, lastfmGetArtistBio } from "./lastfm.js";
import { dbOps } from "../../db/helpers/index.js";
import { normalizeTitle } from "./deezer.js";
import { resolveAlbumByArtistAndTitle } from "../providers/brainzmashProvider.js";

const wikiBioCache = createCache(3600);

const wikidataTitleCache = createCache(3600);

const youtubeVideoCache = createCache(24 * 3600);

async function wikidataGetWikipediaTitleByMbid(mbid) {
  if (!mbid) return null;
  const cacheKey = `wd:v2:${mbid}`;
  const cached = wikidataTitleCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const query = [
      "PREFIX wdt: <http://www.wikidata.org/prop/direct/>",
      "PREFIX schema: <http://schema.org/>",
      `SELECT ?article WHERE { ?band wdt:P434 "${mbid}" . ?article schema:about ?band . ?article schema:isPartOf <https://en.wikipedia.org/> . } LIMIT 1`,
    ].join(" ");
    const contact =
      (getMusicBrainzContact() || "").trim() || "https://github.com/aurral";
    const userAgent = `${APP_NAME}/${APP_VERSION} ( ${contact} )`;
    const res = await axios.get("https://query.wikidata.org/sparql", {
      params: { query, format: "json" },
      headers: {
        "User-Agent": userAgent,
        Accept: "application/sparql-results+json",
      },
      timeout: 5000,
    });
    const bindings = res.data?.results?.bindings || [];
    const url = bindings[0]?.article?.value || null;
    if (!url) {
      wikidataTitleCache.set(cacheKey, null);
      return null;
    }
    const slug = url.split("/").pop() || "";
    const title = decodeURIComponent(slug).replace(/_/g, " ").trim();
    const value = title || null;
    wikidataTitleCache.set(cacheKey, value);
    return value;
  } catch (e) {
    wikidataTitleCache.set(cacheKey, null);
    return null;
  }
}

async function wikipediaGetBioByTitle(title) {
  if (!title) return null;
  const cacheKey = `wp:v2:${title.toLowerCase()}`;
  const cached = wikiBioCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const urlTitle = encodeURIComponent(title.replace(/ /g, "_"));
    const contact =
      (getMusicBrainzContact() || "").trim() || "https://github.com/aurral";
    const userAgent = `${APP_NAME}/${APP_VERSION} ( ${contact} )`;
    const res = await axios.get(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${urlTitle}`,
      { timeout: 5000, headers: { "User-Agent": userAgent } },
    );
    const extract = res.data?.extract || null;
    const isDisambiguation =
      res.data?.type === "disambiguation" || /may refer to/.test(extract || "");
    const value =
      typeof extract === "string" && extract.trim() && !isDisambiguation
        ? extract.trim()
        : null;
    wikiBioCache.set(cacheKey, value);
    return value;
  } catch (e) {
    wikiBioCache.set(cacheKey, null);
    return null;
  }
}

export async function wikipediaGetArtistBioByMbid(mbid) {
  const title = await wikidataGetWikipediaTitleByMbid(mbid);
  if (!title) return null;
  return wikipediaGetBioByTitle(title);
}

export async function getArtistBio(_artistName, mbid) {
  if (!mbid) return null;
  return Promise.any([
    wikipediaGetArtistBioByMbid(mbid),
    lastfmGetArtistBio(mbid),
  ]).catch(() => null);
}

export async function enrichReleaseGroupsWithLastfm(
  mbReleaseGroups,
  artistName,
  artistMbid = null,
) {
  if (!mbReleaseGroups?.length || !artistName || !getLastfmApiKey())
    return mbReleaseGroups;
  try {
    const params = artistMbid
      ? { mbid: artistMbid, limit: 200 }
      : { artist: artistName, limit: 200 };
    const data = await lastfmRequest("artist.getTopAlbums", params);
    const raw = data?.topalbums?.album;
    const albums = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (!albums.length) return mbReleaseGroups;

    const byTitle = new Map();
    for (const album of albums) {
      const title = album?.name || album?.title || "";
      if (!title) continue;
      const listeners = parseInt(album?.listeners || album?.playcount || 0, 10);
      if (!listeners) continue;
      const key = normalizeTitle(title);
      const existing = byTitle.get(key) || 0;
      if (listeners > existing) byTitle.set(key, listeners);
    }

    for (const rg of mbReleaseGroups) {
      rg.fans = 0;
      const key = normalizeTitle(rg.title);
      const listeners = byTitle.get(key);
      if (typeof listeners === "number") {
        rg.fans = listeners;
      }
    }
    return mbReleaseGroups;
  } catch (e) {
    return mbReleaseGroups;
  }
}

function normalizeArtistAlbumKey(artistName, albumName) {
  const a = String(artistName || "").trim().toLowerCase();
  const b = String(albumName || "").trim().toLowerCase();
  return `aa:${a}\0${b}`;
}

export async function resolveDeezerAlbumToMbid(
  artistName,
  albumName,
  deezerAlbumId,
) {
  const dzKey = `dz:${String(deezerAlbumId || "").replace(/^dz-/, "")}`;
  const aaKey = normalizeArtistAlbumKey(artistName, albumName);
  const cached =
    dbOps.getDeezerMbidCache(dzKey) || dbOps.getDeezerMbidCache(aaKey);
  if (cached) return cached;

  const artist = String(artistName || "").trim();
  const album = String(albumName || "").trim();
  if (!artist || !album) return null;

  try {
    const id = await resolveAlbumByArtistAndTitle({
      artistName: artist,
      albumTitle: album,
    });
    if (!id) return null;
    dbOps.setDeezerMbidCache(dzKey, id);
    dbOps.setDeezerMbidCache(aaKey, id);
    return id;
  } catch (e) {
    return null;
  }
}
export async function youtubeFindTopSongVideo(artistName, trackTitle) {
  const artist = String(artistName || "").trim();
  const title = String(trackTitle || "").trim();
  if (!artist || !title) return null;

  const cacheKey = `${artist.toLowerCase()}\0${title.toLowerCase()}`;
  const cached = youtubeVideoCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const query = `${artist} ${title} official video`;
    const response = await axios.get("https://www.youtube.com/results", {
      params: { search_query: query },
      timeout: 5000,
      headers: {
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
    });
    const matches = [
      ...String(response.data || "").matchAll(
        /"videoId":"([a-zA-Z0-9_-]{11})"/g,
      ),
    ];
    const videoId = [...new Set(matches.map((match) => match[1]))][0] || null;
    const result = videoId
      ? {
          videoId,
          embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
          query,
        }
      : null;
    youtubeVideoCache.set(cacheKey, result);
    return result;
  } catch (e) {
    youtubeVideoCache.set(cacheKey, null, 300);
    return null;
  }
}

export const clearCrossProviderCache = () => {
  wikiBioCache.flushAll();
  wikidataTitleCache.flushAll();
  youtubeVideoCache.flushAll();
};
export { youtubeVideoCache };
