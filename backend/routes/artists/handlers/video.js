import { youtubeFindTopSongVideo } from "../../../services/apiClients/index.js";
import createRoute from "../../shared/createRoute.js";

export function registerVideo(router) {
  createRoute(router, "get", "/:mbid/video", async (req, res) => {
    const { mbid } = req.params;
    const artistName = String(req.query.artistName || "").trim();
    const trackTitle = String(req.query.trackTitle || "").trim();

    if (!artistName || !trackTitle) {
      return res.json({ video: null });
    }

    const video = await youtubeFindTopSongVideo(artistName, trackTitle);
    return res.json({ video });
  }, { cache: 3600, uuid: true });
}
