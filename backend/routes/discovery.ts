import express from 'express';
import {
  getDiscoveryCache,
  getDiscoveryUpdateStatus,
  getDiscoveryPlaylistBuildStatus,
  requestUserDiscoveryRefresh,
  getUserDiscoveryCacheStaleness,
  isGlobalDiscoveryRefreshInProgress,
  getDiscoveryAutoRefreshHours,
  getDiscoveryMode,
  getDiscoveryFeedback,
  addDiscoveryFeedback,
  removeDiscoveryFeedback,
  resetDiscoveryFeedback,
  serveCachedRecommendations,
  getLocalDiscoveryPreferences,
} from '../services/discoveryService.js';
import {
  lastfmRequest,
  getLastfmApiKey,
  getTicketmasterApiKey,
  clearApiCaches,
} from '../services/apiClients.js';
import { libraryManager } from '../services/libraryManager.js';
import { dbOps, userOps } from '../config/db-helpers.js';
import { imagePrefetchService } from '../services/imagePrefetchService.js';
import { hydrateArtistImages } from '../services/artistImageHydration.js';
import { buildImageProxyUrl, clearImageProxyCache } from '../services/imageProxyService.js';
import { requireAuth, requireAdmin, requirePermission } from '../middleware/requirePermission.js';
import { verifyTokenAuth } from '../middleware/auth.js';
import { noCache } from '../middleware/cache.js';
import { getNearbyShows } from '../services/nearbyShowsService.js';
import {
  getListenHistoryCacheNamespace,
  getListenHistoryProfile,
  hasListenHistoryProfile,
} from '../services/listeningHistory.js';
import {
  DISCOVERY_PROVIDER_LASTFM,
  DISCOVERY_PROVIDER_LISTENBRAINZ_FALLBACK,
  buildListenbrainzFallbackDiscovery,
  getDiscoveryCapabilities,
  getFallbackTagNames,
  searchFallbackGenreArtists,
} from '../services/listenbrainzDiscoveryFallback.js';
import { requestDiscoveryRefresh } from '../services/discoveryRefreshScheduler.js';

const router = express.Router();
const SLSKD_NOT_CONFIGURED_MESSAGE =
  'slskd is not configured. Add your slskd URL and API key in Settings > Integrations to enable Soulseek downloads for flows and playlists.';

const pendingTagRequests = new Map<string, Promise<unknown>>();
const pendingTagSuggestRequest: { promise: Promise<unknown> | null; expiry: number } = { promise: null, expiry: 0 };

const fetchLastfmTopTagNames = async () => {
  const now = Date.now();
  let data;
  if (pendingTagSuggestRequest.promise && pendingTagSuggestRequest.expiry > now) {
    data = await pendingTagSuggestRequest.promise;
  } else {
    const fetchPromise = lastfmRequest('chart.getTopTags', { limit: 100 });
    pendingTagSuggestRequest.promise = fetchPromise;
    pendingTagSuggestRequest.expiry = now + 60000;
    data = await fetchPromise;
  }
  if (!data?.tags?.tag) return [];
  const tags = Array.isArray(data.tags.tag) ? data.tags.tag : [data.tags.tag];
  return tags.map((tag: Record<string, unknown>) => (tag.name != null ? String(tag.name).trim() : '')).filter(Boolean);
};
const DISCOVERY_REVALIDATE_COOLDOWN_MS = 60 * 1000;
let lastDiscoveryRevalidateAt = 0;

const getDiscoveryStaleMs = () => getDiscoveryAutoRefreshHours() * 60 * 60 * 1000;

const buildArtistKeySet = (artists: unknown) => {
  const set = new Set<string>();
  for (const artist of Array.isArray(artists) ? artists : []) {
    [artist?.id, artist?.mbid, artist?.foreignArtistId, artist?.name, artist?.artistName].forEach(
      (value) => {
        const key = String(value || '')
          .trim()
          .toLowerCase();
        if (key) set.add(key);
      },
    );
  }
  return set;
};

