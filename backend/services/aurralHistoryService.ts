import crypto from 'crypto';
import { dbOps } from '../config/db-helpers.js';
import { flowPlaylistConfig } from './weeklyFlowPlaylistConfig.js';

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const STALE_TRACK_JOB_MS = 15 * 60 * 1000;
const STALE_AURRAL_JOB_MS = 60 * 60 * 1000;

const KIND_SOURCE_MAP: Record<string, string> = {
  track_download: 'slskd',
  album_requested: 'lidarr',
  artist_added: 'lidarr',
  track_reused_lidarr: 'lidarr',
  track_reused_aurral: 'aurral',
  discovery_refresh: 'aurral',
  flow_generated: 'aurral',
  flow_generating: 'aurral',
  playlist_tracks_added: 'aurral',
};

interface HistoryEntry {
  id?: unknown;
  kind?: unknown;
  title?: unknown;
  subtitle?: unknown;
  status?: unknown;
  statusLabel?: unknown;
  href?: unknown;
  metadata?: unknown;
  createdAt?: unknown;
  referenceId?: unknown;
}

interface TrackJobParams {
  jobId?: unknown;
  trackName?: unknown;
  artistName?: unknown;
  playlistId?: unknown;
  playlistType?: unknown;
  downloadSource?: unknown;
  status?: string;
  statusLabel?: string;
  title?: string | null;
  subtitle?: string | null;
}

interface DiscoveryUpdatedParams {
  recommendationCount?: number;
  genreCount?: number;
}

interface ArtistAddedParams {
  artistName?: unknown;
  artistMbid?: unknown;
}

interface AlbumParams {
  albumId?: unknown;
  albumName?: unknown;
  artistName?: unknown;
  artistMbid?: unknown;
  searching?: boolean;
}

interface AlbumFailedParams {
  albumId?: unknown;
  albumName?: unknown;
  artistName?: unknown;
  artistMbid?: unknown;
  statusLabel?: string;
}

interface FlowStartedParams {
  flowId?: unknown;
}

interface FlowTracksParams {
  flowId?: unknown;
  tracksQueued?: number;
  reserveTracks?: number;
}

interface PlaylistTracksParams {
  playlistId?: unknown;
  tracksQueued?: number;
  tracksReused?: number;
}

interface TrackReusedParams {
  track?: Record<string, unknown>;
  playlistId?: unknown;
  sourceType?: string;
}

const resolvePlaylistName = (playlistId: unknown): string => {
  const id = String(playlistId || '').trim();
  if (!id) return 'Playlist';
  const shared = flowPlaylistConfig.getSharedPlaylist(id);
  if (shared?.name) return shared.name;
  const flow = flowPlaylistConfig.getFlow(id);
  if (flow?.name) return flow.name;
  return id;
};

const buildPlaylistHref = (playlistId: unknown): string => {
  const id = String(playlistId || '').trim();
  if (!id) return '/playlists';
  return `/playlists?selected=${encodeURIComponent(id)}`;
};

const buildArtistHref = (artistMbid: unknown): string | null => {
  const mbid = String(artistMbid || '').trim();
  if (!mbid || mbid === 'null' || mbid === 'undefined') return null;
  return `/artist/${mbid}`;
};

