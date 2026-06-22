import { Request, Response } from 'express';
import express from 'express';
import { dbOps } from '../config/db-helpers.js';
import {
  DEFAULT_METADATA_BASE_URL,
  DEFAULT_SEARCH_URL,
  LEGACY_METADATA_BASE_URL,
  defaultData,
} from '../config/constants.js';
import { reconcileLocalNetworkBypassSetting } from '../middleware/auth.js';
import { noCache } from '../middleware/cache.js';
import { requireAuth, requireAdmin } from '../middleware/requirePermission.js';
import { validateExternalUrl } from '../middleware/urlValidator.js';
import { websocketService } from '../services/websocketService.js';
import { resolvePlaylistRoot } from '../services/playlistPaths.js';
import { normalizePathMappings } from '../services/pathMappings.js';
import { normalizeM3uPathMappings, normalizeM3uPathMode } from '../services/playlistM3uPaths.js';

 
type Settings = Record<string, any>;

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);

function normalizeMetadataBaseUrl(baseUrl: unknown) {
  const trimmed = String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  return trimmed === LEGACY_METADATA_BASE_URL ? DEFAULT_METADATA_BASE_URL : trimmed;
}

router.get('/', noCache, (req: Request, res: Response) => {
  try {
    const settings: Settings = dbOps.getSettings();
    const integrations: Settings = settings.integrations || {};
    if (integrations.coverArtArchive) {
      delete integrations.coverArtArchive;
    }
    if (integrations.musicbrainz) {
      delete integrations.musicbrainz;
    }
    if (!integrations.search) {
      integrations.search = {
        url: DEFAULT_SEARCH_URL,
        apiKey: '',
      };
    } else {
      integrations.search = {
        url: integrations.search.url || DEFAULT_SEARCH_URL,
        apiKey: integrations.search.apiKey || '',
      };
    }
    if (!integrations.metadata) {
      const legacyMusicbrainz =
        (dbOps.getSettings() as Settings).integrations?.musicbrainz || {};
      integrations.metadata = {
        provider: 'brainzmash',
        baseUrl: normalizeMetadataBaseUrl(
          String(legacyMusicbrainz.customUrl || '')
            .trim()
            .replace(/\/ws\/2\/?$/, '') || DEFAULT_METADATA_BASE_URL,
        ),
        userAgentSuffix: '',
        enableNarrowFallbacks: true,
      };
    } else {
      integrations.metadata = {
        ...integrations.metadata,
        baseUrl: normalizeMetadataBaseUrl(
          integrations.metadata.baseUrl || DEFAULT_METADATA_BASE_URL,
        ),
      };
    }
    const security: Settings = settings.security || {};
    settings.security = {
      ...security,
      localNetworkBypass: {
        enabled: security.localNetworkBypass?.enabled === true,
      },
    };
    res.json({
      ...settings,
      downloadFolderPath: settings.downloadFolderPath || resolvePlaylistRoot(),
    });
  } catch (error: unknown) {
    console.error('Settings GET error:', error);
    res.status(500).json({ error: 'Failed to fetch settings', message: (error as Error).message });
  }
});

router.post('/slskd/test', async (req: Request, res: Response) => {
  try {
    const { slskdClient } = await import('../services/slskdClient.js');
    const result = await slskdClient.testConnection({ force: true });
    if (!result.configured) {
      return res.status(400).json(result);
    }
    if (!result.ok) {
      return res.status(502).json(result);
    }
    return res.json({
      success: true,
      warning: (result as Settings).warning === true,
      ...result,
    });
  } catch (error: unknown) {
    return res.status(500).json({
      error: 'slskd test failed',
      message: (error as Error).message,
    });
  }
});

router.post('/prowlarr/test', async (req: Request, res: Response) => {
  try {
    const { prowlarrClient } = await import('../services/prowlarrClient.js');
    const result = await prowlarrClient.testConnection({ force: true });
    if (!result.configured) {
      return res.status(400).json(result);
    }
    if (!result.ok) {
      return res.status(502).json(result);
    }
    return res.json({
      success: true,
      ...result,
    });
  } catch (error: unknown) {
    return res.status(500).json({
      error: 'Prowlarr test failed',
      message: (error as Error).message,
    });
  }
});

router.get('/prowlarr/indexers', async (_req: Request, res: Response) => {
  try {
    const { prowlarrClient } = await import('../services/prowlarrClient.js');
    const indexers = await prowlarrClient.listUsenetIndexers();
    return res.json({ indexers });
  } catch (error: unknown) {
    return res.status(500).json({
      error: 'Failed to load Prowlarr indexers',
      message: (error as Error).message,
    });
  }
});

