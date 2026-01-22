import { db } from "../config/db.js";
import { lastfmRequest } from "./apiClients.js";

const negativeImageCache = new Set();
const pendingImageRequests = new Map();

export const getArtistImage = async (mbid) => {
  if (!mbid) return { url: null, images: [] };

  if (db.data.images[mbid]) {
    if (db.data.images[mbid] === "NOT_FOUND") {
      return { url: null, images: [] };
    }
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

  if (negativeImageCache.has(mbid)) {
    return { url: null, images: [] };
  }

  if (pendingImageRequests.has(mbid)) {
    return pendingImageRequests.get(mbid);
  }

  const fetchPromise = (async () => {
    if (lastfmRequest) {
      try {
        const lastfmData = await lastfmRequest("artist.getInfo", { mbid });
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
            await db.write();

            return { url: images[0].image, images };
          }
        }
      } catch (e) {}
    }

    negativeImageCache.add(mbid);
    db.data.images[mbid] = "NOT_FOUND";
    await db.write();

    return { url: null, images: [] };
  })();

  pendingImageRequests.set(mbid, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    pendingImageRequests.delete(mbid);
  }
};
