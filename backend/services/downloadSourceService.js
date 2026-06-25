import { dbOps } from "../db/helpers/index.js";
import { slskdClient } from "./slskdClient.js";
import { prowlarrClient } from "./prowlarrClient.js";
import { nzbgetClient } from "./nzbgetClient.js";
import { sabnzbdClient } from "./sabnzbdClient.js";

const SOURCE_LABELS = {
  slskd: "Soulseek",
  usenet: "Usenet",
};

function normalizePriority(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function getIntegrations() {
  return dbOps.getSettings()?.integrations || {};
}

function isSlskdEnabled() {
  const slskd = getIntegrations().slskd || {};
  return slskd.enabled !== false;
}

function getSlskdPriority() {
  const slskd = getIntegrations().slskd || {};
  return normalizePriority(slskd.priority, 10);
}

function getUsenetPriority() {
  const integrations = getIntegrations();
  if (sabnzbdClient.isConfigured()) {
    return normalizePriority(integrations.sabnzbd?.priority, 20);
  }
  return normalizePriority(integrations.nzbget?.priority, 20);
}

export function getDownloadSourceStatus() {
  const slskdConfigured = isSlskdEnabled() && slskdClient.isConfigured();
  const prowlarrConfigured = prowlarrClient.isConfigured();
  const nzbgetConfigured = nzbgetClient.isConfigured();
  const sabnzbdConfigured = sabnzbdClient.isConfigured();
  const usenetConfigured = prowlarrConfigured && (nzbgetConfigured || sabnzbdConfigured);
  return {
    slskd: {
      id: "slskd",
      label: SOURCE_LABELS.slskd,
      enabled: isSlskdEnabled(),
      configured: slskdConfigured,
      priority: getSlskdPriority(),
    },
    usenet: {
      id: "usenet",
      label: SOURCE_LABELS.usenet,
      enabled: usenetConfigured,
      configured: usenetConfigured,
      priority: getUsenetPriority(),
      prowlarrConfigured,
      nzbgetConfigured,
      sabnzbdConfigured,
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
  if (!status.slskd.configured) pieces.push("slskd");
  if (!status.usenet.configured) pieces.push("Prowlarr + NZBGet or SABnzbd");
  return `No download source is configured. Configure ${pieces.join(" or ")} in Settings > Integrations to enable downloads for flows and playlists.`;
}

export function getSourceLabel(sourceId) {
  return SOURCE_LABELS[String(sourceId || "")] || String(sourceId || "download source");
}
