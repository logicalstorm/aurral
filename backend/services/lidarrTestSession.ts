import { validateExternalUrl } from '../middleware/urlValidator.js';

export function resolveLidarrTestCredentials(query: Record<string, unknown> = {}, configuredClient: Record<string, unknown> | null = null) {
  const testUrl = String(query.url || '').trim();
  const testApiKey = String(query.apiKey || '').trim();
  if (testUrl && testApiKey) {
    return { url: testUrl, apiKey: testApiKey, usingProvided: true };
  }
  ((configuredClient as any).updateConfig as (() => void) | undefined)?.();
  const config = ((configuredClient as any).getConfig as (() => Record<string, unknown>) | undefined)?.() || {};
  return {
    url: String(config.url || '').trim(),
    apiKey: String(config.apiKey || '').trim(),
    usingProvided: false,
  };
}

export function validateLidarrTestCredentials(url: unknown, apiKey: unknown) {
  if (!url || !apiKey) {
    return { valid: false, error: 'Lidarr URL and API key are required' };
  }
  const urlValidation = validateExternalUrl(String(url));
  if (!urlValidation.valid) {
    return { valid: false, error: urlValidation.error };
  }
  return { valid: true, url: (urlValidation.url || '').replace(/\/+$/, '') };
}

export async function withTemporaryLidarrClient(url: unknown, apiKey: unknown, fn: (client: unknown) => unknown | Promise<unknown>) {
  const { lidarrClient } = await import('./lidarrClient.js');
  const client = lidarrClient as unknown as Record<string, unknown>;
  const originalConfig = { ...(client.config as Record<string, unknown>) };
  const originalApiPath = client.apiPath;
  const originalHoldConfig = client._holdConfig;

  client._holdConfig = true;
  client.config = {
    url: String(url).replace(/\/+$/, ''),
    apiKey: String(apiKey).trim(),
    insecure: (originalConfig as Record<string, unknown>).insecure,
    timeoutMs: (originalConfig as Record<string, unknown>).timeoutMs,
    circuitDisabled: true,
  };
  client.apiPath = '/api/v1';

  try {
    return await fn(lidarrClient);
  } finally {
    client._holdConfig = originalHoldConfig;
    client.config = originalConfig;
    client.apiPath = originalApiPath;
    (lidarrClient as unknown as { updateConfig: () => void }).updateConfig();
  }
}
