import { UUID_REGEX } from "../../../config/constants.js";
import {
  getLastfmApiKey,
  lastfmGetArtistNameByMbid,
  deezerGetArtistTopTracks,
} from "../../../services/apiClients.js";
import { cacheMiddleware } from "../../../middleware/cache.js";

export default function registerPreview(router) {
  router.get("/:mbid/preview", cacheMiddleware(60), async (req, res) => {
    try {
      const { mbid } = req.params;
      const artistNameParam = (req.query.artistName || "").trim();
      if (!UUID_REGEX.test(mbid)) {
        return res.status(400).json({ error: "Invalid MBID format", tracks: [] });
      }
      let artistName =
        artistNameParam ||
        (getLastfmApiKey() ? await lastfmGetArtistNameByMbid(mbid) : null) ||
        null;
      if (!artistName) {
        return res.json({ tracks: [] });
      }
      const normalized =
        artistName.replace(/\s*\([^)]*\)\s*$/, "").trim() || artistName;
      const tracks = await deezerGetArtistTopTracks(normalized);
      res.json({ tracks });
    } catch (error) {
      res.json({ tracks: [] });
    }
  });
}
