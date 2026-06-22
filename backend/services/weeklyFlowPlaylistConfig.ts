import { randomUUID } from 'crypto';
import { dbOps } from '../config/db-helpers.js';
import { downloadTracker } from './weeklyFlowDownloadTracker.js';

// --- Types ---

interface NormalizedTrack {
  artistName: string;
  trackName: string;
  albumName: string | null;
  artistMbid: string | null;
  albumMbid: string | null;
  trackMbid: string | null;
  releaseYear: string | null;
  durationMs: number | null;
  artistAliases: string[];
  reason: string | null;
}

interface FlowConfig {
  id: string;
  name: string;
  ownerUserId: number | null;
  enabled: boolean;
  scheduleDays: number[];
  scheduleTime: string;
  deepDive: boolean;
  nextRunAt: number | null;
  lastRunAt: number | null;
  size: number;
  mix: Record<string, number>;
  recipe?: Record<string, unknown>;
  tags: string[];
  relatedArtists: string[];
  discoverPresetId: string | null;
  createdAt: number;
}

interface SharedPlaylist {
  id: string;
  name: string;
  ownerUserId: number | null;
  sourceName: string | null;
  sourceFlowId: string | null;
  discoverPresetId: string | null;
  importedAt: number;
  createdAt: number;
  tracks: NormalizedTrack[];
  trackCount: number;
}

class PlaylistConfigError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

// --- Constants ---

const LEGACY_TYPES = ['discover', 'mix', 'trending'];
const DEFAULT_MIX: Record<string, number> = { discover: 34, mix: 33, trending: 33, focus: 0 };
const DEFAULT_SIZE = 30;
const DEFAULT_SCHEDULE_TIME = '00:00';
const DAY_MS = 24 * 60 * 60 * 1000;
let cachedFlows: FlowConfig[] | null = null;
let cachedSharedPlaylists: SharedPlaylist[] | null = null;

// --- Normalizers ---

const clampSize = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SIZE;
  return Math.max(Math.round(n), 1);
};

const normalizeWeightMap = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(record)) {
    const name = String(key || '').trim();
    if (!name) continue;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) continue;
    const rounded = Math.round(parsed);
    if (rounded <= 0) continue;
    out[name] = rounded;
  }
  return out;
};

const getFlowEntryName = (value: unknown): string | null => {
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).trim();
    return text || null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const candidates = [
    record.name,
    record.artistName,
    record.artist,
    record.tag,
    record.label,
    record.value,
  ];
  for (const candidate of candidates) {
    const text = String(candidate || '').trim();
    if (text) return text;
  }
  return null;
};

const normalizeStringArray = (value: unknown): string[] => {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const text = getFlowEntryName(entry);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
};

const clampCount = (value: unknown, min = 1, max = 100): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(Math.round(n), min), max);
};

const normalizeStringList = (value: unknown): string[] => {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((item: unknown) => getFlowEntryName(item)).filter((s: string | null): s is string => s !== null);
  }
  const single = getFlowEntryName(value);
  return single ? [single] : [];
};

const normalizeScheduleDays = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  const out = new Set<number>();
  for (const entry of value) {
    const day = Number(entry);
    if (!Number.isFinite(day)) continue;
    const rounded = Math.round(day);
    if (rounded < 0 || rounded > 6) continue;
    out.add(rounded);
  }
  return [...out].sort((a: number, b: number) => a - b);
};

const getDefaultScheduleDay = (timeMs = Date.now()): number => new Date(timeMs).getDay();

const normalizeScheduleTime = (value: unknown): string => {
  const text = String(value ?? '').trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return DEFAULT_SCHEDULE_TIME;
  const hours = Number(match[1]);
  if (!Number.isInteger(hours) || hours < 0 || hours > 23) {
    return DEFAULT_SCHEDULE_TIME;
  }
  return `${String(hours).padStart(2, '0')}:00`;
};

const buildScheduledTime = (baseTimeMs: unknown, scheduleTime: unknown): number => {
  const [hoursText, minutesText] = normalizeScheduleTime(scheduleTime).split(':');
  const candidate = new Date(Number(baseTimeMs));
  candidate.setHours(Number(hoursText), Number(minutesText), 0, 0);
  return candidate.getTime();
};

