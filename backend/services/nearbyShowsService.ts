import axios from 'axios';
import NodeCache from 'node-cache';
import { getTicketmasterApiKey } from './apiClients.js';

interface LocationData {
  source: string;
  postalCode: string;
  city: string | null;
  region: string | null;
  regionCode: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  label?: string;
}

const ticketmasterEventCache = new NodeCache({
  stdTTL: 15 * 60,
  checkperiod: 60,
  maxKeys: 200,
});

const ipLocationCache = new NodeCache({
  stdTTL: 30 * 60,
  checkperiod: 120,
  maxKeys: 500,
});

const zipLocationCache = new NodeCache({
  stdTTL: 24 * 60 * 60,
  checkperiod: 10 * 60,
  maxKeys: 1000,
});

const DEFAULT_RADIUS_MILES = 250;
const MAX_EVENT_RESULTS = 200;
const DEFAULT_SHOW_LIMIT = 18;
const MAX_SHOW_LIMIT = 60;
const TICKETMASTER_BASE_URL = 'https://app.ticketmaster.com/discovery/v2';

const normalizeArtistKey = (value: unknown) =>
  String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const artistKeysForName = (value: unknown) => {
  const normalized = normalizeArtistKey(value);
  if (!normalized) return [];
  const parts = normalized.split(' ').filter(Boolean);
  const keys = new Set([normalized]);
  if (parts.length > 1) {
    keys.add(parts.join(' '));
  }
  return [...keys];
};

interface ArtistEntry {
  name: string;
  sourceType: string;
}

const findBestArtistMatch = (artistKey: string, artistMap: Map<string, ArtistEntry>) => {
  if (!artistKey || !artistMap || artistMap.size === 0) return null;
  if (artistMap.has(artistKey)) return artistMap.get(artistKey);
  const compactArtistKey = artistKey.replace(/\s+/g, '');
  for (const [candidateKey, candidate] of artistMap.entries()) {
    if (candidateKey === artistKey) return candidate;
    const compactCandidateKey = candidateKey.replace(/\s+/g, '');
    if (
      compactArtistKey.length >= 7 &&
      compactCandidateKey.length >= 7 &&
      (compactArtistKey.includes(compactCandidateKey) ||
        compactCandidateKey.includes(compactArtistKey))
    ) {
      return candidate;
    }
  }
  return null;
};

const sanitizeZipCode = (value: unknown) =>
  String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9 -]/g, '')
    .slice(0, 12);

const isLikelyUsZip = (value: unknown) => /^\d{5}(-\d{4})?$/.test(String(value || '').trim());

const normalizeUsZip = (value: unknown) =>
  String(value || '')
    .trim()
    .split('-')[0];

const sanitizeIpAddress = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw === '::1') return '127.0.0.1';
  if (raw.startsWith('::ffff:')) return raw.slice(7);
  return raw;
};

const isPrivateIpAddress = (value: unknown) => {
  const ip = sanitizeIpAddress(value);
  if (!ip) return true;
  if (ip.includes(':')) {
    return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd');
  }
  if (
    ip === '127.0.0.1' ||
    ip === '0.0.0.0' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  ) {
    return true;
  }
  return false;
};

const getForwardedIp = (req: Record<string, unknown>) => {
  const forwarded = req.headers as Record<string, unknown>;
  const xForwardedFor = forwarded?.['x-forwarded-for'];
  if (typeof xForwardedFor === 'string' && xForwardedFor.trim()) {
    return xForwardedFor.split(',')[0].trim();
  }
  if (Array.isArray(xForwardedFor) && xForwardedFor.length > 0) {
    return String(xForwardedFor[0] || '').trim();
  }
  return sanitizeIpAddress(req.ip);
};

const buildLocationLabel = (location: LocationData) =>
  [location.city, location.regionCode || location.region, location.countryCode]
    .filter(Boolean)
    .join(', ') ||
  location.postalCode ||
  'Your area';

