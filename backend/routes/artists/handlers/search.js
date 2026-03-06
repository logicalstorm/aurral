import { musicbrainzRequest } from "../../../services/apiClients.js";
import { imagePrefetchService } from "../../../services/imagePrefetchService.js";
import { dbOps } from "../../../config/db-helpers.js";
import { cacheMiddleware } from "../../../middleware/cache.js";

const handleSearch = async (req, res) => {
  try {
    const { query, limit = 24, offset = 0 } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Query parameter is required" });
    }

    const limitInt = parseInt(limit) || 24;
    const offsetInt = parseInt(offset) || 0;

    try {
      const mbData = await musicbrainzRequest("/artist", {
        query,
        limit: limitInt,
        offset: offsetInt,
      });

      const artists = Array.isArray(mbData?.artists) ? mbData.artists : [];
      const filteredArtists = artists.filter((a) => a.id);
      const mbids = filteredArtists.map((a) => a.id);
      const cachedImages = dbOps.getImages(mbids);

      const formattedArtists = filteredArtists.map((a) => {
        const cachedImage = cachedImages[a.id];
        const imageUrl =
          cachedImage &&
          cachedImage.imageUrl &&
          cachedImage.imageUrl !== "NOT_FOUND"
            ? cachedImage.imageUrl
            : null;

        return {
          id: a.id,
          name: a.name,
          "sort-name": a["sort-name"] || a.name,
          image: imageUrl,
          imageUrl,
          listeners: null,
        };
      });
      if (formattedArtists.length > 0) {
        imagePrefetchService
          .prefetchSearchResults(formattedArtists)
          .catch(() => {});
      }

      return res.json({
        artists: formattedArtists,
        count: parseInt(mbData?.count || formattedArtists.length),
        offset: offsetInt,
      });
    } catch (error) {
      console.warn("MusicBrainz search failed", error.message);
    }

    res.json({ artists: [], count: 0, offset: offsetInt });
  } catch (error) {
    res.status(500).json({
      error: "Failed to search artists",
      message: error.message,
    });
  }
};

export default function registerSearch(router) {
  router.get("/search", cacheMiddleware(300), handleSearch);
  router.get("/artists", cacheMiddleware(300), handleSearch);
}
