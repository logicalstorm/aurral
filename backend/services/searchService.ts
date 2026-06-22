import NodeCache from 'node-cache';
import { getDiscoveryCache } from './discoveryService.js';
import { getLastfmApiKey, lastfmRequest } from './apiClients.js';
import { buildImageProxyUrl } from './imageProxyService.js';
import { selectBestArtistImage } from './imageService.js';
import { lidarrClient } from './lidarrClient.js';
import {
  searchAlbums as providerSearchAlbums,
  searchArtists as providerSearchArtists,
} from './providers/brainzmashProvider.js';
import {
  DISCOVERY_PROVIDER_LISTENBRAINZ_FALLBACK,
  searchFallbackGenreArtists,
} from './listenbrainzDiscoveryFallback.js';

const PRIMARY_RELEASE_TYPES = new Set(['Album', 'EP', 'Single']);
const SECONDARY_RELEASE_TYPES = new Set([
  'Live',
  'Remix',
  'Compilation',
  'Demo',
  'Broadcast',
  'Soundtrack',
  'Spokenword',
  'Other',
]);
const ALL_RELEASE_TYPES = new Set([...PRIMARY_RELEASE_TYPES, ...SECONDARY_RELEASE_TYPES]);
const albumLibraryLookupCache = new NodeCache({
  stdTTL: 60,
  checkperiod: 60,
  maxKeys: 10,
});

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeSearchText(value: unknown): string {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePercentOfTracks(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (raw > 1 && raw <= 100) return Math.round(raw);
  if (raw <= 1) return Math.round(raw * 100);
  return Math.min(100, Math.round(raw / 10));
}

async function getAlbumLibraryLookup(albumMbids: string[]): Promise<Map<string, Record<string, unknown>>> {
  const lookup = new Map();
  if (!lidarrClient.isConfigured() || albumMbids.length === 0) {
    return lookup;
  }

  try {
    const lidarrAlbums = albumLibraryLookupCache.get('lidarrAlbums');
    if (!lidarrAlbums) {
      return lookup;
    }
    const wanted = new Set(albumMbids);
    for (const album of Array.isArray(lidarrAlbums) ? lidarrAlbums : []) {
      const foreignAlbumId = album?.foreignAlbumId;
      if (!foreignAlbumId || !wanted.has(foreignAlbumId)) continue;
      const percentOfTracks = normalizePercentOfTracks(album?.statistics?.percentOfTracks);
      const sizeOnDisk = Number(album?.statistics?.sizeOnDisk || 0);
      lookup.set(foreignAlbumId, {
        inLibrary: true,
        libraryAlbumId: album.id !== undefined && album.id !== null ? String(album.id) : null,
        libraryArtistId:
          album.artistId !== undefined && album.artistId !== null ? String(album.artistId) : null,
        status: percentOfTracks >= 100 || sizeOnDisk > 0 ? 'available' : 'inLibrary',
      });
    }
  } catch (error) {
    console.warn('Album search enrichment failed:', (error as Error).message);
  }

  return lookup;
}

export function normalizeAlbumReleaseTypesFilter(releaseTypes: unknown): string[] {
  const values = Array.isArray(releaseTypes)
    ? releaseTypes
    : String(releaseTypes || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
  return [...new Set(values.filter((value) => ALL_RELEASE_TYPES.has(value)))];
}

export function normalizeAlbumSearchSort(value: unknown): string {
  const normalized = String(value || '').trim();
  return ['relevance', 'dateDesc', 'artistAsc', 'titleAsc'].includes(normalized)
    ? normalized
    : 'relevance';
}

function normalizeArtistItem(item: Record<string, unknown>): Record<string, unknown> {
  const image = selectBestArtistImage(item.images as unknown[]) as Record<string, unknown> | null;
  return {
    type: 'artist',
    id: item.id,
    name: item.name,
    sortName: item.sortName || item.name,
    image: (image as Record<string, unknown>)?.url || null,
    imageUrl: (image as Record<string, unknown>)?.url || null,
    artistType: item.type || null,
    country: null,
    area: null,
    begin: null,
    end: null,
    disambiguation: item.disambiguation || null,
    tags: Array.isArray(item.genres) ? item.genres : [],
    genres: Array.isArray(item.genres) ? item.genres : [],
    inLibrary: false,
    score: item.score || 0,
  };
}

export function normalizeArtistSearchItem(item: Record<string, unknown>, imageCache: Record<string, Record<string, unknown>> = {}): Record<string, unknown> {
  const normalized = normalizeArtistItem({
    id: item?.id,
    name: item?.name,
    sortName: item?.sortName || item?.['sort-name'] || item?.name,
    type: item?.type || null,
    disambiguation: item?.disambiguation || null,
    genres: item?.genres || item?.tags || [],
    images: (imageCache as Record<string, Record<string, unknown>>)?.[item?.id as string]?.imageUrl
      ? [{ url: (imageCache as Record<string, Record<string, unknown>>)[item?.id as string].imageUrl }]
      : item?.imageUrl || item?.image
        ? [{ url: item.imageUrl || item.image }]
        : [],
    score: item?.score || 0,
  } as Record<string, unknown>);
  return normalized;
}

function normalizeAlbumItem(item: Record<string, unknown>, lookup: Record<string, unknown> | null = null): Record<string, unknown> {
  return {
    type: 'album',
    id: item.id,
    title: item.title || 'Untitled Release',
    artistName: item.artistName || 'Unknown Artist',
    artistMbid: item.artistId || null,
    releaseDate: item.releaseDate || null,
    primaryType: item.type || null,
    secondaryTypes: Array.isArray(item.secondaryTypes) ? item.secondaryTypes : [],
    coverUrl: item.coverUrl || null,
    inLibrary: !!lookup,
    libraryAlbumId: lookup ? (lookup.libraryAlbumId || null) : null,
    libraryArtistId: lookup ? (lookup.libraryArtistId || null) : null,
    status: lookup ? (lookup.status || 'missing') : 'missing',
    score: item.score || 0,
  };
}

export function normalizeAlbumSearchItem(item: Record<string, unknown>, lookup: Record<string, unknown> = {}): Record<string, unknown> {
  const artistCredit = Array.isArray(item?.['artist-credit']) ? item['artist-credit'] : [];
  const primaryCredit = (artistCredit[0] || {}) as Record<string, unknown>;
  const artist = (primaryCredit.artist || {}) as Record<string, unknown>;
  const normalized = normalizeAlbumItem(
    {
      id: item?.id,
      title: item?.title,
      artistName: primaryCredit.name || artist.name || item?.artistName,
      artistId: artist.id || item?.artistMbid || item?.artistId || null,
      type: item?.type || item?.['primary-type'] || null,
      secondaryTypes: item?.secondaryTypes || item?.['secondary-types'] || [],
      releaseDate: item?.releaseDate || item?.['first-release-date'] || null,
      coverUrl: item?.coverUrl || null,
      score: item?.score || 0,
    } as Record<string, unknown>,
    lookup?.inLibrary || lookup?.libraryAlbumId || lookup?.libraryArtistId ? lookup : null,
  );
  delete (normalized as Record<string, unknown>).score;
  return normalized;
}

export function matchesAlbumReleaseTypeFilter(item: Record<string, unknown>, selectedReleaseTypes: unknown = []): boolean {
  const selected = normalizeAlbumReleaseTypesFilter(selectedReleaseTypes);
  if (selected.length === 0) return true;

  const primaryType = String(item?.primaryType || item?.['primary-type'] || '').trim();
  const secondaryTypesRaw = item?.secondaryTypes || item?.['secondary-types'];
  const secondaryTypes: string[] = Array.isArray(secondaryTypesRaw) ? secondaryTypesRaw as string[] : [];

  const primaryMatches = selected.filter((value) => PRIMARY_RELEASE_TYPES.has(value));
  const secondaryMatches = selected.filter((value) => SECONDARY_RELEASE_TYPES.has(value));

  if (primaryMatches.length > 0 && !primaryMatches.includes(primaryType)) {
    return false;
  }

  if (!secondaryMatches.every((value) => secondaryTypes.includes(value))) {
    return false;
  }

  if (secondaryMatches.length > 0 && secondaryTypes.length !== secondaryMatches.length) {
    return false;
  }

  return true;
}

export async function searchArtists(query: unknown, limit: number = 24, offset: number = 0): Promise<Record<string, unknown>> {
  const limitInt = parsePositiveInt(limit, 24);
  const offsetInt = Math.max(0, Math.floor(Number(offset)) || 0);
  const result = await providerSearchArtists(String(query || '').trim(), {
    limit: limitInt,
    offset: offsetInt,
  });
  return {
    scope: 'artist',
    query,
    count: result.count,
    offset: result.offset,
    items: result.items.map(normalizeArtistItem),
  };
}

export async function searchAlbums(
  query: unknown,
  limit: number = 24,
  offset: number = 0,
  releaseTypes: unknown = [],
  sort: string = 'relevance',
): Promise<Record<string, unknown>> {
  const limitInt = parsePositiveInt(limit, 24);
  const offsetInt = Math.max(0, Math.floor(Number(offset)) || 0);
  const normalizedSort = normalizeAlbumSearchSort(sort);
  const selectedReleaseTypes = normalizeAlbumReleaseTypesFilter(releaseTypes);
  const result = await providerSearchAlbums(String(query || '').trim(), {
    limit: limitInt,
    offset: offsetInt,
    releaseTypes: selectedReleaseTypes,
    sort: normalizedSort,
  });
  const albumLookup = await getAlbumLibraryLookup(result.items.map((item: Record<string, unknown>) => item.id as string));
  return {
    scope: 'album',
    query,
    sort: normalizedSort,
    count: result.count,
    offset: result.offset,
    hasMore: result.offset + result.items.length < result.count,
    items: result.items.map((item: Record<string, unknown>) => normalizeAlbumItem(item as Record<string, unknown>, albumLookup.get(item.id as string) || null)),
  };
}

function normalizeTagArtistItem(artist: Record<string, unknown>, tag: string): Record<string, unknown> {
  return {
    ...artist,
    tags: [tag],
  };
}

function getTagArtistKey(artist: Record<string, unknown>): string | null {
  const artistId = String(artist?.id || artist?.mbid || '')
    .trim()
    .toLowerCase();
  if (artistId) return `id:${artistId}`;
  const artistName = String(artist?.name || '')
    .trim()
    .toLowerCase();
  return artistName ? `name:${artistName}` : null;
}

function matchesTagSearch(artist: Record<string, unknown>, normalizedTag: string): boolean {
  const tags = Array.isArray(artist?.tags) ? artist.tags : [];
  const genres = Array.isArray(artist?.genres) ? artist.genres : [];
  return [...tags, ...genres].some((entry) => normalizeSearchText(entry) === normalizedTag);
}

function dedupeTagArtists(artists: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set();
  const output = [];
  for (const artist of Array.isArray(artists) ? artists : []) {
    const key = getTagArtistKey(artist);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(artist);
  }
  return output;
}

function getTagSourceMap(artists: Record<string, unknown>[]): Map<string, string> {
  const sourceMap = new Map();
  for (const artist of Array.isArray(artists) ? artists : []) {
    const key = getTagArtistKey(artist);
    if (!key || sourceMap.has(key)) continue;
    sourceMap.set(key, artist?.tagResultSource || 'all');
  }
  return sourceMap;
}

function normalizeLastfmTagArtist(artist: Record<string, unknown>, tag: string): Record<string, unknown> {
  let imageUrl: string | null = null;
  if (Array.isArray(artist?.image)) {
    const img =
      (artist.image as Record<string, unknown>[]).find((entry: Record<string, unknown>) => entry.size === 'extralarge') ||
      (artist.image as Record<string, unknown>[]).find((entry: Record<string, unknown>) => entry.size === 'large') ||
      (artist.image as Record<string, unknown>[]).slice(-1)[0];
    if (img?.['#text'] && !String(img['#text']).includes('2a96cbd8b46e442fc41c2b86b821562f')) {
      imageUrl = img['#text'] as string;
    }
  }

  return normalizeTagArtistItem(
    {
      type: 'artist',
      id: artist?.mbid || null,
      name: artist?.name || 'Unknown Artist',
      sortName: artist?.name || 'Unknown Artist',
      image: imageUrl ? buildImageProxyUrl(imageUrl) || imageUrl : null,
      imageUrl: imageUrl ? buildImageProxyUrl(imageUrl) || imageUrl : null,
      artistType: null,
      country: null,
      area: null,
      begin: null,
      end: null,
      disambiguation: null,
      tags: [tag],
      genres: [tag],
      inLibrary: false,
      score: 0,
      tagResultSource: 'all',
    },
    tag,
  );
}

async function fetchMergedLastfmTagArtists(tag: string, limitInt: number, offsetInt: number, recommendedItems: Record<string, unknown>[]): Promise<{ items: Record<string, unknown>[]; exhausted: boolean }> {
  const pageSize = 50;
  const requiredCount = offsetInt + limitInt;
  const supplementalItems: Record<string, unknown>[] = [];
  const seen = new Set(recommendedItems.map((artist: Record<string, unknown>) => getTagArtistKey(artist)).filter(Boolean) as string[]);
  let page = 1;
  let exhausted = false;

  while (!exhausted && recommendedItems.length + supplementalItems.length < requiredCount) {
    const data = await lastfmRequest('tag.getTopArtists', {
      tag,
      limit: pageSize,
      page,
    });
    const artists = Array.isArray(data?.topartists?.artist)
      ? data.topartists.artist
      : data?.topartists?.artist
        ? [data.topartists.artist]
        : [];

    if (artists.length === 0) {
      exhausted = true;
      break;
    }

    for (const artist of artists) {
      const normalized = normalizeLastfmTagArtist(artist, tag);
      const key = getTagArtistKey(normalized);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      supplementalItems.push(normalized);
    }

    const reportedTotal = Number.parseInt(data?.topartists?.['@attr']?.total as string, 10);
    const totalPages: number | null = Number.isFinite(reportedTotal) ? Math.ceil(reportedTotal / pageSize) : null;
    exhausted = artists.length < pageSize || (totalPages !== null && page >= totalPages);
    page += 1;
  }

  return {
    items: [...recommendedItems, ...supplementalItems],
    exhausted,
  };
}

export async function searchTags(query: unknown, limit: number = 24, offset: number = 0): Promise<Record<string, unknown>> {
  const tag = String(query || '')
    .trim()
    .replace(/^#/, '');
  const limitInt = parsePositiveInt(limit, 24);
  const offsetInt = Math.max(0, Math.floor(Number(offset)) || 0);

  if (!tag) {
    return {
      scope: 'tag',
      query: '',
      count: 0,
      offset: offsetInt,
      items: [],
    };
  }

  const discoveryCache = getDiscoveryCache();
  const tagLower = normalizeSearchText(tag);
  const recommendedMatches = dedupeTagArtists(
    (discoveryCache.recommendations || [])
      .filter((artist: Record<string, unknown>) => matchesTagSearch(artist, tagLower))
      .map((artist: Record<string, unknown>) =>
        normalizeTagArtistItem(
          {
            ...artist,
            tagResultSource: 'recommended',
          },
          tag,
        ),
      ),
  );

  if (getLastfmApiKey()) {
    const merged = await fetchMergedLastfmTagArtists(tag, limitInt, offsetInt, recommendedMatches);
    const items = merged.items.slice(offsetInt, offsetInt + limitInt);
    return {
      scope: 'tag',
      query: tag,
      count: merged.exhausted
        ? merged.items.length
        : offsetInt + items.length + (merged.items.length > offsetInt + items.length ? 1 : 0),
      offset: offsetInt,
      hasMore: !merged.exhausted || offsetInt + items.length < merged.items.length,
      items,
    };
  }

  const fallbackResult = await searchFallbackGenreArtists({
    tag,
    limit: offsetInt + limitInt,
    offset: 0,
    precomputedGenrePools:
      (discoveryCache?.fallbackGenrePools &&
      Object.keys(discoveryCache.fallbackGenrePools).length > 0
        ? discoveryCache.fallbackGenrePools as Record<string, Record<string, unknown>[]>
        : null),
  });
  if (fallbackResult) {
    const sourceMap = getTagSourceMap(recommendedMatches);
    const fallbackItems = fallbackResult.artists.map((artist) =>
      normalizeTagArtistItem(
        {
          type: 'artist',
          id: artist.id || artist.mbid || null,
          name: artist.name || 'Unknown Artist',
          sortName: artist.sortName || artist.name || 'Unknown Artist',
          image: artist.image || artist.imageUrl || null,
          imageUrl: artist.image || artist.imageUrl || null,
          artistType: null,
          country: null,
          area: null,
          begin: null,
          end: null,
          disambiguation: null,
          tags: artist.tags || [tag],
          genres: artist.genres || [tag],
          inLibrary: false,
          score: 0,
          tagResultSource: sourceMap.get(getTagArtistKey(artist) as string) || 'all',
        },
        tag,
      ),
    );
    const mergedItems = dedupeTagArtists([...recommendedMatches, ...fallbackItems]);
    const items = mergedItems.slice(offsetInt, offsetInt + limitInt);
    return {
      scope: 'tag',
      query: tag,
      count: Math.max(mergedItems.length, fallbackResult.total),
      offset: offsetInt,
      provider: DISCOVERY_PROVIDER_LISTENBRAINZ_FALLBACK,
      fallbackLimited: true,
      hasMore:
        offsetInt + items.length < mergedItems.length ||
        offsetInt + limitInt < fallbackResult.total,
      items,
    };
  }

  const mergedItems = dedupeTagArtists([
    ...recommendedMatches,
    ...(Array.isArray(discoveryCache.globalTop) ? discoveryCache.globalTop : []),
    ...(Array.isArray(discoveryCache.basedOn) ? discoveryCache.basedOn : []),
  ])
    .filter((artist) => matchesTagSearch(artist, tagLower))
    .map((artist) =>
      normalizeTagArtistItem(
        {
          ...artist,
          tagResultSource: artist.tagResultSource === 'recommended' ? 'recommended' : 'all',
        },
        tag,
      ),
    );

  return {
    scope: 'tag',
    query: tag,
    count: mergedItems.length,
    offset: offsetInt,
    hasMore: offsetInt + limitInt < mergedItems.length,
    items: mergedItems.slice(offsetInt, offsetInt + limitInt),
  };
}
