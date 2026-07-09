import crypto from "crypto";
import { dbOps } from "../db/helpers/index.js";
import { downloadTracker } from "./weeklyFlow/weeklyFlowDownloadTracker.js";
import { flowPlaylistConfig } from "./weeklyFlow/weeklyFlowPlaylistConfig.js";

const tokenEquals = (left, right) => {
  const a = String(left || "").trim();
  const b = String(right || "").trim();
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
};

export const buildLidarrImportListItems = (jobs) => {
  const seen = new Set();
  const items = [];
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const artistMbid = String(job?.artistMbid || "").trim();
    if (!artistMbid) continue;
    const albumMbid = String(job?.albumMbid || "").trim();
    const key = albumMbid ? `${artistMbid}\u0001${albumMbid}` : artistMbid;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = { MusicBrainzId: artistMbid };
    if (albumMbid) entry.AlbumId = albumMbid;
    items.push(entry);
  }
  return items;
};

export const buildFlowLidarrImportList = (flowId) => {
  const flow = flowPlaylistConfig.getFlow(flowId);
  if (!flow) return null;
  const jobs = downloadTracker.getByPlaylistType(flowId);
  return buildLidarrImportListItems(jobs);
};

export const verifyFlowLidarrFeedToken = (flowId, token) => {
  const flow = flowPlaylistConfig.getFlow(flowId);
  if (!flow?.lidarrFeedToken) return null;
  if (!tokenEquals(flow.lidarrFeedToken, token)) return null;
  return flow;
};

const parseHostname = (value) => {
  try {
    return new URL(String(value || "").trim()).hostname;
  } catch {
    return "";
  }
};

const isLoopbackHost = (hostname) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

export const resolveLidarrFeedBaseUrl = ({
  req,
  lidarrUrl = dbOps.getSettings()?.integrations?.lidarr?.url || "",
  publicUrl = process.env.AURRAL_PUBLIC_URL || "",
  port = process.env.PORT || 3001,
} = {}) => {
  const fromEnv = String(publicUrl || "").trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;

  const lidarrHost = parseHostname(lidarrUrl);
  const reqHost = String(req?.get?.("x-forwarded-host") || req?.get?.("host") || "")
    .split(",")[0]
    .trim();
  const [reqHostname, reqPortPart] = reqHost.split(":");
  const feedPort = reqPortPart || String(port);

  if (lidarrHost && !isLoopbackHost(lidarrHost) && !/^\d+\.\d+\.\d+\.\d+$/.test(lidarrHost)) {
    return `http://aurral:${feedPort}`;
  }

  if (isLoopbackHost(reqHostname)) {
    return `http://127.0.0.1:${feedPort}`;
  }

  const proto = String(req?.get?.("x-forwarded-proto") || req?.protocol || "http")
    .split(",")[0]
    .trim();
  return reqHost ? `${proto}://${reqHost}` : null;
};

export const buildFlowLidarrFeedUrl = (req, flowId, token) => {
  const baseUrl = resolveLidarrFeedBaseUrl({ req });
  if (!baseUrl) return null;
  const query = new URLSearchParams({ token: String(token || "").trim() });
  return `${baseUrl}/api/feeds/lidarr/flows/${encodeURIComponent(flowId)}.json?${query}`;
};
