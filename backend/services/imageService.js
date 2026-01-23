import { db } from "../config/db.js";
import { musicbrainzRequest } from "./apiClients.js";
import axios from "axios";

const negativeImageCache = new Set();
const pendingImageRequests = new Map();

export const getArtistImage = async (mbid, forceRefresh = false) => {
  if (!mbid) return { url: null, images: [] };

  if (!forceRefresh && db.data.images[mbid] && db.data.images[mbid] !== "NOT_FOUND") {
    return {
      url: db.data.images[mbid],
      images: [
        {
          image: db.data.images[mbid],
          front: true,
          types: ["Front"],
        },
      ],
    };
  }

  if (!forceRefresh && db.data.images[mbid] === "NOT_FOUND") {
    delete db.data.images[mbid];
    negativeImageCache.delete(mbid);
  }

  if (!forceRefresh && negativeImageCache.has(mbid)) {
    negativeImageCache.delete(mbid);
  }

  if (pendingImageRequests.has(mbid)) {
    return pendingImageRequests.get(mbid);
  }

  const fetchPromise = (async () => {
    try {
      // Get artist name from MusicBrainz (minimal call, no relationships needed)
      const artistData = await Promise.race([
        musicbrainzRequest(`/artist/${mbid}`, {}),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("MusicBrainz timeout")), 5000)
        )
      ]).catch(() => null);

      // Search Deezer directly by artist name (no relationship lookup needed)
      if (artistData?.name) {
        try {
          const searchResponse = await axios.get(
            `https://api.deezer.com/search/artist`,
            {
              params: { q: artistData.name, limit: 1 },
              timeout: 3000
            }
          ).catch(() => null);

          if (searchResponse?.data?.data?.[0]?.picture_xl || searchResponse?.data?.data?.[0]?.picture_big) {
            const artist = searchResponse.data.data[0];
            const imageUrl = artist.picture_xl || artist.picture_big;
            db.data.images[mbid] = imageUrl;
            db.write().catch(e => {
              console.error("Error saving image to database:", e.message);
            });

            return {
              url: imageUrl,
              images: [{
                image: imageUrl,
                front: true,
                types: ["Front"],
              }]
            };
          }
        } catch (e) {
          console.warn(`Failed to search Deezer for ${mbid}:`, e.message);
        }
      }
    } catch (e) {
      console.warn(`Failed to fetch image for ${mbid}:`, e.message);
    }

    // Cache negative result
    negativeImageCache.add(mbid);
    db.data.images[mbid] = "NOT_FOUND";
    db.write().catch(e => {
      console.error("Error saving image cache to database:", e.message);
    });

    return { url: null, images: [] };
  })();

  pendingImageRequests.set(mbid, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    pendingImageRequests.delete(mbid);
  }
};