const isLibraryArtist = (artist: Record<string, unknown> | null | undefined, existingArtistKeys: Set<unknown> | null | undefined) => {
  if (!artist || !existingArtistKeys?.size) return false;
  return [artist.id, artist.mbid, artist.foreignArtistId, artist.name, artist.artistName].some(
    (value) => {
      const key = String(value || '')
        .trim()
        .toLowerCase();
      return key && existingArtistKeys.has(key);
    },
  );
};

router.post('/refresh', requireAuth, requireAdmin, (req, res) => {
  const result = requestDiscoveryRefresh({
    reason: 'manual',
    force: true,
  });
  if (!result.enqueued) {
    return res.status(409).json({
      message: 'Discovery update already in progress',
      isUpdating: true,
      reason: result.reason,
    });
  }
  res.json({
    message: 'Discovery update started',
    isUpdating: true,
  });
});

router.post('/clear', requireAuth, requireAdmin, async (req, res) => {
  dbOps.clearImages();
  clearImageProxyCache();
  clearApiCaches();
  res.json({ message: 'Image cache cleared' });
});

router.post('/clear-discovery', requireAuth, requireAdmin, async (req, res) => {
  dbOps.updateDiscoveryCache({
    recommendations: [],
    globalTop: [],
    basedOn: [],
    topTags: [],
    topGenres: [],
    fallbackGenres: [],
    provider: DISCOVERY_PROVIDER_LASTFM,
    recommendationQuality: null,
    isEnriching: false,
    discoveryRunId: null,
    enrichmentStartedAt: null,
    enrichmentCompletedAt: null,
    enrichmentProgressMessage: null,
    lastUpdated: null,
  });
  const discoveryCache = getDiscoveryCache();
  Object.assign(discoveryCache, {
    recommendations: [],
    globalTop: [],
    basedOn: [],
    topTags: [],
    topGenres: [],
    fallbackGenres: [],
    provider: DISCOVERY_PROVIDER_LASTFM,
    capabilities: getDiscoveryCapabilities(true),
    recommendationQuality: null,
    isEnriching: false,
    discoveryRunId: null,
    enrichmentStartedAt: null,
    enrichmentCompletedAt: null,
    enrichmentProgressMessage: null,
    lastUpdated: null,
    isUpdating: false,
  });
  pendingTagRequests.clear();
  pendingTagSuggestRequest.promise = null;
  pendingTagSuggestRequest.expiry = 0;
  res.json({ message: 'Discovery cache cleared' });
});

