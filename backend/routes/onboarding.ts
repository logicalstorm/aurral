import express from 'express';
import bcrypt from 'bcrypt';
import { dbOps, userOps } from '../config/db-helpers.js';
import { getDefaultListenHistoryProfile } from '../services/listeningHistory.js';
import {
  DEFAULT_METADATA_BASE_URL,
  LEGACY_METADATA_BASE_URL,
} from '../config/constants.js';
import { validateExternalUrl } from '../middleware/urlValidator.js';
import { requirePasswordStrength } from '../middleware/validation.js';
import {
  getSuggestedDownloadFolderPath,
  validateDownloadFolderPath,
} from '../services/downloadFolderConfig.js';

const router = express.Router();

function normalizeMetadataBaseUrl(baseUrl: unknown) {
  const trimmed = String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  return trimmed === LEGACY_METADATA_BASE_URL ? DEFAULT_METADATA_BASE_URL : trimmed;
}

router.use((req, res, next) => {
  const settings = dbOps.getSettings();
  if (settings.onboardingComplete) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Onboarding has already been completed',
    });
  }
  next();
});

router.get('/lidarr/test-library-access', async (req, res) => {
  try {
    const { validateLidarrTestCredentials, withTemporaryLidarrClient } =
      await import('../services/lidarrTestSession.js');
    const { runLidarrLibraryAccessTest } = await import('../services/lidarrLibraryAccessTest.js');

    let url = (String(req.query.url || '')).trim().replace(/\/+$/, '');
    const apiKey = (String(req.query.apiKey || '')).trim();
    const validation = validateLidarrTestCredentials(url, apiKey);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    url = validation.url!;

    const rawResult = await withTemporaryLidarrClient(url, apiKey, (client: unknown) =>
      runLidarrLibraryAccessTest(client as Record<string, unknown>),
    );
    const result = rawResult as Record<string, unknown>;

    res.json({
      success: result.ok,
      ok: result.ok,
      partial: !!result.partial,
      steps: result.steps,
      sample: result.sample,
    });
  } catch (error) {
    res.status(400).json({
      error: 'Library access check failed',
      message: (error as Error).message,
    });
  }
});

router.get('/lidarr/profiles', async (req, res) => {
  try {
    const { validateLidarrTestCredentials, withTemporaryLidarrClient } =
      await import('../services/lidarrTestSession.js');

    let url = (String(req.query.url || '')).trim().replace(/\/+$/, '');
    const apiKey = (String(req.query.apiKey || '')).trim();
    const validation = validateLidarrTestCredentials(url, apiKey);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    url = validation.url!;

    const profiles = await withTemporaryLidarrClient(url, apiKey, (client: unknown) =>
      (client as any).getQualityProfiles(true),
    );

    res.json(profiles);
  } catch (error) {
    res.status(400).json({
      error: 'Failed to fetch Lidarr quality profiles',
      message: (error as Error).message,
    });
  }
});

router.get('/lidarr/metadata-profiles', async (req, res) => {
  try {
    const { validateLidarrTestCredentials, withTemporaryLidarrClient } =
      await import('../services/lidarrTestSession.js');

    let url = (String(req.query.url || '')).trim().replace(/\/+$/, '');
    const apiKey = (String(req.query.apiKey || '')).trim();
    const validation = validateLidarrTestCredentials(url, apiKey);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    url = validation.url!;

    const profiles = await withTemporaryLidarrClient(url, apiKey, (client: unknown) =>
      (client as any).getMetadataProfiles(true),
    );

    res.json(profiles);
  } catch (error) {
    res.status(400).json({
      error: 'Failed to fetch Lidarr metadata profiles',
      message: (error as Error).message,
    });
  }
});

router.get('/lidarr/test', async (req, res) => {
  try {
    const { lidarrClient } = await import('../services/lidarrClient.js');
    let url = (String(req.query.url || '')).trim().replace(/\/+$/, '');
    const apiKey = (String(req.query.apiKey || '')).trim();
    if (!url || !apiKey) {
      return res.status(400).json({ error: 'URL and API key are required' });
    }
    const urlValidation = validateExternalUrl(url);
    if (!urlValidation.valid) {
      return res.status(400).json({ error: urlValidation.error });
    }
    url = urlValidation.url!;
    const lc = lidarrClient as any;
    const originalConfig = { ...lc.config };
    const originalApiPath = lc.apiPath;
    lc.config = { url, apiKey };
    lc.apiPath = '/api/v1';
    try {
      const result = await lidarrClient.testConnection(true);
      if (result.connected) {
        res.json({ success: true, message: 'Connection successful' });
      } else {
        res.status(400).json({ error: result.error || 'Connection failed' });
      }
    } finally {
      lc.config = originalConfig;
      lc.apiPath = originalApiPath;
    }
  } catch (error) {
    res.status(400).json({
      error: 'Connection failed',
      message: (error as Error).message,
    });
  }
});

