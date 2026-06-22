import { lastfmRequest, musicbrainzResolveArtistMbidByName } from './apiClients.js';
import { isRemoteSearchConfigured, searchRemoteCatalog } from './aurralSearchClient.js';
import {
  getArtistByMbid,
  getAlbumByMbid,
  listArtistAlbums,
  resolveAlbumByArtistAndTitle,
} from './providers/brainzmashProvider.js';

const CATALOG_RESOLVE_LIMIT = 8;
const CATALOG_MIN_SCORE = 65;

const artistAliasCache = new Map();
const releaseGroupSearchCache = new Map();
const releaseContextCache = new Map();

function normalizeText(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(
      /\b(deluxe|expanded|anniversary|remaster(?:ed)?|bonus|edition|live|mono|stereo|single|ep)\b/g,
      ' ',
    )
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getYear(value: unknown) {
  const match = String(value || '').match(/\b(19\d{2}|20\d{2})\b/);
  return match ? match[1] : null;
}

function splitWords(value: unknown) {
  return normalizeText(value)
    .split(' ')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function scoreTextMatch(left: unknown, right: unknown) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 92;
  const leftWords = new Set(splitWords(a));
  const rightWords = new Set(splitWords(b));
  if (leftWords.size === 0 || rightWords.size === 0) return 0;
  let overlap = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) overlap += 1;
  }
  const ratio = (2 * overlap) / Math.max(1, leftWords.size + rightWords.size);
  return Math.round(ratio * 100);
}

function pickBestCatalogArtist(artists: Record<string, unknown>[], artistName: string) {
  const list = Array.isArray(artists) ? artists : [];
  if (!list.length || !artistName) return null;
  return (
    [...list]
      .map((artist) => ({
        artist,
        score: scoreTextMatch(artist.name, artistName) + Number(artist.score || 0) * 0.1,
      }))
      .filter((entry) => entry.score >= CATALOG_MIN_SCORE)
      .sort((left, right) => right.score - left.score)[0]?.artist || null
  );
}

function pickBestCatalogAlbum(albums: Record<string, unknown>[], albumName: string, artistName: string, artistMbid: string) {
  const list = Array.isArray(albums) ? albums : [];
  if (!list.length || !albumName) return null;
  return (
    [...list]
      .map((album) => {
        let score = scoreTextMatch(album.title, albumName);
        if (artistName) {
          score = Math.round(score * 0.65 + scoreTextMatch(album.artistName, artistName) * 0.35);
        }
        if (artistMbid && album.artistMbid === artistMbid) {
          score += 12;
        } else if (artistMbid && album.artistMbid && album.artistMbid !== artistMbid) {
          score -= 25;
        }
        return { album, score: score + Number(album.score || 0) * 0.1 };
      })
      .filter((entry) => entry.score >= CATALOG_MIN_SCORE)
      .sort((left, right) => right.score - left.score)[0]?.album || null
  );
}

function pickBestCatalogTrack(tracks: Record<string, unknown>[], { trackName, artistName, albumName, artistMbid, albumMbid }: { trackName: string; artistName?: string; albumName?: string; artistMbid?: string; albumMbid?: string }) {
  const list = Array.isArray(tracks) ? tracks : [];
  if (!list.length || !trackName) return null;
  return (
    [...list]
      .map((track) => {
        let score = scoreTextMatch(track.title, trackName);
        if (artistName) {
          score = Math.round(score * 0.7 + scoreTextMatch(track.artistName, artistName) * 0.3);
        }
        if (albumName && track.albumTitle) {
          score = Math.round(score * 0.8 + scoreTextMatch(track.albumTitle, albumName) * 0.2);
        }
        if (artistMbid && track.artistMbid === artistMbid) {
          score += 12;
        } else if (artistMbid && track.artistMbid && track.artistMbid !== artistMbid) {
          score -= 25;
        }
        if (albumMbid && track.albumMbid === albumMbid) {
          score += 12;
        }
        return { track, score: score + Number(track.score || 0) * 0.1 };
      })
      .filter((entry) => entry.score >= CATALOG_MIN_SCORE)
      .sort((left, right) => right.score - left.score)[0]?.track || null
  );
}

async function resolveArtistMbidFromCatalog(artistName: string) {
  const safeArtist = String(artistName || '').trim();
  if (!safeArtist || !isRemoteSearchConfigured()) return null;
  try {
    const catalog = await searchRemoteCatalog(safeArtist, {
      mode: 'suggest',
      limit: CATALOG_RESOLVE_LIMIT,
    });
    const match = pickBestCatalogArtist((catalog as Record<string, unknown>)?.artists as Record<string, unknown>[], safeArtist);
    return match?.id ? String(match.id) : null;
  } catch {
    return null;
  }
}