router.post('/nzbget/test', async (req: Request, res: Response) => {
  try {
    const { nzbgetClient } = await import('../services/nzbgetClient.js');
    const result = await nzbgetClient.testConnection({ force: true });
    if (!result.configured) {
      return res.status(400).json(result);
    }
    if (!result.ok) {
      return res.status(502).json(result);
    }
    return res.json({
      success: true,
      ...result,
    });
  } catch (error: unknown) {
    return res.status(500).json({
      error: 'NZBGet test failed',
      message: (error as Error).message,
    });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body as Settings;
    const {
      quality,
      releaseTypes,
      integrations: bodyIntegrations,
      rootFolderPath,
      downloadFolderPath,
      pathMappings,
      security: bodySecurity,
      playlistArtwork,
    } = body;

    const currentSettings: Settings = dbOps.getSettings();
    const currentIntegrations: Settings = currentSettings.integrations || {};
    const currentSecurity: Settings = currentSettings.security || {};
    const localBypassWasEnabled = currentSecurity.localNetworkBypass?.enabled === true;
    const lidarrExternalUrl = bodyIntegrations?.lidarr?.externalUrl;
    if (lidarrExternalUrl !== undefined) {
      const trimmedExternalUrl = String(lidarrExternalUrl).trim();
      if (trimmedExternalUrl) {
        const urlValidation = validateExternalUrl(trimmedExternalUrl);
        if (!urlValidation.valid) {
          return res.status(400).json({ error: urlValidation.error });
        }
        bodyIntegrations.lidarr.externalUrl = urlValidation.url!;
      } else {
        bodyIntegrations.lidarr.externalUrl = '';
      }
    }

    if (bodyIntegrations?.search) {
      const nextSearch: Settings = {
        ...(currentIntegrations.search || {}),
        ...bodyIntegrations.search,
      };
      const trimmedSearchUrl = String(nextSearch.url || '').trim();
      if (trimmedSearchUrl) {
        const urlValidation = validateExternalUrl(trimmedSearchUrl);
        if (!urlValidation.valid) {
          return res.status(400).json({
            error: `Invalid search URL: ${urlValidation.error}`,
          });
        }
        nextSearch.url = urlValidation.url!.replace(/\/+$/, '');
      } else {
        nextSearch.url = '';
      }
      nextSearch.apiKey = typeof nextSearch.apiKey === 'string' ? nextSearch.apiKey.trim() : '';
      bodyIntegrations.search = nextSearch;
    }
    if (bodyIntegrations?.metadata) {
      const nextMetadata: Settings = {
        ...(currentIntegrations.metadata || {}),
        ...bodyIntegrations.metadata,
      };
      nextMetadata.provider = 'brainzmash';
      const baseUrlValidation = validateExternalUrl(String(nextMetadata.baseUrl || ''));
      if (!baseUrlValidation.valid) {
        return res.status(400).json({
          error: `Invalid metadata base URL: ${baseUrlValidation.error}`,
        });
      }
      nextMetadata.baseUrl = normalizeMetadataBaseUrl(baseUrlValidation.url!);
      nextMetadata.userAgentSuffix =
        typeof nextMetadata.userAgentSuffix === 'string'
          ? nextMetadata.userAgentSuffix.trim()
          : '';
      nextMetadata.enableNarrowFallbacks = nextMetadata.enableNarrowFallbacks !== false;
      bodyIntegrations.metadata = nextMetadata;
    }
    if (bodyIntegrations?.coverArtArchive) {
      delete bodyIntegrations.coverArtArchive;
    }
    if (bodyIntegrations?.prowlarr) {
      const nextProwlarr: Settings = {
        ...(currentIntegrations.prowlarr || {}),
        ...bodyIntegrations.prowlarr,
      };
      const trimmedUrl = String(nextProwlarr.url || '').trim();
      if (trimmedUrl) {
        const urlValidation = validateExternalUrl(trimmedUrl);
        if (!urlValidation.valid) {
          return res.status(400).json({
            error: `Invalid Prowlarr URL: ${urlValidation.error}`,
          });
        }
        nextProwlarr.url = urlValidation.url!.replace(/\/+$/, '');
      } else {
        nextProwlarr.url = '';
      }
      nextProwlarr.enabled = nextProwlarr.enabled === true;
      nextProwlarr.apiKey =
        typeof nextProwlarr.apiKey === 'string' ? nextProwlarr.apiKey.trim() : '';
      nextProwlarr.categories = Array.isArray(nextProwlarr.categories)
        ? nextProwlarr.categories
            .map((entry: unknown) => Number.parseInt(entry as string, 10))
            .filter((entry: number) => Number.isFinite(entry) && entry > 0)
        : String(nextProwlarr.categories || '')
            .split(',')
            .map((entry: string) => Number.parseInt(entry.trim(), 10))
            .filter((entry: number) => Number.isFinite(entry) && entry > 0);
      if (nextProwlarr.categories.length === 0) {
        nextProwlarr.categories = [3000];
      }
      const maxResults = Number.parseInt(String(nextProwlarr.maxResults), 10);
      nextProwlarr.maxResults = Number.isFinite(maxResults)
        ? Math.min(200, Math.max(10, maxResults))
        : 60;
      const indexers: Settings =
        nextProwlarr.indexers && typeof nextProwlarr.indexers === 'object'
          ? nextProwlarr.indexers
          : {};
      nextProwlarr.indexers = Object.fromEntries(
        Object.entries(indexers)
          .map(([id, entry]: [string, Settings]) => {
            const parsedId = Number.parseInt(id, 10);
            if (!Number.isFinite(parsedId)) return null;
            const priority = Number.parseInt(entry?.priority, 10);
            return [
              String(parsedId),
              {
                enabled: entry?.enabled !== false,
                priority: Number.isFinite(priority) ? Math.min(1000, Math.max(1, priority)) : 25,
              },
            ];
          })
          .filter(Boolean) as [string, Settings][],
      );
      bodyIntegrations.prowlarr = nextProwlarr;
    }
    if (bodyIntegrations?.nzbget) {
      const nextNzbget: Settings = {
        ...(currentIntegrations.nzbget || {}),
        ...bodyIntegrations.nzbget,
      };
      const trimmedUrl = String(nextNzbget.url || '').trim();
      if (trimmedUrl) {
        const urlValidation = validateExternalUrl(trimmedUrl);
        if (!urlValidation.valid) {
          return res.status(400).json({
            error: `Invalid NZBGet URL: ${urlValidation.error}`,
          });
        }
        nextNzbget.url = urlValidation.url!.replace(/\/+$/, '');
      } else {
        nextNzbget.url = '';
      }
      nextNzbget.enabled = nextNzbget.enabled === true;
      nextNzbget.username =
        typeof nextNzbget.username === 'string' ? nextNzbget.username.trim() : '';
      nextNzbget.password =
        typeof nextNzbget.password === 'string' ? nextNzbget.password : '';
      nextNzbget.category = String(nextNzbget.category || 'aurral').trim() || 'aurral';
      const priority = Number.parseInt(String(nextNzbget.priority), 10);
      nextNzbget.priority = Number.isFinite(priority)
        ? Math.min(1000, Math.max(1, priority))
        : 20;
      const nzbPriority = Number.parseInt(String(nextNzbget.nzbPriority), 10);
      nextNzbget.nzbPriority = Number.isFinite(nzbPriority)
        ? Math.min(900, Math.max(-100, nzbPriority))
        : 0;
      nextNzbget.addPaused = nextNzbget.addPaused === true;
      nextNzbget.completedPath =
        typeof nextNzbget.completedPath === 'string' ? nextNzbget.completedPath.trim() : '';
      bodyIntegrations.nzbget = nextNzbget;
    }
    if (bodyIntegrations?.slskd) {
      const slskdPriority = Number.parseInt(String(bodyIntegrations.slskd.priority), 10);
      bodyIntegrations.slskd.enabled = bodyIntegrations.slskd.enabled !== false;
      bodyIntegrations.slskd.priority = Number.isFinite(slskdPriority)
        ? Math.min(1000, Math.max(1, slskdPriority))
        : 10;
    }
    if (bodyIntegrations?.navidrome) {
      bodyIntegrations.navidrome.m3uPathMode = normalizeM3uPathMode(
        bodyIntegrations.navidrome.m3uPathMode,
      );
      bodyIntegrations.navidrome.pathMappings = normalizeM3uPathMappings(
        bodyIntegrations.navidrome.pathMappings,
      );
    }

    let mergedIntegrations: Settings =
      currentSettings.integrations || defaultData.settings.integrations || {};
    if (bodyIntegrations) {
      mergedIntegrations = {
        ...mergedIntegrations,
        ...bodyIntegrations,
        lidarr: bodyIntegrations.lidarr
          ? {
              ...(mergedIntegrations.lidarr || {}),
              ...bodyIntegrations.lidarr,
            }
          : mergedIntegrations.lidarr,
        navidrome: bodyIntegrations.navidrome
          ? {
              ...(mergedIntegrations.navidrome || {}),
              ...bodyIntegrations.navidrome,
            }
          : mergedIntegrations.navidrome,
        plex: bodyIntegrations.plex
          ? {
              ...(mergedIntegrations.plex || {}),
              ...bodyIntegrations.plex,
              token: bodyIntegrations.plex.token || mergedIntegrations.plex?.token || '',
              clientId:
                bodyIntegrations.plex.clientId || mergedIntegrations.plex?.clientId || '',
            }
          : mergedIntegrations.plex,
        slskd: bodyIntegrations.slskd
          ? {
              ...(mergedIntegrations.slskd || {}),
              ...bodyIntegrations.slskd,
            }
          : mergedIntegrations.slskd,
        prowlarr: bodyIntegrations.prowlarr
          ? {
              ...(mergedIntegrations.prowlarr || {}),
              ...bodyIntegrations.prowlarr,
            }
          : mergedIntegrations.prowlarr,
        nzbget: bodyIntegrations.nzbget
          ? {
              ...(mergedIntegrations.nzbget || {}),
              ...bodyIntegrations.nzbget,
            }
          : mergedIntegrations.nzbget,
        lastfm: bodyIntegrations.lastfm
          ? {
              ...(mergedIntegrations.lastfm || {}),
              ...bodyIntegrations.lastfm,
            }
          : mergedIntegrations.lastfm,
        ticketmaster: bodyIntegrations.ticketmaster
          ? {
              ...(mergedIntegrations.ticketmaster || {}),
              ...bodyIntegrations.ticketmaster,
            }
          : mergedIntegrations.ticketmaster,
        metadata: bodyIntegrations.metadata
          ? {
              ...(mergedIntegrations.metadata || {}),
              ...bodyIntegrations.metadata,
            }
          : mergedIntegrations.metadata,
        search: bodyIntegrations.search
          ? {
              ...(mergedIntegrations.search || {}),
              ...bodyIntegrations.search,
            }
          : mergedIntegrations.search,
        general: bodyIntegrations.general
          ? {
              ...(mergedIntegrations.general || {}),
              ...bodyIntegrations.general,
            }
          : mergedIntegrations.general,
        gotify: bodyIntegrations.gotify
          ? {
              ...(mergedIntegrations.gotify || {}),
              ...bodyIntegrations.gotify,
            }
          : mergedIntegrations.gotify,
        webhooks:
          bodyIntegrations.webhooks !== undefined
            ? bodyIntegrations.webhooks
            : mergedIntegrations.webhooks,
        webhookEvents: bodyIntegrations.webhookEvents
          ? {
              ...(mergedIntegrations.webhookEvents || {}),
              ...bodyIntegrations.webhookEvents,
            }
          : mergedIntegrations.webhookEvents,
      };
    }

    if (mergedIntegrations.coverArtArchive) {
      delete mergedIntegrations.coverArtArchive;
    }

    const updatedSettings: Settings = {
      ...currentSettings,
      quality: quality !== undefined ? quality : currentSettings.quality || 'standard',
      rootFolderPath:
        rootFolderPath !== undefined ? rootFolderPath : currentSettings.rootFolderPath || null,
      downloadFolderPath:
        downloadFolderPath !== undefined
          ? downloadFolderPath
          : currentSettings.downloadFolderPath || null,
      pathMappings:
        pathMappings !== undefined
          ? normalizePathMappings(pathMappings as Settings[])
          : currentSettings.pathMappings || [],
      releaseTypes:
        releaseTypes !== undefined
          ? releaseTypes
          : currentSettings.releaseTypes || defaultData.settings.releaseTypes,
      integrations: mergedIntegrations,
      security:
        bodySecurity !== undefined
          ? {
              ...currentSecurity,
              ...bodySecurity,
              localNetworkBypass: bodySecurity.localNetworkBypass
                ? {
                    ...(currentSecurity.localNetworkBypass ||
                      defaultData.settings.security.localNetworkBypass),
                    ...bodySecurity.localNetworkBypass,
                    enabled: bodySecurity.localNetworkBypass.enabled === true,
                  }
                : currentSecurity.localNetworkBypass ||
                  defaultData.settings.security.localNetworkBypass,
            }
          : currentSecurity || defaultData.settings.security,
      playlistArtwork:
        playlistArtwork !== undefined
          ? {
              ...(currentSettings.playlistArtwork || defaultData.settings.playlistArtwork),
              ...playlistArtwork,
            }
          : currentSettings.playlistArtwork || defaultData.settings.playlistArtwork,
    };

    if (updatedSettings.integrations?.coverArtArchive) {
      delete updatedSettings.integrations.coverArtArchive;
    }
    if (updatedSettings.integrations?.musicbrainz) {
      delete updatedSettings.integrations.musicbrainz;
    }

    dbOps.updateSettings(updatedSettings);
    if (downloadFolderPath !== undefined) {
      const { refreshPlaylistRuntimeRoots } = await import('../services/playlistRuntime.js');
      await refreshPlaylistRuntimeRoots();
    }
    const reconciled = reconcileLocalNetworkBypassSetting().settings;
    const reconciledSecurity: Settings = reconciled?.security || {};
    if (localBypassWasEnabled && reconciledSecurity.localNetworkBypass?.enabled !== true) {
      websocketService.reconcileAuthState();
    }
    res.json(reconciled);
  } catch (error: unknown) {
    console.error('Settings POST error:', error);
    res
      .status(500)
      .json({ error: 'Failed to save settings', message: (error as Error).message });
  }
});

