import { downloadTracker } from './weeklyFlowDownloadTracker.js';
import { weeklyFlowWorker } from './weeklyFlowWorker.js';
import { buildSharedTrackIdentity, flowPlaylistConfig } from './weeklyFlowPlaylistConfig.js';
import { weeklyFlowOperationQueue } from './weeklyFlowOperationQueue.js';
import { getWeeklyFlowOperationWorkerStatus } from './weeklyFlowOperationWorker.js';
import { slskdClient } from './slskdClient.js';
import { userOps } from '../config/db-helpers.js';
import { getFlowCapabilities } from './listenbrainzDiscoveryFallback.js';

function formatNextRunMessage(flows: Record<string, unknown>[]) {
  const nextRunAt = (Array.isArray(flows) ? flows : [])
    .filter((flow) => flow?.enabled === true)
    .map((flow) => Number(flow?.nextRunAt))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)[0];
  if (!nextRunAt) return null;
  const diff = nextRunAt - Date.now();
  if (diff <= 0) return 'Next update soon';
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (diff < hourMs) {
    const minutes = Math.ceil(diff / minuteMs);
    return minutes === 1 ? 'Next update in 1 minute' : `Next update in ${minutes} minutes`;
  }
  if (diff < dayMs) {
    const hours = Math.ceil(diff / hourMs);
    return hours === 1 ? 'Next update in 1 hour' : `Next update in ${hours} hours`;
  }
  const days = Math.ceil(diff / dayMs);
  return days === 1 ? 'Next update in 1 day' : `Next update in ${days} days`;
}

function aggregateStats(statsByType: Record<string, { total?: number; pending?: number; downloading?: number; done?: number; failed?: number }> = {}, ids: string[]) {
  const base = {
    total: 0,
    pending: 0,
    downloading: 0,
    done: 0,
    failed: 0,
  };
  for (const id of Array.isArray(ids) ? ids : []) {
    const stats = statsByType?.[id];
    if (!stats) continue;
    base.pending += Number(stats.pending || 0);
    base.downloading += Number(stats.downloading || 0);
    base.done += Number(stats.done || 0);
    base.failed += Number(stats.failed || 0);
  }
  base.total = base.pending + base.downloading + base.done + base.failed;
  return base;
}

const sharedPlaylistIdentityCache = new Map();
const sharedPlaylistStaticIdentityKeyCache = new Map();

function getSharedPlaylistStaticIdentityKey(playlist: Record<string, unknown>) {
  const playlistId = String(playlist?.id || '');
  const cached = sharedPlaylistStaticIdentityKeyCache.get(playlistId);
  if (cached?.playlist === playlist) return cached.key;
  const key = (Array.isArray(playlist?.tracks) ? playlist.tracks : [])
    .map((track: Record<string, unknown>) => buildSharedTrackIdentity(track as unknown as string))
    .filter(Boolean)
    .join('\u0002');
  sharedPlaylistStaticIdentityKeyCache.set(playlistId, {
    playlist,
    key,
  });
  return key;
}

function buildSharedPlaylistIdentityCacheKey(playlist: Record<string, unknown>, stats: Record<string, number | undefined>) {
  return [
    downloadTracker.getRevision(),
    playlist?.trackCount || 0,
    playlist?.createdAt || 0,
    Number(stats?.pending || 0),
    Number(stats?.downloading || 0),
    Number(stats?.done || 0),
    Number(stats?.failed || 0),
    getSharedPlaylistStaticIdentityKey(playlist),
  ].join('|');
}

