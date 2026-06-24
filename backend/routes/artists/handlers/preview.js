import {
  deezerGetArtistTopTracks,
  deezerGetArtistTopTracksById,
} from "../../../services/apiClients/index.js";
import { dbOps } from "../../../db/helpers/index.js";
import createRoute from "../../shared/createRoute.js";

export function registerPreview(router) {
  createRoute(router, "get", "/:mbid/preview", async (req, res) => {
    const { mbid } = req.params;
    const artistNameParam = (req.query.artistName || "").trim();
    const override = dbOps.getArtistOverride(mbid);
    const resolvedMbid = override?.musicbrainzId || mbid;
    const deezerArtistId = override?.deezerArtistId || null;

    if (deezerArtistId) {
      const tracks = await deezerGetArtistTopTracksById(deezerArtistId);
      return res.json({ tracks });
    }
    const artistName = artistNameParam || null;
    if (!artistName) {
      return res.json({ tracks: [] });
    }
    const normalized =
      artistName.replace(/\s*\([^)]*\)\s*$/, "").trim() || artistName;
    const tracks = await deezerGetArtistTopTracks(normalized);
    res.json({ tracks });
  }, { cache: 60, uuid: true });
}
