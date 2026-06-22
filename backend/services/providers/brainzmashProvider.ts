import axios from 'axios';
import NodeCache from 'node-cache';
import { dbOps } from '../../config/db-helpers.js';
import {
  APP_NAME,
  APP_VERSION,
  DEFAULT_METADATA_BASE_URL,
  LEGACY_METADATA_BASE_URL,
  MUSICBRAINZ_API,
} from '../../config/constants.js';
import { rankAlbumCandidates, rankArtistCandidates } from './brainzmashRanking.js';
import {
  matchesGenreQuery,
  toLegacyArtist,
  toLegacyRelease,
  toLegacyReleaseGroupSummary,
  toLegacySearchAlbumResult,
  toLegacySearchArtistResult,
  toNormalizedAlbum,
  toNormalizedArtist,
  toNormalizedArtistAlbum,
} from './brainzmashMappers.js';
import { selectBestAlbumImage } from '../imageService.js';

const providerCache = new NodeCache({
  stdTTL: 300,
  checkperiod: 60,
  maxKeys: 2000,
});
const releaseCache = new NodeCache({
  stdTTL: 300,
  checkperiod: 60,
  maxKeys: 5000,
});

const healthState: {
  configuredProvider: string;
  activeBaseUrl: string | null;
  failoverActive: boolean;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string;
} = {
  configuredProvider: 'brainzmash',
  activeBaseUrl: null,
  failoverActive: false,
  lastCheckedAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastFailureReason: '',
};

function nowIso() {
  return new Date().toISOString();
}

function getSettingsMetadata(): Record<string, unknown> {
  const settings = dbOps.getSettings() as Record<string, unknown>;
  return ((settings.integrations as Record<string, unknown>)?.metadata as Record<string, unknown>) || {};
}

function isNarrowFallbacksEnabled() {
  const metadata = getSettingsMetadata();
  return metadata.enableNarrowFallbacks !== false;
}

export function getMetadataBaseUrl() {
  const metadata = getSettingsMetadata();
  const raw = String(
    metadata.baseUrl || process.env.BRAINZMASH_BASE_URL || DEFAULT_METADATA_BASE_URL,
  ).trim();
  try {
    const parsed = new URL(raw);
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    parsed.search = '';
    parsed.hash = '';
    const normalized = parsed.toString().replace(/\/+$/, '');
    if (normalized === LEGACY_METADATA_BASE_URL) {
      return DEFAULT_METADATA_BASE_URL;
    }
    return normalized;
  } catch {
    return DEFAULT_METADATA_BASE_URL;
  }
}

export function getMetadataProvider() {
  return 'brainzmash';
}

function getUserAgent() {
  return `${APP_NAME}/${APP_VERSION}`;
}

async function request(path: string, params: Record<string, unknown> = {}) {
  const baseUrl = getMetadataBaseUrl();
  const cacheKey = `${path}:${JSON.stringify(params)}`;
  const cached = providerCache.get(cacheKey);
  if (cached) return cached;

  healthState.activeBaseUrl = baseUrl;
  healthState.lastCheckedAt = nowIso();

  try {
    const response = await axios.get(`${baseUrl}${path}`, {
      params,
      timeout: 8000,
      headers: {
        'User-Agent': getUserAgent(),
      },
    });
    providerCache.set(cacheKey, response.data);
    healthState.lastSuccessAt = healthState.lastCheckedAt;
    healthState.lastFailureReason = '';
    return response.data;
  } catch (error) {
    const err = error as Record<string, unknown>;
    healthState.lastFailureAt = healthState.lastCheckedAt;
    healthState.lastFailureReason =
      (err.response as Record<string, unknown>)?.status != null
        ? `HTTP ${(err.response as Record<string, unknown>).status}`
        : (err.code as string) || (err.message as string) || 'Unknown error';
    throw error;
  }
}

function applyReleaseTypeFilter(albums: Record<string, unknown>[], releaseTypes: unknown[] = []) {
  const normalizedSet = new Set(
    (Array.isArray(releaseTypes)
      ? releaseTypes
      : String(releaseTypes || '')
          .split(',')
          .map((value: string) => value.trim())
          .filter(Boolean)
    ).map((value: unknown) => String(value)),
  );
  if (normalizedSet.size === 0) return albums;
  return albums.filter((album: Record<string, unknown>) => {
    if (normalizedSet.has(album.type as string)) return true;
    return ((album.secondaryTypes as unknown[]) || []).some((entry: unknown) => normalizedSet.has(entry as string));
  });
}

