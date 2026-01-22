import { db } from "../config/db.js";
import { lastfmRequest, getLastfmApiKey } from "./apiClients.js";

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
    if (!getLastfmApiKey()) {
      return { url: null, images: [] };
    }
    delete db.data.images[mbid];
    negativeImageCache.delete(mbid);
  }

  if (!forceRefresh && negativeImageCache.has(mbid)) {
    if (!getLastfmApiKey()) {
      return { url: null, images: [] };
    }
    negativeImageCache.delete(mbid);
  }

  if (pendingImageRequests.has(mbid)) {
    return pendingImageRequests.get(mbid);
  }

  const fetchPromise = (async () => {
    if (getLastfmApiKey()) {
      try {
        const lastfmData = await Promise.race([
          lastfmRequest("artist.getInfo", { mbid }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Last.fm timeout")), 5000)
          )
        ]);
        if (lastfmData?.artist?.image) {
          const images = lastfmData.artist.image
            .filter(
              (img) =>
                img["#text"] &&
                !img["#text"].includes("2a96cbd8b46e442fc41c2b86b821562f"),
            )
            .map((img) => ({
              image: img["#text"],
              front: true,
              types: ["Front"],
              size: img.size,
            }));

          if (images.length > 0) {
            const sizeOrder = {
              mega: 4,
              extralarge: 3,
              large: 2,
              medium: 1,
              small: 0,
            };
            images.sort(
              (a, b) => (sizeOrder[b.size] || 0) - (sizeOrder[a.size] || 0),
            );

            db.data.images[mbid] = images[0].image;
            db.write().catch(e => {
              console.error("Error saving image to database:", e.message);
            });

            return { url: images[0].image, images };
          }
        }
      } catch (e) {
        console.warn(`Failed to fetch image for ${mbid} from Last.fm:`, e.message);
      }
    }

    if (getLastfmApiKey()) {
      negativeImageCache.add(mbid);
      db.data.images[mbid] = "NOT_FOUND";
      db.write().catch(e => {
        console.error("Error saving image cache to database:", e.message);
      });
    }

    return { url: null, images: [] };
  })();

  pendingImageRequests.set(mbid, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    pendingImageRequests.delete(mbid);
  }
};
