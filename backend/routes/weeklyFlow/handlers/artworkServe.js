import { playlistManager } from "../../../services/weeklyFlowPlaylistManager.js";
import { noCache } from "../../../middleware/cache.js";
import { hasPermission, verifyTokenAuth } from "../../../middleware/auth.js";
import { canAccessPlaylistType } from "./utils.js";

export default function register(router) {
  router.get("/artwork/:playlistId", noCache, async (req, res) => {
    if (!verifyTokenAuth(req)) {
      return res
        .status(401)
        .json({ error: "Unauthorized", message: "Authentication required" });
    }
    if (req.user && !hasPermission(req.user, "accessFlow")) {
      return res
        .status(403)
        .json({ error: "Forbidden", message: "Permission required: accessFlow" });
    }

    const { playlistId } = req.params;
    if (!canAccessPlaylistType(req.user, playlistId)) {
      return res.status(404).json({ error: "Playlist artwork not found" });
    }
    const artwork = await playlistManager.resolveArtworkFile(playlistId);
    if (!artwork) {
      return res.status(404).json({ error: "Playlist artwork not found" });
    }

    const { getArtworkContentTypeForExtension } =
      await import("../../services/playlistArtworkGenerator.js");
    res.type(getArtworkContentTypeForExtension(artwork.extension));
    res.sendFile(artwork.safePath);
  });
}