function selectedReleaseForAlbum(album: Record<string, unknown>) {
  const releases = Array.isArray(album?.releases) ? album.releases : [];
  return (
    releases.find(
      (release: Record<string, unknown>) =>
        String(release?.status || '').toLowerCase() === 'official' &&
        Array.isArray(release?.tracks) &&
        (release.tracks as unknown[]).length > 0,
    ) ||
    releases.find((release: Record<string, unknown>) => Array.isArray(release?.tracks) && (release.tracks as unknown[]).length > 0) ||
    releases[0] ||
    null
  );
}

function storeAlbumReleaseMappings(album: Record<string, unknown>) {
  for (const release of (album?.releases as unknown[]) || []) {
    releaseCache.set((release as Record<string, unknown>).id as string, JSON.parse(JSON.stringify({ albumId: album.id, release })));
  }
}

export async function getArtistByMbid(mbid: string) {
  const data = await request(`/artist/${mbid}`);
  return toNormalizedArtist(data);
}

export async function getAlbumByMbid(albumMbid: string) {
  const data = await request(`/album/${albumMbid}`);
  const normalized = toNormalizedAlbum(data);
  storeAlbumReleaseMappings(normalized);
  return normalized;
}

export async function getAlbumTracksByAlbumMbid(albumMbid: string) {
  const album = await getAlbumByMbid(albumMbid);
  const release = selectedReleaseForAlbum(album);
  return Array.isArray(release?.tracks) ? release.tracks : [];
}

export async function searchArtists(query: string, { limit = 24, offset = 0 }: { limit?: number; offset?: number } = {}) {
  const data = await request('/search/artist', {
    query,
    limit,
  });
  const source = Array.isArray(data) ? data : [];
  const items = source.map((entry: Record<string, unknown>, index: number) => ({
    ...toNormalizedArtist(entry),
    score: Math.max(0, 100 - index),
  }));
  return {
    query,
    count: items.length,
    offset,
    items: items.slice(offset, offset + limit),
  };
}

export async function searchAlbums(
  query: string,
  { artistName = '', limit = 24, offset = 0, releaseTypes = [] as string[], sort = 'relevance' }: {
    artistName?: string;
    limit?: number;
    offset?: number;
    releaseTypes?: string[];
    sort?: string;
  } = {},
) {
  const requestedLimit = Math.max(limit + offset, limit);
  let items: Record<string, unknown>[] = [];

  try {
    const data = await request('/search/album', {
      query,
      limit: requestedLimit,
      ...(artistName ? { artist: artistName } : {}),
    });
    const source = Array.isArray(data) ? data : [];
    items = source.map((entry: Record<string, unknown>, index: number) => {
      const artists = Array.isArray(entry?.artists) ? entry.artists : [];
      const primaryArtist = artists[0] ? toNormalizedArtist(artists[0]) : null;
      const coverImage = selectBestAlbumImage(entry?.images as unknown[]) as { Url?: string } | null;
      return {
        id: entry?.id,
        title: entry?.title || 'Untitled Release',
        artistName: primaryArtist?.name || artistName || 'Unknown Artist',
        artistId: entry?.artistid || primaryArtist?.id || null,
        type: entry?.type || 'Album',
        secondaryTypes: Array.isArray(entry?.secondarytypes) ? entry.secondarytypes : [],
        releaseDate: entry?.releasedate || null,
        coverUrl: coverImage?.Url ? String(coverImage.Url).trim() : null,
        images: Array.isArray(entry?.images) ? entry.images : [],
        inLibrary: false,
        score: Math.max(0, 100 - index),
        releaseStatuses: [],
      };
    });
  } catch {}

  if (items.length === 0 && isNarrowFallbacksEnabled()) {
    const mbQuery = artistName
      ? `artist:"${artistName.replace(/"/g, '\\"')}" AND releasegroup:"${String(query || '').replace(/"/g, '\\"')}"`
      : String(query || '').trim();
    const response = await axios.get(`${MUSICBRAINZ_API}/release-group`, {
      params: {
        fmt: 'json',
        query: mbQuery,
        limit: requestedLimit,
        offset: 0,
      },
      timeout: 8000,
      headers: {
        'User-Agent': `${APP_NAME}/${APP_VERSION} (metadata album fallback)`,
      },
    });
    const source = Array.isArray(response?.data?.['release-groups'])
      ? response.data['release-groups']
      : [];
    items = source.map((entry: Record<string, unknown>, index: number) => {
      const artistCredit = Array.isArray(entry?.['artist-credit']) ? entry['artist-credit'] : [];
      const primaryArtist = artistCredit[0]?.artist || {};
      return {
        id: entry?.id,
        title: entry?.title || 'Untitled Release',
        artistName: artistCredit[0]?.name || primaryArtist?.name || artistName || 'Unknown Artist',
        artistId: primaryArtist?.id || null,
        type: entry?.['primary-type'] || 'Album',
        secondaryTypes: Array.isArray(entry?.['secondary-types']) ? entry['secondary-types'] : [],
        releaseDate: entry?.['first-release-date'] || null,
        coverUrl: null,
        images: [],
        inLibrary: false,
        score: Number(entry?.score || entry?.['ext:score'] || Math.max(0, 100 - index)) || 0,
        releaseStatuses: [],
      };
    });
  }

  items = applyReleaseTypeFilter(items, releaseTypes);

  if (sort === 'relevance') {
    items = rankAlbumCandidates(query, items as any, { artistName }) as Record<string, unknown>[];
  } else if (sort === 'artistAsc') {
    items.sort(
      (left: Record<string, unknown>, right: Record<string, unknown>) =>
        String(left.artistName || '').localeCompare(String(right.artistName || '')) ||
        String(left.title || '').localeCompare(String(right.title || '')),
    );
  } else if (sort === 'titleAsc') {
    items.sort(
      (left: Record<string, unknown>, right: Record<string, unknown>) =>
        String(left.title || '').localeCompare(String(right.title || '')) ||
        String(left.artistName || '').localeCompare(String(right.artistName || '')),
    );
  } else if (sort === 'dateDesc') {
    items.sort(
      (left: Record<string, unknown>, right: Record<string, unknown>) =>
        String(right.releaseDate || '').localeCompare(String(left.releaseDate || '')) ||
        String(left.title || '').localeCompare(String(right.title || '')),
    );
  }

  return {
    query,
    count: items.length,
    offset,
    items: items.slice(offset, offset + limit),
  };
}