router.get('/', requireAuth, async (req, res) => {
  const hasLastfmKey = !!getLastfmApiKey();
  const libraryArtists = await libraryManager.getAllArtists();

  const reqUser = req.user ? userOps.getUserById(req.user.id as number) : null;
  const listenHistoryProfile = getListenHistoryProfile(reqUser || {});
  const userCacheNamespace = getListenHistoryCacheNamespace(listenHistoryProfile);
  const effectiveCacheNamespace: string | null = hasLastfmKey ? userCacheNamespace : null;

  if (
    hasListenHistoryProfile(listenHistoryProfile) &&
    hasLastfmKey &&
    !isGlobalDiscoveryRefreshInProgress()
  ) {
    const ns = userCacheNamespace;
    if (ns) {
      const staleness = getUserDiscoveryCacheStaleness(ns);
      if (staleness > getDiscoveryStaleMs()) {
        requestUserDiscoveryRefresh(listenHistoryProfile, {
          feedbackUserId: req.user ? String(req.user.id || '') || null : null,
        }).catch((err: Error) => {
          console.error(
            `[Discover] On-demand refresh for ${(listenHistoryProfile as Record<string, unknown>).listenHistoryProvider}:${(listenHistoryProfile as Record<string, unknown>).listenHistoryUsername} failed:`,
            err.message,
          );
        });
      }
    }
  }

  let discoveryCache = getDiscoveryCache(effectiveCacheNamespace);

  const hasData =
    discoveryCache.recommendations?.length > 0 ||
    discoveryCache.globalTop?.length > 0 ||
    discoveryCache.topGenres?.length > 0 ||
    discoveryCache.fallbackGenres?.length > 0;
  const hasCompletedRefresh =
    !!discoveryCache.lastUpdated &&
    (discoveryCache.recommendations?.length > 0 ||
      discoveryCache.globalTop?.length > 0 ||
      discoveryCache.topGenres?.length > 0 ||
      discoveryCache.fallbackGenres?.length > 0);

  let isUpdating = discoveryCache.isUpdating || false;

  if (
    !hasLastfmKey &&
    (!hasData || discoveryCache.provider !== DISCOVERY_PROVIDER_LISTENBRAINZ_FALLBACK)
  ) {
    const fallbackData = await buildListenbrainzFallbackDiscovery({
      existingArtistKeys: buildArtistKeySet(libraryArtists),
    });
    dbOps.updateDiscoveryCache(fallbackData);
    Object.assign(getDiscoveryCache(), fallbackData, { isUpdating: false });
    discoveryCache = getDiscoveryCache(effectiveCacheNamespace);
    isUpdating = false;
  } else if (!hasData && !hasCompletedRefresh && !isUpdating) {
    lastDiscoveryRevalidateAt = Date.now();
    const lazyRefresh = requestDiscoveryRefresh({ reason: 'lazy' });
    if (lazyRefresh.enqueued) {
      isUpdating = true;
    }
  }

  let {
    recommendations,
    globalTop,
    basedOn,
  } = discoveryCache;
  const topTags = discoveryCache.topTags;
  const topGenres = discoveryCache.topGenres;
  const fallbackGenres = (discoveryCache.fallbackGenres ?? []) as unknown as Array<Record<string, unknown>>;
  const discoverPlaylists = discoveryCache.discoverPlaylists ?? [];
  const lastUpdated = discoveryCache.lastUpdated;
  const recommendationQuality = discoveryCache.recommendationQuality;
  const isEnriching = discoveryCache.isEnriching;
  const discoveryRunId = discoveryCache.discoveryRunId;
  const enrichmentStartedAt = discoveryCache.enrichmentStartedAt;
  const enrichmentCompletedAt = discoveryCache.enrichmentCompletedAt;
  const enrichmentProgressMessage = discoveryCache.enrichmentProgressMessage;
  let provider = discoveryCache.provider;
  let capabilities = discoveryCache.capabilities;
  provider = hasLastfmKey
    ? DISCOVERY_PROVIDER_LASTFM
    : provider || DISCOVERY_PROVIDER_LISTENBRAINZ_FALLBACK;
  capabilities = capabilities || getDiscoveryCapabilities(hasLastfmKey);
  const feedback = getDiscoveryFeedback(String(req.user?.id ?? 'global'));
  const discoveryMode = getDiscoveryMode();

  const existingArtistKeys = buildArtistKeySet(libraryArtists);

  recommendations = recommendations.filter(
    (artist: Record<string, unknown>) => !isLibraryArtist(artist, existingArtistKeys),
  );
  globalTop = globalTop.filter((artist: Record<string, unknown>) => !isLibraryArtist(artist, existingArtistKeys));
  recommendations = await hydrateArtistImages(recommendations, {
    limit: Math.min(recommendations.length, 36),
    batchSize: 8,
    delayMs: 10,
  });
  globalTop = await hydrateArtistImages(globalTop, {
    limit: Math.min(globalTop.length, 36),
    batchSize: 8,
    delayMs: 10,
  });
  basedOn = await hydrateArtistImages(basedOn, {
    limit: Math.min(basedOn.length, 24),
    batchSize: 6,
    delayMs: 10,
  });
  if (Array.isArray(fallbackGenres) && fallbackGenres.length > 0) {
    for (const section of fallbackGenres) {
      if (!Array.isArray(section?.artists) || section.artists.length === 0) {
        continue;
      }
      section.artists = await hydrateArtistImages(section.artists as never[], {
        limit: Math.min(section.artists.length, 24),
        batchSize: 6,
        delayMs: 10,
      });
    }
  }

  recommendations = serveCachedRecommendations({
    recommendations,
    feedback,
  } as any) as unknown as typeof recommendations;

  const parsedLastUpdated = lastUpdated ? new Date(lastUpdated).getTime() : 0;
  const isStale =
    Number.isFinite(parsedLastUpdated) &&
    parsedLastUpdated > 0 &&
    Date.now() - parsedLastUpdated > getDiscoveryStaleMs();

  if (
    isStale &&
    !isUpdating &&
    !hasListenHistoryProfile(listenHistoryProfile) &&
    Date.now() - lastDiscoveryRevalidateAt > DISCOVERY_REVALIDATE_COOLDOWN_MS
  ) {
    lastDiscoveryRevalidateAt = Date.now();
    const staleRefresh = requestDiscoveryRefresh({ reason: 'stale' });
    if (staleRefresh.enqueued) {
      isUpdating = true;
    }
  }

  if (recommendations.length > 0 || globalTop.length > 0) {
    imagePrefetchService
      .prefetchDiscoveryImages({
        recommendations,
        globalTop,
      })
      .catch(() => {});
  }

  if (recommendations.length > 0 || globalTop.length > 0) {
    res.set('Cache-Control', 'private, max-age=120, stale-while-revalidate=300');
  } else if (isUpdating) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  } else {
    res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=120');
  }

  const { annotateDiscoverPlaylistsForUser } =
    await import('../services/discoverPlaylistService.js');
  const playlists = annotateDiscoverPlaylistsForUser(discoverPlaylists, req.user as Record<string, unknown>).filter(
    (playlist: Record<string, unknown>) => Number(playlist.trackCount) > 0,
  );

  const playlistBuildStatus = getDiscoveryPlaylistBuildStatus(
    effectiveCacheNamespace as any,
  );

  res.json({
    recommendations,
    globalTop,
    basedOn,
    topTags,
    topGenres,
    fallbackGenres,
    discoverPlaylists: playlists,
    lastUpdated,
    isUpdating,
    recommendationQuality,
    isEnriching,
    discoveryRunId,
    enrichmentStartedAt,
    enrichmentCompletedAt,
    enrichmentProgressMessage,
    ...(isUpdating ? getDiscoveryUpdateStatus() : {}),
    playlistsUpdating: playlistBuildStatus.playlistsUpdating,
    ...(playlistBuildStatus.playlistsUpdating
      ? {
          playlistsUpdateMessage: playlistBuildStatus.playlistsUpdateMessage,
        }
      : {}),
    stale: isStale,
    configured: true,
    provider,
    capabilities,
    discoveryMode,
  });
});

