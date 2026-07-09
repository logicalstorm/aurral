import { lidarrClient } from "./lidarrClient.js";
import { downloadTracker } from "./weeklyFlow/weeklyFlowDownloadTracker.js";
import { isSpidarrTrackRequestsEnabled } from "./spidarrTrackRequestService.js";
import { logger } from "./logger.js";

const TAG_PREFIX = "aurral:pl:";
const tagLabelCache = new Map();
const tagIdCache = new Map();

export function buildAcquisitionTagLabel(playlistId, albumMbid) {
  const playlist = String(playlistId || "").trim();
  const album = String(albumMbid || "").trim();
  if (!playlist || !album) return "";
  return `${TAG_PREFIX}${playlist}:alb:${album}`;
}

export function parseAcquisitionTagLabel(label) {
  const text = String(label || "").trim();
  if (!text.startsWith(TAG_PREFIX)) return null;
  const body = text.slice(TAG_PREFIX.length);
  const albIndex = body.indexOf(":alb:");
  if (albIndex <= 0) return null;
  const playlistId = body.slice(0, albIndex).trim();
  const albumMbid = body.slice(albIndex + 5).trim();
  if (!playlistId || !albumMbid) return null;
  return { playlistId, albumMbid };
}

export function isAcquisitionTagLabel(label) {
  return parseAcquisitionTagLabel(label) !== null;
}

async function refreshTagCaches() {
  const tags = await lidarrClient.getTags();
  tagLabelCache.clear();
  tagIdCache.clear();
  for (const tag of tags || []) {
    if (!tag?.id || !tag?.label) continue;
    tagLabelCache.set(tag.id, tag.label);
    tagIdCache.set(tag.label, tag.id);
  }
}

async function getOrCreateTagId(label) {
  const normalized = String(label || "").trim();
  if (!normalized) return null;
  if (tagIdCache.has(normalized)) return tagIdCache.get(normalized);
  await refreshTagCaches();
  if (tagIdCache.has(normalized)) return tagIdCache.get(normalized);
  let created;
  try {
    created = await lidarrClient.createTag(normalized);
  } catch (error) {
    const message = String(error?.message || error || "");
    if (!/409/.test(message) && !/UNIQUE constraint failed: Tags\.Label/i.test(message)) {
      throw error;
    }
    await refreshTagCaches();
    if (tagIdCache.has(normalized)) return tagIdCache.get(normalized);
    return null;
  }
  const id = created?.id ?? created;
  if (id == null) return null;
  tagIdCache.set(normalized, id);
  tagLabelCache.set(id, normalized);
  return id;
}

async function getArtistTagLabels(artistId) {
  const artist = await lidarrClient.getArtist(artistId);
  const labels = [];
  for (const tagId of artist?.tags || []) {
    if (tagLabelCache.has(tagId)) {
      labels.push(tagLabelCache.get(tagId));
      continue;
    }
    await refreshTagCaches();
    if (tagLabelCache.has(tagId)) labels.push(tagLabelCache.get(tagId));
  }
  return labels;
}

function countAlbumAcquisitionTags(tagLabels, albumMbid) {
  const album = String(albumMbid || "").trim();
  if (!album) return 0;
  let count = 0;
  for (const label of tagLabels) {
    const parsed = parseAcquisitionTagLabel(label);
    if (parsed?.albumMbid === album) count += 1;
  }
  return count;
}

function artistHasAcquisitionTags(tagLabels) {
  return tagLabels.some((label) => isAcquisitionTagLabel(label));
}

export function isLibraryGraduatedAlbum(album) {
  if (!album) return false;
  if (album.monitored === true && album.trackMonitorMode !== "selected") return true;
  if (album.monitored === true && !album.trackMonitorMode) return true;
  return false;
}

async function findAlbumForArtist(artistId, albumMbid) {
  const albums = await lidarrClient.getAlbumsByArtistId(artistId);
  return (
    albums.find((entry) => String(entry?.foreignAlbumId || "").trim() === String(albumMbid).trim()) ||
    null
  );
}

async function addTagToArtist(artistId, tagId) {
  const artist = await lidarrClient.getArtist(artistId);
  const tags = Array.isArray(artist?.tags) ? [...artist.tags] : [];
  if (tags.includes(tagId)) return;
  await lidarrClient.updateArtist(artistId, { tags: [...tags, tagId] });
}

