import { randomUUID } from "crypto";
import { dbOps } from "../config/db-helpers.js";

const LEGACY_TYPES = ["discover", "mix", "trending"];
const DEFAULT_MIX = { discover: 34, mix: 33, trending: 33 };
const DEFAULT_SIZE = 30;
const MIN_SIZE = 10;
const MAX_SIZE = 50;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const titleCase = (value) =>
  String(value || "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");

const clampSize = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SIZE;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n)));
};

const normalizeWeightMap = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const name = String(key || "").trim();
    if (!name) continue;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) continue;
    const rounded = Math.round(parsed);
    if (rounded <= 0) continue;
    out[name] = rounded;
  }
  return out;
};

const sumWeightMap = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  return Object.values(value).reduce((acc, entry) => {
    const parsed = Number(entry);
    return acc + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);
};

const normalizeRecipeCounts = (value, fallback) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback ?? { discover: 0, mix: 0, trending: 0 };
  }
  const parseField = (entry) => {
    const parsed = Number(entry);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(Math.round(parsed), 0);
  };
  return {
    discover: parseField(value?.discover ?? 0),
    mix: parseField(value?.mix ?? 0),
    trending: parseField(value?.trending ?? 0),
  };
};

const buildCountsFromMix = (size, mix) => {
  const weights = [
    { key: "discover", value: Number(mix?.discover ?? 0) },
    { key: "mix", value: Number(mix?.mix ?? 0) },
    { key: "trending", value: Number(mix?.trending ?? 0) },
  ];
  const sum = weights.reduce(
    (acc, w) => acc + (Number.isFinite(w.value) ? w.value : 0),
    0,
  );
  if (sum <= 0 || !Number.isFinite(sum) || size <= 0) {
    return { discover: 0, mix: 0, trending: 0 };
  }
  const scaled = weights.map((w) => ({
    ...w,
    raw: (w.value / sum) * size,
  }));
  const floored = scaled.map((w) => ({
    ...w,
    count: Math.floor(w.raw),
    remainder: w.raw - Math.floor(w.raw),
  }));
  let remaining = size - floored.reduce((acc, w) => acc + w.count, 0);
  const ordered = [...floored].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < ordered.length && remaining > 0; i++) {
    ordered[i].count += 1;
    remaining -= 1;
  }
  const out = {};
  for (const item of ordered) {
    out[item.key] = item.count;
  }
  return out;
};