router.get('/logs', async (req: Request, res: Response) => {
  try {
    const { logger } = await import('../services/logger.js');
    const { limit = '100', category, level } = req.query;
    const parsedLimit = parseInt(String(limit), 10);

    const logs = logger.getRecentLogs({
      limit: parsedLimit,
      category: category ? String(category) : undefined,
      level: level ? String(level) : undefined,
    });

    res.json({
      logs,
      count: logs.length,
    });
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to get logs', message: (error as Error).message });
  }
});

router.get('/logs/stats', async (req: Request, res: Response) => {
  try {
    const { logger } = await import('../services/logger.js');
    const stats = logger.getLogStats();
    res.json(stats);
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to get log stats', message: (error as Error).message });
  }
});

router.get('/tasks', noCache, async (_req: Request, res: Response) => {
  try {
    const { getHonkerTaskStatus } = await import('../services/honkerTaskStatus.js');
    res.json(await getHonkerTaskStatus());
  } catch (error: unknown) {
    res.status(500).json({
      error: 'Failed to get task status',
      message: (error as Error).message,
    });
  }
});

router.post('/tasks/clear-stale', noCache, async (_req: Request, res: Response) => {
  try {
    const { clearStaleHonkerJobs, getHonkerTaskStatus } =
      await import('../services/honkerTaskStatus.js');
    const result = await clearStaleHonkerJobs();
    res.json({
      ...result,
      tasks: await getHonkerTaskStatus(),
    });
  } catch (error: unknown) {
    res.status(500).json({
      error: 'Failed to clear stuck jobs',
      message: (error as Error).message,
    });
  }
});

