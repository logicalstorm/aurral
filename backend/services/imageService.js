import { dbOps } from "../config/db-helpers.js";
import { musicbrainzRequest, deezerSearchArtist } from "./apiClients.js";
import axios from "axios";

const negativeImageCache = new Set();
const pendingImageRequests = new Map();

export const getArtistImage = async (mbid, forceRefresh = false) => {
  if (!mbid) return { url: null, images: [] };

  const cachedImage = dbOps.getImage(mbid);
  if (
    !forceRefresh &&
    cachedImage &&
    cachedImage.imageUrl &&
    cachedImage.imageUrl !== "NOT_FOUND"
  ) {
    return {
      url: cachedImage.imageUrl,
      images: [
        {
          image: cachedImage.imageUrl,
          front: true,
          types: ["Front"],
        },
      ],
    };
  }

  if (!forceRefresh && cachedImage && cachedImage.imageUrl === "NOT_FOUND") {
    dbOps.deleteImage(mbid);
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
      const { libraryManager } = await import("./libraryManager.js");
      const libraryArtist = libraryManager.getArtist(mbid);
      let artistName = libraryArtist?.artistName || null;

      let artistData = null;
      if (!artistName) {
        try {
          artistData = await Promise.race([
            musicbrainzRequest(`/artist/${mbid}`, {}),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("MusicBrainz timeout")), 2000),
            ),
          ]).catch(() => null);

          if (artistData?.name) {
            artistName = artistData.name;
          }
        } catch (e) {}
      }

      if (artistName) {
        try {
          const deezer = await deezerSearchArtist(artistName);
          if (deezer?.imageUrl) {
            dbOps.setImage(mbid, deezer.imageUrl);
            return {
              url: deezer.imageUrl,
              images: [
                { image: deezer.imageUrl, front: true, types: ["Front"] },
              ],
            };
          }
        } catch (e) {}
      }

      if (artistName || artistData) {
        try {
          const artistDataForRG = artistData?.["release-groups"]
            ? artistData
            : await Promise.race([
                musicbrainzRequest(`/artist/${mbid}`, {
                  inc: "release-groups",
                }),
                new Promise((_, reject) =>
                  setTimeout(
                    () => reject(new Error("MusicBrainz timeout")),
                    2000,
                  ),
                ),
              ]).catch(() => null);

          if (artistDataForRG?.["release-groups"]?.length > 0) {
            const releaseGroups = artistDataForRG["release-groups"]
              .filter(
                (rg) =>
                  rg["primary-type"] === "Album" || rg["primary-type"] === "EP",
              )
              .sort((a, b) => {
                const dateA = a["first-release-date"] || "";
                const dateB = b["first-release-date"] || "";
                return dateB.localeCompare(dateA);
              })
              .slice(0, 2);

            const coverArtResults = await Promise.allSettled(
              releaseGroups.map((rg) =>
                axios
                  .get(`https://coverartarchive.org/release-group/${rg.id}`, {
                    headers: { Accept: "application/json" },
                    timeout: 2000,
                  })
                  .catch(() => null),
              ),
            );

            for (const result of coverArtResults) {
              if (
                result.status === "fulfilled" &&
                result.value?.data?.images?.length > 0
              ) {
                const frontImage =
                  result.value.data.images.find((img) => img.front) ||
                  result.value.data.images[0];
                if (frontImage) {
                  const imageUrl =
                    frontImage.thumbnails?.["500"] ||
                    frontImage.thumbnails?.["large"] ||
                    frontImage.image;
                  if (imageUrl) {
                    dbOps.setImage(mbid, imageUrl);

                    return {
                      url: imageUrl,
                      images: [
                        {
                          image: imageUrl,
                          front: true,
                          types: frontImage.types || ["Front"],
                        },
                      ],
                    };
                  }
                }
              }
            }
          }
        } catch (e) {}
      }
    } catch (e) {
      console.warn(`Failed to fetch image for ${mbid}:`, e.message);
    }

    negativeImageCache.add(mbid);
    dbOps.setImage(mbid, "NOT_FOUND");

    return { url: null, images: [] };
  })();

  pendingImageRequests.set(mbid, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    pendingImageRequests.delete(mbid);
  }
};