async function resolveReleaseGroupFromCatalog(artistName: string, artistMbid: string, albumName: string) {
  const safeAlbum = String(albumName || '').trim();
  const safeArtist = String(artistName || '').trim();
  const safeMbid = String(artistMbid || '').trim();
  if (!safeAlbum || !isRemoteSearchConfigured()) return null;
  try {
    const catalog = await searchRemoteCatalog([safeArtist, safeAlbum].filter(Boolean).join(' '), {
      mode: 'suggest',
      limit: CATALOG_RESOLVE_LIMIT,
    });
    const match = pickBestCatalogAlbum((catalog as Record<string, unknown>)?.albums as Record<string, unknown>[], safeAlbum, safeArtist, safeMbid);
    if (!match?.id) return null;
    return {
      id: String(match.id),
      title: String(match.title || safeAlbum).trim() || safeAlbum,
      releaseYear: null,
      artistMbid: match.artistMbid ? String(match.artistMbid) : safeMbid || null,
    };
  } catch {
    return null;
  }
}

async function resolveTrackMbidFromCatalog({ artistName, trackName, albumName, artistMbid, albumMbid }: { artistName?: string; trackName: string; albumName?: string; artistMbid?: string; albumMbid?: string }) {
  const safeTrack = String(trackName || '').trim();
  if (!safeTrack || !isRemoteSearchConfigured()) return null;
  try {
    const catalog = await searchRemoteCatalog(
      [artistName, safeTrack, albumName].filter(Boolean).join(' '),
      { mode: 'suggest', limit: CATALOG_RESOLVE_LIMIT },
    );
    return pickBestCatalogTrack((catalog as Record<string, unknown>)?.tracks as Record<string, unknown>[], {
      trackName: safeTrack,
      artistName,
      albumName,
      artistMbid,
      albumMbid,
    });
  } catch {
    return null;
  }
}

function pickBestCandidate(candidates: Record<string, unknown>[], expectedTitle: string, expectedYear: string | null = null) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) return null;
  const targetYear = getYear(expectedYear);
  return [...list]
    .map((candidate) => {
      const c = candidate as Record<string, unknown>;
      const rg = c['release-group'] as Record<string, unknown> | undefined;
      const title =
        c?.title || c?.['title'] || rg?.title || '';
      const year =
        c?.['first-release-date'] ||
        c?.date ||
        rg?.['first-release-date'] ||
        null;
      const titleScore = scoreTextMatch(title, expectedTitle);
      const yearScore =
        targetYear && getYear(year) === targetYear ? 10 : targetYear && getYear(year) ? -5 : 0;
      return {
        candidate,
        score: titleScore + yearScore,
      };
    })
    .sort((left, right) => right.score - left.score)[0]?.candidate;
}

async function fetchArtistAliases(artistMbid: string) {
  const key = String(artistMbid || '').trim();
  if (!key) return [];
  if (artistAliasCache.has(key)) {
    return artistAliasCache.get(key);
  }
  const promise = (async () => {
    try {
      const artist = await getArtistByMbid(key);
      const aliases = Array.isArray(artist?.aliases)
        ? artist.aliases.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [];
      return [...new Set(aliases)].slice(0, 8);
    } catch {
      return [];
    }
  })();
  artistAliasCache.set(key, promise);
  const aliases = await promise;
  artistAliasCache.set(key, aliases);
  return aliases;
}

