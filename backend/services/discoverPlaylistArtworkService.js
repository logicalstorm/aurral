import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getArtworkContentTypeForExtension,
  getArtworkExtensionForStyle,
  getPlaylistArtworkStyle,
  writeGeneratedPlaylistArtwork,
} from "./playlistArtworkGenerator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = path.join(__dirname, "..", "data");
const DATA_DIR = process.env.AURRAL_DATA_DIR
  ? path.resolve(process.env.AURRAL_DATA_DIR)
  : DEFAULT_DATA_DIR;
const DISCOVER_ARTWORK_DIR = path.join(DATA_DIR, "discover-artwork");

const sanitizePresetId = (presetId) =>
  String(presetId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "playlist";

export function getDiscoverArtworkDirectory() {
  return DISCOVER_ARTWORK_DIR;
}

export function getDiscoverArtworkFilePath(presetId, style = null) {
  const resolvedStyle = style || getPlaylistArtworkStyle();
  const extension = getArtworkExtensionForStyle(resolvedStyle);
  return path.join(
    DISCOVER_ARTWORK_DIR,
    `${sanitizePresetId(presetId)}${extension}`,
  );
}

export async function ensureDiscoverArtworkDirectory() {
  await fs.mkdir(DISCOVER_ARTWORK_DIR, { recursive: true });
}

export async function generateDiscoverPlaylistArtwork(playlist, options = {}) {
  const presetId = String(playlist?.presetId || "").trim();
  const title = String(playlist?.name || "").trim() || "Untitled";
  if (!presetId) return null;

  const style = options.style || getPlaylistArtworkStyle();
  await ensureDiscoverArtworkDirectory();
  const outputPath = getDiscoverArtworkFilePath(presetId, style);
  return writeGeneratedPlaylistArtwork({
    outputPath,
    title,
    kind: "Flow",
    signature: presetId,
    relatedArtists: playlist?.relatedArtists || [],
    style,
  });
}

export async function attachArtworkToDiscoverPlaylists(playlists = []) {
  const list = Array.isArray(playlists) ? playlists : [];
  if (list.length === 0) return list;

  const style = getPlaylistArtworkStyle();
  await ensureDiscoverArtworkDirectory();

  const enriched = [];
  for (const playlist of list) {
    if (!playlist?.presetId || playlist.trackCount <= 0) {
      enriched.push(playlist);
      continue;
    }
    try {
      await generateDiscoverPlaylistArtwork(playlist, { style });
      enriched.push({
        ...playlist,
        artworkStyle: style,
        hasArtwork: true,
      });
    } catch (error) {
      console.warn(
        `[DiscoverArtwork] Failed for ${playlist.presetId}: ${error.message}`,
      );
      enriched.push({
        ...playlist,
        artworkStyle: style,
        hasArtwork: false,
      });
    }
  }

  return enriched;
}

export async function resolveDiscoverArtworkFile(presetId) {
  const sanitized = sanitizePresetId(presetId);
  if (!sanitized) return null;

  const candidates = [
    path.join(DISCOVER_ARTWORK_DIR, `${sanitized}.jpg`),
    path.join(DISCOVER_ARTWORK_DIR, `${sanitized}.webp`),
    path.join(DISCOVER_ARTWORK_DIR, `${sanitized}.png`),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      const extension = path.extname(candidate).toLowerCase();
      return {
        safePath: candidate,
        extension,
        contentType: getArtworkContentTypeForExtension(extension),
      };
    } catch {}
  }

  return null;
}

export async function ensureDiscoverArtworkForPreset(presetId, { user } = {}) {
  const existing = await resolveDiscoverArtworkFile(presetId);
  if (existing) return existing;

  const { getDiscoveryCache } = await import("./discoveryService.js");
  const { getListenHistoryProfile } = await import("./listeningHistory.js");
  const { getCachedDiscoverPlaylist } =
    await import("./discoverPlaylistService.js");

  const profile = user ? getListenHistoryProfile(user) : null;
  const cache = getDiscoveryCache(profile);
  const playlist = getCachedDiscoverPlaylist(cache, presetId);
  if (!playlist || playlist.trackCount <= 0) return null;

  try {
    await generateDiscoverPlaylistArtwork(playlist);
    return resolveDiscoverArtworkFile(presetId);
  } catch (error) {
    console.warn(
      `[DiscoverArtwork] Lazy generate failed for ${presetId}: ${error.message}`,
    );
    return null;
  }
}