const createId = (): string => `aurral-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

const stableId = (kind: string, referenceId: unknown): string =>
  `aurral-${kind}-${String(referenceId || '').trim()}`;

const toIso = (createdAt: unknown): string => {
  const value = Number(createdAt);
  if (!Number.isFinite(value) || value <= 0) {
    return new Date().toISOString();
  }
  return new Date(value).toISOString();
};

const resolveTrackDownloadHistorySource = (downloadSource: unknown): string => {
  const normalized = String(downloadSource || '')
    .trim()
    .toLowerCase();
  if (normalized === 'usenet') return 'nzbget';
  return 'slskd';
};

const resolveDownloadClientLabel = (downloadSource: unknown): string =>
  resolveTrackDownloadHistorySource(downloadSource) === 'nzbget' ? 'NZBGet' : 'slskd';

const resolveHistorySource = (kind: string | null, metadata: Record<string, unknown> | null = null): string => {
  if (kind === 'track_download') {
    return resolveTrackDownloadHistorySource(metadata?.downloadSource);
  }
  return KIND_SOURCE_MAP[kind || ''] || 'aurral';
};

const serializeHistoryMetadata = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null;
  return JSON.stringify(value);
};

const hasHistoryRecordChanged = (existing: Record<string, unknown> | null | undefined, next: Record<string, unknown>): boolean => {
  if (!existing) return true;
  return (
    existing.kind !== next.kind ||
    existing.title !== next.title ||
    existing.subtitle !== next.subtitle ||
    existing.status !== next.status ||
    existing.statusLabel !== next.statusLabel ||
    existing.href !== next.href ||
    serializeHistoryMetadata(existing.metadata) !== serializeHistoryMetadata(next.metadata)
  );
};

export const appendAurralHistory = (entry: HistoryEntry = {}): Record<string, unknown> | null => {
  const title = String(entry.title || '').trim();
  if (!title) return null;
  const kind = String(entry.kind || 'activity').trim();
  const record = {
    id: createId(),
    kind,
    title,
    subtitle: entry.subtitle ? String(entry.subtitle).trim() : null,
    status: String(entry.status || 'completed').trim(),
    statusLabel: entry.statusLabel ? String(entry.statusLabel).trim() : null,
    href: entry.href ? String(entry.href).trim() : null,
    metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : null,
    createdAt: Number(entry.createdAt) || Date.now(),
  };
  dbOps.insertAurralHistory(record);
  dbOps.pruneAurralHistory({ maxAgeMs: MAX_AGE_MS });
  return record;
};

export const upsertAurralHistory = (entry: HistoryEntry = {}): Record<string, unknown> | null => {
  const title = String(entry.title || '').trim();
  if (!title) return null;
  const referenceId = entry.referenceId ? String(entry.referenceId).trim() : null;
  const kind = String(entry.kind || 'activity').trim();
  const id = referenceId ? stableId(kind, referenceId) : createId();
  const existing = dbOps.getAurralHistoryById(id);
  const nextRecord = {
    id,
    kind,
    title,
    subtitle: entry.subtitle ? String(entry.subtitle).trim() : null,
    status: String(entry.status || 'completed').trim(),
    statusLabel: entry.statusLabel ? String(entry.statusLabel).trim() : null,
    href: entry.href ? String(entry.href).trim() : null,
    metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : null,
  };
  const changed = hasHistoryRecordChanged(existing, nextRecord);
  const record = {
    ...nextRecord,
    createdAt: existing
      ? changed
        ? Number(entry.createdAt) || Date.now()
        : existing.createdAt
      : Number(entry.createdAt) || Date.now(),
  };
  dbOps.insertAurralHistory(record);
  dbOps.pruneAurralHistory({ maxAgeMs: MAX_AGE_MS });
  return record;
};

export const recordAurralHistory = (entry: HistoryEntry = {}): Record<string, unknown> | null =>
  appendAurralHistory(entry);

export const recordDiscoveryRefreshStarted = (): Record<string, unknown> | null =>
  upsertAurralHistory({
    referenceId: 'discovery',
    kind: 'discovery_refresh',
    title: 'Refreshing discovery',
    subtitle: 'Gathering recommendations from your library and listening history',
    status: 'processing',
    statusLabel: 'Refreshing',
    href: '/discover',
  });

export const recordDiscoveryUpdated = ({ recommendationCount = 0, genreCount = 0 }: DiscoveryUpdatedParams = {}): Record<string, unknown> | null => {
  const parts: string[] = [];
  if (recommendationCount > 0) {
    parts.push(`${recommendationCount} recommendation${recommendationCount === 1 ? '' : 's'}`);
  }
  if (genreCount > 0) {
    parts.push(`${genreCount} genre${genreCount === 1 ? '' : 's'}`);
  }
  return upsertAurralHistory({
    referenceId: 'discovery',
    kind: 'discovery_refresh',
    title: 'Discovery updated',
    subtitle: parts.length > 0 ? parts.join(', ') : 'Recommendations refreshed',
    status: 'completed',
    statusLabel: 'Updated',
    href: '/discover',
    metadata: { recommendationCount, genreCount },
  });
};

export const recordDiscoveryRefreshFailed = (message = 'Discovery refresh failed'): Record<string, unknown> | null =>
  upsertAurralHistory({
    referenceId: 'discovery',
    kind: 'discovery_refresh',
    title: 'Discovery refresh failed',
    subtitle: String(message || '').trim() || null,
    status: 'failed',
    statusLabel: 'Failed',
    href: '/discover',
  });

export const recordArtistAdded = ({ artistName, artistMbid }: ArtistAddedParams = {}): Record<string, unknown> | null => {
  const mbid = String(artistMbid || '').trim();
  const name = String(artistName || '').trim();
  if (!mbid || !name) return null;
  const id = stableId('artist_added', mbid);
  if (dbOps.getAurralHistoryById(id)) return null;
  return upsertAurralHistory({
    referenceId: mbid,
    kind: 'artist_added',
    title: `Added ${name} to library`,
    subtitle: 'Artist added via Lidarr',
    status: 'completed',
    statusLabel: 'Added',
    href: buildArtistHref(mbid),
    metadata: { artistMbid: mbid, artistName: name },
  });
};

export const recordAlbumRequested = ({
  albumId,
  albumName,
  artistName,
  artistMbid,
  searching = false,
}: AlbumParams = {}): Record<string, unknown> | null => {
  const name = String(albumName || '').trim() || 'Album';
  const artist = String(artistName || '').trim();
  const ref = String(albumId || artistMbid || name).trim();
  if (!ref) return null;
  return upsertAurralHistory({
    referenceId: ref,
    kind: 'album_requested',
    title: searching ? `Searching Lidarr for ${name}` : `Requested ${name}`,
    subtitle: artist || null,
    status: searching ? 'processing' : 'completed',
    statusLabel: searching ? 'Searching' : 'Requested',
    href: buildArtistHref(artistMbid),
    metadata: { albumId, albumName: name, artistName: artist, artistMbid },
  });
};

export const recordAlbumSearchStarted = ({ albumId, albumName, artistName, artistMbid }: AlbumParams = {}): Record<string, unknown> | null =>
  recordAlbumRequested({
    albumId,
    albumName,
    artistName,
    artistMbid,
    searching: true,
  });

export const recordAlbumSearchFailed = ({
  albumId,
  albumName,
  artistName,
  artistMbid,
  statusLabel = 'Not found',
}: AlbumFailedParams = {}): Record<string, unknown> | null => {
  const name = String(albumName || '').trim() || 'Album';
  const artist = String(artistName || '').trim();
  const ref = String(albumId || artistMbid || name).trim();
  if (!ref) return null;
  return upsertAurralHistory({
    referenceId: ref,
    kind: 'album_requested',
    title: `No results for ${name}`,
    subtitle: artist || null,
    status: 'failed',
    statusLabel,
    href: buildArtistHref(artistMbid),
    metadata: { albumId, albumName: name, artistName: artist, artistMbid },
  });
};

const parseHonkerPayload = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const isHonkerQueueActive = async (queueName: string, predicate: (payload: Record<string, unknown>) => boolean): Promise<boolean> => {
  try {
    const { getHonkerDb } = await import('./honkerDb.js');
    const rows = getHonkerDb().query(
      `
        SELECT payload
        FROM _honker_live
        WHERE queue = ?
          AND state IN ('pending', 'processing')
      `,
      [String(queueName || '').trim()],
    ) as Array<{ payload?: unknown }>;
    for (const row of rows) {
      const payload = parseHonkerPayload(row?.payload);
      if (payload && predicate(payload)) return true;
    }
    return false;
  } catch {
    return false;
  }
};

const isPipelineActiveForJob = async (jobId: string): Promise<boolean> =>
  isHonkerQueueActive('slskd-pipeline', (payload: Record<string, unknown>) => payload?.jobId === jobId);

const buildHistoryJobFromEntry = (entry: Record<string, unknown>): Record<string, unknown> => ({
  id: entry.metadata && typeof entry.metadata === 'object' ? (entry.metadata as Record<string, unknown>).jobId : entry.id,
  trackName: entry.metadata && typeof entry.metadata === 'object' ? (entry.metadata as Record<string, unknown>).trackName : null,
  artistName: entry.metadata && typeof entry.metadata === 'object' ? (entry.metadata as Record<string, unknown>).artistName : null,
  playlistId: entry.metadata && typeof entry.metadata === 'object' ? (entry.metadata as Record<string, unknown>).playlistId : null,
  playlistType: entry.metadata && typeof entry.metadata === 'object' ? (entry.metadata as Record<string, unknown>).playlistId : null,
  downloadSource: entry.metadata && typeof entry.metadata === 'object' ? (entry.metadata as Record<string, unknown>).downloadSource : null,
});

export const syncTrackDownloadHistory = async () => {
  const { downloadTracker } = await import('./weeklyFlowDownloadTracker.js');
  const cutoff = Date.now() - MAX_AGE_MS;
  const pendingEntries = dbOps
    .getAurralHistory({ since: cutoff, limit: 300 })
    .filter(
      (entry) =>
        entry.kind === 'track_download' &&
        (entry.status === 'processing' || entry.status === 'pending'),
    );
  if (!pendingEntries.length) return;

  for (const entry of pendingEntries) {
    const jobId = String(entry.metadata?.jobId || '').trim();
    if (!jobId) {
      if (Date.now() - Number(entry.createdAt || 0) >= STALE_TRACK_JOB_MS) {
        recordTrackJobFailed(buildHistoryJobFromEntry(entry), 'Download no longer active');
      }
      continue;
    }

    const job = downloadTracker.getJob(jobId);
    if (!job) {
      if (Date.now() - Number(entry.createdAt || 0) >= STALE_TRACK_JOB_MS) {
        recordTrackJobFailed(buildHistoryJobFromEntry(entry), 'Download no longer active');
      }
      continue;
    }

    if (job.status === 'done') {
      recordTrackJobCompleted(job);
      continue;
    }

    if (job.status === 'failed') {
      recordTrackJobFailed(job, job.error || 'Download failed');
      continue;
    }

    const anchorTime = Math.max(
      Number(job.startedAt || 0),
      Number(job.createdAt || 0),
      Number(entry.createdAt || 0),
    );
    if (!anchorTime || Date.now() - anchorTime < STALE_TRACK_JOB_MS) {
      continue;
    }

    if (await isPipelineActiveForJob(jobId)) {
      continue;
    }

    const message = 'Download timed out';
    downloadTracker.setFailed(jobId, message);
    recordTrackJobFailed(job, message);
  }
};

const syncDiscoveryRefreshHistory = async () => {
  const cutoff = Date.now() - MAX_AGE_MS;
  const pendingEntries = dbOps
    .getAurralHistory({ since: cutoff, limit: 300 })
    .filter((entry) => entry.kind === 'discovery_refresh' && entry.status === 'processing');
  if (!pendingEntries.length) return;

  const discoveryActive = await isHonkerQueueActive('discovery-refresh', () => true);
  if (discoveryActive) return;

  for (const entry of pendingEntries) {
    if (Date.now() - Number(entry.createdAt || 0) < STALE_AURRAL_JOB_MS) {
      continue;
    }
    recordDiscoveryRefreshFailed('Discovery refresh timed out');
  }
};

const syncFlowGenerationHistory = async () => {
  const cutoff = Date.now() - MAX_AGE_MS;
  const pendingEntries = dbOps
    .getAurralHistory({ since: cutoff, limit: 300 })
    .filter((entry) => entry.kind === 'flow_generating' && entry.status === 'processing');
  if (!pendingEntries.length) return;

  for (const entry of pendingEntries) {
    const flowId = String(entry.metadata?.flowId || '').trim();
    if (!flowId) continue;
    if (Date.now() - Number(entry.createdAt || 0) < STALE_AURRAL_JOB_MS) {
      continue;
    }
    const flowActive = await isHonkerQueueActive(
      'weekly-flow-operation',
      (payload) => String(payload?.flowId || payload?.playlistId || '').trim() === flowId,
    );
    if (flowActive) continue;
    upsertAurralHistory({
      referenceId: flowId,
      kind: 'flow_generating',
      title: `Failed to generate playlist for ${resolvePlaylistName(flowId)}`,
      subtitle: entry.subtitle || null,
      status: 'failed',
      statusLabel: 'Failed',
      href: buildPlaylistHref(flowId),
      metadata: entry.metadata,
    });
  }
};

export const syncProcessingActivityHistory = async (lidarrClient: any = null): Promise<void> => {
  await syncTrackDownloadHistory();
  await syncDiscoveryRefreshHistory();
  await syncFlowGenerationHistory();
  if (lidarrClient) {
    await syncAlbumSearchHistory(lidarrClient);
  }
};

export const syncAlbumSearchHistory = async (lidarrClient: any): Promise<void> => {
  if (!lidarrClient?.isConfigured()) return;

  const cutoff = Date.now() - MAX_AGE_MS;
  const pendingEntries = dbOps
    .getAurralHistory({ since: cutoff, limit: 300 })
    .filter((entry: Record<string, unknown>) => entry.kind === 'album_requested' && entry.status === 'processing');
  if (!pendingEntries.length) return;

  const { parseLidarrSearchContext, resolveAlbumSearchOutcome } =
    await import('./albumSearchState.js');
  const [queue, history, commands] = await Promise.all([
    lidarrClient.getQueue().catch(() => []),
    lidarrClient.getHistory(1, 200).catch(() => ({ records: [] })),
    lidarrClient.request('/command').catch(() => []),
  ]);
  const context = parseLidarrSearchContext({ queue, history, commands });

  for (const entry of pendingEntries) {
    const metadata = entry.metadata && typeof entry.metadata === 'object' ? (entry.metadata as Record<string, unknown>) : {};
    const albumId = metadata.albumId;
    if (!albumId) continue;
    const outcome = resolveAlbumSearchOutcome(albumId as string | number, context, {
      searchStartedAt: entry.createdAt,
    });
    if (!outcome || outcome.status !== 'failed') continue;
    recordAlbumSearchFailed({
      albumId,
      albumName: metadata.albumName as string | undefined,
      artistName: metadata.artistName as string | undefined,
      artistMbid: metadata.artistMbid as string | undefined,
      statusLabel: outcome.statusLabel,
    });
  }
};

export const recordFlowGenerationStarted = ({ flowId }: FlowStartedParams = {}): Record<string, unknown> | null => {
  const id = String(flowId || '').trim();
  if (!id) return null;
  const flowName = resolvePlaylistName(id);
  return upsertAurralHistory({
    referenceId: id,
    kind: 'flow_generating',
    title: `Generating playlist for ${flowName}`,
    subtitle: 'Building tracklist from discovery sources',
    status: 'processing',
    statusLabel: 'Generating',
    href: buildPlaylistHref(id),
    metadata: { flowId: id },
  });
};

export const recordFlowTracksGenerated = ({ flowId, tracksQueued = 0, reserveTracks = 0 }: FlowTracksParams = {}): Record<string, unknown> | null => {
  const id = String(flowId || '').trim();
  if (!id) return null;
  const total = tracksQueued + reserveTracks;
  if (total <= 0) return null;
  const flowName = resolvePlaylistName(id);
  return upsertAurralHistory({
    referenceId: id,
    kind: 'flow_generating',
    title: `Generated playlist for ${flowName}`,
    subtitle:
      reserveTracks > 0
        ? `${total} tracks · ${tracksQueued} queued · ${reserveTracks} in reserve`
        : total === 1
          ? '1 track queued for download'
          : `${total} tracks queued for download`,
    status: 'completed',
    statusLabel: 'Generated',
    href: buildPlaylistHref(id),
    metadata: { flowId: id, tracksQueued, reserveTracks },
  });
};

export const recordPlaylistTracksAdded = ({
  playlistId,
  tracksQueued = 0,
  tracksReused = 0,
}: PlaylistTracksParams = {}): Record<string, unknown> | null => {
  const total = tracksQueued + tracksReused;
  if (total <= 0) return null;
  const playlistName = resolvePlaylistName(playlistId);
  const title =
    total === 1 ? `Added 1 track to ${playlistName}` : `Added ${total} tracks to ${playlistName}`;
  const subtitleParts: string[] = [];
  if (tracksReused > 0) {
    subtitleParts.push(`${tracksReused} from library`);
  }
  if (tracksQueued > 0) {
    subtitleParts.push(`${tracksQueued} queued for download`);
  }
  return appendAurralHistory({
    kind: 'playlist_tracks_added',
    title,
    subtitle: subtitleParts.join(' · ') || playlistName,
    status: 'completed',
    statusLabel: 'Added',
    href: buildPlaylistHref(playlistId),
    metadata: { playlistId, tracksQueued, tracksReused },
  });
};

export const recordTrackReused = ({ track = {}, playlistId, sourceType = 'library' }: TrackReusedParams = {}): Record<string, unknown> | null => {
  const playlistName = resolvePlaylistName(playlistId);
  const trackName = String(track.trackName || track.title || 'Track').trim();
  const artistName = String(track.artistName || track.artist || 'Artist').trim();
  const fromLabel =
    sourceType === 'lidarr'
      ? 'from Lidarr library'
      : sourceType === 'aurral'
        ? 'from Aurral library'
        : 'from library';
  return appendAurralHistory({
    kind: sourceType === 'lidarr' ? 'track_reused_lidarr' : 'track_reused_aurral',
    title: `Reused ${trackName}`,
    subtitle: `${artistName} · ${playlistName} · ${fromLabel}`,
    status: 'completed',
    statusLabel: sourceType === 'lidarr' ? 'From Lidarr' : 'From library',
    href: buildPlaylistHref(playlistId),
    metadata: {
      playlistId,
      sourceType,
      artistName,
      trackName,
    },
  });
};

export const recordTrackJobActivity = ({
  jobId,
  trackName,
  artistName,
  playlistId,
  status = 'processing',
  statusLabel = 'Searching',
  title = null as string | null,
  subtitle = null as string | null,
  downloadSource = null as string | null,
}: TrackJobParams = {}): Record<string, unknown> | null => {
  const id = String(jobId || '').trim();
  if (!id) return null;
  const playlistName = resolvePlaylistName(playlistId);
  const track = String(trackName || 'Track').trim();
  const artist = String(artistName || 'Artist').trim();
  const clientLabel = resolveDownloadClientLabel(downloadSource);
  return upsertAurralHistory({
    referenceId: id,
    kind: 'track_download',
    title: title || `Searching ${clientLabel} for ${track}`,
    subtitle: subtitle || `${artist} · ${playlistName}`,
    status,
    statusLabel,
    href: buildPlaylistHref(playlistId),
    metadata: {
      jobId: id,
      trackName: track,
      artistName: artist,
      playlistId,
      downloadSource: downloadSource || 'slskd',
    },
  });
};

export const recordTrackJobSearching = (job: Record<string, unknown>): Record<string, unknown> | null =>
  recordTrackJobActivity({
    jobId: job?.id,
    trackName: job?.trackName,
    artistName: job?.artistName,
    playlistId: job?.playlistId || job?.playlistType,
    downloadSource: job?.downloadSource,
    status: 'processing',
    statusLabel: 'Searching',
    title: `Searching ${resolveDownloadClientLabel(job?.downloadSource)} for ${(job?.trackName as string) || 'track'}`,
  });

export const recordTrackJobDownloading = (job: Record<string, unknown>): Record<string, unknown> | null =>
  recordTrackJobActivity({
    jobId: job?.id,
    trackName: job?.trackName,
    artistName: job?.artistName,
    playlistId: job?.playlistId || job?.playlistType,
    downloadSource: job?.downloadSource,
    status: 'processing',
    statusLabel: 'Downloading',
    title: `Downloading ${(job?.trackName as string) || 'track'} via ${resolveDownloadClientLabel(job?.downloadSource)}`,
  });

export const recordTrackJobMoving = (job: Record<string, unknown>): Record<string, unknown> | null =>
  recordTrackJobActivity({
    jobId: job?.id,
    trackName: job?.trackName,
    artistName: job?.artistName,
    playlistId: job?.playlistId || job?.playlistType,
    downloadSource: job?.downloadSource,
    status: 'processing',
    statusLabel: 'Moving',
    title: `Moving ${(job?.trackName as string) || 'track'} into playlist library`,
  });

export const recordTrackJobCompleted = (job: Record<string, unknown>): Record<string, unknown> | null =>
  recordTrackJobActivity({
    jobId: job?.id,
    trackName: job?.trackName,
    artistName: job?.artistName,
    playlistId: job?.playlistId || job?.playlistType,
    downloadSource: job?.downloadSource,
    status: 'completed',
    statusLabel: 'Downloaded',
    title: `Downloaded ${(job?.trackName as string) || 'track'}`,
    subtitle: `${(job?.artistName as string) || 'Artist'} · ${resolvePlaylistName(job?.playlistId || job?.playlistType)}`,
  });

export const recordTrackJobFailed = (job: Record<string, unknown>, message = 'Download failed'): Record<string, unknown> | null =>
  recordTrackJobActivity({
    jobId: job?.id,
    trackName: job?.trackName,
    artistName: job?.artistName,
    playlistId: job?.playlistId || job?.playlistType,
    downloadSource: job?.downloadSource,
    status: 'failed',
    statusLabel: 'Failed',
    title: `Failed to download ${(job?.trackName as string) || 'track'}`,
    subtitle: String(message || '').trim() || `${(job?.artistName as string) || 'Artist'}`,
  });

export const toHistoryRequestItem = (entry: Record<string, unknown>): Record<string, unknown> => {
  const kind = (entry.kind as string) || null;
  const source = resolveHistorySource(kind, entry.metadata && typeof entry.metadata === 'object' ? (entry.metadata as Record<string, unknown>) : null);
  const metadata = entry.metadata && typeof entry.metadata === 'object' ? (entry.metadata as Record<string, unknown>) : {};
  return {
    id: entry.id,
    source,
    type: 'activity',
    title: entry.title,
    subtitle: entry.subtitle || null,
    status: entry.status || 'completed',
    statusLabel: entry.statusLabel || null,
    requestedAt: toIso(entry.createdAt),
    href: entry.href || null,
    kind,
    playlistId: metadata.playlistId || null,
    jobId: metadata.jobId || null,
    albumId: metadata.albumId ? String(metadata.albumId) : null,
    inQueue: entry.status === 'processing' || entry.status === 'pending',
    canReSearch:
      entry.kind === 'album_requested' &&
      entry.status === 'failed' &&
      Boolean(metadata.albumId),
  };
};

export const getAurralHistoryRequests = async (lidarrClient: any = null): Promise<Array<Record<string, unknown>>> => {
  await syncProcessingActivityHistory(lidarrClient);
  const cutoff = Date.now() - MAX_AGE_MS;
  const entries = dbOps.getAurralHistory({ since: cutoff, limit: 300 });
  return entries.map(toHistoryRequestItem);
};
