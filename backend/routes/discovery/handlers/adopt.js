import { requireAuth, requirePermission } from "../../../middleware/requirePermission.js";
import { SLSKD_NOT_CONFIGURED_MESSAGE, handleDiscoverAdoptError } from "./utils.js";

export function registerAdoptRoutes(router) {
  router.post(
    "/playlists/adopt",
    requireAuth,
    requirePermission("accessFlow"),
    async (req, res) => {
      try {
        const presetId = String(req.body?.presetId || "").trim();
        if (!presetId) {
          return res.status(400).json({ error: "presetId is required" });
        }

        const { slskdClient } = await import("../../../services/slskdClient.js");
        if (!slskdClient.isConfigured()) {
          return res.status(400).json({
            error: "slskd not configured",
            message: SLSKD_NOT_CONFIGURED_MESSAGE,
          });
        }

        const { adoptDiscoverPresetAsFlow } =
          await import("../../../services/discovery/playlistAdopt.js");
        const result = await adoptDiscoverPresetAsFlow(req.user, presetId);
        res.json(result);
      } catch (error) {
        handleDiscoverAdoptError(
          res,
          error,
          "Failed to adopt discover playlist",
        );
      }
    },
  );

  router.post(
    "/playlists/adopt-playlist",
    requireAuth,
    requirePermission("accessFlow"),
    async (req, res) => {
      try {
        const presetId = String(req.body?.presetId || "").trim();
        if (!presetId) {
          return res.status(400).json({ error: "presetId is required" });
        }

        const { slskdClient } = await import("../../../services/slskdClient.js");
        if (!slskdClient.isConfigured()) {
          return res.status(400).json({
            error: "slskd not configured",
            message: SLSKD_NOT_CONFIGURED_MESSAGE,
          });
        }

        const { adoptDiscoverPresetAsPlaylist } =
          await import("../../../services/discovery/playlistAdopt.js");
        const result = await adoptDiscoverPresetAsPlaylist(req.user, presetId);
        res.json(result);
      } catch (error) {
        handleDiscoverAdoptError(
          res,
          error,
          "Failed to adopt discover playlist",
        );
      }
    },
  );
}