router.get('/artwork/:presetId', noCache, async (req, res) => {
  if (!verifyTokenAuth(req)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
  }

  try {
    const { ensureDiscoverArtworkForPreset } =
      await import('../services/discoverPlaylistArtworkService.js');
    const artwork = await ensureDiscoverArtworkForPreset(req.params.presetId, {
      user: req.user,
    });
    if (!artwork) {
      return res.status(404).json({ error: 'Artwork not found' });
    }
    res.type(artwork.contentType);
    res.sendFile(artwork.safePath);
  } catch (error) {
    const err = error as Error;
    res.status(500).json({
      error: 'Failed to load artwork',
      message: err.message,
    });
  }
});

const handleDiscoverAdoptError = (res: express.Response, error: unknown, fallbackError: string) => {
  const err = error as Record<string, unknown> & Error;
  if (err?.statusCode === 400) {
    return res.status(400).json({
      error: err.error || 'Bad Request',
      message: err.message,
    });
  }
  if (err?.statusCode === 404) {
    return res.status(404).json({
      error: err.error || 'Playlist preview not available',
      message: err.message,
    });
  }
  if (err?.code === 'FLOW_NAME_CONFLICT') {
    return res.status(400).json({
      error: 'Flow name already exists',
      message: err.message,
    });
  }
  if (err?.code === 'SHARED_PLAYLIST_NAME_CONFLICT') {
    return res.status(400).json({
      error: 'Shared playlist name already exists',
      message: err.message,
    });
  }
  return res.status(500).json({
    error: fallbackError,
    message: err.message,
  });
};

router.post('/playlists/adopt', requireAuth, requirePermission('accessFlow'), async (req, res) => {
  try {
    const presetId = String(req.body?.presetId || '').trim();
    if (!presetId) {
      return res.status(400).json({ error: 'presetId is required' });
    }

    const { slskdClient } = await import('../services/slskdClient.js');
    if (!slskdClient.isConfigured()) {
      return res.status(400).json({
        error: 'slskd not configured',
        message: SLSKD_NOT_CONFIGURED_MESSAGE,
      });
    }

    const { adoptDiscoverPresetAsFlow } =
      await import('../services/discoverPlaylistAdoptService.js');
    const result = await adoptDiscoverPresetAsFlow(req.user as Record<string, unknown>, presetId);
    res.json(result);
  } catch (error) {
    handleDiscoverAdoptError(res, error, 'Failed to adopt discover playlist');
  }
});

