import axios from 'axios';
import Bottleneck from 'bottleneck';
import NodeCache from 'node-cache';
import { validateExternalUrl } from '../middleware/urlValidator.js';

const KOITO_TIMEOUT_MS = 8000;
const KOITO_MAX_RETRIES = 2;
const KOITO_DEFAULT_LIMIT = 100;

const koitoCache = new NodeCache({
  stdTTL: 300,
  checkperiod: 60,
  maxKeys: 500,
});
const koitoInflightRequests = new Map();

const koitoLimiter = new Bottleneck({
  minTime: 250,
  maxConcurrent: 2,
});

const KOITO_PERIOD_BY_DISCOVERY_PERIOD = {
  '7day': 'week',
  '1month': 'month',
  '3month': 'year',
  '6month': 'year',
  '12month': 'year',
  overall: 'all_time',
};

export function normalizeKoitoBaseUrl(baseUrl: string) {
  const trimmed = String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    parsed.pathname = parsed.pathname
      .replace(/\/apis\/listenbrainz(?:\/1)?\/?$/i, '')
      .replace(/\/+$/, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return trimmed;
  }
}

export function getKoitoPeriod(discoveryPeriod: string) {
  if (!discoveryPeriod || discoveryPeriod === 'none') return null;
  return KOITO_PERIOD_BY_DISCOVERY_PERIOD[discoveryPeriod as keyof typeof KOITO_PERIOD_BY_DISCOVERY_PERIOD] || 'month';
}

const koitoRequest = koitoLimiter.wrap(async (opts: { baseUrl: string; path: string; params?: Record<string, unknown> }) => {
  const { baseUrl, path, params = {} } = opts;
  const normalizedBaseUrl = normalizeKoitoBaseUrl(baseUrl);
  const cacheKey = `koito:${normalizedBaseUrl}:${path}:${JSON.stringify(params)}`;
  const cached = koitoCache.get(cacheKey);
  if (cached) return cached;
  const inflight = koitoInflightRequests.get(cacheKey);
  if (inflight) return inflight;

  const requestPromise = (async () => {
    let lastError: unknown = null;
    for (let retryCount = 0; retryCount <= KOITO_MAX_RETRIES; retryCount++) {
      try {
        const response = await axios.get(`${normalizedBaseUrl}${path}`, {
          params,
          timeout: KOITO_TIMEOUT_MS,
          validateStatus: (status: number) => status >= 200 && status < 300,
        });
        koitoCache.set(cacheKey, response.data);
        return response.data;
      } catch (error: unknown) {
        lastError = error;
        const err = error as any;
        const status = err.response?.status;
        const code = err.code;
        const retryable =
          code === 'ECONNABORTED' ||
          code === 'ETIMEDOUT' ||
          code === 'ECONNRESET' ||
          code === 'ENOTFOUND' ||
          code === 'EAI_AGAIN' ||
          [408, 425, 429, 500, 502, 503, 504].includes(status);
        if (retryCount < KOITO_MAX_RETRIES && retryable) {
          const backoffMs = 300 * Math.pow(2, retryCount) + retryCount * 200;
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
        break;
      }
    }
    throw lastError;
  })();

  koitoInflightRequests.set(cacheKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    koitoInflightRequests.delete(cacheKey);
  }
});

export async function fetchKoitoTopArtists(
  baseUrl: string,
  { discoveryPeriod = '1month', limit = 50 }: { discoveryPeriod?: string; limit?: number } = {},
) {
  const validation = validateExternalUrl(baseUrl);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid Koito URL');
  }
  const period = getKoitoPeriod(discoveryPeriod);
  if (!period) return [];

  const boundedLimit = Math.min(50, Math.max(1, Number(limit) || 50));
  const artists = [];
  let page = 1;

  while (artists.length < boundedLimit) {
    const data: any = await koitoRequest({
      baseUrl: validation.url || '',
      path: '/apis/web/v1/top/artists',
      params: {
        period,
        page,
        limit: Math.min(KOITO_DEFAULT_LIMIT, boundedLimit - artists.length),
      },
    });
    const items: any[] = Array.isArray(data?.items) ? data.items : [];
    if (items.length === 0) break;
    artists.push(...items);
    if (data?.has_next_page !== true) break;
    page += 1;
  }

  return artists
    .slice(0, boundedLimit)
    .map((entry) => {
      const artist = entry?.item || {};
      const mbid = String(artist.musicbrainz_id || '').trim();
      if (!mbid) return null;
      return {
        mbid,
        artistName: artist.name,
        playcount: parseInt(artist.listen_count || 0, 10) || 0,
      };
    })
    .filter(Boolean);
}