const normalizeMix = (mix) => {
  const raw = {
    discover: Number(mix?.discover ?? 0),
    mix: Number(mix?.mix ?? 0),
    trending: Number(mix?.trending ?? 0),
  };
  const sum = raw.discover + raw.mix + raw.trending;
  if (!Number.isFinite(sum) || sum <= 0) {
    return { ...DEFAULT_MIX };
  }
  const weights = [
    { key: "discover", value: raw.discover },
    { key: "mix", value: raw.mix },
    { key: "trending", value: raw.trending },
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
  const out = {};
  for (const item of ordered) {
    out[item.key] = item.count;
  }
  return out;
};

const normalizeFlow = (flow) => {
  const name = String(flow?.name || "").trim();
  const size = clampSize(flow?.size);
  const mix = normalizeMix(flow?.mix);
  const tags = normalizeWeightMap(flow?.tags);
  const relatedArtists = normalizeWeightMap(flow?.relatedArtists);
  const recipeSize = Math.max(
    size - sumWeightMap(tags) - sumWeightMap(relatedArtists),
    0,
  );
  const recipeFallback = buildCountsFromMix(recipeSize, mix);
  return {
    id: flow?.id || randomUUID(),
    name: name || "Flow",
    enabled: flow?.enabled === true,
    deepDive: flow?.deepDive === true,
    nextRunAt:
      flow?.nextRunAt != null && Number.isFinite(Number(flow.nextRunAt))
        ? Number(flow.nextRunAt)
        : null,
    size,
    mix,
    recipe: normalizeRecipeCounts(flow?.recipe, recipeFallback),
    tags,
    relatedArtists,
    createdAt:
      flow?.createdAt != null && Number.isFinite(Number(flow.createdAt))
        ? Number(flow.createdAt)
        : Date.now(),
  };
};

const buildLegacyFlows = (settings) => {
  const playlists = settings.weeklyFlowPlaylists || {};
  return LEGACY_TYPES.map((type) => {
    const legacy = playlists[type] || {};
    const mix = {
      discover: type === "discover" ? 100 : 0,
      mix: type === "mix" ? 100 : 0,
      trending: type === "trending" ? 100 : 0,
    };
    return normalizeFlow({
      id: type,
      name: titleCase(type),
      enabled: legacy.enabled === true,
      nextRunAt: legacy.nextRunAt ?? null,
      mix,
      size: DEFAULT_SIZE,
    });
  });
};

const getStoredFlows = () => {
  const settings = dbOps.getSettings();
  const stored = settings.weeklyFlows;
  if (Array.isArray(stored) && stored.length > 0) {
    return stored.map((flow) => normalizeFlow(flow));
  }
  const legacy = buildLegacyFlows(settings);
  dbOps.updateSettings({
    ...settings,
    weeklyFlows: legacy,
  });
  return legacy;
};

const setFlows = (flows) => {
  const current = dbOps.getSettings();
  dbOps.updateSettings({
    ...current,
    weeklyFlows: flows,
  });
};

export const flowPlaylistConfig = {
  getFlows() {
    return getStoredFlows();
  },

  getFlow(flowId) {
    return getStoredFlows().find((flow) => flow.id === flowId) || null;
  },

  isEnabled(flowId) {
    const flow = this.getFlow(flowId);
    return flow?.enabled === true;
  },

  createFlow({ name, mix, size, deepDive, recipe, tags, relatedArtists }) {
    const flows = getStoredFlows();
    const flow = normalizeFlow({
      id: randomUUID(),
      name,
      mix,
      size,
      deepDive,
      recipe,
      tags,
      relatedArtists,
      enabled: false,
      nextRunAt: null,
    });
    flows.push(flow);
    setFlows(flows);
    return flow;
  },

  updateFlow(flowId, updates) {
    const flows = getStoredFlows();
    const index = flows.findIndex((flow) => flow.id === flowId);
    if (index === -1) return null;
    const current = flows[index];
    const next = normalizeFlow({
      ...current,
      name: updates?.name ?? current.name,
      size: updates?.size ?? current.size,
      mix: updates?.mix ?? current.mix,
      recipe: updates?.recipe ?? current.recipe,
      tags: updates?.tags ?? current.tags,
      relatedArtists: updates?.relatedArtists ?? current.relatedArtists,
      deepDive:
        typeof updates?.deepDive === "boolean"
          ? updates.deepDive
          : current.deepDive,
      enabled: current.enabled,
      nextRunAt: current.nextRunAt,
      createdAt: current.createdAt,
    });
    flows[index] = next;
    setFlows(flows);
    return next;
  },

  deleteFlow(flowId) {
    const flows = getStoredFlows();
    const next = flows.filter((flow) => flow.id !== flowId);
    if (next.length === flows.length) return false;
    setFlows(next);
    return true;
  },

  setEnabled(flowId, enabled) {
    const flows = getStoredFlows();
    const index = flows.findIndex((flow) => flow.id === flowId);
    if (index === -1) return null;
    const flow = { ...flows[index], enabled: enabled === true };
    if (!flow.enabled) {
      flow.nextRunAt = null;
    }
    flows[index] = flow;
    setFlows(flows);
    return flow;
  },

  setNextRunAt(flowId, nextRunAt) {
    const flows = getStoredFlows();
    const index = flows.findIndex((flow) => flow.id === flowId);
    if (index === -1) return null;
    const flow = { ...flows[index] };
    flow.nextRunAt =
      nextRunAt != null && Number.isFinite(Number(nextRunAt))
        ? Number(nextRunAt)
        : null;
    flows[index] = flow;
    setFlows(flows);
    return flow;
  },

  scheduleNextRun(flowId) {
    return this.setNextRunAt(flowId, Date.now() + WEEK_MS);
  },

  getDueForRefresh() {
    const now = Date.now();
    return getStoredFlows().filter(
      (flow) =>
        flow.enabled === true &&
        flow.nextRunAt != null &&
        flow.nextRunAt <= now,
    );
  },
};
