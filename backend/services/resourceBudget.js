const HEAVY_WORK_TYPES = {
  DISCOVERY_REFRESH: "discovery-refresh",
  DISCOVERY_ENRICHMENT: "discovery-enrichment",
  FLOW_HARVEST: "flow-harvest",
};

let activeType = null;
let activeLabel = null;
let activeSince = null;
const waiters = [];

const isEnabled = () => process.env.AURRAL_RESOURCE_BUDGET_ENABLED === "1";

const notifyWaiters = () => {
  while (waiters.length > 0 && !activeType) {
    const resolve = waiters.shift();
    try {
      resolve();
    } catch {}
  }
};

const releaseHeavyWork = () => {
  activeType = null;
  activeLabel = null;
  activeSince = null;
  notifyWaiters();
};

const acquireHeavyWork = async (type, label = null) => {
  if (!isEnabled()) return;
  const safeType = String(type || "").trim();
  if (!safeType) return;
  while (activeType && activeType !== safeType) {
    await new Promise((resolve) => {
      waiters.push(resolve);
    });
  }
  if (!activeType) {
    activeType = safeType;
    activeLabel = label || safeType;
    activeSince = Date.now();
  }
};

export function getResourceBudgetStatus() {
  return {
    enabled: isEnabled(),
    activeType,
    activeLabel,
    activeSince,
    waiting: waiters.length,
  };
}

export function isFlowHarvestOperation(payload = {}) {
  const kind = String(payload?.kind || payload?.label || "").trim().toLowerCase();
  if (!kind) return false;
  return [
    "manual-start-flow",
    "scheduled-flow-refresh",
    "enable-flow-refresh",
    "shared-playlist-create",
    "shared-playlist-append-tracks",
  ].includes(kind);
}

export async function withHeavyWorkBudget(type, fn, label = null) {
  await acquireHeavyWork(type, label);
  try {
    return await fn();
  } finally {
    if (activeType === type) {
      releaseHeavyWork();
    }
  }
}

export { HEAVY_WORK_TYPES };
