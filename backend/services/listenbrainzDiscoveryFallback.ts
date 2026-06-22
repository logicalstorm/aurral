import NodeCache from 'node-cache';
import { UUID_REGEX } from '../config/constants.js';
import {
  getLastfmApiKey,
  listenbrainzRequest,
  musicbrainzGetCachedArtistMbidByName,
  musicbrainzResolveArtistMbidByName,
} from './apiClients.js';
import { hydrateArtistImages } from './artistImageHydration.js';
import { getArtistGenres } from './providers/brainzmashProvider.js';

export const DISCOVERY_PROVIDER_LASTFM = 'lastfm';
export const DISCOVERY_PROVIDER_LISTENBRAINZ_FALLBACK = 'listenbrainz-fallback';

const LISTENBRAINZ_SITEWIDE_POOL_CACHE = new NodeCache({
  stdTTL: 6 * 60 * 60,
  checkperiod: 15 * 60,
  maxKeys: 8,
});
const LISTENBRAINZ_ENRICHED_POOL_CACHE = new NodeCache({
  stdTTL: 6 * 60 * 60,
  checkperiod: 15 * 60,
  maxKeys: 8,
});
const LISTENBRAINZ_SITEWIDE_POOL_LIMIT = 1000;
const LISTENBRAINZ_SITEWIDE_PAGE_SIZE = 100;
const LISTENBRAINZ_GENRE_ENRICH_CONCURRENCY = 8;

export const DEFAULT_DISCOVERY_GENRE_SECTIONS = [
  {
    name: 'Rock',
    tags: [
      'rock',
      'classic rock',
      'alternative rock',
      'indie rock',
      'punk',
      'punk rock',
      'post-punk',
      'metal',
      'heavy metal',
      'hard rock',
      'grunge',
    ],
    artists: [
      'Radiohead',
      'The Beatles',
      'David Bowie',
      'Nirvana',
      'Queen',
      'Pink Floyd',
      'Led Zeppelin',
      'The Rolling Stones',
      'Foo Fighters',
      'Coldplay',
      'Arctic Monkeys',
      'The Strokes',
      'Metallica',
      'Black Sabbath',
      'The Clash',
      'Pixies',
    ],
  },
  {
    name: 'Pop',
    tags: ['pop', 'dance pop', 'synthpop', 'indie pop', 'r&b', 'rnb', 'soul'],
    artists: [
      'Taylor Swift',
      'Michael Jackson',
      'Madonna',
      'Beyonce',
      'Lady Gaga',
      'The Weeknd',
      'Ariana Grande',
      'Billie Eilish',
      'Dua Lipa',
      'Prince',
      'Kylie Minogue',
      'ABBA',
      'Frank Ocean',
      'SZA',
      'Stevie Wonder',
      'The Weeknd',
    ],
  },
  {
    name: 'Hip-Hop',
    tags: ['hip-hop', 'hip hop', 'rap'],
    artists: [
      'Kendrick Lamar',
      'Nas',
      'A Tribe Called Quest',
      'OutKast',
      'JAY-Z',
      'Missy Elliott',
      'Wu-Tang Clan',
      'The Roots',
      'MF DOOM',
      'Lauryn Hill',
      'Run-D.M.C.',
      'Public Enemy',
    ],
  },
  {
    name: 'Electronic',
    tags: ['electronic', 'electronica', 'edm', 'house', 'techno', 'ambient', 'downtempo', 'idm'],
    artists: [
      'Daft Punk',
      'The Chemical Brothers',
      'Aphex Twin',
      'Massive Attack',
      'Justice',
      'Disclosure',
      'Deadmau5',
      'Skrillex',
      'Fatboy Slim',
      'Underworld',
      'Four Tet',
      'Boards of Canada',
    ],
  },
  {
    name: 'Indie & Alternative',
    tags: ['indie', 'alternative', 'alternative pop', 'shoegaze', 'dream pop'],
    artists: [
      'The Smiths',
      'Pixies',
      'The National',
      'Vampire Weekend',
      'Arcade Fire',
      'Sufjan Stevens',
      'Phoebe Bridgers',
      'Mitski',
      'Bon Iver',
      'Tame Impala',
      'Modest Mouse',
      'Belle and Sebastian',
    ],
  },
  {
    name: 'Jazz',
    tags: ['jazz', 'bebop', 'swing'],
    artists: [
      'Miles Davis',
      'John Coltrane',
      'Herbie Hancock',
      'Thelonious Monk',
      'Nina Simone',
      'Ella Fitzgerald',
      'Duke Ellington',
      'Bill Evans',
      'Charles Mingus',
      'Chet Baker',
      'Kamasi Washington',
      'Sonny Rollins',
    ],
  },
  {
    name: 'Folk & Country',
    tags: [
      'folk',
      'singer-songwriter',
      'folk rock',
      'country',
      'alt-country',
      'country rock',
      'americana',
    ],
    artists: [
      'Bob Dylan',
      'Joni Mitchell',
      'Nick Drake',
      'Joan Baez',
      'Simon & Garfunkel',
      'Leonard Cohen',
      'Cat Stevens',
      'Fleet Foxes',
      'Iron & Wine',
      'First Aid Kit',
      'Gillian Welch',
      'Townes Van Zandt',
      'Johnny Cash',
      'Dolly Parton',
      'Willie Nelson',
      'Emmylou Harris',
      'Patsy Cline',
      'Hank Williams',
      'Loretta Lynn',
      'Sturgill Simpson',
      'Kacey Musgraves',
      'Jason Isbell',
      'Chris Stapleton',
      'The Chicks',
    ],
  },
  {
    name: 'Classical',
    tags: ['classical', 'orchestral', 'composer'],
    artists: [
      'Ludwig van Beethoven',
      'Wolfgang Amadeus Mozart',
      'Johann Sebastian Bach',
      'Franz Schubert',
      'Pyotr Ilyich Tchaikovsky',
      'Claude Debussy',
      'Frederic Chopin',
      'Antonio Vivaldi',
      'Johannes Brahms',
      'Igor Stravinsky',
      'Philip Glass',
      'Max Richter',
    ],
  },
];

