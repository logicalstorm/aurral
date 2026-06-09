import { userOps } from "../config/db-helpers.js";
import { getLastfmApiKey } from "./apiClients.js";
import { recordFlowTracksGenerated, recordPlaylistTracksAdded } from "./aurralHistoryService.js";
import {
  buildFlowPayloadFromPreset,
  getCachedDiscoverPlaylist,
  serializeTrack,
} from "./discoverPlaylistService.js";
import { getDiscoveryCache } from "./discoveryService.js";
import {
  getListenHistoryCacheNamespace,
  getListenHistoryProfile,
} from "./listeningHistory.js";
import { downloadTracker } from "./weeklyFlowDownloadTracker.js";
import { normalizeExistingFileMode, reuseTrackForPlaylist } from "./weeklyFlowFileReuse.js";
import { flowPlaylistConfig } from "./weeklyFlowPlaylistConfig.js";
import { weeklyFlowOperationQueue } from "./weeklyFlowOperationQueue.js";
import { playlistManager } from "./weeklyFlowPlaylistManager.js";
import { weeklyFlowWorker } from "./weeklyFlowWorker.js";

const resolveDiscoverAdoptContext = (user, presetId) => {
  const reqUser = userOps.getUserById(user?.id);
  const listenHistoryProfile = getListenHistoryProfile(reqUser || user || {});
  const userCacheNamespace = getListenHistoryCacheNamespace(listenHistoryProfile);
  const effectiveCacheNamespace = getLastfmApiKey() ? userCacheNamespace : null;
  const discoveryCache = getDiscoveryCache(effectiveCacheNamespace);
  const cachedPlaylist = getCachedDiscoverPlaylist(discoveryCache, presetId);
  return { cachedPlaylist };
};

const queueSharedPlaylistTracks = async (tracks, playlistId) => {
  const settings = weeklyFlowWorker.getWorkerSettings();
  const existingFileMode = normalizeExistingFileMode(settings.existingFileMode);
  const reusedJobIds = [];
  const tracksToQueue = [];
  for (const track of Array.isArray(tracks) ? tracks : []) {
    const reuse = await reuseTrackForPlaylist(track, playlistId, {
      existingFileMode,
      weeklyFlowRoot: weeklyFlowWorker.weeklyFlowRoot,
      targetPlaylistType: playlistId,
      skipHistory: true,
    });
    if (reuse.reused) {
      reusedJobIds.push(reuse.jobId);
    } else {
      tracksToQueue.push(track);
    }
  }
  const jobIds = downloadTracker.addJobs(tracksToQueue, playlistId);
  return {
    reusedJobIds,
    jobIds,
    tracksQueued: jobIds.length,
  };
};

const wakeDownloadWorker = async () => {
  if (!weeklyFlowWorker.running) {
    await weeklyFlowWorker.start();
  } else {
    weeklyFlowWorker.wake();
  }
};

export async function adoptDiscoverPresetAsFlow(user, presetId) {
  const safePresetId = String(presetId || "").trim();
  if (!safePresetId) {
    throw Object.assign(new Error("presetId is required"), { statusCode: 400 });
  }

  const existingFlow = flowPlaylistConfig
    .getFlowsForUser(user)
    .find((flow) => flow.discoverPresetId === safePresetId);
  if (existingFlow) {
    return {
      success: true,
      flowId: existingFlow.id,
      flow: existingFlow,
      alreadyAdopted: true,
    };
  }

  const { cachedPlaylist } = resolveDiscoverAdoptContext(user, safePresetId);
  if (!cachedPlaylist || cachedPlaylist.trackCount <= 0) {
    throw Object.assign(
      new Error("Run discovery refresh to generate this playlist first"),
      { statusCode: 404, error: "Playlist preview not available" },
    );
  }

  const flow = flowPlaylistConfig.createFlow({
    ...buildFlowPayloadFromPreset(cachedPlaylist, safePresetId),
    ownerUserId: user.id,
  });
  await playlistManager.ensureSmartPlaylists();
  flowPlaylistConfig.setEnabled(flow.id, true);
  flowPlaylistConfig.scheduleNextRun(flow.id);

  const tracks = (cachedPlaylist.tracks || []).map(serializeTrack);
  const result = await weeklyFlowOperationQueue.enqueue(
    `adopt:${flow.id}`,
    async () => weeklyFlowWorker.seedFlowRunWithTracks(flow.id, flow, tracks),
  );

  await wakeDownloadWorker();

  recordFlowTracksGenerated({
    flowId: flow.id,
    tracksQueued: result?.tracksQueued || tracks.length,
    reserveTracks: 0,
  });

  return {
    success: true,
    flowId: flow.id,
    flow,
    tracksQueued: result?.tracksQueued || tracks.length,
    alreadyAdopted: false,
  };
}

export async function adoptDiscoverPresetAsPlaylist(user, presetId) {
  const safePresetId = String(presetId || "").trim();
  if (!safePresetId) {
    throw Object.assign(new Error("presetId is required"), { statusCode: 400 });
  }

  const existingPlaylist = flowPlaylistConfig
    .getSharedPlaylistsForUser(user)
    .find((playlist) => playlist.discoverPresetId === safePresetId);
  if (existingPlaylist) {
    return {
      success: true,
      playlistId: existingPlaylist.id,
      playlist: existingPlaylist,
      alreadyAdopted: true,
    };
  }

  const { cachedPlaylist } = resolveDiscoverAdoptContext(user, safePresetId);
  if (!cachedPlaylist || cachedPlaylist.trackCount <= 0) {
    throw Object.assign(
      new Error("Run discovery refresh to generate this playlist first"),
      { statusCode: 404, error: "Playlist preview not available" },
    );
  }

  const tracks = (cachedPlaylist.tracks || []).map(serializeTrack);
  const playlist = flowPlaylistConfig.createSharedPlaylist({
    name: cachedPlaylist.name,
    sourceName: cachedPlaylist.name,
    tracks,
    ownerUserId: user.id,
    discoverPresetId: safePresetId,
  });

  let tracksQueued = 0;
  let tracksReused = 0;
  if (tracks.length > 0) {
    const queued = await queueSharedPlaylistTracks(tracks, playlist.id);
    tracksQueued = queued.tracksQueued;
    tracksReused = queued.reusedJobIds.length;
    if (tracksQueued > 0) {
      await wakeDownloadWorker();
    }
    if (queued.reusedJobIds.length > 0) {
      playlistManager.scheduleScanLibrary();
    }
  }

  playlistManager.updateConfig(false);
  await playlistManager.ensureSmartPlaylists();

  if (tracksQueued + tracksReused > 0) {
    recordPlaylistTracksAdded({
      playlistId: playlist.id,
      tracksQueued,
      tracksReused,
    });
  }

  return {
    success: true,
    playlistId: playlist.id,
    playlist,
    tracksQueued,
    tracksReused,
    alreadyAdopted: false,
  };
}
