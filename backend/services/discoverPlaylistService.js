import { getLastfmApiKey } from "./apiClients.js";
import { playlistSource } from "./weeklyFlowPlaylistSource.js";
import { flowPlaylistConfig } from "./weeklyFlowPlaylistConfig.js";
import {
  DISCOVER_PLAYLIST_PRESETS,
  RELEASE_RADAR_PRESET,
  getDiscoverPlaylistPreset,
} from "../config/discoverPlaylistPresets.js";

const FOCUS_PLAYLIST_SIZE = 20;
const MAX_FOCUS_PLAYLISTS = 5;
const PLAYLIST_BUILD_CONCURRENCY = 2;
const FOCUS_MIX = { discover: 0, mix: 0, trending: 0, focus: 100 };

const serializeTrack = (track) => ({
  artistName: track?.artistName || null,
  trackName: track?.trackName || null,
  albumName: track?.albumName || null,
  artistMbid: track?.artistMbid || null,
  albumMbid: track?.albumMbid || null,
  trackMbid: track?.trackMbid || null,
  releaseYear: track?.releaseYear || null,
  reason: track?.reason || null,
});

const slugify = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const titleCase = (value) =>
  String(value || "")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");

const uniqueStrings = (values, limit = 10) => {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = String(value || "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
};

const buildPlaylistPreview = (preset, tracks, plan = null) => {
  const mix = preset.mix || { discover: 0, mix: 0, trending: 0, focus: 0 };
  const tags = uniqueStrings(preset.tags || []);
  const relatedArtists = uniqueStrings(preset.relatedArtists || []);
  const recipe =
    preset.id === RELEASE_RADAR_PRESET.id
      ? { releaseRadar: tracks.length }
      : plan?.diagnostics?.targets || {
          discover: 0,
          mix: 0,
          trending: 0,
          focus: 0,
        };
  return {
    presetId: preset.id,
    name: preset.name,
    description: preset.description || null,
    type:
      preset.type ||
      (preset.id === RELEASE_RADAR_PRESET.id ? "release_radar" : "flow"),
    mix,
    size: Math.max(1, Math.round(Number(preset.size) || 30)),
    deepDive: preset.deepDive === true,
    tags,
    relatedArtists,
    recipe,
    tracks: tracks.map(serializeTrack),
    trackCount: tracks.length,
  };
};

const areTagsSimilar = (left, right) => {
  const a = slugify(left);
  const b = slugify(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
};

const diversifyTasteTags = (topGenres = [], topTags = []) => {
  const merged = uniqueStrings([...topGenres, ...topTags], 12);
  const out = [];
  for (const tag of merged) {
    if (out.some((existing) => areTagsSimilar(existing, tag))) continue;
    out.push(tag);
  }
  return out;
};

const buildFocusedPlaylistCandidates = ({
  topGenres = [],
  topTags = [],
  basedOn = [],
  recommendations = [],
} = {}) => {
  const candidates = [];
  const seenIds = new Set();
  const usedTagPairs = new Set();
  const usedArtistKeys = new Set();

  const addCandidate = (preset) => {
    const id = String(preset?.id || "").trim();
    if (!id || seenIds.has(id)) return false;
    const tags = uniqueStrings(preset.tags || []);
    const relatedArtists = uniqueStrings(preset.relatedArtists || []);
    if (tags.length === 0 && relatedArtists.length === 0) return false;
    seenIds.add(id);
    candidates.push({
      ...preset,
      id,
      tags,
      relatedArtists,
      size: preset.size || FOCUS_PLAYLIST_SIZE,
      type: "focus",
    });
    return true;
  };

  const tasteTags = diversifyTasteTags(topGenres, topTags);
  const seedArtists = uniqueStrings(
    basedOn.map((artist) => artist?.name || artist?.artistName),
    8,
  );

  if (tasteTags[0]) {
    addCandidate({
      id: `focus-spotlight:${slugify(tasteTags[0])}`,
      name: `${titleCase(tasteTags[0])} Spotlight`,
      description: `A deep dive into ${tasteTags[0]}`,
      mix: { ...FOCUS_MIX },
      tags: [tasteTags[0]],
      relatedArtists: [],
      deepDive: true,
    });
  }

  for (let index = 0; index < tasteTags.length - 1; index += 1) {
    const left = tasteTags[index];
    const right = tasteTags.find(
      (tag, tagIndex) => tagIndex > index && !areTagsSimilar(left, tag),
    );
    if (!right) continue;
    const pairKey = [slugify(left), slugify(right)].sort().join("::");
    if (usedTagPairs.has(pairKey)) continue;
    usedTagPairs.add(pairKey);
    addCandidate({
      id: `focus-tags:${slugify(left)}-${slugify(right)}`,
      name: `${titleCase(left)} × ${titleCase(right)}`,
      description: `Where ${left} meets ${right}`,
      mix: { ...FOCUS_MIX },
      tags: [left, right],
      relatedArtists: [],
      deepDive: true,
    });
    if (candidates.length >= MAX_FOCUS_PLAYLISTS) {
      return candidates.slice(0, MAX_FOCUS_PLAYLISTS);
    }
  }

  for (let index = 0; index < seedArtists.length; index += 1) {
    const artistName = seedArtists[index];
    const artistKey = slugify(artistName);
    if (!artistKey || usedArtistKeys.has(artistKey)) continue;
    const tag =
      tasteTags[(index * 2 + 1) % Math.max(tasteTags.length, 1)] ||
      tasteTags[0];
    if (!tag) continue;
    usedArtistKeys.add(artistKey);
    addCandidate({
      id: `focus-cross:${slugify(tag)}-${artistKey}`,
      name: `${titleCase(tag)} · Near ${artistName}`,
      description: `${tag} through ${artistName}'s orbit`,
      mix: { ...FOCUS_MIX },
      tags: [tag],
      relatedArtists: [artistName],
      deepDive: false,
    });
    if (candidates.length >= MAX_FOCUS_PLAYLISTS) {
      return candidates.slice(0, MAX_FOCUS_PLAYLISTS);
    }
  }

  const recPool = (Array.isArray(recommendations) ? recommendations : [])
    .filter((entry) => {
      const tags = [
        ...(Array.isArray(entry?.matchedTags) ? entry.matchedTags : []),
        ...(Array.isArray(entry?.tags) ? entry.tags : []),
      ];
      return tags.length > 0;
    })
    .slice(0, 10);

  for (let index = 0; index < recPool.length; index += 1) {
    const recommendation = recPool[index];
    const targetArtist = String(
      recommendation?.name || recommendation?.artistName || "",
    ).trim();
    if (!targetArtist) continue;
    const recTags = uniqueStrings(
      [
        ...(Array.isArray(recommendation.matchedTags)
          ? recommendation.matchedTags
          : []),
        ...(Array.isArray(recommendation.tags)
          ? recommendation.tags.slice(0, 2)
          : []),
      ],
      2,
    );
    const diversifiedRecTags = [];
    for (const tag of recTags) {
      if (
        diversifiedRecTags.some((existing) => areTagsSimilar(existing, tag))
      ) {
        continue;
      }
      diversifiedRecTags.push(tag);
    }
    if (diversifiedRecTags.length === 0) continue;

    const anchorArtist =
      seedArtists.find((artist) => slugify(artist) !== slugify(targetArtist)) ||
      seedArtists[index % Math.max(seedArtists.length, 1)];

    const tagLabel = diversifiedRecTags
      .map((tag) => titleCase(tag))
      .join(" + ");
    addCandidate({
      id: `focus-path:${slugify(targetArtist)}:${slugify(diversifiedRecTags.join("-"))}`,
      name:
        diversifiedRecTags.length > 1
          ? `${tagLabel} → ${targetArtist}`
          : `${titleCase(diversifiedRecTags[0])} → ${targetArtist}`,
      description: anchorArtist
        ? `${tagLabel} on the way to ${targetArtist}, via ${anchorArtist}`
        : `${tagLabel} on the way to ${targetArtist}`,
      mix: { ...FOCUS_MIX },
      tags: diversifiedRecTags,
      relatedArtists: anchorArtist ? [anchorArtist] : [],
      deepDive: false,
    });
    if (candidates.length >= MAX_FOCUS_PLAYLISTS) {
      return candidates.slice(0, MAX_FOCUS_PLAYLISTS);
    }
  }

  if (tasteTags[1] && seedArtists[1]) {
    addCandidate({
      id: `focus-bridge:${slugify(tasteTags[1])}:${slugify(seedArtists[1])}`,
      name: `${titleCase(tasteTags[1])} Bridge`,
      description: `Between ${tasteTags[1]} and ${seedArtists[1]}`,
      mix: { ...FOCUS_MIX },
      tags: [tasteTags[1]],
      relatedArtists: [seedArtists[1]],
      deepDive: true,
    });
  }

  return candidates.slice(0, MAX_FOCUS_PLAYLISTS);
};

const buildFlowConfigFromPreset = (preset) => ({
  name: preset.name,
  mix: preset.mix,
  size: preset.size,
  deepDive: preset.deepDive === true,
  tags: preset.tags || [],
  relatedArtists: preset.relatedArtists || [],
});

async function buildPlaylistFromPreset(preset, listenHistoryProfile) {
  const flow = buildFlowConfigFromPreset(preset);
  const plan = await playlistSource.buildFlowRunPlan(flow, {
    listenHistoryProfile,
    deferReserve: true,
  });
  const tracks = Array.isArray(plan?.primaryTracks) ? plan.primaryTracks : [];
  if (tracks.length === 0) return null;
  return buildPlaylistPreview(preset, tracks, plan);
}

async function buildPlaylistsFromPresets(
  presets,
  listenHistoryProfile,
  onProgress,
) {
  const playlists = [];
  const items = Array.isArray(presets) ? presets : [];
  const totalSteps = items.length + 1;
  let completed = 0;
  for (
    let index = 0;
    index < items.length;
    index += PLAYLIST_BUILD_CONCURRENCY
  ) {
    const batch = items.slice(index, index + PLAYLIST_BUILD_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (preset) => {
        try {
          return await buildPlaylistFromPreset(preset, listenHistoryProfile);
        } catch (error) {
          console.warn(
            `[DiscoverPlaylists] Failed to build ${preset.id}: ${error.message}`,
          );
          return null;
        }
      }),
    );
    playlists.push(...batchResults.filter(Boolean));
    completed = Math.min(items.length, index + batch.length);
    onProgress?.({ completed, total: totalSteps });
  }
  return { playlists, totalSteps, completedBeforeReleaseRadar: completed };
}

export async function generateDiscoverPlaylists({
  listenHistoryProfile = null,
  basedOn = [],
  topGenres = [],
  topTags = [],
  recommendations = [],
  onProgress,
} = {}) {
  if (!getLastfmApiKey()) return [];

  const focusCandidates = buildFocusedPlaylistCandidates({
    topGenres,
    topTags,
    basedOn,
    recommendations,
  });
  const { playlists: presetPlaylists, totalSteps } =
    await buildPlaylistsFromPresets(
      [...DISCOVER_PLAYLIST_PRESETS, ...focusCandidates],
      listenHistoryProfile,
      onProgress,
    );

  const playlists = [...presetPlaylists];

  try {
    const tracks = await playlistSource.getReleaseRadarTracks(
      RELEASE_RADAR_PRESET.size,
      { listenHistoryProfile, basedOn },
    );
    if (tracks.length > 0) {
      playlists.push(buildPlaylistPreview(RELEASE_RADAR_PRESET, tracks));
    }
  } catch (error) {
    console.warn(`[DiscoverPlaylists] Release radar failed: ${error.message}`);
  }

  onProgress?.({ completed: totalSteps, total: totalSteps });

  return playlists;
}

export function annotateDiscoverPlaylistsForUser(playlists, user) {
  const flows = flowPlaylistConfig.getFlowsForUser(user);
  const adoptedByPresetId = new Map();
  for (const flow of flows) {
    const presetId = String(flow?.discoverPresetId || "").trim();
    if (!presetId) continue;
    adoptedByPresetId.set(presetId, flow.id);
  }
  return (Array.isArray(playlists) ? playlists : []).map((playlist) => ({
    ...playlist,
    adoptedFlowId: adoptedByPresetId.get(playlist.presetId) || null,
  }));
}

export function getCachedDiscoverPlaylist(cache, presetId) {
  const playlists = Array.isArray(cache?.discoverPlaylists)
    ? cache.discoverPlaylists
    : [];
  return playlists.find((playlist) => playlist.presetId === presetId) || null;
}

export function buildFlowPayloadFromPreset(preset, presetId) {
  return {
    name: preset.name,
    mix: preset.mix,
    size: preset.size,
    deepDive: preset.deepDive === true,
    tags: preset.tags || [],
    relatedArtists: preset.relatedArtists || [],
    discoverPresetId: presetId,
    scheduleDays: [5],
    scheduleTime: "00:00",
  };
}

export { getDiscoverPlaylistPreset, serializeTrack };