router.post('/navidrome/test', async (req, res) => {
  try {
    const { NavidromeClient } = await import('../services/navidrome.js');
    let url = (String((req.body as Record<string, unknown>)?.url || '')).trim().replace(/\/+$/, '');
    const username = (String((req.body as Record<string, unknown>)?.username || '')).trim();
    const password = (req.body as Record<string, unknown>)?.password ?? '';
    if (!url || !username || !password) {
      return res.status(400).json({
        error: 'URL, username, and password are required',
      });
    }
    const urlValidation = validateExternalUrl(url);
    if (!urlValidation.valid) {
      return res.status(400).json({ error: urlValidation.error });
    }
    url = urlValidation.url!;
    const client = new NavidromeClient(url, username, String(password));
    await client.ping();
    res.json({ success: true, message: 'Connection successful' });
  } catch (error) {
    res.status(400).json({
      error: 'Connection failed',
      message: (error as Error).message,
    });
  }
});

router.post('/lidarr/apply-community-guide', async (req, res) => {
  try {
    const { applyLidarrCommunityGuide } = await import('../services/lidarrCommunityGuide.js');
    const { validateLidarrTestCredentials, withTemporaryLidarrClient } =
      await import('../services/lidarrTestSession.js');

    const body = req.body as Record<string, unknown>;
    let url = (String(body?.url || '')).trim().replace(/\/+$/, '');
    const apiKey = (String(body?.apiKey || '')).trim();
    const validation = validateLidarrTestCredentials(url, apiKey);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    url = validation.url!;

    const results = await withTemporaryLidarrClient(url, apiKey, (client: unknown) =>
      applyLidarrCommunityGuide(client as Record<string, unknown>),
    );

    res.json({
      success: true,
      message: 'Community guide settings applied successfully',
      results,
    });
  } catch (error) {
    console.error('Onboarding community guide error:', error);
    const err = error as Record<string, unknown> & Error;
    res.status(500).json({
      error: 'Failed to apply community guide settings',
      message: err.message,
      details: (err as any).response?.data,
    });
  }
});

router.post('/slskd/test', async (req, res) => {
  try {
    const { testSlskdWithCredentials } = await import('../services/slskdClient.js');
    const body = req.body as Record<string, unknown>;
    const url = (String(body?.url || '')).trim();
    const apiKey = (String(body?.apiKey || '')).trim();
    const result = await testSlskdWithCredentials(url, apiKey);
    if (!result.configured) {
      return res.status(400).json(result);
    }
    if (!result.ok) {
      return res.status(502).json(result);
    }
    return res.json({
      success: true,
      warning: result.warning === true,
      ...result,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'slskd test failed',
      message: (error as Error).message,
    });
  }
});