export async function resolveArtistByName(name: string) {
  const result = await searchArtists(name, { limit: 10, offset: 0 });
  const ranked = rankArtistCandidates(name, result.items as any) as Record<string, unknown>[];
  return (ranked[0] as Record<string, unknown>)?.id || null;
}

export async function resolveAlbumByArtistAndTitle({
  artistName = '',
  albumTitle = '',
  releaseYear = null,
}: {
  artistName?: string;
  albumTitle?: string;
  releaseYear?: string | null;
}) {
  const firstPass = await searchAlbums(albumTitle, {
    artistName,
    limit: 10,
    offset: 0,
  });
  let ranked = rankAlbumCandidates(albumTitle, firstPass.items as any, {
    artistName,
    releaseYear: releaseYear as any,
  }) as Record<string, unknown>[];
  if ((ranked[0] as Record<string, unknown>)?.id) return (ranked[0] as Record<string, unknown>).id;

  const secondPass = await searchAlbums(albumTitle, {
    artistName: '',
    limit: 10,
    offset: 0,
  });
  ranked = rankAlbumCandidates(albumTitle, secondPass.items as any, {
    artistName,
    releaseYear: releaseYear as any,
  }) as Record<string, unknown>[];
  return (ranked[0] as Record<string, unknown>)?.id || null;
}

export async function listArtistAlbums(
  artistMbid: string,
  { releaseTypes = [] as string[], includeTrackCounts = false, hydrateLimit = 30 } = {},
) {
  const rawArtist = await request(`/artist/${artistMbid}`);
  const artist = toNormalizedArtist(rawArtist);
  let albums = (Array.isArray(rawArtist?.Albums) ? rawArtist.Albums : []).map((entry: Record<string, unknown>) =>
    toNormalizedArtistAlbum(entry),
  );
  albums = applyReleaseTypeFilter(albums as Record<string, unknown>[], releaseTypes as unknown[]) as typeof albums;
  albums.sort((left: Record<string, unknown>, right: Record<string, unknown>) => {
    const leftBootleg = ((left.releaseStatuses as unknown[]) || []).includes('Bootleg') ? 1 : 0;
    const rightBootleg = ((right.releaseStatuses as unknown[]) || []).includes('Bootleg') ? 1 : 0;
    if (leftBootleg !== rightBootleg) return leftBootleg - rightBootleg;
    const typeOrder: Record<string, number> = { Album: 0, EP: 1, Single: 2 };
    const leftType = typeOrder[left.type as string] ?? 9;
    const rightType = typeOrder[right.type as string] ?? 9;
    if (leftType !== rightType) return leftType - rightType;
    return String(left.title || '').localeCompare(String(right.title || ''));
  });

  const safeHydrateLimit =
    Number.isFinite(Number(hydrateLimit)) && Number(hydrateLimit) > 0
      ? Math.min(100, Math.floor(Number(hydrateLimit)))
      : 30;
  await Promise.all(
    albums.slice(0, safeHydrateLimit).map(async (album: Record<string, unknown>) => {
      try {
        const needsDate = !album.firstReleaseDate;
        const needsRating = includeTrackCounts;
        if (!needsDate && !needsRating) return;

        const hydrated = await getAlbumByMbid(album.id as string);
        if (needsDate) {
          album.firstReleaseDate = hydrated.releaseDate || album.firstReleaseDate;
        }
        if (needsRating) {
          album.rating = hydrated.rating || null;
        }
      } catch {}
    }),
  );

  return albums.map((album: Record<string, unknown>) => ({
    ...album,
    artistName: artist.name,
    artistId: artist.id,
  }));
}

