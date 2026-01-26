import { db } from "../config/db.js";
import { musicbrainzRequest, spotifySearchArtist } from "./apiClients.js";
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
      // Try to get artist name from library first (fastest, no API call)
      const { libraryManager } = await import("./libraryManager.js");
      const libraryArtist = libraryManager.getArtist(mbid);
      let artistName = libraryArtist?.artistName || null;

      // Fetch artist name from MusicBrainz if we don't have it
      let artistData = null;
      if (!artistName) {
        try {
          artistData = await Promise.race([
            musicbrainzRequest(`/artist/${mbid}`, {}),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error("MusicBrainz timeout")), 2000)
            )
          ]).catch(() => null);
          
          if (artistData?.name) {
            artistName = artistData.name;
          }
        } catch (e) {
          // Continue without artist name
        }
      }

      // Try Spotify first (fastest, best quality)
      if (artistName) {
        try {
          const spotifyArtist = await spotifySearchArtist(artistName);
          if (spotifyArtist?.images?.length > 0) {
            // Get the largest available image (images are sorted by size, largest first)
            const imageUrl = spotifyArtist.images[0].url;
            if (imageUrl) {
              if (!db.data.images) db.data.images = {};
              if (!db.data.imageCacheAge) db.data.imageCacheAge = {};
              db.data.images[mbid] = imageUrl;
              db.data.imageCacheAge[mbid] = Date.now();
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
          }
        } catch (e) {
          // Continue to fallback
        }
      }

      // Fallback: Try Cover Art Archive (only if we have artist name or can get release groups)
      if (artistName || artistData) {
        try {
          const artistDataForRG = artistData?.["release-groups"] ? artistData : 
            await Promise.race([
              musicbrainzRequest(`/artist/${mbid}`, { inc: "release-groups" }),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error("MusicBrainz timeout")), 2000)
              )
            ]).catch(() => null);

          if (artistDataForRG?.["release-groups"]?.length > 0) {
            const releaseGroups = artistDataForRG["release-groups"]
              .filter(rg => rg["primary-type"] === "Album" || rg["primary-type"] === "EP")
              .sort((a, b) => {
                const dateA = a["first-release-date"] || "";
                const dateB = b["first-release-date"] || "";
                return dateB.localeCompare(dateA);
              })
              .slice(0, 2); // Only check top 2

            // Try cover art in parallel
            const coverArtResults = await Promise.allSettled(
              releaseGroups.map(rg => 
                axios.get(
                  `https://coverartarchive.org/release-group/${rg.id}`,
                  {
                    headers: { Accept: "application/json" },
                    timeout: 2000,
                  }
                ).catch(() => null)
              )
            );

            for (const result of coverArtResults) {
              if (result.status === 'fulfilled' && result.value?.data?.images?.length > 0) {
                const frontImage = result.value.data.images.find(img => img.front) || result.value.data.images[0];
                if (frontImage) {
                  const imageUrl = frontImage.thumbnails?.["500"] || frontImage.thumbnails?.["large"] || frontImage.image;
                  if (imageUrl) {
                    if (!db.data.images) db.data.images = {};
                    if (!db.data.imageCacheAge) db.data.imageCacheAge = {};
                    db.data.images[mbid] = imageUrl;
                    db.data.imageCacheAge[mbid] = Date.now();
                    db.write().catch(e => {
                      console.error("Error saving image to database:", e.message);
                    });

                    return {
                      url: imageUrl,
                      images: [{
                        image: imageUrl,
                        front: true,
                        types: frontImage.types || ["Front"],
                      }]
                    };
                  }
                }
              }
            }
          }
        } catch (e) {
          // Continue to negative cache
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
