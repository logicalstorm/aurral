import { noCache } from "../../../middleware/cache.js";
import { logger } from "../../../services/logger.js";

export function registerStorageHealth(router) {
  router.get("/storage-health", noCache, async (req, res) => {
    try {
      const { runStorageHealthCheck } =
        await import("../../../services/storageHealthService.js");
      const force = req.query.force === "1" || req.query.force === "true";
      const result = await runStorageHealthCheck({ force });
      res.json({
        success: result.ok,
        ...result,
      });
    } catch (error) {
      logger.error("settings", "Storage health check error:", error);
      res.status(500).json({
        error: "Storage health check failed",
        message: error.message,
      });
    }
  });
}