router.post(
  '/playlists/adopt-playlist',
  requireAuth,
  requirePermission('accessFlow'),
  async (req, res) => {
    try {
      const presetId = String(req.body?.presetId || '').trim();
      if (!presetId) {
        return res.status(400).json({ error: 'presetId is required' });
      }

      const { slskdClient } = await import('../services/slskdClient.js');
      if (!slskdClient.isConfigured()) {
        return res.status(400).json({
          error: 'slskd not configured',
          message: SLSKD_NOT_CONFIGURED_MESSAGE,
        });
      }

      const { adoptDiscoverPresetAsPlaylist } =
        await import('../services/discoverPlaylistAdoptService.js');
      const result = await adoptDiscoverPresetAsPlaylist(req.user as Record<string, unknown>, presetId);
      res.json(result);
    } catch (error) {
      handleDiscoverAdoptError(res, error, 'Failed to adopt discover playlist');
    }
  },
);

router.get('/related', requireAuth, (req, res) => {
  const discoveryCache = getDiscoveryCache();
  res.json({
    recommendations: discoveryCache.recommendations,
    basedOn: discoveryCache.basedOn,
    total: discoveryCache.recommendations.length,
  });
});

router.get('/similar', requireAuth, (req, res) => {
  const discoveryCache = getDiscoveryCache();
  res.json({
    topTags: discoveryCache.topTags,
    topGenres: discoveryCache.topGenres,
    basedOn: discoveryCache.basedOn,
    message: 'Served from cache',
  });
});

router.get('/tags', async (req, res) => {
  try {
    const { q = '', limit = '10' } = req.query as Record<string, string>;
    const limitInt = Math.min(parseInt(limit as string) || 10, 20);
    const rawPrefix = String(q).trim();
    const prefix = rawPrefix.toLowerCase();
    let tagNames: string[] = [];
    if (getLastfmApiKey()) {
      tagNames = await fetchLastfmTopTagNames();
    }
    if (tagNames.length === 0) {
      const discoveryCache = getDiscoveryCache();
      const cached = [
        ...getFallbackTagNames(),
        ...(discoveryCache.topTags || []),
        ...(discoveryCache.topGenres || []),
      ]
        .map((t: unknown) => (t != null ? String(t).trim() : ''))
        .filter(Boolean);
      tagNames = [...new Set(cached)];
    }
    const seen = new Set<string>();
    const filtered = tagNames.filter((name: string) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      if (prefix && !key.includes(prefix)) return false;
      seen.add(key);
      return true;
    });
    if (prefix.length >= 2 && !filtered.some((name: string) => name.toLowerCase() === prefix)) {
      filtered.unshift(rawPrefix);
    }
    res.json({ tags: filtered.slice(0, limitInt) });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch tag suggestions',
      message: (error as Error).message,
    });
  }
});