const computeNextRunAt = (
  scheduleDays: unknown,
  scheduleTime: unknown = DEFAULT_SCHEDULE_TIME,
  fromTimeMs = Date.now(),
): number => {
  const normalized = normalizeScheduleDays(scheduleDays);
  if (normalized.length === 0) {
    return buildScheduledTime(fromTimeMs + 7 * DAY_MS, scheduleTime);
  }
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidateBase = fromTimeMs + offset * DAY_MS;
    const candidateTime = buildScheduledTime(candidateBase, scheduleTime);
    const candidateDay = new Date(candidateTime).getDay();
    if (normalized.includes(candidateDay) && candidateTime > fromTimeMs) {
      return candidateTime;
    }
  }
  return buildScheduledTime(fromTimeMs + 7 * DAY_MS, scheduleTime);
};

const distributeCount = (total: number, values: string[]): Record<string, number> => {
  const items = values.filter(Boolean);
  if (!items.length || total <= 0) return {};
  const per = Math.floor(total / items.length);
  let remaining = total - per * items.length;
  const result: Record<string, number> = {};
  for (const item of items) {
    const extra = remaining > 0 ? 1 : 0;
    if (remaining > 0) remaining -= 1;
    result[item] = (result[item] || 0) + per + extra;
  }
  return result;
};

const extractFromBlocks = (value: unknown): {
  recipe: Record<string, number>;
  tags: Record<string, number>;
  relatedArtists: Record<string, number>;
  deepDive: boolean;
  size: number;
} | null => {
  if (!Array.isArray(value)) return null;
  const recipe: Record<string, number> = { discover: 0, mix: 0, trending: 0, focus: 0 };
  const tags: Record<string, number> = {};
  const relatedArtists: Record<string, number> = {};
  let deepDive = false;
  let total = 0;
  for (const rawBlock of value) {
    const block = rawBlock as Record<string, unknown> | null | undefined;
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    const count = clampCount(block.count);
    if (count <= 0) continue;
    total += count;
    if (block.deepDive === true) deepDive = true;
    const include = (block.include ?? {}) as Record<string, unknown>;
    const includeTags = normalizeStringList(include.tags ?? include.tag);
    const includeRelated = normalizeStringList(include.relatedArtists ?? include.relatedArtist);
    if (includeTags.length > 0) {
      const distributed = distributeCount(count, includeTags);
      for (const [tag, qty] of Object.entries(distributed)) {
        tags[tag] = (tags[tag] || 0) + qty;
      }
      continue;
    }
    if (includeRelated.length > 0) {
      const distributed = distributeCount(count, includeRelated);
      for (const [artist, qty] of Object.entries(distributed)) {
        relatedArtists[artist] = (relatedArtists[artist] || 0) + qty;
      }
      continue;
    }
    const source = String(block.source || '')
      .trim()
      .toLowerCase();
    const key = source === 'mix' ? 'mix' : source === 'trending' ? 'trending' : 'discover';
    recipe[key] += count;
  }
  if (total <= 0) return null;
  return { recipe, tags, relatedArtists, deepDive, size: total };
};

const normalizeMix = (mix: unknown): Record<string, number> => {
  const record = (mix && typeof mix === 'object' ? mix : {}) as Record<string, unknown>;
  const raw = {
    discover: Number(record.discover ?? 0),
    mix: Number(record.mix ?? 0),
    trending: Number(record.trending ?? 0),
    focus: Number(record.focus ?? 0),
  };
  const sum = raw.discover + raw.mix + raw.trending + raw.focus;
  if (!Number.isFinite(sum) || sum <= 0) {
    return { ...DEFAULT_MIX };
  }
  const weights = [
    { key: 'discover', value: raw.discover },
    { key: 'mix', value: raw.mix },
    { key: 'trending', value: raw.trending },
    { key: 'focus', value: raw.focus },
  ];
  const scaled = weights.map((w) => ({
    ...w,
    raw: (w.value / sum) * 100,
  }));
  const floored = scaled.map((w) => ({
    ...w,
    count: Math.floor(w.raw),
    remainder: w.raw - Math.floor(w.raw),
  }));
  let remaining = 100 - floored.reduce((acc, w) => acc + w.count, 0);
  const ordered = [...floored].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < ordered.length && remaining > 0; i++) {
    ordered[i].count += 1;
    remaining -= 1;
  }
  const out: Record<string, number> = {};
  for (const item of ordered) {
    out[item.key] = item.count;
  }
  return out;
};

