import { UUID_REGEX } from "../../../config/constants.js";
import { logger } from "../../../services/logger.js";
import { dbOps } from "../../../db/helpers/index.js";
import { pendingCoverRequests, fetchCoverInBackground } from "../utils.js";
import { getArtistImage } from "../../../services/imageService.js";
import { warmImageProxy } from "../../../services/imageProxyService.js";

export function registerCover(router) {
  router.get("/:mbid/cover", async (req, res) => {
    const { mbid } = req.params;
    const { refresh = false, artistName: queryArtistName } = req.query;
    const artistNameFromQuery =
      typeof queryArtistName === "string" && queryArtistName.trim()
        ? queryArtistName.trim()
        : null;

    try {
      if (!UUID_REGEX.test(mbid)) {
        return res.status(400).json({ error: "Invalid MBID format", images: [] });
      }

      if (pendingCoverRequests.has(mbid)) {
        logger.api("info", "Deduplicating cover request", { mbid });
        const result = await pendingCoverRequests.get(mbid);
        return res.json({ images: result.images || [] });
      }

      const override = dbOps.getArtistOverride(mbid);
      const resolvedMbid = override?.musicbrainzId || mbid;

      const cachedImage = dbOps.getImage(mbid);
      if (
        !refresh &&
        cachedImage &&
        cachedImage.imageUrl &&
        cachedImage.imageUrl !== "NOT_FOUND"
      ) {
        logger.api("info", "Cover cache hit", { mbid });
        res.set("Cache-Control", "public, max-age=31536000, immutable");

        const cacheAge = cachedImage.cacheAge;
        const shouldRefresh =
          !cacheAge || Date.now() - cacheAge > 7 * 24 * 60 * 60 * 1000;

        if (shouldRefresh) {
          fetchCoverInBackground(mbid, artistNameFromQuery).catch(() => {});
        }
        warmImageProxy(cachedImage.imageUrl).catch(() => {
          dbOps.deleteImage(mbid);
          fetchCoverInBackground(mbid, artistNameFromQuery).catch(() => {});
        });

        const cachedResult = await getArtistImage(mbid, {
          artistName: artistNameFromQuery,
        }).catch(() => null);

        return res.json({
          images: cachedResult?.images?.length
            ? cachedResult.images
            : [
                {
                  image: cachedImage.imageUrl,
                  front: true,
                  types: ["Front"],
                },
              ],
        });
      }

      if (
        !refresh &&
        cachedImage &&
        cachedImage.imageUrl === "NOT_FOUND" &&
        !artistNameFromQuery
      ) {
        logger.api("info", "NOT_FOUND cache", { mbid });
        res.set("Cache-Control", "public, max-age=3600");

        setTimeout(() => {
          fetchCoverInBackground(mbid, artistNameFromQuery).catch(() => {});
        }, 60000);

        return res.json({ images: [] });
      }

      logger.api("info", "Fetching cover", { mbid });

      const shouldForceRefresh =
        !!refresh ||
        (cachedImage?.imageUrl === "NOT_FOUND" && !!artistNameFromQuery);

      const fetchPromise = (async () => {
        try {
          const result = await getArtistImage(mbid, {
            forceRefresh: shouldForceRefresh,
            artistName: artistNameFromQuery,
          });
          return {
            images: result.images || [],
            notFound: !!result.notFound,
            transientError: !!result.transientError,
          };
        } catch (error) {
          logger.api("error", "Error fetching cover", { mbid, error: error.message });
          return { images: [] };
        }
      })();

      pendingCoverRequests.set(mbid, fetchPromise);
      const result = await fetchPromise;

      if (result.images && result.images.length > 0) {
        logger.api("info", "Successfully returning cover", { mbid });
        res.set("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        if (result.notFound) {
          logger.api("info", "No cover found, caching NOT_FOUND", { mbid });
          dbOps.setImage(mbid, "NOT_FOUND");
          res.set("Cache-Control", "public, max-age=3600");
        } else {
          logger.api("warn", "Cover lookup failed transiently, skipping NOT_FOUND cache", { mbid });
          res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
        }
      }

      res.json({ images: result.images || [] });
    } catch (error) {
      logger.api("error", "Error in cover route", { mbid, error: error.message });
      res.set("Cache-Control", "public, max-age=60");
      res.json({ images: [] });
    } finally {
      if (mbid) {
        pendingCoverRequests.delete(mbid);
      }
    }
  });
}