router.get('/by-tag', async (req, res) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const tag = q.tag;
    const limit = q.limit || '24';
    const offset = q.offset || '0';
    const includeLibrary = q.includeLibrary;
    const scope = q.scope;

    if (!tag) {
      return res.status(400).json({ error: 'Tag parameter is required' });
    }

    const limitInt = Math.min(parseInt(limit as string) || 24, 50);
    const offsetInt = parseInt(offset as string) || 0;
    const page = Math.floor(offsetInt / limitInt) + 1;
    const includeLibraryFlag = includeLibrary === 'true' || includeLibrary === '1';
    const scopeValue = scope === 'all' || includeLibraryFlag ? 'all' : 'recommended';
    const cacheKey = `tag:${tag.toLowerCase()}:${limitInt}:${page}:${scopeValue}`;

    let recommendations: Record<string, unknown>[] = [];
    if (scopeValue === 'all') {
      if (getLastfmApiKey()) {
        try {
          let data: Record<string, unknown> | undefined;
          if (pendingTagRequests.has(cacheKey)) {
            data = (await pendingTagRequests.get(cacheKey)) as Record<string, unknown> | undefined;
          } else {
            const fetchPromise = lastfmRequest('tag.getTopArtists', {
              tag,
              limit: limitInt,
              page,
            });
            pendingTagRequests.set(cacheKey, fetchPromise);
            try {
              data = (await fetchPromise) as Record<string, unknown> | undefined;
            } finally {
              pendingTagRequests.delete(cacheKey);
            }
          }

          if ((data as any)?.topartists?.artist) {
            const rawArtists = (data as any).topartists.artist as Record<string, unknown>[];
            const artists = Array.isArray(rawArtists)
              ? rawArtists
              : [rawArtists];

            recommendations = artists
              .map((artist: Record<string, unknown>) => {
                let imageUrl: string | null = null;
                const artistImage = artist.image;
                if (artistImage && Array.isArray(artistImage)) {
                  const imgArr = artistImage as Array<Record<string, unknown>>;
                  const img =
                    imgArr.find((i: Record<string, unknown>) => i.size === 'extralarge') ||
                    imgArr.find((i: Record<string, unknown>) => i.size === 'large') ||
                    imgArr.slice(-1)[0];
                  if (
                    img &&
                    img['#text'] &&
                    !String(img['#text']).includes('2a96cbd8b46e442fc41c2b86b821562f')
                  ) {
                    imageUrl = String(img['#text']);
                  }
                }

                return {
                  id: artist.mbid,
                  name: artist.name,
                  sortName: artist.name,
                  type: 'Artist' as string,
                  tags: [tag] as string[],
                  image: imageUrl ? buildImageProxyUrl(imageUrl) || imageUrl : null,
                };
              })
              .filter((a: Record<string, unknown>) => a.id);
          }
        } catch (err) {
          console.error('Last.fm tag search failed:', (err as Error).message);
        }
      } else {
        const fallbackResult = await searchFallbackGenreArtists({
          tag,
          limit: limitInt,
          offset: offsetInt,
          existingArtistKeys: includeLibraryFlag
            ? new Set()
            : buildArtistKeySet(await libraryManager.getAllArtists()),
        } as any);
        if (fallbackResult) {
          return res.json({
            recommendations: fallbackResult.artists,
            tag,
            total: fallbackResult.total,
            offset: offsetInt,
            provider: DISCOVERY_PROVIDER_LISTENBRAINZ_FALLBACK,
            fallbackLimited: true,
          });
        }

        const discoveryCache = getDiscoveryCache();
        const tagLower = String(tag).trim().toLowerCase();
        const castFallbackGenres = discoveryCache.fallbackGenres as unknown as Array<Record<string, unknown>>;
        const pool = [
          ...(discoveryCache.recommendations || []),
          ...(discoveryCache.globalTop || []),
          ...(castFallbackGenres || []).flatMap((section: Record<string, unknown>) =>
            Array.isArray(section?.artists) ? section.artists : [],
          ),
        ];
        const seen = new Set<string>();
        const matches = pool.filter((artist: Record<string, unknown>) => {
          const key = String(artist?.id || artist?.mbid || artist?.name || '')
            .trim()
            .toLowerCase();
          if (!key || seen.has(key)) return false;
          const artistTags = [
            ...(Array.isArray(artist?.tags) ? artist.tags : []),
            ...(Array.isArray(artist?.genres) ? artist.genres : []),
          ];
          const matched = artistTags.some(
            (entry: unknown) =>
              String(entry || '')
                .trim()
                .toLowerCase() === tagLower,
          );
          if (!matched) return false;
          seen.add(key);
          return true;
        });
        recommendations = matches.slice(offsetInt, offsetInt + limitInt);
        return res.json({
          recommendations,
          tag,
          total: matches.length,
          offset: offsetInt,
          provider: DISCOVERY_PROVIDER_LISTENBRAINZ_FALLBACK,
          fallbackLimited: true,
          message: 'Tag search is limited without Last.fm',
        });
      }
    } else {
      const discoveryCache = getDiscoveryCache();
      const tagLower = String(tag).trim().toLowerCase();
      const matches = (discoveryCache.recommendations || []).filter((artist: Record<string, unknown>) => {
        const artistTags = Array.isArray(artist.tags) ? artist.tags : [];
        return artistTags.some((t: unknown) => String(t).toLowerCase() === tagLower);
      });
      recommendations = matches.slice(offsetInt, offsetInt + limitInt);
      return res.json({
        recommendations,
        tag,
        total: matches.length,
        offset: offsetInt,
      });
    }

    res.json({
      recommendations,
      tag,
      total: recommendations.length,
      offset: offsetInt,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to search by tag',
      message: (error as Error).message,
    });
  }
});

