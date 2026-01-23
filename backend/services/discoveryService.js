import { db } from "../config/db.js";
import { GENRE_KEYWORDS } from "../config/constants.js";
import { lastfmRequest, getLastfmApiKey } from "./apiClients.js";

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

// Only load from database if it exists and has data
if (db.data?.discovery) {
  const dbData = db.data.discovery;
  // Only use database data if it has actual content
  if (dbData.recommendations?.length > 0 || dbData.globalTop?.length > 0 || dbData.topGenres?.length > 0) {
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
}

export const getDiscoveryCache = () => {
  // Don't check configuration here - let the route handle it
  // Just sync cache with database if it exists
  if (db.data?.discovery) {
    const dbData = db.data.discovery;
    // Only sync if database has more data than cache
    if ((dbData.recommendations?.length > 0 && (!discoveryCache.recommendations || discoveryCache.recommendations.length === 0)) ||
        (dbData.globalTop?.length > 0 && (!discoveryCache.globalTop || discoveryCache.globalTop.length === 0)) ||
        (dbData.topGenres?.length > 0 && (!discoveryCache.topGenres || discoveryCache.topGenres.length === 0))) {
      Object.assign(discoveryCache, {
        recommendations: dbData.recommendations || discoveryCache.recommendations || [],
        globalTop: dbData.globalTop || discoveryCache.globalTop || [],
        basedOn: dbData.basedOn || discoveryCache.basedOn || [],
        topTags: dbData.topTags || discoveryCache.topTags || [],
        topGenres: dbData.topGenres || discoveryCache.topGenres || [],
        lastUpdated: dbData.lastUpdated || discoveryCache.lastUpdated || null,
      });
    }
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
    const libraryArtists = libraryManager.getAllArtists();
    console.log(`Found ${libraryArtists.length} artists in library.`);

    const existingArtistIds = new Set(
      libraryArtists.map((a) => a.mbid),
    );

    if (libraryArtists.length === 0 && !getLastfmApiKey()) {
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
      if (db.data) {
        db.data.discovery = {
          recommendations: [],
          globalTop: [],
          basedOn: [],
          topTags: [],
          topGenres: [],
          lastUpdated: null,
        };
        try {
          await db.write();
        } catch (error) {
          console.error("Failed to clear discovery cache:", error.message);
        }
      }
      return;
    }

    const tagCounts = new Map();
    const genreCounts = new Map();
    const profileSample = [...libraryArtists]
      .sort(() => 0.5 - Math.random())
      .slice(0, 25);

    console.log(`Sampling tags/genres from ${profileSample.length} artists...`);

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
    console.log(`Found tags for ${tagsFound} out of ${profileSample.length} artists`);

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

    const recSampleSize = Math.min(25, libraryArtists.length);
    const recSample = [...libraryArtists]
      .sort(() => 0.5 - Math.random())
      .slice(0, recSampleSize);
    const recommendations = new Map();

    console.log(
      `Generating recommendations based on ${recSample.length} artists...`,
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
      console.log(`Recommendation generation: ${successCount} succeeded, ${errorCount} failed`);
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
      })),
      topTags: discoveryCache.topTags || [],
      topGenres: discoveryCache.topGenres || [],
      globalTop: discoveryCache.globalTop || [],
      lastUpdated: new Date().toISOString(),
    };

    Object.assign(discoveryCache, discoveryData);
    db.data.discovery = discoveryData;
    try {
      await db.write();
      console.log(`Discovery data written to database: ${discoveryData.recommendations.length} recommendations, ${discoveryData.topGenres.length} genres, ${discoveryData.globalTop.length} trending`);
    } catch (error) {
      console.error("Failed to write discovery data to database:", error.message);
    }

    const allToHydrate = [
      ...(discoveryCache.globalTop || []),
      ...recommendationsArray,
    ].filter((a) => !a.image);
    console.log(`Hydrating images for ${allToHydrate.length} artists...`);
    
    // Images are now handled through the image service, no need for library lookup here
    await Promise.all(
      allToHydrate.map(async (item) => {
        try {
          
          try {
            const axios = (await import("axios")).default;
            const artistName = item.name || item.artistName;
            
            // Search Deezer directly by artist name (no MusicBrainz relationship lookup needed)
            if (artistName) {
              try {
                const searchResponse = await axios.get(
                  `https://api.deezer.com/search/artist`,
                  {
                    params: { q: artistName, limit: 1 },
                    timeout: 2000
                  }
                ).catch(() => null);

                if (searchResponse?.data?.data?.[0]?.picture_xl || searchResponse?.data?.data?.[0]?.picture_big) {
                  const artist = searchResponse.data.data[0];
                  item.image = artist.picture_xl || artist.picture_big;
                  return;
                }
              } catch (e) {
              }
            }

            const artistDataWithRGs = await musicbrainzRequest(`/artist/${item.id}`, {
              inc: "release-groups",
            }).catch(() => null);

            if (artistDataWithRGs?.["release-groups"] && artistDataWithRGs["release-groups"].length > 0) {
              const releaseGroups = artistDataWithRGs["release-groups"]
                .filter(rg => rg["primary-type"] === "Album" || rg["primary-type"] === "EP")
                .sort((a, b) => {
                  const dateA = a["first-release-date"] || "";
                  const dateB = b["first-release-date"] || "";
                  return dateB.localeCompare(dateA);
                });

              for (const rg of releaseGroups.slice(0, 1)) {
                try {
                  const coverArtJson = await axios.get(
                    `https://coverartarchive.org/release-group/${rg.id}`,
                    {
                      headers: { Accept: "application/json" },
                      timeout: 2000,
                    }
                  ).catch(() => null);

                  if (coverArtJson?.data?.images) {
                    const frontImage = coverArtJson.data.images.find(img => img.front) || coverArtJson.data.images[0];
                    if (frontImage?.thumbnails?.["500"] || frontImage?.image) {
                      item.image = frontImage.thumbnails?.["500"] || frontImage.image;
                      break;
                    }
                  }
                } catch (e) {
                  continue;
                }
              }
            }
          } catch (e) {
          }
        } catch (e) {}
      }),
    );

    await db.write();

    console.log("Discovery cache updated successfully.");
    console.log(`Summary: ${recommendationsArray.length} recommendations, ${discoveryCache.topGenres.length} genres, ${discoveryCache.globalTop.length} trending artists`);
  } catch (error) {
    console.error("Failed to update discovery cache:", error.message);
    console.error("Stack trace:", error.stack);
  } finally {
    discoveryCache.isUpdating = false;
  }
};
