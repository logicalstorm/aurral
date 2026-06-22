import { dbOps } from '../config/db-helpers.js';
import { slskdClient } from './slskdClient.js';
import { prowlarrClient } from './prowlarrClient.js';
import { nzbgetClient } from './nzbgetClient.js';

const SOURCE_LABELS = {
  slskd: 'Soulseek',
  usenet: 'Usenet',
};

function normalizePriority(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function getIntegrations(): Record<string, unknown> {
  return ((dbOps.getSettings() as Record<string, unknown>)?.integrations as Record<string, unknown>) || {};
}

function isSlskdEnabled() {
  const slskd = (getIntegrations()?.slskd || {}) as Record<string, unknown>;
  return slskd.enabled !== false;
}

function getSlskdPriority() {
  const slskd = (getIntegrations()?.slskd || {}) as Record<string, unknown>;
  return normalizePriority(slskd.priority, 10);
}

function getUsenetPriority() {
  const nzbget = (getIntegrations()?.nzbget || {}) as Record<string, unknown>;
  return normalizePriority(nzbget.priority, 20);
}

export function getDownloadSourceStatus() {
  const slskdConfigured = isSlskdEnabled() && slskdClient.isConfigured();
  const prowlarrConfigured = prowlarrClient.isConfigured();
  const nzbgetConfigured = nzbgetClient.isConfigured();
  return {
    slskd: {
      id: 'slskd',
      label: SOURCE_LABELS.slskd,
      enabled: isSlskdEnabled(),
      configured: slskdConfigured,
      priority: getSlskdPriority(),
    },
    usenet: {
      id: 'usenet',
      label: SOURCE_LABELS.usenet,
      enabled: prowlarrConfigured && nzbgetConfigured,
      configured: prowlarrConfigured && nzbgetConfigured,
      priority: getUsenetPriority(),
      prowlarrConfigured,
      nzbgetConfigured,
    },
  };
}

export function getEnabledDownloadSources() {
  const status = getDownloadSourceStatus();
  const sources = [];
  if (status.slskd.configured) sources.push(status.slskd);
  if (status.usenet.configured) sources.push(status.usenet);
  return sources.sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    return left.id.localeCompare(right.id);
  });
}

export function isAnyDownloadSourceConfigured() {
  return getEnabledDownloadSources().length > 0;
}

export function getDownloadSourceNotConfiguredMessage() {
  const status = getDownloadSourceStatus();
  const pieces = [];
  if (!status.slskd.configured) pieces.push('slskd');
  if (!status.usenet.configured) pieces.push('Prowlarr + NZBGet');
  return `No download source is configured. Configure ${pieces.join(' or ')} in Settings > Integrations to enable downloads for flows and playlists.`;
}

export function getSourceLabel(sourceId: string) {
  return SOURCE_LABELS[sourceId as keyof typeof SOURCE_LABELS] || String(sourceId || 'download source');
}