const normalizeFlow = (flow: unknown): FlowConfig => {
  const record = (flow && typeof flow === 'object' ? flow : {}) as Record<string, unknown>;
  const name = String(record.name || '').trim();
  const blocksData = extractFromBlocks(record.blocks);
  const size = clampSize(record.size);
  const mixSource =
    record.mix ??
    (record.recipe && typeof record.recipe === 'object' ? record.recipe : null) ??
    blocksData?.recipe;
  const mix = normalizeMix(mixSource);
  const normalizedTagsArray = normalizeStringArray(record.tags);
  const normalizedRelatedArray = normalizeStringArray(record.relatedArtists);
  const legacyTags = normalizeWeightMap(record.tags);
  const legacyRelatedArtists = normalizeWeightMap(record.relatedArtists);
  const tags =
    normalizedTagsArray.length > 0
      ? normalizedTagsArray
      : Object.keys(legacyTags).length > 0
        ? Object.keys(legacyTags)
        : normalizeStringArray(Object.keys(normalizeWeightMap(blocksData?.tags)));
  const relatedArtists =
    normalizedRelatedArray.length > 0
      ? normalizedRelatedArray
      : Object.keys(legacyRelatedArtists).length > 0
        ? Object.keys(legacyRelatedArtists)
        : normalizeStringArray(Object.keys(normalizeWeightMap(blocksData?.relatedArtists)));
  const baseSize = blocksData?.size != null && blocksData.size > 0 ? blocksData.size : size;
  return {
    id: (record.id as string) || randomUUID(),
    name: name || 'Flow',
    ownerUserId:
      record.ownerUserId != null && Number.isFinite(Number(record.ownerUserId))
        ? Math.trunc(Number(record.ownerUserId))
        : null,
    enabled: record.enabled === true,
    scheduleDays: normalizeScheduleDays(record.scheduleDays),
    scheduleTime: normalizeScheduleTime(record.scheduleTime),
    deepDive: record.deepDive === true || blocksData?.deepDive === true,
    nextRunAt:
      record.nextRunAt != null && Number.isFinite(Number(record.nextRunAt))
        ? Number(record.nextRunAt)
        : null,
    lastRunAt:
      record.lastRunAt != null && Number.isFinite(Number(record.lastRunAt))
        ? Number(record.lastRunAt)
        : null,
    size: baseSize > 0 ? baseSize : size,
    mix,
    tags,
    relatedArtists,
    discoverPresetId: String(record.discoverPresetId || '').trim() || null,
    createdAt:
      record.createdAt != null && Number.isFinite(Number(record.createdAt))
        ? Number(record.createdAt)
        : Date.now(),
  };
};

// --- Track helpers ---

export const normalizeSharedTrack = (track: unknown): NormalizedTrack | null => {
  if (!track || typeof track !== 'object' || Array.isArray(track)) return null;
  const t = track as Record<string, unknown>;
  const artistName = String(
    t.artistName ?? t.artist ?? t.artist_name ?? t['Artist Name(s)'] ?? '',
  ).trim();
  const trackName = String(
    t.trackName ?? t.title ?? t.name ?? t.track ?? t['Track Name'] ?? '',
  ).trim();
  if (!artistName || !trackName) return null;
  const albumName = String(t.albumName ?? t.album ?? t['Album Name'] ?? '').trim();
  const artistMbid = String(t.artistMbid ?? t.artistId ?? t.mbid ?? '').trim();
  const albumMbid = String(t.albumMbid ?? t.releaseGroupMbid ?? t.albumId ?? '').trim();
  const trackMbid = String(t.trackMbid ?? t.recordingMbid ?? t.recordingId ?? '').trim();
  const releaseYear = String(t.releaseYear ?? t.year ?? '').trim();
  const durationMs =
    t.durationMs != null && Number.isFinite(Number(t.durationMs))
      ? Math.max(0, Math.round(Number(t.durationMs)))
      : null;
  const artistAliases = Array.isArray(t.artistAliases)
    ? (t.artistAliases as unknown[])
        .map((entry: unknown) => String(entry || '').trim())
        .filter(Boolean)
    : [];
  const reason = String(t.reason ?? '').trim();
  return {
    artistName,
    trackName,
    albumName: albumName || null,
    artistMbid: artistMbid || null,
    albumMbid: albumMbid || null,
    trackMbid: trackMbid || null,
    releaseYear: releaseYear || null,
    durationMs,
    artistAliases,
    reason: reason || null,
  };
};