async function resolveReleaseGroup(artistName: string, artistMbid: string, albumName: string, releaseYear: string | null) {
  const safeAlbum = String(albumName || '').trim();
  if (!safeAlbum) return null;
  const safeArtist = String(artistName || '').trim();
  const safeMbid = String(artistMbid || '').trim();
  const cacheKey = JSON.stringify([safeArtist, safeMbid, safeAlbum]);
  if (releaseGroupSearchCache.has(cacheKey)) {
    return releaseGroupSearchCache.get(cacheKey);
  }
  const promise = (async () => {
    const catalogMatch = await resolveReleaseGroupFromCatalog(safeArtist, safeMbid, safeAlbum);
    if (catalogMatch?.id) {
      const album = await getAlbumByMbid(catalogMatch.id).catch(() => null);
      return {
        id: catalogMatch.id,
        title: String(album?.title || catalogMatch.title || safeAlbum).trim() || safeAlbum,
        releaseYear: getYear(album?.releaseDate),
        artistMbid: catalogMatch.artistMbid || safeMbid || null,
      };
    }
    try {
      const resolvedId = await (
        resolveAlbumByArtistAndTitle as (
          params: { artistName?: string; albumTitle?: string; releaseYear?: string | null },
        ) => Promise<string | null>
      )({
        artistName: safeArtist,
        albumTitle: safeAlbum,
        releaseYear,
      });
      if (!resolvedId) return null;
      const album = await getAlbumByMbid(resolvedId).catch(() => null);
      return {
        id: String(resolvedId),
        title: String(album?.title || safeAlbum).trim() || safeAlbum,
        releaseYear: getYear(album?.releaseDate),
      };
    } catch {}
    try {
      const candidates = safeMbid ? await listArtistAlbums(safeMbid) : [];
      const best = pickBestCandidate(candidates, safeAlbum, releaseYear);
      if (best?.Id || best?.id) {
        return {
          id: String(best?.Id || best?.id),
          title: String(best?.Title || best?.title || safeAlbum).trim() || safeAlbum,
          releaseYear: getYear(best?.FirstReleaseDate || best?.firstReleaseDate),
        };
      }
    } catch {}
    return null;
  })();
  releaseGroupSearchCache.set(cacheKey, promise);
  const resolved = await promise;
  releaseGroupSearchCache.set(cacheKey, resolved);
  return resolved;
}

function matchTrackByTitle<T extends Record<string, unknown>>(tracks: T[], trackName: string): (T & { _score: number }) | null {
  const safeTrackName = String(trackName || '').trim();
  if (!safeTrackName) return null;
  return (
    [...(Array.isArray(tracks) ? tracks : [])]
      .map((track) => ({
        ...track,
        _score: scoreTextMatch(track?.title, safeTrackName),
      }))
      .sort((left, right) => right._score - left._score)[0] || null
  );
}

async function fetchReleaseContext(albumMbid: string) {
  const key = String(albumMbid || '').trim();
  if (!key) return null;
  if (releaseContextCache.has(key)) {
    return releaseContextCache.get(key);
  }
  const promise = (async () => {
    try {
      const album = await getAlbumByMbid(key);
      const releases = Array.isArray(album?.releases) ? album.releases : [];
      const pickedRelease =
        releases.find((release) => String(release?.status || '').toLowerCase() === 'official') ||
        releases.find((release) => Array.isArray(release?.tracks) && release.tracks.length > 0) ||
        releases[0] ||
        null;
      if (!pickedRelease) {
        return {
          releaseYear: getYear(album?.releaseDate),
          albumTrackCount: null,
          albumTrackTitles: [],
          tracks: [],
        };
      }
      const tracks = Array.isArray(pickedRelease?.tracks)
        ? pickedRelease.tracks.map((track) => ({
            title: track.title,
            trackNumber: track.trackPosition || track.trackNumber || null,
            durationMs: track.durationMs || null,
            recordingId: track.recordingId || null,
          }))
        : [];
      return {
        releaseYear: getYear(pickedRelease?.releaseDate) || getYear(album?.releaseDate),
        albumTrackCount: tracks.length > 0 ? tracks.length : null,
        albumTrackTitles: tracks.map((track) => track.title),
        tracks,
      };
    } catch {
      return null;
    }
  })();
  releaseContextCache.set(key, promise);
  const resolved = await promise;
  releaseContextCache.set(key, resolved);
  return resolved;
}