router.get('/lidarr/profiles', async (req: Request, res: Response) => {
  try {
    const { lidarrClient } = await import('../services/lidarrClient.js');

    const testUrl = String(req.query.url || '');
    const testApiKey = String(req.query.apiKey || '');

    let url: string;
    let apiKey: string;
    if (testUrl && testApiKey) {
      url = testUrl.trim();
      apiKey = testApiKey.trim();
    } else {
      lidarrClient.updateConfig();
      const config = lidarrClient.getConfig();
      url = config.url;
      apiKey = config.apiKey;
    }

    if (!url || !apiKey) {
      return res.status(400).json({
        error: 'Lidarr not configured',
        message: 'Please configure Lidarr URL and API key in settings first',
      });
    }
    const urlValidation = validateExternalUrl(url);
    if (!urlValidation.valid) {
      return res.status(400).json({ error: urlValidation.error });
    }
    url = urlValidation.url!;

    const originalConfig = { ...(lidarrClient as Settings).config };
    const originalApiPath = (lidarrClient as Settings).apiPath;

    (lidarrClient as Settings).config = {
      url: url!.replace(/\/+$/, ''),
      apiKey: apiKey.trim(),
    };
    (lidarrClient as Settings).apiPath = '/api/v1';

    try {
      const profiles = await lidarrClient.getQualityProfiles(true);
      res.json(profiles);
    } finally {
      (lidarrClient as Settings).config = originalConfig;
      (lidarrClient as Settings).apiPath = originalApiPath;
      lidarrClient.updateConfig();
    }
  } catch (error: unknown) {
    console.error('[Settings] Failed to fetch Lidarr profiles:', error);
    const err = error as Settings;
    res.status(500).json({
      error: 'Failed to fetch Lidarr quality profiles',
      message: err.message,
      details: err.response?.data,
    });
  }
});

