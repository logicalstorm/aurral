import { dbOps } from "../config/db-helpers.js";
import { GENRE_KEYWORDS } from "../config/constants.js";
import {
  lastfmRequest,
  getLastfmApiKey,
  musicbrainzRequest,
  deezerSearchArtist,
} from "./apiClients.js";

const getLastfmUsername = () => {
  const settings = dbOps.getSettings();
  return settings.integrations?.lastfm?.username || null;
};

// Initialize cache - but check if discovery is actually configured first
let discoveryCache = {
  recommendations: [],
  globalTop: [],
  basedOn: [],
  topTags: [],
  topGenres: [],
  lastUpdated: null,
  isUpdating: false,
};

// Load from database if it exists and has data
const dbData = dbOps.getDiscoveryCache();
if (
  dbData.recommendations?.length > 0 ||
  dbData.globalTop?.length > 0 ||
  dbData.topGenres?.length > 0
) {
  discoveryCache = {
    recommendations: dbData.recommendations || [],
    globalTop: dbData.globalTop || [],
    basedOn: dbData.basedOn || [],
    topTags: dbData.topTags || [],
    topGenres: dbData.topGenres || [],
    lastUpdated: dbData.lastUpdated || null,
    isUpdating: false,
  };
}

export const getDiscoveryCache = () => {
  // Sync cache with database
  const dbData = dbOps.getDiscoveryCache();
  // Only sync if database has more data than cache
  if (
    (dbData.recommendations?.length > 0 &&
      (!discoveryCache.recommendations ||
        discoveryCache.recommendations.length === 0)) ||
    (dbData.globalTop?.length > 0 &&
      (!discoveryCache.globalTop || discoveryCache.globalTop.length === 0)) ||
    (dbData.topGenres?.length > 0 &&
      (!discoveryCache.topGenres || discoveryCache.topGenres.length === 0))
  ) {
    Object.assign(discoveryCache, {
      recommendations:
        dbData.recommendations || discoveryCache.recommendations || [],
      globalTop: dbData.globalTop || discoveryCache.globalTop || [],
      basedOn: dbData.basedOn || discoveryCache.basedOn || [],
      topTags: dbData.topTags || discoveryCache.topTags || [],
      topGenres: dbData.topGenres || discoveryCache.topGenres || [],
      lastUpdated: dbData.lastUpdated || discoveryCache.lastUpdated || null,
    });
  }
  return discoveryCache;
};