async function fetchLastfmTrackInfo(track: Record<string, unknown>) {
  const artistName = String(track?.artistName || '').trim();
  const trackName = String(track?.trackName || '').trim();
  if (!artistName || !trackName) return null;
  try {
    return await (lastfmRequest as (method: string, params: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>)('track.getInfo', {
      artist: artistName,
      track: trackName,
      autocorrect: 1,
    });
  } catch {
    return null;
  }
}

export { pickBestCatalogAlbum, pickBestCatalogArtist, pickBestCatalogTrack };

export async function resolveWeeklyFlowTrackContext(track: Record<string, unknown>) {
  const base: Record<string, unknown> = {
    ...track,
    artistName: String(track?.artistName || '').trim(),
    trackName: String(track?.trackName || '').trim(),
    albumName: String(track?.albumName || '').trim() || null,
    artistMbid: String(track?.artistMbid || '').trim() || null,
    albumMbid: String(track?.albumMbid || '').trim() || null,
    trackMbid: String(track?.trackMbid || '').trim() || null,
    releaseYear: getYear(track?.releaseYear) || null,
    durationMs:
      track?.durationMs != null && Number.isFinite(Number(track.durationMs))
        ? Math.max(0, Math.round(Number(track.durationMs)))
        : null,
    artistAliases: Array.isArray(track?.artistAliases)
      ? (track.artistAliases as unknown[]).map((entry: unknown) => String(entry || '').trim()).filter(Boolean)
      : [],
  };
  if (!base.artistName || !base.trackName) {
    return base;
  }

  const lastfmInfo =
    !base.albumName || !base.trackMbid || !base.durationMs
      ? await fetchLastfmTrackInfo(base)
      : null;
  const lastfmTrack = ((lastfmInfo as Record<string, unknown> | null)?.track ?? null) as Record<string, unknown> | null;
  const lastfmAlbum = (lastfmTrack?.album ?? null) as Record<string, unknown> | null;
  const lastfmAlbumName = String(
    lastfmAlbum?.title || lastfmAlbum?.['#text'] || '',
  ).trim();
  const lastfmTrackMbid = String(lastfmTrack?.mbid || '').trim();
  const lastfmDuration =
    lastfmTrack?.duration != null && Number.isFinite(Number(lastfmTrack.duration))
      ? Math.max(0, Math.round(Number(lastfmTrack.duration)))
      : null;

  if (!base.albumName && lastfmAlbumName) {
    base.albumName = lastfmAlbumName;
  }
  if (!base.trackMbid && lastfmTrackMbid) {
    base.trackMbid = lastfmTrackMbid;
  }
  if (!base.durationMs && lastfmDuration) {
    base.durationMs = lastfmDuration;
  }

  if (!base.artistMbid) {
    base.artistMbid = await resolveArtistMbidFromCatalog(base.artistName as string);
  }
  if (!base.artistMbid) {
    base.artistMbid = await musicbrainzResolveArtistMbidByName(base.artistName as string);
  }

  if (((base.artistAliases as unknown[] | undefined)?.length || 0) === 0 && base.artistMbid) {
    base.artistAliases = await fetchArtistAliases(base.artistMbid as string);
  }

  let releaseContext = null;
  if (!base.albumMbid && base.albumName) {
    const releaseGroup = await resolveReleaseGroup(
      base.artistName as string,
      base.artistMbid as string,
      base.albumName as string,
      base.releaseYear as string | null,
    );
    if (releaseGroup?.id) {
      base.albumMbid = releaseGroup.id;
      if (!base.artistMbid && releaseGroup.artistMbid) {
        base.artistMbid = releaseGroup.artistMbid;
      }
      if (!base.releaseYear && releaseGroup.releaseYear) {
        base.releaseYear = releaseGroup.releaseYear;
      }
      if (!base.albumName && releaseGroup.title) {
        base.albumName = releaseGroup.title;
      }
    }
  }

  if (base.albumMbid) {
    releaseContext = await fetchReleaseContext(base.albumMbid as string);
    if (releaseContext?.releaseYear && !base.releaseYear) {
      base.releaseYear = releaseContext.releaseYear;
    }
    const matchedTrack = matchTrackByTitle(releaseContext?.tracks, base.trackName as string);
    if (matchedTrack) {
      if (!base.trackMbid && matchedTrack.recordingId) {
        base.trackMbid = matchedTrack.recordingId;
      }
      if (!base.durationMs && matchedTrack.durationMs) {
        base.durationMs = matchedTrack.durationMs;
      }
      base.trackNumber =
        matchedTrack.trackNumber != null && Number.isFinite(Number(matchedTrack.trackNumber))
          ? Number(matchedTrack.trackNumber)
          : null;
    }
    base.albumTrackCount = releaseContext?.albumTrackCount ?? null;
    base.albumTrackTitles = Array.isArray(releaseContext?.albumTrackTitles)
      ? releaseContext.albumTrackTitles
      : [];
  } else {
    base.albumTrackCount = null;
    base.albumTrackTitles = [];
    base.trackNumber = null;
  }

  if (!base.trackMbid) {
    const catalogTrack = await resolveTrackMbidFromCatalog({
      artistName: base.artistName as string,
      trackName: base.trackName as string,
      albumName: base.albumName as string | undefined,
      artistMbid: base.artistMbid as string | undefined,
      albumMbid: base.albumMbid as string | undefined,
    });
    if (catalogTrack?.id) {
      base.trackMbid = String(catalogTrack.id);
    }
    if (!base.albumMbid && catalogTrack?.albumMbid) {
      base.albumMbid = String(catalogTrack.albumMbid);
    }
    if (!base.albumName && catalogTrack?.albumTitle) {
      base.albumName = String(catalogTrack.albumTitle).trim();
    }
    if (!base.artistMbid && catalogTrack?.artistMbid) {
      base.artistMbid = String(catalogTrack.artistMbid);
    }
  }

  return base;
}