function collectPlaylistTrackIdentities(playlist: Record<string, unknown>, stats: Record<string, number | undefined>) {
  const playlistId = String(playlist?.id || '');
  if (!playlistId) return [] as string[];
  const cacheKey = buildSharedPlaylistIdentityCacheKey(playlist, stats);
  const cached = sharedPlaylistIdentityCache.get(playlistId);
  if (cached?.cacheKey === cacheKey) {
    return cached.identities;
  }
  const seen = new Set<string>();
  const identities: string[] = [];
  const addIdentity = (track: Record<string, unknown>) => {
    const identity = buildSharedTrackIdentity(track as unknown as string);
    if (!identity || seen.has(identity)) return;
    seen.add(identity);
    identities.push(identity);
  };
  for (const job of downloadTracker.getByPlaylistType(playlistId)) {
    addIdentity(job);
  }
  for (const track of Array.isArray(playlist?.tracks) ? playlist.tracks : []) {
    addIdentity(track);
  }
  sharedPlaylistIdentityCache.set(playlistId, {
    cacheKey,
    identities,
  });
  return identities;
}

function pruneSharedPlaylistIdentityCaches(activeIds: string[]) {
  const active = new Set(activeIds.map((id) => String(id || '')));
  for (const key of sharedPlaylistIdentityCache.keys()) {
    if (!active.has(key)) sharedPlaylistIdentityCache.delete(key);
  }
  for (const key of sharedPlaylistStaticIdentityKeyCache.keys()) {
    if (!active.has(key)) sharedPlaylistStaticIdentityKeyCache.delete(key);
  }
}

function buildOwnerMap(flows: Record<string, unknown>[], sharedPlaylists: Record<string, unknown>[]) {
  const ownerIds = new Set<number>();
  for (const item of [...(Array.isArray(flows) ? flows : []), ...(Array.isArray(sharedPlaylists) ? sharedPlaylists : [])]) {
    const ownerUserId = Number(item?.ownerUserId);
    if (Number.isFinite(ownerUserId)) {
      ownerIds.add(ownerUserId);
    }
  }
  const ownerMap = new Map<number, string>();
  for (const ownerUserId of ownerIds) {
    const owner = userOps.getUserById(ownerUserId);
    if (owner?.username) {
      ownerMap.set(ownerUserId, owner.username);
    }
  }
  return ownerMap;
}