export const updateDiscoveryCache = async () => {
  if (discoveryCache.isUpdating) {
    console.log("Discovery update already in progress, skipping...");
    return;
  }
  discoveryCache.isUpdating = true;
  console.log("Starting background update of discovery recommendations...");

  try {
    const { libraryManager } = await import("./libraryManager.js");
    const libraryArtists = await libraryManager.getAllArtists();
    console.log(`Found ${libraryArtists.length} artists in library.`);

    const existingArtistIds = new Set(libraryArtists.map((a) => a.mbid));

    const hasLastfmKey = !!getLastfmApiKey();
    const lastfmUsername = getLastfmUsername();
    const hasLastfmUser = hasLastfmKey && lastfmUsername;

    if (hasLastfmKey && !lastfmUsername) {
      console.log(
        "Last.fm API key configured but username not set. User-specific recommendations will not be available.",
      );
    }

    // Check if we have any data source configured
    if (libraryArtists.length === 0 && !hasLastfmKey) {
      console.log(
        "No artists in library and no Last.fm key. Skipping discovery and clearing cache.",
      );
      // Clear discovery cache if nothing is configured
      discoveryCache.recommendations = [];
      discoveryCache.globalTop = [];
      discoveryCache.basedOn = [];
      discoveryCache.topTags = [];
      discoveryCache.topGenres = [];
      discoveryCache.lastUpdated = null;
      discoveryCache.isUpdating = false;

      // Also clear from database
      dbOps.updateDiscoveryCache({
        recommendations: [],
        globalTop: [],
        basedOn: [],
        topTags: [],
        topGenres: [],
        lastUpdated: null,
      });
      return;
    }

    // Fetch Last.fm user's top artists if username is configured
    let lastfmArtists = [];
    if (hasLastfmUser) {
      console.log(`Fetching Last.fm user top artists for ${lastfmUsername}...`);
      try {
        const userTopArtists = await lastfmRequest("user.getTopArtists", {
          user: lastfmUsername,
          limit: 50,
          period: "overall", // overall, 7day, 1month, 3month, 6month, 12month
        });

        if (!userTopArtists) {
          console.warn(
            "Last.fm user.getTopArtists returned null - check API key and username",
          );
        } else if (userTopArtists.error) {
          console.error(
            `Last.fm API error: ${userTopArtists.message || userTopArtists.error}`,
          );
        } else if (userTopArtists?.topartists?.artist) {
          const artists = Array.isArray(userTopArtists.topartists.artist)
            ? userTopArtists.topartists.artist
            : [userTopArtists.topartists.artist];

          // Convert Last.fm artists to a format similar to library artists
          // Last.fm usually includes MBIDs in the response, but we'll handle cases where they're missing
          const artistsWithMbids = [];
          const artistsWithoutMbids = [];

          for (const artist of artists) {
            if (artist.mbid) {
              artistsWithMbids.push(artist);
            } else if (artist.name) {
              artistsWithoutMbids.push(artist);
            }
          }

          // Add artists that already have MBIDs
          for (const artist of artistsWithMbids) {
            lastfmArtists.push({
              mbid: artist.mbid,
              artistName: artist.name,
              playcount: parseInt(artist.playcount || 0),
            });
          }

          // Try to get MBIDs for artists without them (limit to first 10 to avoid too many API calls)
          if (artistsWithoutMbids.length > 0) {
            console.log(
              `Attempting to get MBIDs for ${Math.min(artistsWithoutMbids.length, 10)} Last.fm artists without MBIDs...`,
            );
            const mbidsToFetch = artistsWithoutMbids.slice(0, 10);
            await Promise.all(
              mbidsToFetch.map(async (artist) => {
                try {
                  const mbSearch = await musicbrainzRequest("/artist", {
                    query: `artist:"${artist.name}"`,
                    limit: 1,
                  });
                  if (mbSearch?.artists?.[0]?.id) {
                    lastfmArtists.push({
                      mbid: mbSearch.artists[0].id,
                      artistName: artist.name,
                      playcount: parseInt(artist.playcount || 0),
                    });
                  }
                } catch (e) {
                  // Skip if we can't get MBID
                  console.warn(
                    `Could not get MBID for Last.fm artist ${artist.name}`,
                  );
                }
              }),
            );
          }
          console.log(
            `Found ${lastfmArtists.length} Last.fm artists with MBIDs.`,
          );
        } else {
          console.warn(
            `Last.fm user.getTopArtists response missing expected data structure. Response:`,
            JSON.stringify(userTopArtists).substring(0, 200),
          );
        }
      } catch (e) {
        console.error(`Failed to fetch Last.fm user artists: ${e.message}`);
        console.error(`Stack trace:`, e.stack);
      }
    } else if (hasLastfmKey) {
      console.log(
        "Last.fm API key is configured but username is missing. Set Last.fm username in Settings to enable user-specific recommendations.",
      );
    }

    // Combine library and Last.fm artists for profile sampling
    const allSourceArtists = [
      ...libraryArtists.map((a) => ({
        mbid: a.mbid,
        artistName: a.artistName,
        source: "library",
      })),
      ...lastfmArtists.map((a) => ({
        mbid: a.mbid,
        artistName: a.artistName,
        source: "lastfm",
      })),
    ];

    // Remove duplicates (prefer library artists if both exist)
    const uniqueArtists = [];
    const seenMbids = new Set();
    for (const artist of allSourceArtists) {
      if (artist.mbid && !seenMbids.has(artist.mbid)) {
        seenMbids.add(artist.mbid);
        uniqueArtists.push(artist);
      }
    }

    const tagCounts = new Map();
    const genreCounts = new Map();
    const profileSample = [...uniqueArtists]
      .sort(() => 0.5 - Math.random())
      .slice(0, 25);

    console.log(
      `Sampling tags/genres from ${profileSample.length} artists (${libraryArtists.length} library, ${lastfmArtists.length} Last.fm)...`,
    );

    let tagsFound = 0;
    await Promise.all(
      profileSample.map(async (artist) => {
        let foundTags = false;
        if (getLastfmApiKey()) {
          try {
            const data = await lastfmRequest("artist.getTopTags", {
              mbid: artist.mbid,
            });
            if (data?.toptags?.tag) {
              const tags = Array.isArray(data.toptags.tag)
                ? data.toptags.tag
                : [data.toptags.tag];
              tags.slice(0, 15).forEach((t) => {
                tagCounts.set(
                  t.name,
                  (tagCounts.get(t.name) || 0) + (parseInt(t.count) || 1),
                );
                const l = t.name.toLowerCase();
                if (GENRE_KEYWORDS.some((g) => l.includes(g)))
                  genreCounts.set(t.name, (genreCounts.get(t.name) || 0) + 1);
              });
              foundTags = true;
              tagsFound++;
            }
          } catch (e) {
            console.warn(
              `Failed to get Last.fm tags for ${artist.artistName}: ${e.message}`,
            );
          }
        }
      }),
    );
    console.log(
      `Found tags for ${tagsFound} out of ${profileSample.length} artists`,
    );

    discoveryCache.topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map((t) => t[0]);
    discoveryCache.topGenres = Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 24)
      .map((t) => t[0]);

    console.log(
      `Identified Top Genres: ${discoveryCache.topGenres.join(", ")}`,
    );

    if (getLastfmApiKey()) {
      console.log("Fetching Global Trending artists from Last.fm...");
      try {
        const topData = await lastfmRequest("chart.getTopArtists", {
          limit: 100,
        });
        if (topData?.artists?.artist) {
          const topArtists = Array.isArray(topData.artists.artist)
            ? topData.artists.artist
            : [topData.artists.artist];
          discoveryCache.globalTop = topArtists
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
              return { id: a.mbid, name: a.name, image: img, type: "Artist" };
            })
            .filter((a) => a.id && !existingArtistIds.has(a.id))
            .slice(0, 32);
          console.log(
            `Found ${discoveryCache.globalTop.length} trending artists.`,
          );
        }
      } catch (e) {
        console.error(`Failed to fetch Global Top: ${e.message}`);
      }
    }

    // Use combined artists for recommendations
    const recSampleSize = Math.min(25, uniqueArtists.length);
    const recSample = [...uniqueArtists]
      .sort(() => 0.5 - Math.random())
      .slice(0, recSampleSize);
    const recommendations = new Map();

    console.log(
      `Generating recommendations based on ${recSample.length} artists (${libraryArtists.length} library, ${lastfmArtists.length} Last.fm)...`,
    );

    if (getLastfmApiKey()) {
      let successCount = 0;
      let errorCount = 0;
      await Promise.all(
        recSample.map(async (artist) => {
          try {
            let sourceTags = [];
            const tagData = await lastfmRequest("artist.getTopTags", {
              mbid: artist.mbid,
            });
            if (tagData?.toptags?.tag) {
              const allTags = Array.isArray(tagData.toptags.tag)
                ? tagData.toptags.tag
                : [tagData.toptags.tag];
              sourceTags = allTags.slice(0, 15).map((t) => t.name);
            }

            const similar = await lastfmRequest("artist.getSimilar", {
              mbid: artist.mbid,
              limit: 25,
            });
            if (similar?.similarartists?.artist) {
              const list = Array.isArray(similar.similarartists.artist)
                ? similar.similarartists.artist
                : [similar.similarartists.artist];
              for (const s of list) {
                if (
                  s.mbid &&
                  !existingArtistIds.has(s.mbid) &&
                  !recommendations.has(s.mbid)
                ) {
                  let img = null;
                  if (s.image && Array.isArray(s.image)) {
                    const i =
                      s.image.find((img) => img.size === "extralarge") ||
                      s.image.find((img) => img.size === "large");
                    if (
                      i &&
                      i["#text"] &&
                      !i["#text"].includes("2a96cbd8b46e442fc41c2b86b821562f")
                    )
                      img = i["#text"];
                  }
                  recommendations.set(s.mbid, {
                    id: s.mbid,
                    name: s.name,
                    type: "Artist",
                    sourceArtist: artist.artistName,
                    sourceType: artist.source || "library",
                    tags: sourceTags,
                    score: Math.round((s.match || 0) * 100),
                    image: img,
                  });
                }
              }
              successCount++;
            } else {
              errorCount++;
            }
          } catch (e) {
            errorCount++;
            console.warn(
              `Error getting similar artists for ${artist.artistName}: ${e.message}`,
            );
          }
        }),
      );
      console.log(
        `Recommendation generation: ${successCount} succeeded, ${errorCount} failed`,
      );
    } else {
      console.warn("Last.fm API key required for similar artist discovery.");
    }

    const recommendationsArray = Array.from(recommendations.values())
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 100);

    console.log(
      `Generated ${recommendationsArray.length} total recommendations.`,
    );

    const discoveryData = {
      recommendations: recommendationsArray,
      basedOn: recSample.map((a) => ({
        name: a.artistName,
        id: a.mbid,
        source: a.source || "library",
      })),
      topTags: discoveryCache.topTags || [],
      topGenres: discoveryCache.topGenres || [],
      globalTop: discoveryCache.globalTop || [],
      lastUpdated: new Date().toISOString(),
    };

    Object.assign(discoveryCache, discoveryData);
    dbOps.updateDiscoveryCache(discoveryData);
    console.log(
      `Discovery data written to database: ${discoveryData.recommendations.length} recommendations, ${discoveryData.topGenres.length} genres, ${discoveryData.globalTop.length} trending`,
    );

    const allToHydrate = [
      ...(discoveryCache.globalTop || []),
      ...recommendationsArray,
    ].filter((a) => !a.image);
    console.log(`Hydrating images for ${allToHydrate.length} artists...`);

    // Images are now handled through the image service, no need for library lookup here
    // Process in batches to avoid overwhelming APIs
    const batchSize = 10;
    for (let i = 0; i < allToHydrate.length; i += batchSize) {
      const batch = allToHydrate.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (item) => {
          try {
            try {
              const artistName = item.name || item.artistName;

              if (artistName) {
                try {
                  const deezer = await deezerSearchArtist(artistName);
                  if (deezer?.imageUrl) {
                    item.image = deezer.imageUrl;
                    return;
                  }
                } catch (e) {}
              }

              const artistDataWithRGs = await Promise.race([
                musicbrainzRequest(`/artist/${item.id}`, {
                  inc: "release-groups",
                }),
                new Promise((_, reject) =>
                  setTimeout(
                    () => reject(new Error("MusicBrainz timeout")),
                    2000,
                  ),
                ),
              ]).catch(() => null);

              if (
                artistDataWithRGs?.["release-groups"] &&
                artistDataWithRGs["release-groups"].length > 0
              ) {
                const releaseGroups = artistDataWithRGs["release-groups"]
                  .filter(
                    (rg) =>
                      rg["primary-type"] === "Album" ||
                      rg["primary-type"] === "EP",
                  )
                  .sort((a, b) => {
                    const dateA = a["first-release-date"] || "";
                    const dateB = b["first-release-date"] || "";
                    return dateB.localeCompare(dateA);
                  });

                // Try top 2 release groups in parallel
                const coverArtPromises = releaseGroups.slice(0, 2).map((rg) =>
                  Promise.race([
                    axios.get(
                      `https://coverartarchive.org/release-group/${rg.id}`,
                      {
                        headers: { Accept: "application/json" },
                        timeout: 1500,
                      },
                    ),
                    new Promise((_, reject) =>
                      setTimeout(
                        () => reject(new Error("Cover Art timeout")),
                        1500,
                      ),
                    ),
                  ]).catch(() => null),
                );

                const coverArtResults =
                  await Promise.allSettled(coverArtPromises);

                for (const result of coverArtResults) {
                  if (result.status !== "fulfilled" || !result.value) continue;

                  const coverArtJson = result.value;

                  if (coverArtJson?.data?.images) {
                    const frontImage =
                      coverArtJson.data.images.find((img) => img.front) ||
                      coverArtJson.data.images[0];
                    if (frontImage?.thumbnails?.["500"] || frontImage?.image) {
                      item.image =
                        frontImage.thumbnails?.["500"] || frontImage.image;
                      break;
                    }
                  }
                }
              }
            } catch (e) {}
          } catch (e) {}
        }),
      );

      // Small delay between batches
      if (i + batchSize < allToHydrate.length) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    // Discovery cache already updated above

    console.log("Discovery cache updated successfully.");
    console.log(
      `Summary: ${recommendationsArray.length} recommendations, ${discoveryCache.topGenres.length} genres, ${discoveryCache.globalTop.length} trending artists`,
    );
  } catch (error) {
    console.error("Failed to update discovery cache:", error.message);
    console.error("Stack trace:", error.stack);
  } finally {
    discoveryCache.isUpdating = false;
  }
};