router.post('/complete', async (req, res) => {
  try {
    const body = req.body as Record<string, unknown> | undefined;
    const {
      authUser,
      authPassword,
      lidarr,
      metadata,
      navidrome,
      lastfm,
      slskd,
      ticketmaster,
      downloadFolderPath,
    } = (body || {}) as Record<string, unknown>;
    if (authPassword != null && String(authPassword).length > 0) {
      const passwordValidation = requirePasswordStrength(authPassword as string);
      if (!passwordValidation.valid) {
        return res.status(400).json({ error: passwordValidation.error });
      }
    }

    const current = dbOps.getSettings() as Record<string, unknown>;
    const currentIntegrations = (current.integrations || {}) as Record<string, Record<string, unknown>>;
    const lidarrObj = (lidarr || {}) as Record<string, unknown>;
    const metadataObj = (metadata || {}) as Record<string, unknown>;
    const navidromeObj = (navidrome || {}) as Record<string, unknown>;
    const lastfmObj = (lastfm || {}) as Record<string, unknown>;
    const slskdObj = (slskd || {}) as Record<string, unknown>;
    const ticketmasterObj = (ticketmaster || {}) as Record<string, unknown>;
    const integrations: Record<string, Record<string, unknown>> = {
      ...currentIntegrations,
      general: {
        ...(currentIntegrations.general || {}),
        authUser:
          authUser != null
            ? String(authUser).trim()
            : currentIntegrations.general?.authUser || 'admin',
        authPassword:
          authPassword != null
            ? String(authPassword)
            : currentIntegrations.general?.authPassword || '',
      },
      lidarr:
        lidarrObj && (lidarrObj.url || lidarrObj.apiKey)
          ? {
              ...(currentIntegrations.lidarr || {}),
              ...lidarrObj,
              qualityProfileId:
                lidarrObj.qualityProfileId != null
                  ? parseInt(String(lidarrObj.qualityProfileId), 10) || null
                  : (currentIntegrations.lidarr?.qualityProfileId ?? null),
              metadataProfileId:
                lidarrObj.metadataProfileId != null
                  ? parseInt(String(lidarrObj.metadataProfileId), 10) || null
                  : (currentIntegrations.lidarr?.metadataProfileId ?? null),
              defaultMonitorOption:
                lidarrObj.defaultMonitorOption != null
                  ? String(lidarrObj.defaultMonitorOption)
                  : currentIntegrations.lidarr?.defaultMonitorOption || 'none',
              searchOnAdd: lidarrObj.searchOnAdd === true,
            }
          : currentIntegrations.lidarr,
      metadata:
        metadataObj && (metadataObj.baseUrl || metadataObj.userAgentSuffix)
          ? {
              ...(currentIntegrations.metadata || {}),
              provider: 'brainzmash' as string,
              baseUrl: normalizeMetadataBaseUrl(
                metadataObj.baseUrl != null
                  ? String(metadataObj.baseUrl).trim().replace(/\/+$/, '')
                  : currentIntegrations.metadata?.baseUrl || DEFAULT_METADATA_BASE_URL,
              ),
              userAgentSuffix:
                metadataObj.userAgentSuffix != null
                  ? String(metadataObj.userAgentSuffix).trim()
                  : currentIntegrations.metadata?.userAgentSuffix || '',
              enableNarrowFallbacks: metadataObj.enableNarrowFallbacks !== false,
            }
          : currentIntegrations.metadata,
      navidrome:
        navidromeObj && (navidromeObj.url || navidromeObj.username)
          ? { ...(currentIntegrations.navidrome || {}), ...navidromeObj }
          : currentIntegrations.navidrome,
      lastfm:
        lastfmObj && (lastfmObj.apiKey || lastfmObj.username)
          ? {
              ...(currentIntegrations.lastfm || {}),
              apiKey:
                lastfmObj.apiKey != null
                  ? String(lastfmObj.apiKey).trim()
                  : (currentIntegrations.lastfm?.apiKey ?? ''),
              username:
                lastfmObj.username != null
                  ? String(lastfmObj.username).trim()
                  : (currentIntegrations.lastfm?.username ?? ''),
            }
          : currentIntegrations.lastfm,
      slskd:
        slskdObj && (slskdObj.url || slskdObj.apiKey)
          ? { ...(currentIntegrations.slskd || {}), ...slskdObj }
          : currentIntegrations.slskd,
      ticketmaster:
        ticketmasterObj && ticketmasterObj.apiKey
          ? {
              ...(currentIntegrations.ticketmaster || {}),
              apiKey:
                ticketmasterObj.apiKey != null
                  ? String(ticketmasterObj.apiKey).trim()
                  : (currentIntegrations.ticketmaster?.apiKey ?? ''),
              searchRadiusMiles:
                ticketmasterObj.searchRadiusMiles != null
                  ? Math.max(5, Math.min(250, Math.floor(Number(ticketmasterObj.searchRadiusMiles))))
                  : (currentIntegrations.ticketmaster?.searchRadiusMiles ?? 250),
            }
          : currentIntegrations.ticketmaster,
    };

    const nextSettings: Record<string, unknown> = {
      ...current,
      integrations,
      onboardingComplete: true,
    };
    if (downloadFolderPath !== undefined) {
      const validation = validateDownloadFolderPath(downloadFolderPath, undefined, {
        create: true,
      });
      if (!validation.valid) {
        return res.status(400).json({
          error: validation.error,
          message: validation.error,
        });
      }
      nextSettings.downloadFolderPath = validation.path;
    } else if (!current.downloadFolderPath) {
      const validation = validateDownloadFolderPath(getSuggestedDownloadFolderPath(), undefined, {
        create: true,
      });
      if (!validation.valid) {
        return res.status(400).json({
          error: 'download_folder_required',
          message: 'Choose a downloads folder before completing onboarding.',
        });
      }
      nextSettings.downloadFolderPath = validation.path;
    }
    dbOps.updateSettings(nextSettings);
    const { refreshPlaylistRuntimeRoots } = await import('../services/playlistRuntime.js');
    await refreshPlaylistRuntimeRoots();

    const authUserFinal = String(integrations?.general?.authUser || 'admin');
    const authPasswordFinal = String(integrations?.general?.authPassword || '');
    if (authPasswordFinal && userOps.getAllUsers().length === 0) {
      const hash = bcrypt.hashSync(authPasswordFinal, 10);
      const created = userOps.createUser(authUserFinal, hash, 'admin', null);
      const initialListenHistory = getDefaultListenHistoryProfile(nextSettings);
      if (created && initialListenHistory) {
        userOps.updateUser(Number(created.id), initialListenHistory as Record<string, unknown>);
      }
    }

    const hasLastfm = integrations?.lastfm?.apiKey && integrations?.lastfm?.username;
    const hasLidarr = !!integrations?.lidarr?.apiKey;
    if (hasLastfm || hasLidarr) {
      const { requestDiscoveryRefresh } = await import('../services/discoveryRefreshScheduler.js');
      requestDiscoveryRefresh({ reason: 'onboarding' } as Record<string, unknown>);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Onboarding complete error:', error);
    res.status(500).json({
      error: 'Failed to save onboarding',
      message: (error as Error).message,
    });
  }
});

export default router;