router.get('/nearby-shows', requireAuth, async (req, res) => {
  try {
    const apiKey = getTicketmasterApiKey();
    if (!apiKey) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.json({
        configured: false,
        location: null,
        shows: [],
        total: 0,
        counts: {
          libraryArtists: 0,
          matchedLibraryShows: 0,
          matchedRecommendedShows: 0,
        },
      });
    }

    const zipCode = String(req.query.zip || '').trim();
    const limit = req.query.limit;
    const settings = dbOps.getSettings() as Record<string, unknown>;
    const integrations = settings.integrations as Record<string, Record<string, unknown>> | undefined;
    const configuredRadius = Number(integrations?.ticketmaster?.searchRadiusMiles);
    const localDiscoveryPreferences = getLocalDiscoveryPreferences();
    const radiusMiles = Number.isFinite(configuredRadius)
      ? Math.max(5, Math.min(250, Math.floor(configuredRadius)))
      : undefined;
    const libraryArtists = await libraryManager.getAllArtists();
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const reqUser = userOps.getUserById(req.user.id as number);
    const userCacheNamespace = getLastfmApiKey()
      ? getListenHistoryCacheNamespace(getListenHistoryProfile(reqUser || {}))
      : null;
    const discoveryCache = getDiscoveryCache(userCacheNamespace);
    const feedback = getDiscoveryFeedback(String(req.user?.id ?? 'global'));
    const recommendedArtists: Record<string, unknown>[] = localDiscoveryPreferences.includeRecommendations
      ? serveCachedRecommendations({
          recommendations: discoveryCache.recommendations || [],
          feedback,
        } as any) as unknown as Record<string, unknown>[]
      : [];
    const trendingArtists: Record<string, unknown>[] = localDiscoveryPreferences.includeTrending
      ? (discoveryCache.globalTop || []) as unknown as Record<string, unknown>[]
      : [];
    const libraryArtistsTyped = libraryArtists as any[];
    const nearbyShows = await getNearbyShows({
      req: req as unknown as Record<string, unknown>,
      zipCode,
      libraryArtists: libraryArtistsTyped as never[],
      recommendedArtists: recommendedArtists as never[],
      trendingArtists: trendingArtists as never[],
      limit: limit as number | undefined,
      radiusMiles,
    });

    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.json({
      configured: true,
      ...nearbyShows,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to load nearby shows',
      message: (error as Error).message,
    });
  }
});

router.get('/preferences', requireAuth, (req, res) => {
  const localDiscoveryPreferences = getLocalDiscoveryPreferences();
  res.json({
    discoveryMode: getDiscoveryMode(),
    localDiscoveryIncludeRecommendations: localDiscoveryPreferences.includeRecommendations,
    localDiscoveryIncludeTrending: localDiscoveryPreferences.includeTrending,
  });
});

