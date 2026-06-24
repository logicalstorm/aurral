import { UUID_REGEX } from "../../config/constants.js";
import { cacheMiddleware, noCache as noCacheMiddleware } from "../../middleware/cache.js";
import { requireAuth as requireAuthMiddleware } from "../../middleware/requirePermission.js";
import { verifyTokenAuth } from "../../middleware/auth.js";
import { dbOps } from "../../db/helpers/index.js";

export default function createRoute(router, method, path, handler, options = {}) {
  const middlewares = [];

  if (options.noCache) {
    middlewares.push(noCacheMiddleware);
  } else if (options.cache != null) {
    middlewares.push(cacheMiddleware(options.cache));
  }

  const wrappedHandler = async (req, res) => {
    try {
      if (options.uuid) {
        const mbid = req.params.mbid;
        if (mbid && !UUID_REGEX.test(mbid)) {
          return res.status(400).json({
            error: "Invalid MBID format",
            message: `"${mbid}" is not a valid MusicBrainz ID. MBIDs must be UUIDs.`,
          });
        }
      }

      if (options.auth === "verifyToken" && !verifyTokenAuth(req)) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "Authentication required",
        });
      }
      if (options.auth === "requireAuth") {
        requireAuthMiddleware(req, res, () => {});
        if (res.headersSent) return;
      }

      if (options.resolveOverride) {
        const mbid = req.params.mbid;
        if (mbid) {
          const override = dbOps.getArtistOverride(mbid);
          req.resolvedMbid = override?.musicbrainzId || mbid;
        }
      }

      await handler(req, res);
    } catch (error) {
      res.status(500).json({
        error: "Internal server error",
        message: error.message,
      });
    }
  };

  router[method](path, ...middlewares, wrappedHandler);
}
