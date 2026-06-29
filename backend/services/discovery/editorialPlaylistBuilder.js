import { lastfmRequest, getLastfmApiKey } from "../apiClients/index.js";
import { EDITORIAL_PLAYLIST_PRESETS } from "../../config/editorialPlaylistPresets.js";
import { FIXED_DISCOVER_PLAYLIST_ARTWORK_COLORS } from "../../config/discoverPlaylistPresets.js";
import { logger } from "../logger.js";

const EDITORIAL_BUILD_CONCURRENCY = 3;
const ALBUM_ENRICH_CONCURRENCY = 2;

const normalizeTrack = (track, rank) => ({
  artistName: track?.artist?.name || null,
  trackName: track?.name || null,
  albumName: null,
  artistMbid: track?.artist?.mbid || null,
  albumMbid: null,
  trackMbid: track?.mbid || null,
  releaseYear: null,
  reason: `#${rank} on Last.fm`,
});

const buildEditorialPlaylistPreview = (preset, tracks) => ({
  presetId: preset.id,
  name: preset.name,
  description: preset.description || null,
  type: "editorial",
  editorialType: preset.type || "genre",
  tag: preset.tag,
  size: preset.size,
  tracks: tracks.map(normalizeTrack),
  trackCount: tracks.length,
  artworkColor: FIXED_DISCOVER_PLAYLIST_ARTWORK_COLORS[preset.id] || null,
});

async function buildPlaylistFromPreset(preset) {
  try {
    const result = await lastfmRequest("tag.getTopTracks", {
      tag: preset.tag,
      limit: preset.size,
    });

    if (!result) {
      logger.warn("discovery", `[EditorialPlaylists] ${preset.id} (${preset.tag}): API returned null — possible auth or network error`);
      return null;
    }

    if (result.error) {
      logger.warn("discovery", `[EditorialPlaylists] ${preset.id} (${preset.tag}): API error ${result.error} — ${result.message || ""}`);
      return null;
    }

    const rawTracks = result?.tracks?.track;
    const tracks = Array.isArray(rawTracks) ? rawTracks : rawTracks ? [rawTracks] : [];

    if (tracks.length === 0) {
      logger.info("discovery", `[EditorialPlaylists] ${preset.id} (${preset.tag}): tag returned no tracks`);
      return null;
    }

    return buildEditorialPlaylistPreview(preset, tracks);
  } catch (error) {
    logger.warn("discovery", `[EditorialPlaylists] Failed to build ${preset.id} (${preset.tag}): ${error.message}`);
    return null;
  }
}

async function enrichTrackWithAlbum(track) {
  const artistName = String(track?.artistName || "").trim();
  const trackName = String(track?.trackName || "").trim();
  if (!artistName || !trackName) return track;
  try {
    const info = await lastfmRequest("track.getInfo", {
      artist: artistName,
      track: trackName,
      autocorrect: 1,
    });
    const albumTitle = String(info?.track?.album?.title || "").trim();
    if (albumTitle) {
      return { ...track, albumName: albumTitle };
    }
  } catch {
    // silently skip enrichment failures
  }
  return track;
}

async function enrichTracksWithAlbums(tracks) {
  const enriched = [];
  for (let i = 0; i < tracks.length; i += ALBUM_ENRICH_CONCURRENCY) {
    const batch = tracks.slice(i, i + ALBUM_ENRICH_CONCURRENCY);
    const results = await Promise.all(batch.map(enrichTrackWithAlbum));
    enriched.push(...results);
  }
  return enriched;
}

export { enrichTrackWithAlbum, enrichTracksWithAlbums };

export async function generateEditorialPlaylists() {
  if (!getLastfmApiKey()) {
    logger.info("discovery", "[EditorialPlaylists] Skipped — Last.fm not configured");
    return [];
  }

  const playlists = [];
  for (let i = 0; i < EDITORIAL_PLAYLIST_PRESETS.length; i += EDITORIAL_BUILD_CONCURRENCY) {
    const batch = EDITORIAL_PLAYLIST_PRESETS.slice(i, i + EDITORIAL_BUILD_CONCURRENCY);
    const results = await Promise.all(batch.map(buildPlaylistFromPreset));
    playlists.push(...results.filter(Boolean));
  }

  const mappings = playlists.flatMap((p) =>
    p.tracks.map((t, trackIdx) => ({ playlist: p, trackIdx })),
  );
  const allTracks = mappings.map((m) => m.playlist.tracks[m.trackIdx]);
  const enriched = await enrichTracksWithAlbums(allTracks);

  for (let i = 0; i < mappings.length; i += 1) {
    mappings[i].playlist.tracks[mappings[i].trackIdx].albumName =
      enriched[i]?.albumName || null;
  }

  logger.info("discovery", `[EditorialPlaylists] Built ${playlists.length}/${EDITORIAL_PLAYLIST_PRESETS.length} playlists`);
  return playlists;
}