router.get('/lidarr/metadata-profiles', async (req: Request, res: Response) => {
  try {
    const { lidarrClient } = await import('../services/lidarrClient.js');

    const testUrl = String(req.query.url || '');
    const testApiKey = String(req.query.apiKey || '');

    let url: string;
    let apiKey: string;
    if (testUrl && testApiKey) {
      url = testUrl.trim();
      apiKey = testApiKey.trim();
    } else {
      lidarrClient.updateConfig();
      const config = lidarrClient.getConfig();
      url = config.url;
      apiKey = config.apiKey;
    }

    if (!url || !apiKey) {
      return res.status(400).json({
        error: 'Lidarr not configured',
        message: 'Please configure Lidarr URL and API key in settings first',
      });
    }
    const urlValidation = validateExternalUrl(url);
    if (!urlValidation.valid) {
      return res.status(400).json({ error: urlValidation.error });
    }
    url = urlValidation.url!;

    const originalConfig = { ...(lidarrClient as Settings).config };
    const originalApiPath = (lidarrClient as Settings).apiPath;

    (lidarrClient as Settings).config = {
      url: url!.replace(/\/+$/, ''),
      apiKey: apiKey.trim(),
    };
    (lidarrClient as Settings).apiPath = '/api/v1';

    try {
      const profiles = await lidarrClient.getMetadataProfiles(true);
      res.json(profiles);
    } finally {
      (lidarrClient as Settings).config = originalConfig;
      (lidarrClient as Settings).apiPath = originalApiPath;
      lidarrClient.updateConfig();
    }
  } catch (error: unknown) {
    console.error('[Settings] Failed to fetch Lidarr metadata profiles:', error);
    const err = error as Settings;
    res.status(500).json({
      error: 'Failed to fetch Lidarr metadata profiles',
      message: err.message,
      details: err.response?.data,
    });
  }
});

