import { Router, Request, Response } from 'express';
import { UUID_REGEX } from '../../../config/constants.js';
import {
  getLastfmApiKey,
  lastfmRequest,
  musicbrainzGetArtistAppearsOnReleaseGroups,
  musicbrainzGetArtistReleaseGroups,
  musicbrainzGetArtistNameByMbid,
} from '../../../services/apiClients.js';
import { dbOps } from '../../../config/db-helpers.js';
import { noCache } from '../../../middleware/cache.js';
import { verifyTokenAuth } from '../../../middleware/auth.js';
import { buildArtistRequestKey, sendSSE, pendingArtistRequests } from '../utils.js';
import { getArtistImage } from '../../../services/imageService.js';
import { buildImageProxyUrl } from '../../../services/imageProxyService.js';
import {
  attachCachedCoverUrls,
  resolveReleaseGroupCoversBatch,
} from '../../../services/releaseGroupCoverService.js';
import { getArtistByMbid } from '../../../services/providers/brainzmashProvider.js';

interface MetadataArtist {
  id: string;
  name: string;
  sortName: string;
  type: string | null;
  status: string | null;
  disambiguation: string;
  overview: string;
  genres: string[];
  aliases: string[];
  images: Array<{ kind: string; url: string } | null>;
  links: Array<{ type: string; target: string } | null>;
  rating: { count: number; value: number | null } | null;
}

interface TagEntry {
  name: string;
  count: number;
}

interface ArtistBasePayload {
  id: string;
  name: string;
  'sort-name': string;
  disambiguation: string;
  'type-id': null;
  type: string | null;
  country: null;
  'life-span': { begin: null; end: null; ended: boolean };
  genres: string[];
  links: Array<{ type: string; target: string } | null>;
  relations: Array<{ type: string; url: { resource: string } }>;
  rating: { count: number; value: number | null } | null;
  bio?: string;
}

interface ReleaseGroupItem {
  id: string;
  title: string;
  coverUrl?: string;
  [key: string]: unknown;
}

interface DiscographyContext {
  metadataArtist: MetadataArtist | null;
  name: string;
  releaseGroups: ReleaseGroupItem[];
}

interface PrefetchItem {
  mbid: string;
  artistName: string;
  albumTitle: string;
}