router.post('/preferences', requireAuth, (req, res) => {
  try {
    const updates = (req.body as Record<string, unknown>) || {};
    const currentSettings = dbOps.getSettings() as Record<string, unknown>;
    const currentIntegrations = (currentSettings.integrations as Record<string, Record<string, unknown>>) || {};
    const nextIntegrations: Record<string, Record<string, unknown>> = {
      ...currentIntegrations,
      lastfm: {
        ...(currentIntegrations.lastfm || {}),
        discoveryMode:
          updates.discoveryMode === 'safer' || updates.discoveryMode === 'deeper'
            ? updates.discoveryMode
            : 'balanced',
      },
      ticketmaster: {
        ...(currentIntegrations.ticketmaster || {}),
        localDiscoveryIncludeRecommendations:
          updates.localDiscoveryIncludeRecommendations !== false,
        localDiscoveryIncludeTrending: updates.localDiscoveryIncludeTrending !== false,
      },
    };
    const nextSettings: Record<string, unknown> = {
      ...currentSettings,
      integrations: nextIntegrations,
    };
    dbOps.updateSettings(nextSettings);

    res.json({
      success: true,
      preferences: {
        discoveryMode: (nextIntegrations.lastfm?.discoveryMode as string) || 'balanced',
        localDiscoveryIncludeRecommendations:
          nextIntegrations.ticketmaster?.localDiscoveryIncludeRecommendations !== false,
        localDiscoveryIncludeTrending:
          nextIntegrations.ticketmaster?.localDiscoveryIncludeTrending !== false,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to update preferences',
      message: (error as Error).message,
    });
  }
});

router.post('/preferences/reset', requireAuth, (req, res) => {
  const currentSettings = dbOps.getSettings() as Record<string, unknown>;
  const currentIntegrations = (currentSettings.integrations as Record<string, Record<string, unknown>>) || {};
  dbOps.updateSettings({
    ...currentSettings,
    integrations: {
      ...currentIntegrations,
      lastfm: {
        ...(currentIntegrations.lastfm || {}),
        discoveryMode: 'balanced',
      },
      ticketmaster: {
        ...(currentIntegrations.ticketmaster || {}),
        localDiscoveryIncludeRecommendations: true,
        localDiscoveryIncludeTrending: true,
      },
    },
  });
  res.json({
    success: true,
    preferences: {
      discoveryMode: 'balanced',
      localDiscoveryIncludeRecommendations: true,
      localDiscoveryIncludeTrending: true,
    },
  });
});

router.get('/feedback', requireAuth, (req, res) => {
  res.json({
    feedback: getDiscoveryFeedback(String(req.user?.id ?? 'global')),
  });
});

router.post('/feedback', requireAuth, (req, res) => {
  try {
    const feedback = addDiscoveryFeedback(String(req.user?.id ?? 'global'), (req.body as Record<string, unknown>) || {});
    res.json({
      success: true,
      feedback,
      feedbackList: getDiscoveryFeedback(String(req.user?.id ?? 'global')),
    });
  } catch (error) {
    res.status(400).json({
      error: 'Failed to save discovery feedback',
      message: (error as Error).message,
    });
  }
});

router.delete('/feedback/:id', requireAuth, (req, res) => {
  const feedbackList = removeDiscoveryFeedback(String(req.user?.id ?? 'global'), String(req.params.id));
  res.json({
    success: true,
    feedbackList,
  });
});

router.post('/feedback/reset', requireAuth, (req, res) => {
  const feedbackList = resetDiscoveryFeedback(String(req.user?.id ?? 'global'));
  res.json({
    success: true,
    feedbackList,
  });
});

router.get('/filtered', requireAuth, async (req, res) => {
  try {
    const discoveryCache = getDiscoveryCache();
    const feedback = getDiscoveryFeedback(String(req.user?.id ?? 'global'));
    const discoveryMode = getDiscoveryMode();
    let recommendations = discoveryCache.recommendations || [];
    let globalTop = discoveryCache.globalTop || [];

    const libraryArtists = await libraryManager.getAllArtists();
    const existingArtistKeys = buildArtistKeySet(libraryArtists);

    recommendations = recommendations.filter(
      (artist: Record<string, unknown>) => !isLibraryArtist(artist, existingArtistKeys),
    );
    globalTop = globalTop.filter((artist: Record<string, unknown>) => !isLibraryArtist(artist, existingArtistKeys));
    recommendations = serveCachedRecommendations({
      recommendations,
      feedback,
    } as any) as unknown as typeof recommendations;

    res.json({
      recommendations,
      globalTop,
      topTags: discoveryCache.topTags || [],
      topGenres: discoveryCache.topGenres || [],
      basedOn: discoveryCache.basedOn || [],
      lastUpdated: discoveryCache.lastUpdated,
      preferencesApplied: true,
      discoveryMode,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get filtered discovery',
      message: (error as Error).message,
    });
  }
});

export default router;