router.get('/lidarr/tags', async (req: Request, res: Response) => {
  try {
    const { lidarrClient } = await import('../services/lidarrClient.js');

    const testUrl = String(req.query.url || '');
    const testApiKey = String(req.query.apiKey || '');

    let url: string;
    let apiKey: string;
    if (testUrl && testApiKey) {
      url = testUrl.trim();
      apiKey = testApiKey.trim();
    } else {
      lidarrClient.updateConfig();
      const config = lidarrClient.getConfig();
      url = config.url;
      apiKey = config.apiKey;
    }

    if (!url || !apiKey) {
      return res.status(400).json({
        error: 'Lidarr not configured',
        message: 'Please configure Lidarr URL and API key in settings first',
      });
    }
    const urlValidation = validateExternalUrl(url);
    if (!urlValidation.valid) {
      return res.status(400).json({ error: urlValidation.error });
    }
    url = urlValidation.url!;

    const originalConfig = { ...(lidarrClient as Settings).config };
    const originalApiPath = (lidarrClient as Settings).apiPath;

    (lidarrClient as Settings).config = {
      url: url!.replace(/\/+$/, ''),
      apiKey: apiKey.trim(),
    };
    (lidarrClient as Settings).apiPath = '/api/v1';

    try {
      const tags = await lidarrClient.getTags(true);
      res.json(tags);
    } finally {
      (lidarrClient as Settings).config = originalConfig;
      (lidarrClient as Settings).apiPath = originalApiPath;
      lidarrClient.updateConfig();
    }
  } catch (error: unknown) {
    console.error('[Settings] Failed to fetch Lidarr tags:', error);
    const err = error as Settings;
    res.status(500).json({
      error: 'Failed to fetch Lidarr tags',
      message: err.message,
      details: err.response?.data,
    });
  }
});

router.get('/storage-health', noCache, async (req: Request, res: Response) => {
  try {
    const { runStorageHealthCheck } = await import('../services/storageHealthService.js');
    const force = String(req.query.force || '') === '1' || String(req.query.force || '') === 'true';
    const result = await runStorageHealthCheck({ force });
    res.json({
      success: result.ok,
      ...result,
    });
  } catch (error: unknown) {
    console.error('[Settings] Storage health check error:', error);
    res.status(500).json({
      error: 'Storage health check failed',
      message: (error as Error).message,
    });
  }
});

router.get('/lidarr/test-library-access', async (req: Request, res: Response) => {
  try {
    const { lidarrClient } = await import('../services/lidarrClient.js');
    const {
      resolveLidarrTestCredentials,
      validateLidarrTestCredentials,
      withTemporaryLidarrClient,
    } = await import('../services/lidarrTestSession.js');
    const { runLidarrLibraryAccessTest } = await import(
      '../services/lidarrLibraryAccessTest.js'
    );

    const { url, apiKey } = resolveLidarrTestCredentials(
      req.query as Settings,
       
      lidarrClient as any,
    );
    const validation = validateLidarrTestCredentials(url, apiKey);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const result = await withTemporaryLidarrClient(
      validation.url,
      apiKey,
      (client: unknown) => runLidarrLibraryAccessTest(client as Record<string, unknown>),
    );

    const typedResult = result as Record<string, unknown>;
    res.json({
      success: typedResult.ok,
      ok: typedResult.ok,
      partial: !!typedResult.partial,
      steps: typedResult.steps,
      sample: typedResult.sample,
    });
  } catch (error: unknown) {
    console.error('[Settings] Lidarr library access test error:', error);
    res.status(500).json({
      error: 'Library access check failed',
      message: (error as Error).message,
    });
  }
});