export const buildSharedTrackIdentity = (track: unknown): string =>
  [
    String((track as Record<string, unknown>)?.artistName || '')
      .trim()
      .toLocaleLowerCase(),
    String((track as Record<string, unknown>)?.trackName || '')
      .trim()
      .toLocaleLowerCase(),
    String((track as Record<string, unknown>)?.albumName || '')
      .trim()
      .toLocaleLowerCase(),
    String((track as Record<string, unknown>)?.artistMbid || '').trim(),
    String((track as Record<string, unknown>)?.albumMbid || '').trim(),
    String((track as Record<string, unknown>)?.trackMbid || '').trim(),
    String((track as Record<string, unknown>)?.releaseYear || '').trim(),
  ].join('\u0001');

export const buildCoreTrackIdentity = (track: unknown): string => {
  const rec = track as Record<string, unknown>;
  const artistName = String(rec?.artistName || '')
    .trim()
    .toLocaleLowerCase();
  const trackName = String(rec?.trackName || '')
    .trim()
    .toLocaleLowerCase();
  if (!artistName || !trackName) return '';
  return `${artistName}\u0001${trackName}`;
};

export const tracksShareMembership = (left: unknown, right: unknown): boolean => {
  if (buildSharedTrackIdentity(left) === buildSharedTrackIdentity(right)) {
    return true;
  }
  const leftCore = buildCoreTrackIdentity(left);
  const rightCore = buildCoreTrackIdentity(right);
  return Boolean(leftCore) && leftCore === rightCore;
};

export const dedupeSharedTracks = (tracks: unknown): NormalizedTrack[] => {
  const seen = new Set<string>();
  const uniqueTracks: NormalizedTrack[] = [];
  for (const rawTrack of Array.isArray(tracks) ? tracks : []) {
    const normalizedTrack = normalizeSharedTrack(rawTrack);
    if (!normalizedTrack) continue;
    const identity = buildSharedTrackIdentity(normalizedTrack);
    if (seen.has(identity)) continue;
    seen.add(identity);
    uniqueTracks.push(normalizedTrack);
  }
  return uniqueTracks;
};

export const filterMissingSharedTracks = (existingTracks: unknown, incomingTracks: unknown): NormalizedTrack[] => {
  const seen = new Set<string>(
    dedupeSharedTracks(existingTracks).map((track) => buildSharedTrackIdentity(track)),
  );
  const missingTracks: NormalizedTrack[] = [];
  for (const rawTrack of Array.isArray(incomingTracks) ? incomingTracks : []) {
    const normalizedTrack = normalizeSharedTrack(rawTrack);
    if (!normalizedTrack) continue;
    const identity = buildSharedTrackIdentity(normalizedTrack);
    if (seen.has(identity)) continue;
    seen.add(identity);
    missingTracks.push(normalizedTrack);
  }
  return missingTracks;
};

// --- Shared Playlist helpers ---

const normalizeSharedPlaylist = (playlist: unknown): SharedPlaylist => {
  const record = (playlist && typeof playlist === 'object' ? playlist : {}) as Record<string, unknown>;
  const name = String(record.name || '').trim();
  const tracks = dedupeSharedTracks(record.tracks);
  return {
    id: (record.id as string) || randomUUID(),
    name: name || 'Shared Playlist',
    ownerUserId:
      record.ownerUserId != null && Number.isFinite(Number(record.ownerUserId))
        ? Math.trunc(Number(record.ownerUserId))
        : null,
    sourceName: String(record.sourceName || '').trim() || null,
    sourceFlowId: String(record.sourceFlowId || '').trim() || null,
    discoverPresetId: String(record.discoverPresetId || '').trim() || null,
    importedAt:
      record.importedAt != null && Number.isFinite(Number(record.importedAt))
        ? Number(record.importedAt)
        : Date.now(),
    createdAt:
      record.createdAt != null && Number.isFinite(Number(record.createdAt))
        ? Number(record.createdAt)
        : Date.now(),
    tracks,
    trackCount: tracks.length,
  };
};