export default function registerStream(router: Router) {
  router.get('/:mbid/stream', noCache, async (req: Request, res: Response) => {
    try {
      const mbid = String(req.params.mbid || '');
      const streamArtistName = (String(req.query.artistName || '')).trim();
      const selectedReleaseTypes: string[] | null =
        typeof req.query.releaseTypes === 'string' && req.query.releaseTypes.trim()
          ? req.query.releaseTypes
              .split(',')
              .map((value: string) => value.trim())
              .filter(Boolean)
          : null;
      const parsedAppearsOnLimit = Number.parseInt(String(req.query.appearsOnLimit || ''), 10);
      const appearsOnLimit: number | null =
        Number.isFinite(parsedAppearsOnLimit) && parsedAppearsOnLimit > 0
          ? parsedAppearsOnLimit
          : null;

      if (!UUID_REGEX.test(mbid)) {
        return res.status(400).json({
          error: 'Invalid MBID format',
          message: `"${mbid}" is not a valid MusicBrainz ID. MBIDs must be UUIDs.`,
        });
      }

      if (!verifyTokenAuth(req)) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required',
        });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      let clientDisconnected = false;
      req.on('close', () => {
        clientDisconnected = true;
      });

      const isClientConnected = (): boolean =>
        !clientDisconnected && !req.socket.destroyed;

      sendSSE(res, 'connected', { mbid });

      const override = dbOps.getArtistOverride(mbid);
      const resolvedMbid = String(override?.musicbrainzId || mbid);
      const requestKey = buildArtistRequestKey({
        mbid,
        mode: 'full',
         
        selectedReleaseTypes: selectedReleaseTypes as any,
         
        appearsOnLimit: appearsOnLimit as any,
      });

      const toLegacyRelations = (
        metadataArtist: MetadataArtist | null,
      ): Array<{ type: string; url: { resource: string } }> =>
        Array.isArray(metadataArtist?.links)
          ? metadataArtist!.links
              .filter((link) => link?.target)
              .map((link) => ({
                type: link?.type || 'external',
                url: { resource: link!.target },
              }))
          : [];

      const getLastfmTags = async (
        artistMbid: string,
        artistName = '',
      ): Promise<TagEntry[]> => {
        if (!getLastfmApiKey()) return [];
         
        let data: any = await lastfmRequest('artist.getTopTags', {
          mbid: artistMbid,
        }).catch(() => null);
        if (!data?.toptags?.tag && artistName) {
          data = await lastfmRequest('artist.getTopTags', {
            artist: artistName,
          }).catch(() => null);
        }
        const rawTags: unknown[] = data?.toptags?.tag
          ? Array.isArray(data.toptags.tag)
            ? data.toptags.tag
            : [data.toptags.tag]
          : [];
        return rawTags
          .map((tag: unknown) => {
            const t = tag as Record<string, unknown> | undefined;
            return {
              name: String(t?.name || '').trim(),
              count: Number(t?.count || 0),
            };
          })
          .filter((tag: TagEntry) => tag.name);
      };

      const getArtistTagPayload = async (
        artistMbid: string,
        artistName = '',
        metadataArtist: MetadataArtist | null = null,
      ): Promise<{ tags: TagEntry[]; genres: string[] }> => {
        const lastfmTags = await getLastfmTags(artistMbid, artistName);
        if (lastfmTags.length > 0) {
          return {
            tags: lastfmTags,
            genres: lastfmTags.map((tag: TagEntry) => tag.name),
          };
        }
        const fallbackGenres: string[] = Array.isArray(metadataArtist?.genres)
          ? (metadataArtist?.genres || []).filter(Boolean)
          : [];
        return {
          tags: fallbackGenres.map((genre: string) => ({ name: genre, count: 0 })),
          genres: fallbackGenres,
        };
      };

      const initialName = streamArtistName || 'Unknown Artist';

      const buildArtistBase = (
        name: string,
        metadataArtist: MetadataArtist | null = null,
      ): ArtistBasePayload => ({
        id: resolvedMbid,
        name: metadataArtist?.name || name,
        'sort-name': metadataArtist?.sortName || metadataArtist?.name || name,
        disambiguation: metadataArtist?.disambiguation || '',
        'type-id': null,
        type: metadataArtist?.type || null,
        country: null,
        'life-span': { begin: null, end: null, ended: false },
        genres: metadataArtist?.genres ? [...metadataArtist.genres] : [],
        links: metadataArtist?.links ? [...metadataArtist.links] : [],
        relations: toLegacyRelations(metadataArtist),
        rating: metadataArtist?.rating || null,
        ...(metadataArtist?.overview ? { bio: metadataArtist.overview } : {}),
      });

      const sendArtist = (payload: Record<string, unknown>): void => {
        if (!isClientConnected()) return;
        sendSSE(res, 'artist', payload);
      };

      sendArtist({
        ...buildArtistBase(initialName),
        tags: [],
        genres: [],
      });

      try {
        const tasks: Array<Promise<unknown>> = [];
        let fullArtistPromise: Promise<Record<string, unknown> | null> | null = null;
        const pendingPromise: Promise<Record<string, unknown>> | undefined =
          pendingArtistRequests.has(requestKey)
            ? (pendingArtistRequests.get(requestKey) as Promise<Record<string, unknown>> | undefined)
            : undefined;

        const metadataArtistPromise: Promise<MetadataArtist | null> = getArtistByMbid(
          resolvedMbid,
        ).catch(() => null) as Promise<MetadataArtist | null>;

        const namePromise: Promise<string> = pendingPromise
          ? streamArtistName
            ? Promise.resolve(streamArtistName)
            : pendingPromise
                .then(
                  (data: Record<string, unknown>) =>
                    (data?.name as string) || streamArtistName || 'Unknown Artist',
                )
                .catch(() => streamArtistName || 'Unknown Artist')
          : (async (): Promise<string> => {
              const metadataArtist = await metadataArtistPromise;
              if (metadataArtist?.name) return metadataArtist.name;
              if (streamArtistName) return streamArtistName;
              const name = String(
                (await musicbrainzGetArtistNameByMbid(resolvedMbid)) || '',
              ) || 'Unknown Artist';
              return name;
            })();

        tasks.push(
          Promise.all([metadataArtistPromise, namePromise]).then(
            async ([metadataArtist, name]: [MetadataArtist | null, string]) => {
              if (!metadataArtist || !isClientConnected()) return;
              const tagPayload = await getArtistTagPayload(resolvedMbid, name, metadataArtist);
              sendArtist({
                ...buildArtistBase(name, metadataArtist),
                tags: tagPayload.tags,
                genres: tagPayload.genres,
              });
            },
          ),
        );

        const libraryTask = (async () => {
          const { lidarrClient } = await import(
            '../../../services/lidarrClient.js'
          );
          const { libraryManager } = await import(
            '../../../services/libraryManager.js'
          );

          if (!lidarrClient.isConfigured()) return;

          try {
            const lidarrArtist = await lidarrClient.getArtistByMbid(mbid) as Record<string, unknown> | null;
            if (!lidarrArtist) {
              if (isClientConnected()) {
                sendSSE(res, 'library', {
                  exists: false,
                  artist: null,
                  albums: [],
                });
              }
              return;
            }
            if (!isClientConnected()) return;

            console.log(
              `[Artists Stream] Found artist in Lidarr: ${lidarrArtist.artistName}`,
            );
            const metadataArtist = await metadataArtistPromise;

            sendArtist({
              ...buildArtistBase(
                String(lidarrArtist.artistName || ''),
                metadataArtist,
              ),
              _lidarrData: {
                id: lidarrArtist.id,
                monitored: lidarrArtist.monitored,
                statistics: lidarrArtist.statistics,
              },
            });

            const libArtist = libraryManager.mapLidarrArtist(lidarrArtist) as Record<string, unknown>;
            sendSSE(res, 'library', {
              exists: true,
              artist: {
                ...libArtist,
                foreignArtistId: libArtist.foreignArtistId || libArtist.mbid,
                added: libArtist.addedAt,
              },
              albums: [],
            });

            const lidarrAlbums = await libraryManager.getAlbums(
              libArtist.id as string,
               
              lidarrArtist as any,
            ) as Array<Record<string, unknown>>;

            if (!isClientConnected()) return;

            sendSSE(res, 'library', {
              exists: true,
              artist: {
                ...libArtist,
                foreignArtistId: libArtist.foreignArtistId || libArtist.mbid,
                added: libArtist.addedAt,
              },
              albums: lidarrAlbums.map((a: Record<string, unknown>) => ({
                ...a,
                foreignAlbumId: a.foreignAlbumId || a.mbid,
                title: a.albumName,
                albumType: 'Album',
                statistics: a.statistics || {
                  trackCount: 0,
                  sizeOnDisk: 0,
                  percentOfTracks: 0,
                },
              })),
            });
          } catch (error: unknown) {
            console.warn(
              `[Artists Stream] Failed to fetch from Lidarr: ${(error as Error).message}`,
            );
          }
        })();
        tasks.push(libraryTask);

        if (pendingPromise) {
          console.log(
            `[Artists Stream] Request for ${requestKey} already in progress, waiting...`,
          );
          pendingPromise
            .then((data: Record<string, unknown>) => {
              if (data) sendArtist(data);
            })
            .catch((error: unknown) => {
              const err = error as { response?: { data?: { error?: string } }; message?: string };
              sendSSE(res, 'error', {
                error: 'Failed to fetch artist details',
                message: err.response?.data?.error || err.message,
              });
            });
          tasks.push(pendingPromise.catch(() => null));
        }

        if (!pendingPromise) {
          const includeTrackCounts = !appearsOnLimit;
          const releaseGroupsPromise = musicbrainzGetArtistReleaseGroups(
            resolvedMbid,
            selectedReleaseTypes,
            { includeTrackCounts },
          ).catch(() => [] as ReleaseGroupItem[]);

          const discographyTask: Promise<DiscographyContext | null> = Promise.all([
            metadataArtistPromise,
            namePromise,
            releaseGroupsPromise,
          ]).then(
            async ([metadataArtist, name, releaseGroups]: [
              MetadataArtist | null,
              string,
              ReleaseGroupItem[],
            ]): Promise<DiscographyContext | null> => {
              if (!isClientConnected()) return null;
              const releaseGroupsWithCovers = attachCachedCoverUrls(
                 
                releaseGroups as any,
                 
                12 as any,
              ) as ReleaseGroupItem[];
              sendArtist({
                ...buildArtistBase(name, metadataArtist),
                'release-groups': releaseGroupsWithCovers,
                'release-group-count': releaseGroupsWithCovers.length,
                'release-count': releaseGroupsWithCovers.length,
              });
              const prefetchItems: PrefetchItem[] = releaseGroupsWithCovers
                .filter(
                  (releaseGroup: ReleaseGroupItem) =>
                    releaseGroup?.id && !releaseGroup.coverUrl,
                )
                .slice(0, 6)
                .map((releaseGroup: ReleaseGroupItem) => ({
                  mbid: releaseGroup.id,
                  artistName: name || '',
                  albumTitle: (releaseGroup.title as string) || '',
                }));
              if (prefetchItems.length) {
                 
                resolveReleaseGroupCoversBatch(prefetchItems as any, {
                  concurrency: 6,
                }).catch(() => {});
              }
              return { metadataArtist, name, releaseGroups: releaseGroupsWithCovers };
            },
          );
          tasks.push(discographyTask);

          const appearsOnTask = discographyTask.then(
            async (ctx: DiscographyContext | null) => {
              if (!ctx) return [] as ReleaseGroupItem[];
              const appearsOnReleaseGroups = await musicbrainzGetArtistAppearsOnReleaseGroups(
                resolvedMbid,
                ctx.releaseGroups,
                { limit: appearsOnLimit ?? undefined },
              ).catch(() => [] as ReleaseGroupItem[]);
              if (!isClientConnected()) return appearsOnReleaseGroups;
              const appearsOnWithCovers = attachCachedCoverUrls(
                 
                appearsOnReleaseGroups as any,
                 
                (appearsOnLimit || 6) as any,
              ) as ReleaseGroupItem[];
              sendArtist({
                id: resolvedMbid,
                'appears-on-release-groups': appearsOnWithCovers,
              });
              const prefetchAppearsOnItems: PrefetchItem[] = [
                ...appearsOnWithCovers,
              ]
                .sort((a: ReleaseGroupItem, b: ReleaseGroupItem) =>
                  String(b['first-release-date'] || '').localeCompare(
                    String(a['first-release-date'] || ''),
                  ),
                )
                .filter(
                  (releaseGroup: ReleaseGroupItem) =>
                    releaseGroup?.id && !releaseGroup.coverUrl,
                )
                .slice(0, appearsOnLimit || 6)
                .map((releaseGroup: ReleaseGroupItem) => ({
                  mbid: releaseGroup.id,
                  artistName:
                    (
                      releaseGroup['artist-credit'] as Array<{
                        name?: string;
                        artist?: { name?: string };
                      }>
                    )?.[0]?.name ||
                    (
                      releaseGroup['artist-credit'] as Array<{
                        name?: string;
                        artist?: { name?: string };
                      }>
                    )?.[0]?.artist?.name ||
                    '',
                  albumTitle: (releaseGroup.title as string) || '',
                }));
              if (prefetchAppearsOnItems.length) {
                 
                resolveReleaseGroupCoversBatch(prefetchAppearsOnItems as any, {
                  concurrency: 6,
                }).catch(() => {});
              }
              return appearsOnWithCovers;
            },
          );
          tasks.push(appearsOnTask);

          const metadataCorePromise = Promise.all([
            discographyTask,
            appearsOnTask,
          ]).then(
            async ([ctx, appearsOnReleaseGroups]: [DiscographyContext | null, unknown]) => {
              if (!ctx) return null;
              const tagPayload = await getArtistTagPayload(
                resolvedMbid,
                ctx.name,
                ctx.metadataArtist,
              );
              return {
                ...buildArtistBase(ctx.name, ctx.metadataArtist),
                tags: tagPayload.tags,
                genres: tagPayload.genres,
                'release-groups': ctx.releaseGroups,
                'appears-on-release-groups': appearsOnReleaseGroups,
                'release-group-count': ctx.releaseGroups.length,
                'release-count': ctx.releaseGroups.length,
              };
            },
          );

          fullArtistPromise = metadataCorePromise
            .then((artistPayload) => artistPayload)
            .catch(() => null) as Promise<Record<string, unknown> | null>;

          pendingArtistRequests.set(requestKey, fullArtistPromise);
          fullArtistPromise.finally(() => {
            pendingArtistRequests.delete(requestKey);
          });
        }

        const coverTask = (async () => {
          if (!isClientConnected()) return;
          try {
            const cachedImage = dbOps.getImage(mbid) as {
              imageUrl?: string;
            } | null;
            if (
              cachedImage &&
              cachedImage.imageUrl &&
              cachedImage.imageUrl !== 'NOT_FOUND'
            ) {
              const artistName =
                (await namePromise.catch(() => null)) || streamArtistName || null;
              const cachedCover = await getArtistImage(
                mbid,
                 
                { artistName: artistName || undefined } as any,
              ).catch(() => null);
              sendSSE(res, 'cover', {
                images:
                  cachedCover && (cachedCover as Record<string, unknown>).images &&
                  Array.isArray((cachedCover as Record<string, unknown>).images) &&
                  ((cachedCover as Record<string, unknown>).images as unknown[]).length
                    ? (cachedCover as Record<string, unknown>).images
                    : [
                        {
                          image: cachedImage.imageUrl,
                          front: true,
                          types: ['Front'],
                        },
                      ],
              });
              return;
            }

            const artistName =
              (await namePromise.catch(() => null)) || streamArtistName || null;
            const shouldForceRefresh =
              cachedImage?.imageUrl === 'NOT_FOUND' && !!artistName;
            const cover = await getArtistImage(
              mbid,
              {
                artistName: artistName || undefined,
                forceRefresh: shouldForceRefresh,
               
              } as any,
            );
            if (
              (cover as Record<string, unknown>)?.images &&
              Array.isArray((cover as Record<string, unknown>).images) &&
              ((cover as Record<string, unknown>).images as unknown[]).length
            ) {
              sendSSE(res, 'cover', {
                images: (cover as Record<string, unknown>).images,
              });
              return;
            }

            if ((cover as Record<string, unknown>)?.notFound) {
              dbOps.setImage(mbid, 'NOT_FOUND');
            }
            sendSSE(res, 'cover', { images: [] });
          } catch {
            sendSSE(res, 'cover', { images: [] });
          }
        })();
        tasks.push(coverTask);

        const similarTask = (async () => {
          if (!isClientConnected()) return;
          if (getLastfmApiKey()) {
            try {
               
              let similarData: any = await lastfmRequest('artist.getSimilar', {
                mbid: resolvedMbid,
                limit: 10,
              });

              if (!similarData?.similarartists?.artist) {
                const fallbackArtistName =
                  streamArtistName ||
                  (await metadataArtistPromise.catch(() => null))?.name ||
                  (await namePromise.catch(() => null)) ||
                  (await musicbrainzGetArtistNameByMbid(resolvedMbid).catch(
                    () => null,
                  )) ||
                  '';

                if (fallbackArtistName) {
                  similarData = await lastfmRequest('artist.getSimilar', {
                    artist: fallbackArtistName,
                    limit: 10,
                  });
                }
              }

               
              const similarArtists = similarData?.similarartists as any;
              if (similarArtists?.artist) {
                const artists: unknown[] = Array.isArray(similarArtists.artist)
                  ? similarArtists.artist
                  : [similarArtists.artist];

                const formattedArtists = artists
                  .map(
                    (a: unknown): {
                      id: string;
                      name: string;
                      image: string | null;
                      match: number;
                    } | null => {
                      const artist = a as Record<string, unknown>;
                      let img: string | null = null;
                      if (
                        artist.image &&
                        Array.isArray(artist.image)
                      ) {
                        const images = artist.image as Array<Record<string, unknown>>;
                        const i =
                          images.find(
                            (imgEntry: Record<string, unknown>) =>
                              imgEntry.size === 'extralarge',
                          ) ||
                          images.find(
                            (imgEntry: Record<string, unknown>) =>
                              imgEntry.size === 'large',
                          );
                        if (
                          i &&
                          i['#text'] &&
                          !String(i['#text']).includes(
                            '2a96cbd8b46e442fc41c2b86b821562f',
                          )
                        )
                          img = i['#text'] as string;
                      }
                      return {
                        id: String(artist.mbid || ''),
                        name: String(artist.name || ''),
                        image: img ? buildImageProxyUrl(img) || img : null,
                        match: Math.round(
                          ((artist.match as number) || 0) * 100,
                        ),
                      };
                    },
                  )
                  .filter(
                    (
                      a,
                    ): a is {
                      id: string;
                      name: string;
                      image: string | null;
                      match: number;
                    } => !!a && !!a.id,
                  );

                sendSSE(res, 'similar', { artists: formattedArtists });
              } else {
                sendSSE(res, 'similar', { artists: [] });
              }
            } catch {
              sendSSE(res, 'similar', { artists: [] });
            }
          } else {
            sendSSE(res, 'similar', { artists: [] });
          }
        })();
        tasks.push(similarTask);

        Promise.allSettled(tasks)
          .then(() => {
            sendSSE(res, 'complete', {});
          })
          .catch(() => {
            sendSSE(res, 'complete', {});
          })
          .finally(() => {
            setTimeout(() => {
              res.end();
            }, 100);
          });
      } catch (error: unknown) {
        const err = error as {
          message?: string;
          response?: { data?: { error?: string } };
        };
        console.error(
          `[Artists Stream] Error for artist ${mbid}:`,
          err.message,
        );
        sendSSE(res, 'error', {
          error: 'Failed to fetch artist details',
          message: err.response?.data?.error || err.message,
        });
        res.end();
      }
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error(`[Artists Stream] Unexpected error:`, err.message);
      res.status(500).json({
        error: 'Failed to stream artist details',
        message: err.message,
      });
    }
  });
}