async function removeTagFromArtist(artistId, tagId) {
  const artist = await lidarrClient.getArtist(artistId);
  const tags = Array.isArray(artist?.tags) ? artist.tags.filter((entry) => entry !== tagId) : [];
  await lidarrClient.updateArtist(artistId, { tags });
}

export async function addAcquisitionTag(artistId, playlistId, albumMbid) {
  const label = buildAcquisitionTagLabel(playlistId, albumMbid);
  if (!label || !artistId) return false;
  const tagId = await getOrCreateTagId(label);
  if (tagId == null) return false;
  await addTagToArtist(artistId, tagId);
  return true;
}

export async function removeAcquisitionTag(artistId, playlistId, albumMbid) {
  const label = buildAcquisitionTagLabel(playlistId, albumMbid);
  if (!label || !artistId) return false;
  await refreshTagCaches();
  const tagId = tagIdCache.get(label);
  if (tagId == null) return false;
  await removeTagFromArtist(artistId, tagId);
  return true;
}

async function resolveAcquisitionContext(context = {}) {
  if (context.artistId && context.albumMbid) {
    return {
      artistId: context.artistId,
      albumMbid: String(context.albumMbid).trim(),
    };
  }

  let track = context.track || null;
  if (!track && context.job) {
    track = await lidarrClient.resolveTrackForRequest(context.job);
  }
  if (!track?.artistId) return null;

  let albumMbid = String(context.albumMbid || context.job?.albumMbid || "").trim();
  if (!albumMbid && track.albumId) {
    const album = await lidarrClient.getAlbum(track.albumId);
    albumMbid = String(album?.foreignAlbumId || "").trim();
  }
  if (!albumMbid) return null;

  return { artistId: track.artistId, albumMbid, track };
}

export async function claimPlaylistAcquisition(playlistId, context = {}) {
  if (!isSpidarrTrackRequestsEnabled()) return { skipped: true, reason: "track-requests-disabled" };
  const safePlaylistId = String(playlistId || "").trim();
  if (!safePlaylistId) return { skipped: true, reason: "missing-playlist-id" };

  const resolved = await resolveAcquisitionContext(context);
  if (!resolved?.artistId || !resolved.albumMbid) {
    return { skipped: true, reason: "missing-lidarr-context" };
  }

  await addAcquisitionTag(resolved.artistId, safePlaylistId, resolved.albumMbid);
  return {
    success: true,
    artistId: resolved.artistId,
    albumMbid: resolved.albumMbid,
  };
}

export async function graduateAlbumFromPlaylistAcquisition(artistId, albumMbid) {
  if (!isSpidarrTrackRequestsEnabled()) return { skipped: true };
  const safeArtistId = artistId;
  const safeAlbumMbid = String(albumMbid || "").trim();
  if (!safeArtistId || !safeAlbumMbid) return { skipped: true };

  await refreshTagCaches();
  const labels = await getArtistTagLabels(safeArtistId);
  let removed = 0;
  for (const label of labels) {
    const parsed = parseAcquisitionTagLabel(label);
    if (!parsed || parsed.albumMbid !== safeAlbumMbid) continue;
    const tagId = tagIdCache.get(label);
    if (tagId == null) continue;
    await removeTagFromArtist(safeArtistId, tagId);
    removed += 1;
  }
  return { success: true, removed };
}

async function teardownAlbumIfOrphaned(artistId, albumMbid, summary) {
  const album = await findAlbumForArtist(artistId, albumMbid);
  if (!album) return;

  if (isLibraryGraduatedAlbum(album)) return;

  const labels = await getArtistTagLabels(artistId);
  if (countAlbumAcquisitionTags(labels, albumMbid) > 0) return;

  try {
    const queue = await lidarrClient.getQueue();
    for (const item of queue) {
      if (item?.albumId !== album.id) continue;
      await lidarrClient.removeQueueItem(item.id);
      summary.queueRemoved += 1;
    }
  } catch (error) {
    summary.errors.push(`queue ${album.id}: ${error.message}`);
  }

  const tracks = await lidarrClient.getTracksByAlbumId(album.id);
  for (const track of tracks) {
    if (!track?.monitored) continue;
    try {
      if (track.trackFileId) {
        await lidarrClient.deleteTrackFile(track.trackFileId);
        summary.filesRemoved += 1;
      }
      await lidarrClient.monitorTracks([track.id], false);
      summary.tracksUnmonitored += 1;
    } catch (error) {
      summary.errors.push(`${track.title}: ${error.message}`);
    }
  }

  const refreshedTracks = await lidarrClient.getTracksByAlbumId(album.id);
  if (!refreshedTracks.some((track) => track?.hasFile)) {
    try {
      await lidarrClient.deleteAlbum(album.id, true);
      summary.albumsRemoved += 1;
    } catch (error) {
      summary.errors.push(`album ${album.id}: ${error.message}`);
    }
  }
}