// --- Persistence ---

const getStoredFlows = (): FlowConfig[] => {
  if (cachedFlows) {
    return cachedFlows;
  }
  const settings = dbOps.getSettings();
  const stored: unknown = settings.flows;
  if (Array.isArray(stored) && stored.length > 0) {
    const idMap = new Map<string, string>();
    let needsSave = false;
    const nextFlows: FlowConfig[] = stored.map((rawFlow: unknown) => {
      const flow = rawFlow as Record<string, unknown>;
      const currentId = flow?.id as string | undefined;
      if (LEGACY_TYPES.includes(currentId as string)) {
        const mapped = idMap.get(currentId as string) || randomUUID();
        idMap.set(currentId as string, mapped);
        needsSave = true;
        return normalizeFlow({ ...flow, id: mapped });
      }
      if (flow?.blocks) needsSave = true;
      if (!Array.isArray(flow?.scheduleDays)) needsSave = true;
      if (normalizeScheduleTime(flow?.scheduleTime) !== flow?.scheduleTime) {
        needsSave = true;
      }
      return normalizeFlow(flow);
    });
    if (idMap.size > 0 || needsSave) {
      dbOps.updateSettings({
        ...settings,
        flows: nextFlows,
      });
      downloadTracker.migratePlaylistTypes(idMap);
    }
    cachedFlows = nextFlows;
    return cachedFlows;
  }
  if (Array.isArray(stored)) {
    cachedFlows = [];
    return cachedFlows;
  }
  dbOps.updateSettings({
    ...settings,
    flows: [],
  });
  cachedFlows = [];
  return cachedFlows;
};

const setFlows = (flows: FlowConfig[]): void => {
  cachedFlows = flows;
  const current = dbOps.getSettings();
  dbOps.updateSettings({
    ...current,
    flows,
  });
};

const getStoredSharedPlaylists = (): SharedPlaylist[] => {
  if (cachedSharedPlaylists) {
    return cachedSharedPlaylists;
  }
  const settings = dbOps.getSettings();
  const stored: unknown = settings.sharedPlaylists;
  if (Array.isArray(stored)) {
    const next: SharedPlaylist[] = (stored as unknown[]).map((s: unknown) => normalizeSharedPlaylist(s));
    const needsSave =
      next.length !== stored.length ||
      next.some((playlist, index) => JSON.stringify(playlist) !== JSON.stringify(stored[index]));
    if (needsSave) {
      dbOps.updateSettings({
        ...settings,
        sharedPlaylists: next,
      });
    }
    cachedSharedPlaylists = next;
    return cachedSharedPlaylists;
  }
  dbOps.updateSettings({
    ...settings,
    sharedPlaylists: [],
  });
  cachedSharedPlaylists = [];
  return cachedSharedPlaylists;
};

const setSharedPlaylists = (playlists: SharedPlaylist[]): void => {
  cachedSharedPlaylists = playlists;
  const current = dbOps.getSettings();
  dbOps.updateSettings({
    ...current,
    sharedPlaylists: playlists,
  });
};

// --- Validation ---

const normalizeNameKey = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLowerCase();

const createNameConflictError = (name: string): PlaylistConfigError => {
  return new PlaylistConfigError(`Flow name "${name}" already exists`, 'FLOW_NAME_CONFLICT');
};

const createSharedPlaylistNameConflictError = (name: string): PlaylistConfigError => {
  return new PlaylistConfigError(
    `Shared playlist "${name}" already exists`,
    'SHARED_PLAYLIST_NAME_CONFLICT',
  );
};

const assertUniqueFlowName = (flows: FlowConfig[], nextName: unknown, exceptFlowId: string | null = null): void => {
  const key = normalizeNameKey(nextName);
  if (!key) return;
  const hasConflict = flows.some((flow: FlowConfig) => {
    if (!flow) return false;
    if (exceptFlowId && flow.id === exceptFlowId) return false;
    return normalizeNameKey(flow.name) === key;
  });
  if (hasConflict) {
    throw createNameConflictError(String(nextName || '').trim());
  }
};