interface ImageEntry {
  ratio?: string;
  url?: string;
  width?: number;
}

const selectImage = (images: ImageEntry[] = []) => {
  if (!Array.isArray(images) || images.length === 0) return null;
  const preferredRatios = ['16_9', '3_2', '4_3'];
  for (const ratio of preferredRatios) {
    const match = images
      .filter((image: ImageEntry) => image?.ratio === ratio && image?.url)
      .sort((a: ImageEntry, b: ImageEntry) => (b.width || 0) - (a.width || 0))[0];
    if (match?.url) return match.url;
  }
  return images.find((image: ImageEntry) => image?.url)?.url || null;
};

const parseVenueLocation = (event: Record<string, unknown>) => {
  const embedded = event?._embedded as Record<string, unknown> | undefined;
  const venues = embedded?.venues as Record<string, unknown>[] | undefined;
  const venue = venues?.[0] || {} as Record<string, unknown>;
  const city = (venue.city as Record<string, unknown>)?.name || venue.city || null;
  const region = (venue.state as Record<string, unknown>)?.stateCode || (venue.state as Record<string, unknown>)?.name || (venue.country as Record<string, unknown>)?.countryCode || null;
  return {
    venueName: venue.name || null,
    city,
    region,
    countryCode: (venue.country as Record<string, unknown>)?.countryCode || null,
    postalCode: venue.postalCode || null,
    latitude:
      (venue.location as Record<string, unknown>)?.latitude != null
        ? Number((venue.location as Record<string, unknown>).latitude)
        : venue.latitude != null
          ? Number(venue.latitude)
          : null,
    longitude:
      (venue.location as Record<string, unknown>)?.longitude != null
        ? Number((venue.location as Record<string, unknown>).longitude)
        : venue.longitude != null
          ? Number(venue.longitude)
          : null,
  };
};

interface ExtractedArtist {
  name: string;
  key: string;
  ticketmasterAttractionId: string | null;
  image: string | null;
  url: string | null;
}

const extractEventArtists = (event: Record<string, unknown>) => {
  const embedded = event?._embedded as Record<string, unknown> | undefined;
  const attractions = Array.isArray(embedded?.attractions)
    ? embedded.attractions as Record<string, unknown>[]
    : [];
  const unique = new Map<string, ExtractedArtist>();
  for (const attraction of attractions) {
    const name = String(attraction?.name || '').trim();
    if (!name) continue;
    const key = normalizeArtistKey(name);
    if (!key || unique.has(key)) continue;
    unique.set(key, {
      name,
      key,
      ticketmasterAttractionId: attraction.id as string || null,
      image: selectImage(attraction.images as ImageEntry[]),
      url: attraction.url as string || null,
    });
  }
  return [...unique.values()];
};

const buildDateRange = () => {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + 90);
  return {
    startDateTime: start.toISOString().split('.')[0] + 'Z',
    endDateTime: end.toISOString().split('.')[0] + 'Z',
  };
};

const getTicketmasterLocationParams = (location: Record<string, unknown>, radiusMiles: number) => {
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return {
      latlong: `${latitude},${longitude}`,
      radius: radiusMiles,
      unit: 'miles',
      sort: 'distance,asc',
    };
  }
  if (location.postalCode) {
    const postalCode =
      location.countryCode === 'US' ? normalizeUsZip(location.postalCode) : location.postalCode;
    return {
      postalCode,
      countryCode: location.countryCode || undefined,
      radius: radiusMiles,
      unit: 'miles',
      sort: 'distance,asc',
    };
  }
  throw new Error('Unable to determine a search location');
};

