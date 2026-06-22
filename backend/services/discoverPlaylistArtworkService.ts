import fs from 'node:fs/promises';
import path from 'node:path';
import { isFixedDiscoverPlaylistPreset } from '../config/discoverPlaylistPresets.js';
import {
  getArtworkContentTypeForExtension,
  getArtworkExtensionForStyle,
  getPlaylistArtworkStyle,
  writeGeneratedPlaylistArtwork,
} from './playlistArtworkGenerator.js';
import { resolveAurralDataDir } from '../config/data-dir.js';

const DATA_DIR = resolveAurralDataDir();
const DISCOVER_ARTWORK_DIR = path.join(DATA_DIR, 'discover-artwork');

const sanitizePresetId = (presetId: unknown): string =>
  String(presetId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'playlist';

export function getDiscoverArtworkDirectory() {
  return DISCOVER_ARTWORK_DIR;
}

export function getDiscoverArtworkFilePath(presetId: unknown, style: unknown = null) {
  const resolvedStyle = (style as string) || getPlaylistArtworkStyle();
  const extension = getArtworkExtensionForStyle(resolvedStyle);
  return path.join(DISCOVER_ARTWORK_DIR, `${sanitizePresetId(presetId)}${extension}`);
}

export async function ensureDiscoverArtworkDirectory() {
  await fs.mkdir(DISCOVER_ARTWORK_DIR, { recursive: true });
}

export async function pruneObsoleteDiscoverArtwork(presetIds: unknown[] = []) {
  await ensureDiscoverArtworkDirectory();

  const validBasenames = new Set(
    (Array.isArray(presetIds) ? presetIds : [])
      .map((presetId) => sanitizePresetId(presetId))
      .filter(Boolean),
  );
  const artworkExtensions = new Set(['.jpg', '.webp', '.png']);
  const files = await fs.readdir(DISCOVER_ARTWORK_DIR).catch(() => []);
  let removed = 0;

  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    if (!artworkExtensions.has(extension)) continue;

    const basename = path.basename(file, extension);
    if (validBasenames.has(basename)) continue;

    const candidatePath = path.join(DISCOVER_ARTWORK_DIR, file);
    try {
      await fs.unlink(candidatePath);
      removed += 1;
    } catch {}
  }

  return removed;
}

export async function generateDiscoverPlaylistArtwork(playlist: Record<string, unknown> | null | undefined, options: Record<string, unknown> = {}) {
  const presetId = String(playlist?.presetId || '').trim();
  const title = String(playlist?.name || '').trim() || 'Untitled';
  if (!presetId) return null;

  const style = (options.style as string) || getPlaylistArtworkStyle();
  await ensureDiscoverArtworkDirectory();
  const outputPath = getDiscoverArtworkFilePath(presetId, style);
  if (options.force !== true) {
    try {
      await fs.access(outputPath);
      return outputPath;
    } catch {}
  }
  return writeGeneratedPlaylistArtwork({
    outputPath,
    title,
    kind: 'Flow',
    signature: presetId,
    relatedArtists: (playlist?.relatedArtists as unknown[]) || [],
    style: style as string | null | undefined,
    paletteSeed: isFixedDiscoverPlaylistPreset(presetId) ? presetId : null,
  } as Parameters<typeof writeGeneratedPlaylistArtwork>[0]);
}

export async function attachArtworkToDiscoverPlaylists(playlists: Record<string, unknown>[] = []) {
  const list: Record<string, unknown>[] = Array.isArray(playlists) ? (playlists as Record<string, unknown>[]) : [];
  if (list.length === 0) return list;

  const style = getPlaylistArtworkStyle();
  await ensureDiscoverArtworkDirectory();
  await pruneObsoleteDiscoverArtwork(list.map((playlist) => playlist?.presetId).filter(Boolean));

  const enriched = [];
  for (const playlist of list) {
    if (!playlist?.presetId || (playlist.trackCount as number) <= 0) {
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
      console.warn(`[DiscoverArtwork] Failed for ${playlist.presetId}: ${(error as Error).message}`);
      enriched.push({
        ...playlist,
        artworkStyle: style,
        hasArtwork: false,
      });
    }
  }

  return enriched;
}

export async function resolveDiscoverArtworkFile(presetId: unknown) {
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

export async function ensureDiscoverArtworkForPreset(presetId: unknown, options: Record<string, unknown> = {}) {
  const existing = await resolveDiscoverArtworkFile(presetId);
  if (existing) return existing;

  const { getDiscoveryCache } = await import('./discoveryService.js');
  const { getListenHistoryProfile } = await import('./listeningHistory.js');
  const { getCachedDiscoverPlaylist } = await import('./discoverPlaylistService.js');

  const user = options.user as Record<string, unknown> | undefined;
  const profile = user ? getListenHistoryProfile(user) : {};
  const cache = getDiscoveryCache(profile as unknown as string | null);
  const playlist = getCachedDiscoverPlaylist(cache as Record<string, unknown>, String(presetId)) as Record<string, unknown> | null;
  if (!playlist || (playlist.trackCount as number) <= 0) return null;

  try {
    await generateDiscoverPlaylistArtwork(playlist);
    return resolveDiscoverArtworkFile(presetId);
  } catch (error) {
    console.warn(`[DiscoverArtwork] Lazy generate failed for ${presetId}: ${(error as Error).message}`);
    return null;
  }
}