const canUserAccessOwnerScopedEntity = (user: unknown, ownerUserId: unknown): boolean => {
  const record = (user && typeof user === 'object' ? user : null) as Record<string, unknown> | null;
  if (record?.role === 'admin') return true;
  if (!record || ownerUserId == null) return false;
  return Number(record.id) === Number(ownerUserId);
};

const assertUniqueSharedPlaylistName = (
  playlists: SharedPlaylist[],
  nextName: unknown,
  exceptPlaylistId: string | null = null,
): void => {
  const key = normalizeNameKey(nextName);
  if (!key) return;
  const hasConflict = playlists.some((playlist: SharedPlaylist) => {
    if (!playlist) return false;
    if (exceptPlaylistId && playlist.id === exceptPlaylistId) return false;
    return normalizeNameKey(playlist.name) === key;
  });
  if (hasConflict) {
    throw createSharedPlaylistNameConflictError(String(nextName || '').trim());
  }
};

// --- Public API ---

export const flowPlaylistConfig = {
  canUserAccessFlow(user: unknown, flow: FlowConfig): boolean {
    return canUserAccessOwnerScopedEntity(user, flow?.ownerUserId ?? null);
  },

  canUserAccessSharedPlaylist(user: unknown, playlist: SharedPlaylist): boolean {
    return canUserAccessOwnerScopedEntity(user, playlist?.ownerUserId ?? null);
  },

  getFlows(): FlowConfig[] {
    return getStoredFlows();
  },

  getFlowsForUser(user: unknown): FlowConfig[] {
    return getStoredFlows().filter((flow: FlowConfig) => this.canUserAccessFlow(user, flow));
  },

  getFlow(flowId: unknown): FlowConfig | null {
    return getStoredFlows().find((flow: FlowConfig) => flow.id === flowId) || null;
  },

  getFlowForUser(user: unknown, flowId: unknown): FlowConfig | null {
    const flow = this.getFlow(flowId);
    return this.canUserAccessFlow(user, flow as FlowConfig) ? (flow as FlowConfig) : null;
  },

  isEnabled(flowId: unknown): boolean {
    const flow = this.getFlow(flowId);
    return flow?.enabled === true;
  },

  createFlow({
    name,
    mix,
    size,
    deepDive,
    recipe,
    tags,
    relatedArtists,
    scheduleDays,
    scheduleTime,
    ownerUserId = null,
    discoverPresetId = null,
  }: {
    name: unknown;
    mix?: unknown;
    size?: unknown;
    deepDive?: unknown;
    recipe?: unknown;
    tags?: unknown;
    relatedArtists?: unknown;
    scheduleDays?: unknown;
    scheduleTime?: unknown;
    ownerUserId?: unknown;
    discoverPresetId?: unknown;
  }): FlowConfig {
    const flows = getStoredFlows();
    assertUniqueFlowName(flows, name);
    const flow = normalizeFlow({
      id: randomUUID(),
      name,
      mix,
      size,
      deepDive,
      recipe,
      tags,
      relatedArtists,
      discoverPresetId,
      scheduleDays,
      scheduleTime,
      ownerUserId,
      enabled: false,
      nextRunAt: null,
      lastRunAt: null,
    });
    flows.push(flow);
    setFlows(flows);
    return flow;
  },

  updateFlow(flowId: unknown, updates: Record<string, unknown>): FlowConfig | null {
    const flows = getStoredFlows();
    const index = flows.findIndex((flow: FlowConfig) => flow.id === flowId);
    if (index === -1) return null;
    const current = flows[index];
    const nextName = updates?.name ?? current.name;
    assertUniqueFlowName(flows, nextName, flowId as string);
    const currentSchedule = normalizeScheduleDays(current.scheduleDays);
    const currentScheduleTime = normalizeScheduleTime(current.scheduleTime);
    const next = normalizeFlow({
      ...current,
      name: nextName,
      size: updates?.size ?? current.size,
      mix: updates?.mix ?? current.mix,
      recipe: updates?.recipe ?? current.recipe,
      tags: updates?.tags ?? current.tags,
      relatedArtists: updates?.relatedArtists ?? current.relatedArtists,
      scheduleDays: updates?.scheduleDays ?? current.scheduleDays,
      scheduleTime: updates?.scheduleTime ?? current.scheduleTime,
      deepDive: typeof updates?.deepDive === 'boolean' ? updates.deepDive : current.deepDive,
      enabled: current.enabled,
      nextRunAt: current.nextRunAt,
      lastRunAt: current.lastRunAt,
      createdAt: current.createdAt,
    });
    const nextSchedule = normalizeScheduleDays(next.scheduleDays);
    const nextScheduleTime = normalizeScheduleTime(next.scheduleTime);
    const scheduleChanged =
      currentSchedule.length !== nextSchedule.length ||
      currentSchedule.some((day, idx) => day !== nextSchedule[idx]) ||
      currentScheduleTime !== nextScheduleTime;
    if (current.enabled && (scheduleChanged || next.nextRunAt == null)) {
      const now = Date.now();
      const effectiveSchedule =
        nextSchedule.length > 0 ? nextSchedule : [getDefaultScheduleDay(now)];
      next.scheduleDays = effectiveSchedule;
      next.nextRunAt = computeNextRunAt(effectiveSchedule, nextScheduleTime, now);
    }
    flows[index] = next;
    setFlows(flows);
    return next;
  },

  deleteFlow(flowId: unknown): boolean {
    const flows = getStoredFlows();
    const next = flows.filter((flow: FlowConfig) => flow.id !== flowId);
    if (next.length === flows.length) return false;
    setFlows(next);
    return true;
  },

  setEnabled(flowId: unknown, enabled: unknown): FlowConfig | null {
    const flows = getStoredFlows();
    const index = flows.findIndex((flow: FlowConfig) => flow.id === flowId);
    if (index === -1) return null;
    const flow = { ...flows[index], enabled: enabled === true };
    if (!flow.enabled) {
      flow.nextRunAt = null;
    }
    flows[index] = flow;
    setFlows(flows);
    return flow;
  },

  setNextRunAt(flowId: unknown, nextRunAt: unknown): FlowConfig | null {
    const flows = getStoredFlows();
    const index = flows.findIndex((flow: FlowConfig) => flow.id === flowId);
    if (index === -1) return null;
    const flow = { ...flows[index] };
    flow.nextRunAt =
      nextRunAt != null && Number.isFinite(Number(nextRunAt)) ? Number(nextRunAt) : null;
    flows[index] = flow;
    setFlows(flows);
    return flow;
  },

  markLastRunAt(flowId: unknown, lastRunAt: unknown = Date.now()): FlowConfig | null {
    const flows = getStoredFlows();
    const index = flows.findIndex((flow: FlowConfig) => flow.id === flowId);
    if (index === -1) return null;
    const flow = { ...flows[index] };
    flow.lastRunAt =
      lastRunAt != null && Number.isFinite(Number(lastRunAt)) ? Number(lastRunAt) : Date.now();
    flows[index] = flow;
    setFlows(flows);
    return flow;
  },

  scheduleNextRun(flowId: unknown): FlowConfig | null {
    const flows = getStoredFlows();
    const index = flows.findIndex((flow: FlowConfig) => flow.id === flowId);
    if (index === -1) return null;
    const now = Date.now();
    const flow = { ...flows[index] };
    const normalizedSchedule = normalizeScheduleDays(flow.scheduleDays);
    flow.scheduleDays =
      normalizedSchedule.length > 0 ? normalizedSchedule : [getDefaultScheduleDay(now)];
    flow.scheduleTime = normalizeScheduleTime(flow.scheduleTime);
    flow.nextRunAt = computeNextRunAt(flow.scheduleDays, flow.scheduleTime, now);
    flows[index] = flow;
    setFlows(flows);
    return flow;
  },

  getDueForRefresh(): FlowConfig[] {
    const now = Date.now();
    return getStoredFlows().filter(
      (flow: FlowConfig) => flow.enabled === true && flow.nextRunAt != null && flow.nextRunAt <= now,
    );
  },

  getSharedPlaylists(): SharedPlaylist[] {
    return getStoredSharedPlaylists();
  },

  getSharedPlaylistsForUser(user: unknown): SharedPlaylist[] {
    return getStoredSharedPlaylists().filter((playlist: SharedPlaylist) =>
      this.canUserAccessSharedPlaylist(user, playlist),
    );
  },

  getSharedPlaylistSummaries(): Array<{
    id: string;
    name: string;
    ownerUserId: number | null;
    sourceName: string | null;
    sourceFlowId: string | null;
    importedAt: number;
    createdAt: number;
    trackCount: number;
  }> {
    return getStoredSharedPlaylists().map((playlist: SharedPlaylist) => ({
      id: playlist.id,
      name: playlist.name,
      ownerUserId: playlist.ownerUserId,
      sourceName: playlist.sourceName,
      sourceFlowId: playlist.sourceFlowId,
      importedAt: playlist.importedAt,
      createdAt: playlist.createdAt,
      trackCount: playlist.trackCount,
    }));
  },

  getSharedPlaylist(playlistId: unknown): SharedPlaylist | null {
    return (
      getStoredSharedPlaylists().find((playlist: SharedPlaylist) => playlist.id === playlistId) ||
      null
    );
  },

  getSharedPlaylistForUser(user: unknown, playlistId: unknown): SharedPlaylist | null {
    const playlist = this.getSharedPlaylist(playlistId);
    return this.canUserAccessSharedPlaylist(user, playlist as SharedPlaylist)
      ? (playlist as SharedPlaylist)
      : null;
  },

  createSharedPlaylist({
    id = null,
    name,
    sourceName,
    sourceFlowId,
    discoverPresetId = null,
    tracks = [],
    ownerUserId = null,
  }: {
    id?: unknown;
    name: unknown;
    sourceName?: unknown;
    sourceFlowId?: unknown;
    discoverPresetId?: unknown;
    tracks?: unknown;
    ownerUserId?: unknown;
  }): SharedPlaylist {
    const playlists = getStoredSharedPlaylists();
    assertUniqueSharedPlaylistName(playlists, name);
    const playlist = normalizeSharedPlaylist({
      id: String(id || '').trim() || randomUUID(),
      name,
      ownerUserId,
      sourceName,
      sourceFlowId,
      discoverPresetId,
      tracks,
      importedAt: Date.now(),
      createdAt: Date.now(),
    });
    playlists.push(playlist);
    setSharedPlaylists(playlists);
    return playlist;
  },

  appendSharedPlaylistTracks(playlistId: unknown, tracks: unknown): SharedPlaylist | null {
    const playlists = getStoredSharedPlaylists();
    const index = playlists.findIndex((playlist: SharedPlaylist) => playlist.id === playlistId);
    if (index === -1) return null;
    const current = playlists[index];
    const appendedTracks = filterMissingSharedTracks(current.tracks, tracks);
    const next = normalizeSharedPlaylist({
      ...current,
      tracks: [...current.tracks, ...appendedTracks],
      importedAt: current.importedAt,
      createdAt: current.createdAt,
    });
    playlists[index] = next;
    setSharedPlaylists(playlists);
    return next;
  },

  updateSharedPlaylist(playlistId: unknown, updates: Record<string, unknown>): SharedPlaylist | null {
    const playlists = getStoredSharedPlaylists();
    const index = playlists.findIndex((playlist: SharedPlaylist) => playlist.id === playlistId);
    if (index === -1) return null;
    const current = playlists[index];
    const nextName = updates?.name ?? current.name;
    assertUniqueSharedPlaylistName(playlists, nextName, playlistId as string);
    const next = normalizeSharedPlaylist({
      ...current,
      name: nextName,
      sourceName: updates?.sourceName ?? current.sourceName,
      sourceFlowId: updates?.sourceFlowId ?? current.sourceFlowId,
      discoverPresetId: updates?.discoverPresetId ?? current.discoverPresetId,
      tracks: Array.isArray(updates?.tracks) ? updates.tracks : current.tracks,
      importedAt: current.importedAt,
      createdAt: current.createdAt,
    });
    playlists[index] = next;
    setSharedPlaylists(playlists);
    return next;
  },

  deleteSharedPlaylist(playlistId: unknown): boolean {
    const playlists = getStoredSharedPlaylists();
    const next = playlists.filter((playlist: SharedPlaylist) => playlist.id !== playlistId);
    if (next.length === playlists.length) return false;
    setSharedPlaylists(next);
    return true;
  },
};