const resolveZipLocation = async (zipCode: string) => {
  const zip = sanitizeZipCode(zipCode);
  if (!zip) return null;
  const normalizedZip = isLikelyUsZip(zip) ? normalizeUsZip(zip) : zip;
  const cached = zipLocationCache.get(normalizedZip);
  if (cached) return cached as LocationData;
  try {
    if (isLikelyUsZip(normalizedZip)) {
      const response = await axios.get(
        `https://api.zippopotam.us/us/${encodeURIComponent(normalizedZip)}`,
        {
          timeout: 5000,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Aurral/1.0 (+https://github.com/leekelly/aurral)',
          },
        },
      );
      const data = response.data as Record<string, unknown>;
      const places = data?.places as Record<string, unknown>[] | undefined;
      const place = places?.[0];
      if (place) {
        const location: LocationData = {
          source: 'zip',
          postalCode: normalizedZip,
          city: (place['place name'] as string) || null,
          region: (place.state as string) || null,
          regionCode: (place['state abbreviation'] as string) || null,
          countryCode: 'US',
          latitude: place.latitude != null ? Number(place.latitude) : null,
          longitude: place.longitude != null ? Number(place.longitude) : null,
        };
        location.label = buildLocationLabel(location);
        zipLocationCache.set(normalizedZip, location);
        return location;
      }
    }
  } catch {}
  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        postalcode: normalizedZip,
        countrycodes: isLikelyUsZip(normalizedZip) ? 'us' : undefined,
        format: 'jsonv2',
        addressdetails: 1,
        limit: 1,
      },
      timeout: 6000,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Aurral/1.0 (+https://github.com/leekelly/aurral)',
      },
    });
    const data = response.data as Record<string, unknown>[];
    const result = Array.isArray(data) ? data[0] : null;
    if (!result) return null;
    const address = (result.address as Record<string, unknown>) || {};
    const location: LocationData = {
      source: 'zip',
      postalCode: normalizedZip,
      city: (address.city || address.town || address.village || null) as string | null,
      region: (address.state as string) || null,
      regionCode: null,
      countryCode: address.country_code ? String(address.country_code).toUpperCase() : null,
      latitude: result.lat != null ? Number(result.lat) : null,
      longitude: result.lon != null ? Number(result.lon) : null,
    };
    location.label = buildLocationLabel(location);
    zipLocationCache.set(normalizedZip, location);
    return location;
  } catch {
    return null;
  }
};

const resolveIpLocation = async (ipAddress: string) => {
  const ip = sanitizeIpAddress(ipAddress);
  const cacheKey = ip || 'caller';
  const cached = ipLocationCache.get(cacheKey);
  if (cached) return cached as LocationData;
  const endpoint = ip && !isPrivateIpAddress(ip) ? `/${ip}/json/` : '/json/';
  const response = await axios.get(`https://ipapi.co${endpoint}`, {
    timeout: 5000,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Aurral/1.0 (+https://github.com/leekelly/aurral)',
    },
  });
  const data = response.data as Record<string, unknown>;
  if (data?.error) {
    throw new Error((data.reason as string) || 'IP lookup failed');
  }
  const location: LocationData = {
    source: 'ip',
    postalCode: sanitizeZipCode(data?.postal),
    city: (data?.city as string) || null,
    region: (data?.region as string) || null,
    regionCode: (data?.region_code as string) || null,
    countryCode: (data?.country_code as string) || null,
    latitude: data?.latitude != null ? Number(data.latitude) : null,
    longitude: data?.longitude != null ? Number(data.longitude) : null,
  };
  location.label = buildLocationLabel(location);
  ipLocationCache.set(cacheKey, location);
  return location;
};

