import { dbOps } from "../../db/helpers/index.js";
import { getMetadataBaseUrl, getMetadataProviderHealthSnapshot as getBrainzmashHealthSnapshot } from "../providers/brainzmashProvider.js";

export const getLastfmApiKey = () => {
  const settings = dbOps.getSettings();
  return settings.integrations?.lastfm?.apiKey || process.env.LASTFM_API_KEY;
};

export const getTicketmasterApiKey = () => {
  const settings = dbOps.getSettings();
  const configuredValue = settings.integrations?.ticketmaster?.apiKey;
  if (configuredValue !== undefined && configuredValue !== null) {
    return String(configuredValue).trim();
  }
  return String(process.env.TICKETMASTER_API_KEY || "").trim();
};

export const getMusicBrainzContact = () => {
  const settings = dbOps.getSettings();
  return (
    settings.integrations?.musicbrainz?.email ||
    process.env.CONTACT_EMAIL ||
    "user@example.com"
  );
};

export const getMusicbrainzApiBaseUrl = () => {
  return getMetadataBaseUrl();
};

export const getMusicbrainzApiBaseUrls = () => {
  return [getMusicbrainzApiBaseUrl()];
};

export const getMetadataProviderHealthSnapshot = () => {
  return getBrainzmashHealthSnapshot();
};

export const __setMetadataProviderHealthStateForTests = () => {};
