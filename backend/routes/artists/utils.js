import {
  getLastfmApiKey,
  lastfmGetArtistNameByMbid,
  deezerSearchArtist,
  getDeezerArtistById,
  musicbrainzGetArtistNameByMbid,
} from "../../services/apiClients.js";
import { dbOps } from "../../config/db-helpers.js";

export const parseLastFmDate = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(dateStr.split(",")[0].trim());
  if (isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
};

export const sendSSE = (res, event, data) => {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (res.flush && typeof res.flush === "function") {
      res.flush();
    }
  } catch (err) {
    console.error(`[SSE] Error sending event ${event}:`, err.message);
  }
};

export const pendingCoverRequests = new Map();
export const pendingArtistRequests = new Map();

export const fetchCoverInBackground = async (mbid) => {
  if (pendingCoverRequests.has(mbid)) return;

  const fetchPromise = (async () => {
    try {
      const { libraryManager } = await import("../../services/libraryManager.js");
      const override = dbOps.getArtistOverride(mbid);
      const resolvedMbid = override?.musicbrainzId || mbid;
      const deezerArtistId = override?.deezerArtistId || null;
      const libraryArtist = libraryManager.getArtist(mbid);
      let artistName =
        libraryArtist?.artistName ||
        (getLastfmApiKey() ? await lastfmGetArtistNameByMbid(resolvedMbid) : null) ||
        (await musicbrainzGetArtistNameByMbid(resolvedMbid));

      if (artistName) {
        try {
          const deezer = deezerArtistId
            ? await getDeezerArtistById(deezerArtistId)
            : await deezerSearchArtist(artistName);
          if (deezer?.imageUrl) {
            dbOps.setImage(mbid, deezer.imageUrl);
          }
        } catch (e) {}
      }
    } catch (e) {}
  })();

  pendingCoverRequests.set(mbid, fetchPromise);
  try {
    await fetchPromise;
  } finally {
    pendingCoverRequests.delete(mbid);
  }
};