const fetchTicketmasterEvents = async ({ location, radiusMiles }: { location: Record<string, unknown>; radiusMiles: number }) => {
  const apiKey = getTicketmasterApiKey();
  if (!apiKey) {
    return [];
  }
  const cacheKey = JSON.stringify({
    postalCode: location.postalCode || null,
    latitude: location.latitude || null,
    longitude: location.longitude || null,
    radiusMiles,
  });
  const cached = ticketmasterEventCache.get(cacheKey);
  if (cached) return cached as Record<string, unknown>[];
  const dateRange = buildDateRange();
  const params = {
    apikey: apiKey,
    classificationName: 'music',
    size: MAX_EVENT_RESULTS,
    locale: '*',
    includeTBA: 'no',
    includeTBD: 'no',
    source: 'ticketmaster',
    ...dateRange,
    ...getTicketmasterLocationParams(location, radiusMiles),
  };
  const response = await axios.get(`${TICKETMASTER_BASE_URL}/events.json`, {
    params,
    timeout: 10000,
  });
  const data = response.data as Record<string, unknown>;
  const embedded = data?._embedded as Record<string, unknown> | undefined;
  const events = embedded?.events as Record<string, unknown>[] || [];
  ticketmasterEventCache.set(cacheKey, events);
  return events;
};

interface ShowArtist {
  name: string;
  key?: string;
  sourceType: string;
  ticketmasterAttractionId?: string | null;
  image?: string | null;
  url?: string | null;
}

interface ShowRecord {
  id: string;
  artistName: string;
  matchType: string;
  sourceType: string;
  eventName: string;
  ticketmasterAttractionId: string | null;
  ticketmasterEventId: string | null;
  image: string | null;
  url: string | null;
  date: string | null;
  time: string | null;
  dateTime: string | null;
  venueName: string | null;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  postalCode: string | null;
  distance: number | null;
  priceRange: Record<string, unknown> | null;
}

const buildShowRecord = (event: Record<string, unknown>, artist: ShowArtist, matchType: string): ShowRecord => {
  const venue = parseVenueLocation(event);
  const eventImage = selectImage(event.images as ImageEntry[]);
  const dates = event?.dates as Record<string, unknown> | undefined;
  const start = dates?.start as Record<string, unknown> | undefined;
  const localDate = start?.localDate as string || null;
  const localTime = start?.localTime as string || null;
  const dateTime = start?.dateTime as string || null;
  return {
    id: event.id as string,
    artistName: artist.name,
    matchType,
    sourceType: artist.sourceType || matchType,
    eventName: (event.name as string) || artist.name,
    ticketmasterAttractionId: artist.ticketmasterAttractionId || null,
    ticketmasterEventId: (event.id as string) || null,
    image: eventImage || artist.image || null,
    url: (event.url as string) || artist.url || null,
    date: localDate,
    time: localTime,
    dateTime,
    venueName: venue.venueName as string | null,
    city: venue.city as string | null,
    region: venue.region as string | null,
    countryCode: venue.countryCode as string | null,
    postalCode: venue.postalCode as string | null,
    distance: Number.isFinite(Number(event.distance)) ? Number(event.distance) : null,
    priceRange: Array.isArray(event.priceRanges) ? ((event.priceRanges as Record<string, unknown>[])[0] || null) : null,
  };
};