router.get('/lidarr/test', async (req: Request, res: Response) => {
  try {
    const { lidarrClient } = await import('../services/lidarrClient.js');

    const testUrl = String(req.query.url || '');
    const testApiKey = String(req.query.apiKey || '');

    let url: string;
    let apiKey: string;
    if (testUrl && testApiKey) {
      url = testUrl.trim();
      apiKey = testApiKey.trim();
    } else {
      lidarrClient.updateConfig();
      const config = lidarrClient.getConfig();
      url = config.url;
      apiKey = config.apiKey;
    }

    console.log('[Settings] Testing Lidarr connection...', {
      url,
      hasApiKey: !!apiKey,
      apiKeyLength: apiKey?.length || 0,
      usingProvided: !!(testUrl && testApiKey),
    });

    if (!url || !apiKey) {
      return res.status(400).json({ error: 'Lidarr URL and API key are required' });
    }
    const urlValidation = validateExternalUrl(url);
    if (!urlValidation.valid) {
      return res.status(400).json({ error: urlValidation.error });
    }
    url = urlValidation.url!;

    const originalConfig = { ...(lidarrClient as Settings).config };
    const originalApiPath = (lidarrClient as Settings).apiPath;

    (lidarrClient as Settings).config = {
      url: url!.replace(/\/+$/, ''),
      apiKey: apiKey.trim(),
    };
    (lidarrClient as Settings).apiPath = '/api/v1';

    try {
      const result = await lidarrClient.testConnection(true);
      console.log('[Settings] Lidarr test result:', result);

      if (result.connected) {
        res.json({
          success: true,
          message: 'Connection successful',
          version: result.version,
          instanceName: result.instanceName,
          apiPath: result.apiPath,
        });
      } else {
        res.status(400).json({
          error: 'Connection failed',
          message: result.error,
          details: result.details,
          url: result.url,
          fullUrl: result.fullUrl,
          statusCode: result.statusCode,
          apiPath: result.apiPath,
        });
      }
    } finally {
      (lidarrClient as Settings).config = originalConfig;
      (lidarrClient as Settings).apiPath = originalApiPath;
      lidarrClient.updateConfig();
    }
  } catch (error: unknown) {
    console.error('[Settings] Lidarr test error:', error);
    const err = error as Settings;
    res.status(500).json({
      error: 'Connection failed',
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
});

router.post('/gotify/test', async (req: Request, res: Response) => {
  try {
    const { sendGotifyTest } = await import('../services/notificationService.js');
    const body = req.body as Settings;
    const url = String(body.url || '').trim();
    const token = String(body.token || '').trim();
    if (!url || !token) {
      return res.status(400).json({
        error: 'URL and token required',
        message: 'Provide Gotify URL and application token in the request body',
      });
    }
    const urlValidation = validateExternalUrl(url);
    if (!urlValidation.valid) {
      return res.status(400).json({ error: urlValidation.error });
    }
    await sendGotifyTest(urlValidation.url!, token);
    res.json({ success: true, message: 'Test notification sent' });
  } catch (error: unknown) {
    const err = error as Settings;
    if (err.code === 'MISSING_CONFIG') {
      return res.status(400).json({
        error: 'Invalid configuration',
        message: err.message,
      });
    }
    const status = err.response?.status;
    const msg = err.response?.data?.description || err.response?.data?.error || err.message;
    res
      .status(status && status >= 400 ? status : 500)
      .json({ error: 'Gotify test failed', message: msg });
  }
});

router.post('/lidarr/apply-community-guide', async (req: Request, res: Response) => {
  try {
    const { lidarrClient } = await import('../services/lidarrClient.js');
    const { applyLidarrCommunityGuide } = await import('../services/lidarrCommunityGuide.js');

    lidarrClient.updateConfig();
    const config = lidarrClient.getConfig();

    if (!config.url || !config.apiKey) {
      return res.status(400).json({
        error: 'Lidarr not configured',
        message: 'Please configure Lidarr URL and API key in settings first',
      });
    }

    try {
      const results: Settings = await applyLidarrCommunityGuide(lidarrClient as unknown as Record<string, unknown>);

      const currentSettings: Settings = dbOps.getSettings();
      const currentIntegrations: Settings = currentSettings.integrations || {};
      dbOps.updateSettings({
        ...currentSettings,
        integrations: {
          ...currentIntegrations,
          lidarr: {
            ...(currentIntegrations.lidarr || {}),
            qualityProfileId: results.qualityProfile?.id || null,
            metadataProfileId: results.metadataProfile?.id || null,
          },
        },
      });

      res.json({
        success: true,
        message: 'Community guide settings applied successfully',
        results,
      });
    } catch (innerError: unknown) {
      console.error('[Settings] Failed to apply community guide:', innerError);
      const err = innerError as Settings;
      res.status(500).json({
        error: 'Failed to apply community guide settings',
        message: err.message,
        details: err.response?.data,
        partialResults: err.partialResults,
      });
    }
  } catch (error: unknown) {
    console.error('[Settings] Error applying community guide:', error);
    res.status(500).json({
      error: 'Failed to apply community guide settings',
      message: (error as Error).message,
    });
  }
});

router.get('/browse', async (req: Request, res: Response) => {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const target = path.resolve(String(req.query.path || '/'));
    const dirents = await fs.readdir(target, { withFileTypes: true });
    const directories = (
      await Promise.all(
        dirents.map(async (d) => {
          let isDir = d.isDirectory();
          if (!isDir && d.isSymbolicLink()) {
            try {
              isDir = (await fs.stat(path.join(target, d.name))).isDirectory();
            } catch {
              isDir = false;
            }
          }
          return isDir ? { name: d.name, path: path.join(target, d.name) } : null;
        }),
      )
    )
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({
      path: target,
      parent: target === '/' ? null : path.dirname(target),
      directories,
    });
  } catch (error: unknown) {
    res.status(400).json({ error: 'Cannot read path', message: (error as Error).message });
  }
});

function getPlexConfig(): Settings {
  return ((dbOps.getSettings() as Settings).integrations as Settings)?.plex || {};
}

router.post('/plex/auth/pin', async (req: Request, res: Response) => {
  try {
    const { PlexClient } = await import('../services/plex.js');
    const settings: Settings = dbOps.getSettings();
    const integrations: Settings = settings.integrations || {};
    const plex: Settings = integrations.plex || {};
    let clientId = plex.clientId;
    if (!clientId) {
      clientId = PlexClient.generateClientId();
      dbOps.updateSettings({
        ...settings,
        integrations: {
          ...integrations,
          plex: { ...plex, clientId },
        },
      });
    }
    const body = req.body as Settings;
    const { id, code } = await PlexClient.generatePin(clientId);
    const forwardUrl = body.forwardUrl;
    res.json({
      pinId: id,
      code,
      clientId,
      authUrl: PlexClient.buildAuthUrl(clientId, code, forwardUrl),
    });
  } catch (error: unknown) {
    console.error('[Settings] Plex PIN generation failed:', (error as Error).message);
    res.status(500).json({
      error: 'Failed to start Plex authentication',
      message: (error as Error).message,
    });
  }
});

router.post('/plex/auth/check', async (req: Request, res: Response) => {
  try {
    const { PlexClient } = await import('../services/plex.js');
    const body = req.body as Settings;
    const { pinId, code } = body || {};
    if (!pinId || !code) {
      return res.status(400).json({ error: 'pinId and code are required' });
    }
    const clientId = getPlexConfig().clientId;
    if (!clientId) {
      return res.status(400).json({ error: 'Plex client not initialized' });
    }
    const token = await PlexClient.checkPin(pinId, code, clientId);
    if (!token) return res.json({ pending: true });
    res.json({ token });
  } catch (error: unknown) {
    console.error('[Settings] Plex PIN check failed:', (error as Error).message);
    res.status(500).json({
      error: 'Failed to check Plex authentication',
      message: (error as Error).message,
    });
  }
});

router.post('/plex/resources', async (req: Request, res: Response) => {
  try {
    const { PlexClient } = await import('../services/plex.js');
    const stored = getPlexConfig();
    const body = req.body as Settings;
    const token = body.token || stored.token;
    const clientId = stored.clientId;
    if (!token || !clientId) {
      return res.status(400).json({ error: 'Plex authentication required' });
    }
    const { servers, total } = await PlexClient.getResources(token, clientId);
    res.json({ servers, total });
  } catch (error: unknown) {
    const err = error as Settings;
    const status = err.response?.status;
    console.error(
      '[Settings] Plex resources failed:',
      status ? `${status} ${JSON.stringify(err.response?.data)}` : err.message,
    );
    res.status(status === 401 ? 401 : 500).json({
      error: 'Failed to list Plex servers',
      message:
        status === 401
          ? 'Plex rejected the token (401). Reconnect your Plex account.'
          : err.message,
    });
  }
});

router.post('/plex/test', async (req: Request, res: Response) => {
  try {
    const { PlexClient } = await import('../services/plex.js');
    const stored = getPlexConfig();
    const body = req.body as Settings;
    let url = String(body.url || stored.url || '').trim().replace(/\/+$/, '');
    const token = body.token || stored.token;
    const clientId = stored.clientId;
    if (!url || !token) {
      return res.status(400).json({ error: 'Server URL and token are required' });
    }
    const urlValidation = validateExternalUrl(url);
    if (!urlValidation.valid) {
      return res.status(400).json({ error: urlValidation.error });
    }
    url = urlValidation.url!;
    const client = new PlexClient(url, token, clientId);
    const identity = await client.ping();
    res.json({
      success: true,
      message: 'Connection successful',
      machineIdentifier: identity.machineIdentifier,
      version: identity.version,
    });
  } catch (error: unknown) {
    const err = error as Settings;
    res.status(400).json({
      error: 'Connection failed',
      message: err.response?.data || err.message,
    });
  }
});

router.post('/plex/sync', async (req: Request, res: Response) => {
  try {
    const plex = getPlexConfig();
    if (!plex.url || !plex.token) {
      return res.status(400).json({
        error: 'Plex not configured',
        message: 'Connect Plex and save settings before syncing',
      });
    }
    const { playlistManager } = await import('../services/weeklyFlowPlaylistManager.js');
    playlistManager.updateConfig(false);
    const result = await playlistManager.syncPlexNow();
    res.json({ success: true, ...result });
  } catch (error: unknown) {
    console.error('[Settings] Plex sync failed:', (error as Error).message);
    const err = error as Settings;
    res.status(500).json({
      error: 'Plex sync failed',
      message: err.response?.data || err.message,
    });
  }
});

router.post('/logs/level', async (req: Request, res: Response) => {
  try {
    const { logger } = await import('../services/logger.js');
    const body = req.body as Settings;
    const { level, category } = body;

    if (!level) {
      return res.status(400).json({ error: 'level is required' });
    }

    if (category) {
      logger.setCategoryLevel(String(category), String(level));
      res.json({ message: `Log level for ${category} set to ${level}` });
    } else {
      logger.setLevel(String(level));
      res.json({ message: `Global log level set to ${level}` });
    }
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to set log level', message: (error as Error).message });
  }
});

export default router;