export async function getArtistGenres(artistMbid: string) {
  const artist = await getArtistByMbid(artistMbid);
  return artist.genres || [];
}

export async function getArtistNameByMbid(artistMbid: string) {
  const artist = await getArtistByMbid(artistMbid);
  return artist.name || null;
}

export function getMetadataProviderHealthSnapshot() {
  return {
    brainzmash: {
      configuredProvider: healthState.configuredProvider,
      activeBaseUrl: getMetadataBaseUrl(),
      failoverActive: healthState.failoverActive,
      lastCheckedAt: healthState.lastCheckedAt,
      lastSuccessAt: healthState.lastSuccessAt,
      lastFailureAt: healthState.lastFailureAt,
      lastFailureReason: healthState.lastFailureReason,
    },
  };
}

export async function legacyMusicbrainzRequest(endpoint: string, params: Record<string, unknown> = {}) {
  const normalizedEndpoint = String(endpoint || '').trim();
  if (normalizedEndpoint.startsWith('/artist/')) {
    const mbid = normalizedEndpoint.replace(/^\/artist\//, '').trim();
    const artist = await getArtistByMbid(mbid);
    return toLegacyArtist(artist);
  }

  if (normalizedEndpoint === '/artist') {
    const result = await searchArtists(String(params.query || '').trim(), {
      limit: (params.limit as number) || 24,
      offset: (params.offset as number) || 0,
    });
    return {
      count: result.count,
      offset: result.offset,
      artists: result.items.map((item: Record<string, unknown>) => toLegacySearchArtistResult(item, (item as Record<string, unknown>).score as number)),
    };
  }

  if (normalizedEndpoint.startsWith('/release-group/')) {
    const mbid = normalizedEndpoint.replace(/^\/release-group\//, '').trim();
    const album = await getAlbumByMbid(mbid);
    return toLegacyReleaseGroupSummary(album, album.artists[0] as any, { score: 100 });
  }

  if (normalizedEndpoint === '/release-group') {
    if (params.artist) {
      const items = await listArtistAlbums(String(params.artist).trim(), {
        releaseTypes: [],
      });
      const offset = Number.parseInt(params.offset as string, 10) || 0;
      const limit = Number.parseInt(params.limit as string, 10) || items.length;
      const paged = items.slice(offset, offset + limit);
      return {
        'release-group-count': items.length,
        'release-groups': paged.map((item: Record<string, unknown>) =>
          toLegacyReleaseGroupSummary(item as any, {
            id: item.artistId as string,
            name: item.artistName as string,
          } as any),
        ),
      };
    }
    const result = await searchAlbums(String(params.query || '').trim(), {
      artistName: '',
      limit: (params.limit as number) || 24,
      offset: (params.offset as number) || 0,
      releaseTypes: [],
    });
    return {
      count: result.count,
      'release-group-count': result.count,
      'release-groups': result.items.map((item: Record<string, unknown>) => toLegacySearchAlbumResult(item)),
    };
  }

  if (normalizedEndpoint.startsWith('/release/')) {
    const releaseId = normalizedEndpoint.replace(/^\/release\//, '').trim();
    const cached = releaseCache.get(releaseId) as { albumId?: string; release?: unknown } | undefined;
    if (!cached?.release) {
      throw new Error(`Release ${releaseId} not found in BrainzMash cache`);
    }
    return toLegacyRelease(cached.release);
  }

  throw new Error(`Unsupported legacy metadata endpoint: ${normalizedEndpoint}`);
}

export async function findArtistsByGenre(query: string, { limit = 24, offset = 0 }: { limit?: number; offset?: number } = {}) {
  const result = await searchArtists(query, { limit: Math.max(limit * 3, 60), offset: 0 });
  const filtered = result.items.filter((artist: Record<string, unknown>) => matchesGenreQuery(artist, query));
  return {
    query,
    count: filtered.length,
    offset,
    items: filtered.slice(offset, offset + limit),
  };
}