export const getNearbyShows = async ({
  req,
  zipCode,
  libraryArtists = [],
  recommendedArtists = [],
  trendingArtists = [],
  radiusMiles = DEFAULT_RADIUS_MILES,
  limit = DEFAULT_SHOW_LIMIT,
}: {
  req: Record<string, unknown>;
  zipCode?: string;
  libraryArtists?: Record<string, unknown>[];
  recommendedArtists?: Record<string, unknown>[];
  trendingArtists?: Record<string, unknown>[];
  radiusMiles?: number;
  limit?: number;
}) => {
  const resolvedLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_SHOW_LIMIT, MAX_SHOW_LIMIT));
  const sanitizedZipCode = sanitizeZipCode(zipCode);
  const libraryArtistCount = Array.isArray(libraryArtists) ? libraryArtists.length : 0;
  const libraryArtistMap = new Map<string, ArtistEntry>();
  const recommendedArtistMap = new Map<string, ArtistEntry>();
  const trendingArtistMap = new Map<string, ArtistEntry>();

  for (const artist of libraryArtists) {
    const name = String(artist?.artistName || artist?.name || '').trim();
    for (const key of artistKeysForName(name)) {
      libraryArtistMap.set(key, {
        name,
        sourceType: 'library',
      });
    }
  }

  for (const artist of recommendedArtists) {
    const name = String(artist?.name || artist?.artistName || '').trim();
    if (!name) continue;
    for (const key of artistKeysForName(name)) {
      if (!recommendedArtistMap.has(key)) {
        recommendedArtistMap.set(key, {
          name,
          sourceType: 'recommended',
        });
      }
    }
  }

  for (const artist of trendingArtists) {
    const name = String(artist?.name || artist?.artistName || '').trim();
    if (!name) continue;
    for (const key of artistKeysForName(name)) {
      if (!trendingArtistMap.has(key)) {
        trendingArtistMap.set(key, {
          name,
          sourceType: 'trending',
        });
      }
    }
  }

  let location: LocationData;
  if (sanitizedZipCode) {
    const resolvedZipLocation = await resolveZipLocation(sanitizedZipCode);
    location = resolvedZipLocation || {
      source: 'zip',
      postalCode: sanitizedZipCode,
      city: null,
      region: null,
      regionCode: null,
      countryCode: isLikelyUsZip(sanitizedZipCode) ? 'US' : null,
      latitude: null,
      longitude: null,
      label: sanitizedZipCode,
    };
  } else {
    location = await resolveIpLocation(getForwardedIp(req));
  }

  let events = await fetchTicketmasterEvents({ location: location as unknown as Record<string, unknown>, radiusMiles });
  if (events.length === 0 && sanitizedZipCode) {
    const zipResolvedLocation = await resolveZipLocation(sanitizedZipCode);
    if (zipResolvedLocation) {
      location = {
        ...zipResolvedLocation,
        source: 'zip',
      };
      events = await fetchTicketmasterEvents({ location: location as unknown as Record<string, unknown>, radiusMiles });
    }
  }
  const libraryShows: ShowRecord[] = [];
  const recommendedShows: ShowRecord[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    const artists = extractEventArtists(event);
    if (artists.length === 0) continue;
    for (const artist of artists) {
      const libraryMatch = findBestArtistMatch(artist.key, libraryArtistMap);
      const recommendedMatch = findBestArtistMatch(artist.key, recommendedArtistMap);
      const trendingMatch = findBestArtistMatch(artist.key, trendingArtistMap);
      const match = libraryMatch || recommendedMatch || trendingMatch;
      if (!match) continue;
      const dedupeKey = `${event.id}:${artist.key}:${match.sourceType}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const show = buildShowRecord(
        event,
        {
          ...artist,
          name: match.name || artist.name,
          sourceType: match.sourceType,
        },
        libraryMatch ? 'library' : 'recommended',
      );
      if (libraryMatch) {
        libraryShows.push(show);
      } else {
        recommendedShows.push(show);
      }
    }
  }

  const sortShows = (shows: ShowRecord[]) =>
    shows.sort((a: ShowRecord, b: ShowRecord) => {
      const aTime = a.dateTime || a.date || '';
      const bTime = b.dateTime || b.date || '';
      if (aTime !== bTime) return aTime.localeCompare(bTime as string);
      const aDistance = Number.isFinite(a.distance) ? a.distance as number : Number.POSITIVE_INFINITY;
      const bDistance = Number.isFinite(b.distance) ? b.distance as number : Number.POSITIVE_INFINITY;
      return aDistance - bDistance;
    });

  sortShows(libraryShows);
  sortShows(recommendedShows);

  const shows = [...libraryShows, ...recommendedShows].slice(0, resolvedLimit);

  return {
    location,
    shows,
    libraryShows: libraryShows.slice(0, resolvedLimit),
    recommendedShows: recommendedShows.slice(0, resolvedLimit),
    total: libraryShows.length + recommendedShows.length,
    counts: {
      libraryArtists: libraryArtistCount,
      matchedLibraryShows: libraryShows.length,
      matchedRecommendedShows: recommendedShows.length,
    },
  };
};