const normalizeKey = (value: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase();

const normalizeGenreText = (value: unknown) =>
  String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeMbid = (value: unknown) => {
  const mbid = String(value || '').trim();
  return UUID_REGEX.test(mbid) ? mbid : null;
};

const getListenbrainzArtistMbid = (artist: Record<string, unknown>) => {
  const direct = normalizeMbid(artist?.artist_mbid);
  if (direct) return direct;
  const fromArray = Array.isArray(artist?.artist_mbids)
    ? (artist.artist_mbids as unknown[]).find((value: unknown) => normalizeMbid(value))
    : null;
  return normalizeMbid(fromArray);
};

const artistKeys = (artist: Record<string, unknown>) =>
  [
    normalizeKey(artist?.id),
    normalizeKey(artist?.mbid),
    normalizeKey(artist?.foreignArtistId),
    normalizeKey(artist?.name),
    normalizeKey(artist?.artistName),
  ].filter(Boolean) as string[];

const isExistingArtist = (artist: Record<string, unknown>, existingArtistKeys: Set<string>) =>
  artistKeys(artist).some((key: string) => existingArtistKeys?.has(key));

const normalizeCuratedArtist = async (entry: string | Record<string, unknown>, genre: Record<string, unknown>) => {
  const name = String(
    typeof entry === 'string' ? entry : (entry as Record<string, unknown>)?.name || (entry as Record<string, unknown>)?.artistName || '',
  ).trim();
  if (!name) return null;
  const explicitMbid = normalizeMbid(typeof entry === 'object' ? (entry as Record<string, unknown>).mbid || (entry as Record<string, unknown>).id : null);
  const mbid =
    explicitMbid ||
    musicbrainzGetCachedArtistMbidByName(name) ||
    (await musicbrainzResolveArtistMbidByName(name).catch(() => null));
  if (!mbid) return null;
  return {
    id: mbid,
    mbid,
    navigateTo: mbid,
    name,
    sortName: name,
    type: 'Artist',
    tags: [genre.name, ...(genre.tags as string[] || [])],
    genres: [genre.name],
    source: 'listenbrainz-fallback',
    metaText: genre.name,
  };
};

export const getFallbackGenreNames = () =>
  DEFAULT_DISCOVERY_GENRE_SECTIONS.map((section) => section.name);

export const getFallbackTagNames = () => [...new Set(getFallbackGenreNames().filter(Boolean))];

export const findFallbackGenreSection = (tag: string) => {
  const wanted = normalizeKey(String(tag || '').replace(/^#/, ''));
  if (!wanted) return null;
  return (
    DEFAULT_DISCOVERY_GENRE_SECTIONS.find((section) =>
      [section.name, ...(section.tags || [])].map(normalizeKey).includes(wanted),
    ) || null
  );
};

const getFallbackGenreAliases = (tag: string) => {
  const section = findFallbackGenreSection(tag);
  if (section) {
    return [section.name, ...(Array.isArray(section.tags) ? section.tags : [])].filter(Boolean);
  }
  const trimmed = String(tag || '')
    .replace(/^#/, '')
    .trim();
  return trimmed ? [trimmed] : [];
};

const getNormalizedArtistGenreTerms = (artist: Record<string, unknown>) =>
  [
    ...(Array.isArray(artist?.genres) ? artist.genres as string[] : []),
    ...(Array.isArray(artist?.tags) ? artist.tags as string[] : []),
  ]
    .map(normalizeGenreText)
    .filter(Boolean);

const getNormalizedSectionAliases = (section: Record<string, unknown>) =>
  [
    ...new Set(
      [section.name, ...(Array.isArray(section.tags) ? section.tags as string[] : [])]
        .map(normalizeGenreText)
        .filter(Boolean),
    ),
  ].sort((left: string, right: string) => right.length - left.length);

const scoreGenreAliasMatch = (genreTerm: string, alias: string) => {
  if (!genreTerm || !alias) return 0;
  if (genreTerm === alias) return 100;
  if (genreTerm.startsWith(`${alias} `) || genreTerm.endsWith(` ${alias}`)) {
    return 60;
  }
  if (genreTerm.includes(` ${alias} `)) return 45;
  if (alias.length >= 5 && genreTerm.includes(alias)) return 25;
  return 0;
};

const classifyArtistToFallbackGenre = (artist: Record<string, unknown>) => {
  const genreTerms = getNormalizedArtistGenreTerms(artist);
  if (genreTerms.length === 0) return null;

  let bestSection: Record<string, unknown> | null = null;
  let bestScore = 0;

  for (const section of DEFAULT_DISCOVERY_GENRE_SECTIONS) {
    const aliases = getNormalizedSectionAliases(section);
    let sectionScore = 0;
    for (const genreTerm of genreTerms) {
      for (const alias of aliases) {
        sectionScore += scoreGenreAliasMatch(genreTerm as string, alias as string);
      }
    }
    if (sectionScore > bestScore) {
      bestScore = sectionScore;
      bestSection = section;
    }
  }

  return bestScore > 0 ? bestSection : null;
};

export const fetchListenbrainzGlobalTopArtists = async ({
  count = 64,
  offset = 0,
  range = 'week',
}: {
  count?: number;
  offset?: number;
  range?: string;
} = {}) => {
  const data = await listenbrainzRequest('/1/stats/sitewide/artists', {
    count,
    offset,
    range,
  }).catch(() => null);
  const payload = data ? (data as Record<string, unknown>).payload as Record<string, unknown> | undefined : undefined;
  const artists = Array.isArray(payload?.artists) ? payload.artists as Record<string, unknown>[] : [];
  return artists
    .map((artist: Record<string, unknown>, index: number) => {
      const name = String(artist?.artist_name || '').trim();
      if (!name) return null;
      const mbid = getListenbrainzArtistMbid(artist);
      return {
        id: mbid,
        mbid,
        navigateTo: mbid,
        name,
        sortName: name,
        type: 'Artist',
        source: 'listenbrainz',
        popularityLabel: 'Trending on ListenBrainz',
        listenCount: Number.parseInt(artist?.listen_count as string || '0', 10) || 0,
        popularityRank: index + 1,
        metaText: 'Trending on ListenBrainz',
      };
    })
    .filter(Boolean);
};

const fetchListenbrainzSitewideArtistPool = async ({
  limit = LISTENBRAINZ_SITEWIDE_POOL_LIMIT,
  range = 'all_time',
}: {
  limit?: number;
  range?: string;
} = {}) => {
  const boundedLimit = Math.max(
    LISTENBRAINZ_SITEWIDE_PAGE_SIZE,
    Math.min(LISTENBRAINZ_SITEWIDE_POOL_LIMIT, Number(limit) || LISTENBRAINZ_SITEWIDE_POOL_LIMIT),
  );
  const cacheKey = `${range}:${boundedLimit}`;
  const cached = LISTENBRAINZ_SITEWIDE_POOL_CACHE.get(cacheKey);
  if (Array.isArray(cached)) return cached as Record<string, unknown>[];

  const artists: Record<string, unknown>[] = [];
  for (let offset = 0; offset < boundedLimit; offset += LISTENBRAINZ_SITEWIDE_PAGE_SIZE) {
    const page = await fetchListenbrainzGlobalTopArtists({
      count: Math.min(LISTENBRAINZ_SITEWIDE_PAGE_SIZE, boundedLimit - offset),
      offset,
      range,
    }).catch(() => []) as Record<string, unknown>[];
    const slice = Array.isArray(page) ? page : [];
    if (slice.length === 0) break;
    const ranked = slice.map((artist: Record<string, unknown>, index: number) => ({
      ...artist,
      popularityRank: offset + index + 1,
    }));
    artists.push(...ranked);
    if (slice.length < LISTENBRAINZ_SITEWIDE_PAGE_SIZE) break;
  }

  const deduped: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const artist of artists) {
    const key = normalizeKey(artist?.mbid || artist?.id || artist?.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(artist);
  }
  LISTENBRAINZ_SITEWIDE_POOL_CACHE.set(cacheKey, deduped);
  return deduped;
};

const enrichListenbrainzArtistPoolWithGenres = async (artists: Record<string, unknown>[] = []) => {
  const enriched: Record<string, unknown>[] = [];
  for (let index = 0; index < artists.length; index += LISTENBRAINZ_GENRE_ENRICH_CONCURRENCY) {
    const batch = artists.slice(index, index + LISTENBRAINZ_GENRE_ENRICH_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (artist: Record<string, unknown>) => {
        if (!artist?.name) return null;
        let mbid = normalizeMbid(artist?.mbid || artist?.id);
        if (!mbid) {
          mbid = (musicbrainzGetCachedArtistMbidByName(artist.name as string) ||
            (await musicbrainzResolveArtistMbidByName(artist.name as string).catch(() => null))) as string | null;
        }
        if (!mbid) return null;
        const genres = await getArtistGenres(mbid).catch(() => []) as string[];
        return {
          ...artist,
          id: mbid,
          mbid,
          navigateTo: mbid,
          genres: Array.isArray(genres) ? genres.filter(Boolean) : [],
          tags: Array.isArray(genres) ? genres.filter(Boolean) : [],
        };
      }),
    );
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        enriched.push(result.value);
      }
    }
  }
  return enriched;
};

const getListenbrainzEnrichedGenrePool = async ({
  limit = LISTENBRAINZ_SITEWIDE_POOL_LIMIT,
  range = 'all_time',
}: {
  limit?: number;
  range?: string;
} = {}) => {
  const boundedLimit = Math.max(
    LISTENBRAINZ_SITEWIDE_PAGE_SIZE,
    Math.min(LISTENBRAINZ_SITEWIDE_POOL_LIMIT, Number(limit) || LISTENBRAINZ_SITEWIDE_POOL_LIMIT),
  );
  const cacheKey = `${range}:${boundedLimit}`;
  const cached = LISTENBRAINZ_ENRICHED_POOL_CACHE.get(cacheKey);
  if (Array.isArray(cached)) return cached as Record<string, unknown>[];
  const rawPool = await fetchListenbrainzSitewideArtistPool({
    limit: boundedLimit,
    range,
  });
  const enriched = await enrichListenbrainzArtistPoolWithGenres(rawPool);
  LISTENBRAINZ_ENRICHED_POOL_CACHE.set(cacheKey, enriched);
  return enriched;
};

const buildFallbackGenrePoolsFromArtists = ({
  artists = [],
  existingArtistKeys = new Set<string>(),
}: {
  artists?: Record<string, unknown>[];
  existingArtistKeys?: Set<string>;
} = {}) => {
  const buckets: Record<string, Record<string, unknown>[]> = Object.fromEntries(
    DEFAULT_DISCOVERY_GENRE_SECTIONS.map((section) => [section.name, []]),
  ) as Record<string, Record<string, unknown>[]>;
  for (const artist of artists) {
    const section = classifyArtistToFallbackGenre(artist);
    if (!section?.name) continue;
    if (isExistingArtist(artist, existingArtistKeys)) continue;
    buckets[section.name as string].push({
      ...artist,
      source: artist.source || 'listenbrainz',
      metaText: section.name,
      tags:
        Array.isArray(artist.tags) && artist.tags.length > 0
          ? artist.tags
          : [section.name, ...(section.tags as string[] || [])],
      genres:
        Array.isArray(artist.genres) && artist.genres.length > 0 ? artist.genres : [section.name],
    });
  }
  return buckets;
};

export const buildListenbrainzFallbackGenrePools = async ({
  existingArtistKeys = new Set<string>(),
  limit = LISTENBRAINZ_SITEWIDE_POOL_LIMIT,
  range = 'all_time',
}: {
  existingArtistKeys?: Set<string>;
  limit?: number;
  range?: string;
} = {}) => {
  const enrichedPool = await getListenbrainzEnrichedGenrePool({
    limit,
    range,
  });
  return buildFallbackGenrePoolsFromArtists({
    artists: enrichedPool,
    existingArtistKeys,
  });
};

const buildFallbackGenreSectionsFromPools = async (
  fallbackGenrePools: Record<string, Record<string, unknown>[]>,
  { hydrate = true, sectionSize = 12 }: { hydrate?: boolean; sectionSize?: number } = {},
) => {
  const sections: Record<string, unknown>[] = [];
  for (const section of DEFAULT_DISCOVERY_GENRE_SECTIONS) {
    const artists = Array.isArray(fallbackGenrePools?.[section.name])
      ? fallbackGenrePools[section.name].slice(0, sectionSize)
      : [];
    if (artists.length === 0) continue;
    if (hydrate) {
       
      await hydrateArtistImages(artists as any, {
        limit: artists.length,
        batchSize: 6,
        delayMs: 25,
      });
    }
    sections.push({
      name: section.name,
      tags: [section.name],
      artists,
    });
  }
  return sections;
};

const buildGenreSection = async (
  genre: Record<string, unknown>,
  { existingArtistKeys = new Set<string>(), hydrate = true }: { existingArtistKeys?: Set<string>; hydrate?: boolean } = {},
) => {
  const artists = (
    await Promise.all((genre.artists as string[]).map((artist: string) => normalizeCuratedArtist(artist, genre)))
  )
    .filter(Boolean)
    .filter((artist: Record<string, unknown> | null) => artist != null && !isExistingArtist(artist, existingArtistKeys)) as Record<string, unknown>[];
  if (hydrate && artists.length > 0) {
     
    await hydrateArtistImages(artists as any, {
      limit: artists.length,
      batchSize: 6,
      delayMs: 25,
    });
  }
  if (artists.length === 0) return null;
  return {
    name: genre.name,
    tags: genre.tags,
    artists,
  };
};

export const buildDefaultGenreSections = async ({
  existingArtistKeys = new Set<string>(),
  hydrate = true,
}: {
  existingArtistKeys?: Set<string>;
  hydrate?: boolean;
} = {}) => {
  const sections: Record<string, unknown>[] = [];
  for (const genre of DEFAULT_DISCOVERY_GENRE_SECTIONS) {
    const section = await buildGenreSection(genre, {
      existingArtistKeys,
      hydrate,
    });
    if (section) sections.push(section);
  }
  return sections;
};

export const searchFallbackGenreArtists = async ({
  tag,
  limit = 24,
  offset = 0,
  existingArtistKeys = new Set<string>(),
  precomputedGenrePools = null,
}: {
  tag: string;
  limit?: number;
  offset?: number;
  existingArtistKeys?: Set<string>;
  precomputedGenrePools?: Record<string, Record<string, unknown>[]> | null;
}) => {
  const aliases = getFallbackGenreAliases(tag);
  if (aliases.length === 0) return null;
  const targetSection = findFallbackGenreSection(tag);
  const targetSectionName = targetSection?.name || aliases[0];
  const fallbackGenrePools =
    precomputedGenrePools ||
    (await buildListenbrainzFallbackGenrePools({
      existingArtistKeys,
      limit: LISTENBRAINZ_SITEWIDE_POOL_LIMIT,
      range: 'all_time',
    }));
  const matchingArtists = Array.isArray(fallbackGenrePools?.[targetSectionName])
    ? fallbackGenrePools[targetSectionName]
    : [];
  const pagedArtists = matchingArtists.slice(offset, offset + limit);
  if (pagedArtists.length > 0) {
     
    await hydrateArtistImages(pagedArtists as any, {
      limit: pagedArtists.length,
      batchSize: 8,
      delayMs: 25,
    });
  }
  if (matchingArtists.length > 0) {
    return {
      artists: pagedArtists,
      total: matchingArtists.length,
      section: {
        name:
          targetSectionName ||
          String(tag || '')
            .replace(/^#/, '')
            .trim(),
        tags: aliases,
        artists: pagedArtists,
      },
    };
  }

  const section = findFallbackGenreSection(tag);
  if (!section) return null;
  const resolved = await buildGenreSection(section, {
    existingArtistKeys,
    hydrate: true,
  });
  const artists = Array.isArray(resolved?.artists) ? resolved.artists as Record<string, unknown>[] : [];
  return {
    artists: artists.slice(offset, offset + limit),
    total: artists.length,
    section: resolved || { name: section.name, tags: section.tags, artists: [] },
  };
};

export const getDiscoveryCapabilities = (hasLastfmKey: boolean = !!getLastfmApiKey()) => {
  const full = !!hasLastfmKey;
  return {
    personalizedRecommendations: full,
    globalTrending: true,
    genreSections: true,
    arbitraryTagSearch: full,
    relatedArtists: full,
    flows: {
      discover: full,
      trending: full,
      mix: full,
      focus: full,
    },
  };
};

export const getFlowCapabilities = (hasLastfmKey: boolean = !!getLastfmApiKey()) => {
  if (hasLastfmKey) {
    return {
      lastfmRequired: false,
      availableSources: ['discover', 'mix', 'trending', 'focus'],
      unavailableSources: {},
    };
  }
  return {
    lastfmRequired: true,
    availableSources: [],
    unavailableSources: {
      discover: 'Last.fm API key required',
      mix: 'Last.fm API key required',
      trending: 'Last.fm API key required',
      focus: 'Last.fm API key required',
    },
  };
};

export const buildListenbrainzFallbackDiscovery = async ({
  existingArtistKeys = new Set<string>(),
  onProgress = null as ((progress: Record<string, unknown>) => void) | null,
  blockSets = { tags: new Set<string>() },
}: {
  existingArtistKeys?: Set<string>;
  onProgress?: ((progress: Record<string, unknown>) => void) | null;
  blockSets?: { tags: Set<string> };
} = {}) => {
  onProgress?.({
    phase: 'warming_genre_pool',
    progress: 28,
    progressMessage: 'Building ListenBrainz genre pool',
  });
  const fallbackGenrePools = await buildListenbrainzFallbackGenrePools({
    existingArtistKeys,
    limit: LISTENBRAINZ_SITEWIDE_POOL_LIMIT,
    range: 'all_time',
  });
  const rawGlobalTop = await fetchListenbrainzGlobalTopArtists({
    count: 80,
    range: 'week',
  }) as Record<string, unknown>[];
  const globalTop: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const artist of rawGlobalTop) {
    if (!artist?.name) continue;
    let mbid = normalizeMbid(artist.id);
    if (!mbid) {
      mbid = (musicbrainzGetCachedArtistMbidByName(artist.name as string) ||
        (await musicbrainzResolveArtistMbidByName(artist.name as string).catch(() => null))) as string | null;
    }
    if (!mbid) continue;
    const entry = {
      ...artist,
      id: mbid,
      mbid,
      navigateTo: mbid,
    };
    const key = normalizeKey(mbid);
    if (seen.has(key)) continue;
    if (isExistingArtist(entry, existingArtistKeys)) continue;
    seen.add(key);
    globalTop.push(entry);
    if (globalTop.length >= 32) break;
  }

   
  await hydrateArtistImages(globalTop as any, {
    limit: globalTop.length,
    batchSize: 8,
    delayMs: 25,
  });

  onProgress?.({
    phase: 'building_genres',
    progress: 55,
    progressMessage: 'Preparing fallback genre sections',
  });
  let fallbackGenres = await buildFallbackGenreSectionsFromPools(fallbackGenrePools, {
    hydrate: true,
  });
  if (fallbackGenres.length === 0) {
    fallbackGenres = await buildDefaultGenreSections({
      existingArtistKeys,
      hydrate: true,
    });
  }
  const topGenres = fallbackGenres.map((section: Record<string, unknown>) => section.name);

  return {
    provider: DISCOVERY_PROVIDER_LISTENBRAINZ_FALLBACK,
    capabilities: getDiscoveryCapabilities(false),
    recommendations: [],
    globalTop,
    basedOn: [],
    topTags: getFallbackTagNames().filter((tag: string) => !blockSets.tags.has(normalizeKey(tag))),
    topGenres,
    fallbackGenres,
    fallbackGenrePools,
    lastUpdated: new Date().toISOString(),
  };
};