export function getWeeklyFlowStatusSnapshot({
  includeJobs = false,
  flowId = null,
  jobsLimit = null,
  user = null,
} = {}) {
  const workerStatus = weeklyFlowWorker.getStatus();
  const flows = user ? flowPlaylistConfig.getFlowsForUser(user) : flowPlaylistConfig.getFlows();
  const rawSharedPlaylists = user
    ? flowPlaylistConfig.getSharedPlaylistsForUser(user)
    : flowPlaylistConfig.getSharedPlaylists();
  const flowIds = flows.map((flow: unknown) => (flow as Record<string, unknown>).id) as string[];
  const sharedPlaylistIds = rawSharedPlaylists.map((playlist: unknown) => (playlist as Record<string, unknown>).id) as string[];
  pruneSharedPlaylistIdentityCaches(sharedPlaylistIds);
  const scopedStats = downloadTracker.getStatsByPlaylistType([...flowIds, ...sharedPlaylistIds] as never[]) as Record<string, { total?: number; pending?: number; downloading?: number; done?: number; failed?: number }>;
  const sharedPlaylists = rawSharedPlaylists.map((playlist: unknown) => {
    const p = playlist as Record<string, unknown>;
    const playlistStats = scopedStats?.[p.id as string];
    const jobTotal =
      Number(playlistStats?.pending || 0) +
      Number(playlistStats?.downloading || 0) +
      Number(playlistStats?.done || 0);
    return {
      id: p.id,
      name: p.name,
      ownerUserId: p.ownerUserId ?? null,
      sourceName: p.sourceName,
      sourceFlowId: p.sourceFlowId,
      importedAt: p.importedAt,
      createdAt: p.createdAt,
      trackCount: jobTotal > 0 ? jobTotal : p.trackCount,
      trackIdentities: collectPlaylistTrackIdentities(p, playlistStats),
    };
  });
  const ownerMap = buildOwnerMap(flows as unknown as Record<string, unknown>[], sharedPlaylists as unknown as Record<string, unknown>[]);
  const flowsWithOwners = flows.map((flow: unknown) => ({
    ...(flow as Record<string, unknown>),
    ownerUsername: ownerMap.get(Number((flow as Record<string, unknown>)?.ownerUserId)) || null,
  }));
  const sharedPlaylistsWithOwners = sharedPlaylists.map((playlist: unknown) => {
    const sp = playlist as Record<string, unknown>;
    return {
      ...sp,
      ownerUsername: ownerMap.get(Number(sp?.ownerUserId)) || null,
    };
  });
  const stats = aggregateStats(scopedStats, flowIds);
  const sharedStats = aggregateStats(scopedStats, sharedPlaylistIds);
  const nextRunMessage = formatNextRunMessage(flowsWithOwners);
  const operationQueue = weeklyFlowOperationQueue.getStatus();
  const operationWorker = getWeeklyFlowOperationWorkerStatus();
  const queueLabel = String(operationQueue?.currentLabel || operationWorker?.currentLabel || '');
  let phase = 'idle';
  let message = 'Idle';
  if (operationQueue?.processing || operationWorker?.currentLabel) {
    phase = 'preparing';
    if (queueLabel.startsWith('enable:') || queueLabel.startsWith('scheduled:')) {
      message = 'Generating playlist';
    } else if (queueLabel.startsWith('disable:') || queueLabel.startsWith('delete:')) {
      message = 'Cleaning existing flow files';
    } else if (queueLabel.startsWith('reset:')) {
      message = 'Resetting flow files';
    } else {
      message = 'Generating playlist';
    }
  } else if (workerStatus?.processing) {
    phase = 'downloading';
    message = 'Downloading track';
  } else if (Number(stats?.pending || 0) > 0) {
    phase = 'queued';
    message = 'Tracks queued and waiting';
  } else if (
    Number(stats?.total || 0) > 0 &&
    Number(stats?.pending || 0) === 0 &&
    Number(stats?.downloading || 0) === 0
  ) {
    phase = 'completed';
  }
  if (phase === 'completed' && nextRunMessage) {
    message = nextRunMessage;
  }
  const flowStats: Record<string, ReturnType<typeof aggregateStats>> = {};
  for (const flowId of flowIds) {
    flowStats[flowId] = (scopedStats[flowId] || aggregateStats({}, [])) as ReturnType<typeof aggregateStats>;
  }
  const sharedPlaylistStats: Record<string, ReturnType<typeof aggregateStats>> = {};
  for (const playlistId of sharedPlaylistIds) {
    sharedPlaylistStats[playlistId] = (scopedStats[playlistId] || aggregateStats({}, [])) as ReturnType<typeof aggregateStats>;
  }
  const retryCyclePausedByPlaylist = weeklyFlowWorker.getRetryCyclePausedMap([
    ...flowIds,
    ...sharedPlaylistIds,
  ] as string[]);
  const retryCycleScheduledByPlaylist = weeklyFlowWorker.getIncompleteRetryMap([
    ...flowIds,
    ...sharedPlaylistIds,
  ] as string[]);
  let jobs;
  if (includeJobs) {
    const allowedPlaylistTypes = new Set([...flowIds, ...sharedPlaylistIds]);
    const sourceJobs = flowId
      ? allowedPlaylistTypes.has(flowId)
        ? downloadTracker.getByPlaylistType(flowId)
        : []
      : (downloadTracker
          .getAll()
          .filter((job: Record<string, unknown>) => allowedPlaylistTypes.has(String(job?.playlistType || ''))) as Record<string, unknown>[]);
    jobs = jobsLimit ? sourceJobs.slice(0, jobsLimit) : sourceJobs;
  }
  return {
    worker: {
      ...workerStatus,
      stats,
    },
    slskd: slskdClient.getStatus(),
    stats,
    flowStats,
    sharedStats,
    sharedPlaylistStats,
    jobs,
    flows: flowsWithOwners,
    sharedPlaylists: sharedPlaylistsWithOwners,
    capabilities: getFlowCapabilities(),
    retryCyclePausedByPlaylist,
    retryCycleScheduledByPlaylist,
    operationQueue,
    operationWorker,
    hint: {
      phase,
      message,
    },
  };
}