async function teardownArtistIfOrphaned(artistId, summary) {
  const artist = await lidarrClient.getArtist(artistId);
  if (!artist || artist.monitored === true) return;

  const labels = await getArtistTagLabels(artistId);
  if (artistHasAcquisitionTags(labels)) return;

  const albums = await lidarrClient.getAlbumsByArtistId(artistId);
  for (const album of albums) {
    const tracks = await lidarrClient.getTracksByAlbumId(album.id);
    if (tracks.some((track) => track?.hasFile)) return;
  }

  try {
    await lidarrClient.deleteArtist(artistId, true);
    summary.artistsRemoved += 1;
  } catch (error) {
    summary.errors.push(`artist ${artistId}: ${error.message}`);
  }
}

async function cancelQueueForPendingJobs(playlistId, summary) {
  const jobs = downloadTracker.getByPlaylistType(playlistId);
  const albumIds = new Set();
  for (const job of jobs) {
    try {
      const track = await lidarrClient.resolveTrackForRequest(job);
      if (track?.albumId) albumIds.add(track.albumId);
    } catch {}
  }
  if (!albumIds.size) return;
  try {
    const queue = await lidarrClient.getQueue();
    for (const item of queue) {
      if (!albumIds.has(item?.albumId)) continue;
      await lidarrClient.removeQueueItem(item.id);
      summary.queueRemoved += 1;
    }
  } catch (error) {
    summary.errors.push(`queue: ${error.message}`);
  }
}

export async function cleanupLidarrForPlaylist(playlistId) {
  const safePlaylistId = String(playlistId || "").trim();
  if (!safePlaylistId) return { skipped: true, reason: "missing-playlist-id" };
  if (!isSpidarrTrackRequestsEnabled()) {
    return { skipped: true, reason: "track-requests-disabled" };
  }

  const summary = {
    playlistId: safePlaylistId,
    tagsRemoved: 0,
    queueRemoved: 0,
    filesRemoved: 0,
    tracksUnmonitored: 0,
    albumsRemoved: 0,
    artistsRemoved: 0,
    errors: [],
  };

  await cancelQueueForPendingJobs(safePlaylistId, summary);
  await refreshTagCaches();

  const tagDetails = await lidarrClient.getTagDetails();
  const playlistPrefix = `${TAG_PREFIX}${safePlaylistId}:alb:`;
  const matchingTags = (tagDetails || []).filter((entry) =>
    String(entry?.label || "").startsWith(playlistPrefix),
  );

  const touchedArtists = new Set();
  const touchedAlbums = [];

  for (const tagDetail of matchingTags) {
    const parsed = parseAcquisitionTagLabel(tagDetail.label);
    if (!parsed) continue;
    const tagId = tagDetail.id ?? tagIdCache.get(tagDetail.label);
    for (const artistId of tagDetail.artistIds || []) {
      if (tagId != null) {
        await removeTagFromArtist(artistId, tagId);
        summary.tagsRemoved += 1;
      }
      touchedArtists.add(artistId);
      touchedAlbums.push({ artistId, albumMbid: parsed.albumMbid });
    }
  }

  const uniqueAlbums = [];
  const seen = new Set();
  for (const entry of touchedAlbums) {
    const key = `${entry.artistId}:${entry.albumMbid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueAlbums.push(entry);
  }

  for (const entry of uniqueAlbums) {
    try {
      await teardownAlbumIfOrphaned(entry.artistId, entry.albumMbid, summary);
    } catch (error) {
      summary.errors.push(`album ${entry.albumMbid}: ${error.message}`);
    }
  }

  for (const artistId of touchedArtists) {
    try {
      await teardownArtistIfOrphaned(artistId, summary);
    } catch (error) {
      summary.errors.push(`artist ${artistId}: ${error.message}`);
    }
  }

  logger.info("[LidarrPlaylistTags] Cleanup finished", summary);
  return summary;
}
