import axios from "axios";
import { UUID_REGEX } from "../../../config/constants.js";
import {
  getLastfmApiKey,
  lastfmRequest,
  lastfmGetArtistNameByMbid,
  getArtistBio,
  musicbrainzGetArtistReleaseGroups,
  enrichReleaseGroupsWithDeezer,
  enrichReleaseGroupsWithLastfm,
  deezerSearchArtist,
  getDeezerArtistById,
  musicbrainzGetArtistNameByMbid,
} from "../../../services/apiClients.js";
import { dbOps } from "../../../config/db-helpers.js";
import { noCache } from "../../../middleware/cache.js";
import { verifyTokenAuth } from "../../../middleware/auth.js";
import { sendSSE, pendingArtistRequests } from "../utils.js";

export default function registerStream(router) {
  router.get("/:mbid/stream", noCache, async (req, res) => {
    try {
      const { mbid } = req.params;
      const streamArtistName = (req.query.artistName || "").trim();

      if (!UUID_REGEX.test(mbid)) {
        return res.status(400).json({
          error: "Invalid MBID format",
          message: `"${mbid}" is not a valid MusicBrainz ID. MBIDs must be UUIDs.`,
        });
      }

      if (!verifyTokenAuth(req)) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "Authentication required",
        });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      let clientDisconnected = false;
      req.on("close", () => {
        clientDisconnected = true;
      });

      const isClientConnected = () =>
        !clientDisconnected && !req.socket.destroyed;

      sendSSE(res, "connected", { mbid });

      const override = dbOps.getArtistOverride(mbid);
      const resolvedMbid = override?.musicbrainzId || mbid;
      const deezerArtistId = override?.deezerArtistId || null;
      const initialName = streamArtistName || "Unknown Artist";
      const buildArtistBase = (name) => ({
        id: resolvedMbid,
        name,
        "sort-name": name,
        disambiguation: "",
        "type-id": null,
        type: null,
        country: null,
        "life-span": { begin: null, end: null, ended: false },
        relations: [],
      });
      const sendArtist = (payload) => {
        if (!isClientConnected()) return;
        sendSSE(res, "artist", payload);
      };

      sendArtist({
        ...buildArtistBase(initialName),
        tags: [],
        genres: [],
        "release-groups": [],
        "release-group-count": 0,
        "release-count": 0,
      });

      try {
        const { lidarrClient } =
          await import("../../../services/lidarrClient.js");
        const { libraryManager } =
          await import("../../../services/libraryManager.js");

        let lidarrArtist = null;
        let lidarrAlbums = [];

        if (lidarrClient.isConfigured()) {
          try {
            lidarrArtist = await lidarrClient.getArtistByMbid(mbid);
            if (lidarrArtist) {
              console.log(
                `[Artists Stream] Found artist in Lidarr: ${lidarrArtist.artistName}`,
              );
              const libraryArtist = await libraryManager.getArtist(mbid);
              if (libraryArtist) {
                lidarrAlbums = await libraryManager.getAlbums(libraryArtist.id);
              }
              sendArtist({
                ...buildArtistBase(lidarrArtist.artistName),
                _lidarrData: {
                  id: lidarrArtist.id,
                  monitored: lidarrArtist.monitored,
                  statistics: lidarrArtist.statistics,
                },
              });

              const libArtist = libraryManager.mapLidarrArtist(lidarrArtist);
              sendSSE(res, "library", {
                exists: true,
                artist: {
                  ...libArtist,
                  foreignArtistId: libArtist.foreignArtistId || libArtist.mbid,
                  added: libArtist.addedAt,
                },
                albums: lidarrAlbums.map((a) => ({
                  ...a,
                  foreignAlbumId: a.foreignAlbumId || a.mbid,
                  title: a.albumName,
                  albumType: "Album",
                  statistics: a.statistics || {
                    trackCount: 0,
                    sizeOnDisk: 0,
                    percentOfTracks: 0,
                  },
                })),
              });
            }
          } catch (error) {
            console.warn(
              `[Artists Stream] Failed to fetch from Lidarr: ${error.message}`,
            );
          }
        }

        const tasks = [];
        let fullArtistPromise = null;
        const pendingPromise = pendingArtistRequests.has(mbid)
          ? pendingArtistRequests.get(mbid)
          : null;
        const namePromise = pendingPromise
          ? streamArtistName
            ? Promise.resolve(streamArtistName)
            : pendingPromise
                .then(
                  (data) => data?.name || streamArtistName || "Unknown Artist",
                )
                .catch(() => streamArtistName || "Unknown Artist")
          : (async () => {
              if (streamArtistName) return streamArtistName;
              const name =
                (getLastfmApiKey()
                  ? await lastfmGetArtistNameByMbid(resolvedMbid)
                  : null) ||
                (await musicbrainzGetArtistNameByMbid(resolvedMbid)) ||
                "Unknown Artist";
              return name;
            })();

        if (pendingPromise) {
          console.log(
            `[Artists Stream] Request for ${mbid} already in progress, waiting...`,
          );
          pendingPromise
            .then((data) => {
              if (data) sendArtist(data);
            })
            .catch((error) => {
              sendSSE(res, "error", {
                error: "Failed to fetch artist details",
                message: error.response?.data?.error || error.message,
              });
            });
          tasks.push(pendingPromise.catch(() => null));
        }

        if (!pendingPromise) {
          const releaseGroupsPromise = musicbrainzGetArtistReleaseGroups(
            resolvedMbid,
          ).catch(() => []);

          tasks.push(
            releaseGroupsPromise.then((releaseGroups) => {
              if (!isClientConnected()) return;
              sendArtist({
                id: resolvedMbid,
                "release-groups": releaseGroups,
                "release-group-count": releaseGroups.length,
                "release-count": releaseGroups.length,
              });
            }),
          );

          const enrichedReleaseGroupsPromise = Promise.all([
            releaseGroupsPromise,
            namePromise,
          ])
            .then(async ([releaseGroups, name]) => {
              if (!releaseGroups.length) return { releaseGroups, name };
              await enrichReleaseGroupsWithDeezer(
                releaseGroups,
                name,
                deezerArtistId,
              );
              if (getLastfmApiKey()) {
                await enrichReleaseGroupsWithLastfm(
                  releaseGroups,
                  name,
                  resolvedMbid,
                );
              }
              return { releaseGroups, name };
            })
            .then(({ releaseGroups, name }) => {
              if (!isClientConnected()) return;
              sendArtist({
                id: resolvedMbid,
                name,
                "sort-name": name,
                "release-groups": releaseGroups,
                "release-group-count": releaseGroups.length,
                "release-count": releaseGroups.length,
              });
              return releaseGroups;
            });

          const tagsPromise = getLastfmApiKey()
            ? lastfmRequest("artist.getTopTags", { mbid: resolvedMbid })
                .then((tagsData) => {
                  const tags = tagsData?.toptags?.tag
                    ? (Array.isArray(tagsData.toptags.tag)
                        ? tagsData.toptags.tag
                        : [tagsData.toptags.tag]
                      ).map((t) => ({ name: t.name, count: t.count || 0 }))
                    : [];
                  if (!isClientConnected()) return tags;
                  sendArtist({ id: resolvedMbid, tags });
                  return tags;
                })
                .catch(() => [])
            : Promise.resolve([]);

          const bioPromise = namePromise
            .then((name) =>
              getArtistBio(name, resolvedMbid, deezerArtistId).catch(
                () => null,
              ),
            )
            .then((bio) => {
              if (!bio || !isClientConnected()) return bio;
              sendArtist({ id: resolvedMbid, bio });
              return bio;
            });

          tasks.push(enrichedReleaseGroupsPromise, tagsPromise, bioPromise);

          fullArtistPromise = Promise.all([
            namePromise,
            enrichedReleaseGroupsPromise,
            tagsPromise,
            bioPromise,
          ])
            .then(([name, releaseGroups, tags, bio]) => ({
              ...buildArtistBase(name),
              tags,
              genres: [],
              "release-groups": releaseGroups,
              relations: [],
              "release-group-count": releaseGroups.length,
              "release-count": releaseGroups.length,
              ...(bio ? { bio } : {}),
            }))
            .catch(() => null);

          pendingArtistRequests.set(mbid, fullArtistPromise);
          fullArtistPromise
            .then((artistData) => {
              if (artistData) sendArtist(artistData);
            })
            .finally(() => {
              pendingArtistRequests.delete(mbid);
            });

          const releaseGroupCoversTask = enrichedReleaseGroupsPromise.then(
            (releaseGroups) => {
              if (!isClientConnected()) return;
              if (!releaseGroups?.length) return;
              const groups = releaseGroups
                .filter(
                  (rg) =>
                    rg["primary-type"] === "Album" ||
                    rg["primary-type"] === "EP" ||
                    rg["primary-type"] === "Single",
                )
                .slice(0, 20);

              const cacheKeys = groups.map((rg) => `rg:${rg.id}`);
              const cachedCovers = dbOps.getImages(cacheKeys);

              for (const rg of groups) {
                if (!isClientConnected()) return;
                const cacheKey = `rg:${rg.id}`;
                const cachedCover = cachedCovers[cacheKey];
                if (rg._coverUrl) {
                  dbOps.setImage(cacheKey, rg._coverUrl);
                  sendSSE(res, "releaseGroupCover", {
                    mbid: rg.id,
                    images: [
                      { image: rg._coverUrl, front: true, types: ["Front"] },
                    ],
                  });
                  continue;
                }
                if (
                  cachedCover &&
                  cachedCover.imageUrl &&
                  cachedCover.imageUrl !== "NOT_FOUND"
                ) {
                  sendSSE(res, "releaseGroupCover", {
                    mbid: rg.id,
                    images: [
                      {
                        image: cachedCover.imageUrl,
                        front: true,
                        types: ["Front"],
                      },
                    ],
                  });
                  continue;
                }
                if (cachedCover && cachedCover.imageUrl === "NOT_FOUND") {
                  sendSSE(res, "releaseGroupCover", {
                    mbid: rg.id,
                    images: [],
                  });
                  continue;
                }
                if (String(rg.id).startsWith("dz-")) continue;
              }

              const uncachedGroups = groups.filter((rg) => {
                if (rg._coverUrl || String(rg.id).startsWith("dz-"))
                  return false;
                const cachedCover = cachedCovers[`rg:${rg.id}`];
                return !cachedCover;
              });

              const BATCH_SIZE = 4;
              return (async () => {
                for (let i = 0; i < uncachedGroups.length; i += BATCH_SIZE) {
                  if (!isClientConnected()) return;
                  const batch = uncachedGroups.slice(i, i + BATCH_SIZE);
                  await Promise.allSettled(
                    batch.map(async (rg) => {
                      if (!isClientConnected()) return;
                      const cacheKey = `rg:${rg.id}`;
                      try {
                        const coverArtResponse = await axios
                          .get(
                            `https://coverartarchive.org/release-group/${rg.id}`,
                            {
                              headers: { Accept: "application/json" },
                              timeout: 3000,
                            },
                          )
                          .catch(() => null);

                        if (coverArtResponse?.data?.images?.length > 0) {
                          const frontImage =
                            coverArtResponse.data.images.find(
                              (img) => img.front,
                            ) || coverArtResponse.data.images[0];
                          if (frontImage) {
                            const imageUrl =
                              frontImage.thumbnails?.["500"] ||
                              frontImage.thumbnails?.["large"] ||
                              frontImage.image;
                            if (imageUrl) {
                              dbOps.setImage(cacheKey, imageUrl);
                              sendSSE(res, "releaseGroupCover", {
                                mbid: rg.id,
                                images: [
                                  {
                                    image: imageUrl,
                                    front: true,
                                    types: frontImage.types || ["Front"],
                                  },
                                ],
                              });
                              return;
                            }
                          }
                        }
                        dbOps.setImage(cacheKey, "NOT_FOUND");
                        sendSSE(res, "releaseGroupCover", {
                          mbid: rg.id,
                          images: [],
                        });
                      } catch (e) {
                        sendSSE(res, "releaseGroupCover", {
                          mbid: rg.id,
                          images: [],
                        });
                      }
                    }),
                  );
                }
              })();
            },
          );

          tasks.push(releaseGroupCoversTask);
        }
        const coverTask = (async () => {
          if (!isClientConnected()) return;
          try {
            const cachedImage = dbOps.getImage(mbid);
            if (
              cachedImage &&
              cachedImage.imageUrl &&
              cachedImage.imageUrl !== "NOT_FOUND"
            ) {
              sendSSE(res, "cover", {
                images: [
                  {
                    image: cachedImage.imageUrl,
                    front: true,
                    types: ["Front"],
                  },
                ],
              });
              return;
            }

            const artistName = await namePromise;
            if (artistName) {
              try {
                const deezer = deezerArtistId
                  ? await getDeezerArtistById(deezerArtistId)
                  : await deezerSearchArtist(artistName);
                if (deezer?.imageUrl) {
                  dbOps.setImage(mbid, deezer.imageUrl);
                  sendSSE(res, "cover", {
                    images: [
                      { image: deezer.imageUrl, front: true, types: ["Front"] },
                    ],
                  });
                  return;
                }
              } catch (e) {}
            }

            dbOps.setImage(mbid, "NOT_FOUND");
            sendSSE(res, "cover", { images: [] });
          } catch (e) {
            sendSSE(res, "cover", { images: [] });
          }
        })();
        tasks.push(coverTask);

        const similarTask = (async () => {
          if (!isClientConnected()) return;
          if (getLastfmApiKey()) {
            try {
              const similarData = await lastfmRequest("artist.getSimilar", {
                mbid: resolvedMbid,
                limit: 10,
              });

              if (similarData?.similarartists?.artist) {
                const artists = Array.isArray(similarData.similarartists.artist)
                  ? similarData.similarartists.artist
                  : [similarData.similarartists.artist];

                const formattedArtists = artists
                  .map((a) => {
                    let img = null;
                    if (a.image && Array.isArray(a.image)) {
                      const i =
                        a.image.find((img) => img.size === "extralarge") ||
                        a.image.find((img) => img.size === "large");
                      if (
                        i &&
                        i["#text"] &&
                        !i["#text"].includes("2a96cbd8b46e442fc41c2b86b821562f")
                      )
                        img = i["#text"];
                    }
                    return {
                      id: a.mbid,
                      name: a.name,
                      image: img,
                      match: Math.round((a.match || 0) * 100),
                    };
                  })
                  .filter((a) => a.id);

                sendSSE(res, "similar", { artists: formattedArtists });
              } else {
                sendSSE(res, "similar", { artists: [] });
              }
            } catch (e) {
              sendSSE(res, "similar", { artists: [] });
            }
          } else {
            sendSSE(res, "similar", { artists: [] });
          }
        })();
        tasks.push(similarTask);

        Promise.allSettled(tasks)
          .then(() => {
            sendSSE(res, "complete", {});
          })
          .catch(() => {
            sendSSE(res, "complete", {});
          })
          .finally(() => {
            setTimeout(() => {
              res.end();
            }, 100);
          });
      } catch (error) {
        console.error(
          `[Artists Stream] Error for artist ${mbid}:`,
          error.message,
        );
        sendSSE(res, "error", {
          error: "Failed to fetch artist details",
          message: error.response?.data?.error || error.message,
        });
        res.end();
      }
    } catch (error) {
      console.error(`[Artists Stream] Unexpected error:`, error.message);
      res.status(500).json({
        error: "Failed to stream artist details",
        message: error.message,
      });
    }
  });
}
