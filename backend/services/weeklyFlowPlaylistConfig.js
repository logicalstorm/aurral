import { randomUUID } from "crypto";
import { dbOps } from "../config/db-helpers.js";
import { downloadTracker } from "./weeklyFlowDownloadTracker.js";

const LEGACY_TYPES = ["discover", "mix", "trending"];
const DEFAULT_MIX = { discover: 34, mix: 33, trending: 33 };
const DEFAULT_SIZE = 30;
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
  return Math.max(Math.round(n), 1);
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

const clampCount = (value, min = 1, max = 100) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(Math.round(n), min), max);
};

const normalizeStringList = (value) => {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
};

const normalizeMatch = (value) => (value === "all" ? "all" : "any");

const normalizeInclude = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { tags: [], artists: [], relatedArtists: [], match: "any" };
  }
  return {
    tags: normalizeStringList(value.tags ?? value.tag),
    artists: normalizeStringList(value.artists ?? value.artist),
    relatedArtists: normalizeStringList(
      value.relatedArtists ?? value.relatedArtist,
    ),
    match: normalizeMatch(value.match ?? value.tagsMatch),
  };
};

const normalizeExclude = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { tags: [], artists: [], relatedArtists: [] };
  }
  return {
    tags: normalizeStringList(value.tags ?? value.tag),
    artists: normalizeStringList(value.artists ?? value.artist),
    relatedArtists: normalizeStringList(
      value.relatedArtists ?? value.relatedArtist,
    ),
  };
};

const normalizeBlock = (block) => {
  if (!block || typeof block !== "object" || Array.isArray(block)) return null;
  const source = String(block.source || "")
    .trim()
    .toLowerCase() || "discover";
  const count = clampCount(block.count);
  if (count <= 0) return null;
  return {
    source: source === "recommended" ? "recommended" : source,
    count,
    deepDive: block.deepDive === true,
    include: normalizeInclude(block.include),
    exclude: normalizeExclude(block.exclude),
  };
};

const buildLegacyBlocks = (flow, size, mix, tags, relatedArtists) => {
  const blocks = [];
  const recipeFallback = buildCountsFromMix(size, mix);
  const recipe = normalizeRecipeCounts(flow?.recipe, recipeFallback);
  for (const [key, count] of Object.entries(recipe)) {
    if (count > 0) {
      blocks.push({
        source: key,
        count,
        deepDive: flow?.deepDive === true,
        include: { tags: [], artists: [], relatedArtists: [], match: "any" },
        exclude: { tags: [], artists: [], relatedArtists: [] },
      });
    }
  }
  for (const [tag, count] of Object.entries(tags)) {
    if (count > 0) {
      blocks.push({
        source: "all",
        count,
        deepDive: flow?.deepDive === true,
        include: { tags: [tag], artists: [], relatedArtists: [], match: "any" },
        exclude: { tags: [], artists: [], relatedArtists: [] },
      });
    }
  }
  for (const [artist, count] of Object.entries(relatedArtists)) {
    if (count > 0) {
      blocks.push({
        source: "all",
        count,
        deepDive: flow?.deepDive === true,
        include: {
          tags: [],
          artists: [],
          relatedArtists: [artist],
          match: "any",
        },
        exclude: { tags: [], artists: [], relatedArtists: [] },
      });
    }
  }
  return blocks;
};

const normalizeBlocks = (value, flow, size, mix, tags, relatedArtists) => {
  if (Array.isArray(value)) {
    return value.map(normalizeBlock).filter(Boolean);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([key]) => /^block\d+$/i.test(String(key)))
      .map(([key, val]) => ({
        key,
        order: Number(String(key).replace(/^\D+/, "")) || 0,
        value: val,
      }))
      .sort((a, b) => a.order - b.order);
    const normalized = entries.map((entry) => normalizeBlock(entry.value)).filter(Boolean);
    if (normalized.length > 0) return normalized;
  }
  return buildLegacyBlocks(flow, size, mix, tags, relatedArtists);
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
  const blocks = normalizeBlocks(
    flow?.blocks,
    flow,
    size,
    mix,
    tags,
    relatedArtists,
  );
  const computedSize = blocks.reduce((acc, block) => acc + block.count, 0);
  const recipeSize = Math.max(
    (computedSize || size) - sumWeightMap(tags) - sumWeightMap(relatedArtists),
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
    size: computedSize > 0 ? computedSize : size,
    mix,
    recipe: normalizeRecipeCounts(flow?.recipe, recipeFallback),
    tags,
    relatedArtists,
    blocks,
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
    return normalizeFlow({
      id: randomUUID(),
      name: titleCase(type),
      enabled: legacy.enabled === true,
      nextRunAt: legacy.nextRunAt ?? null,
      size: DEFAULT_SIZE,
      blocks: [
        {
          source: type,
          count: DEFAULT_SIZE,
          deepDive: false,
          include: { tags: [], artists: [], relatedArtists: [], match: "any" },
          exclude: { tags: [], artists: [], relatedArtists: [] },
        },
      ],
    });
  });
};

const getStoredFlows = () => {
  const settings = dbOps.getSettings();
  const stored = settings.weeklyFlows;
  if (Array.isArray(stored) && stored.length > 0) {
    const idMap = new Map();
    const nextFlows = stored.map((flow) => {
      const currentId = flow?.id;
      if (LEGACY_TYPES.includes(currentId)) {
        const mapped = idMap.get(currentId) || randomUUID();
        idMap.set(currentId, mapped);
        return normalizeFlow({ ...flow, id: mapped });
      }
      return normalizeFlow(flow);
    });
    if (idMap.size > 0) {
      dbOps.updateSettings({
        ...settings,
        weeklyFlows: nextFlows,
      });
      downloadTracker.migratePlaylistTypes(idMap);
    }
    return nextFlows;
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

  createFlow({
    name,
    mix,
    size,
    deepDive,
    recipe,
    tags,
    relatedArtists,
    blocks,
  }) {
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
      blocks,
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
      blocks: updates?.blocks ?? current.blocks,
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
