import { lastfmRequest, getLastfmApiKey } from "./apiClients.js";
import { getDiscoveryCache } from "./discoveryService.js";

export class WeeklyFlowPlaylistSource {
  async getTracksForPlaylist(playlistType, limit = 30) {
    switch (playlistType) {
      case "discover":
        return await this.getRecommendedTracks(limit);
      case "mix":
        return await this.getMixTracks(limit);
      case "trending":
        return await this.getDiscoverTracks(limit);
      default:
        throw new Error(`Unknown playlist type: ${playlistType}`);
    }
  }

  async getDiscoverTracks(limit) {
    if (!getLastfmApiKey()) {
      throw new Error("Last.fm API key not configured");
    }

    try {
      const trackData = await lastfmRequest("chart.getTopTracks", {
        limit: 100,
      });

      if (!trackData?.tracks?.track) {
        return [];
      }

      const tracks = Array.isArray(trackData.tracks.track)
        ? trackData.tracks.track
        : [trackData.tracks.track];

      const result = [];
      const seenArtists = new Set();
      for (const track of tracks) {
        if (result.length >= limit) break;

        const artistName = (
          track.artist?.name ||
          track.artist?.["#text"] ||
          ""
        ).trim();
        const trackName = track?.name?.trim();
        if (!artistName || !trackName) continue;

        const key = artistName.toLowerCase();
        if (seenArtists.has(key)) continue;
        seenArtists.add(key);

        result.push({ artistName, trackName });
      }

      return result;
    } catch (error) {
      console.error(
        "[WeeklyFlowPlaylistSource] Error fetching discover tracks:",
        error.message,
      );
      throw error;
    }
  }

  async getRecommendedTracks(limit) {
    const discoveryCache = getDiscoveryCache();
    const recommendations = discoveryCache.recommendations || [];
    const globalTop = discoveryCache.globalTop || [];

    if (recommendations.length === 0 && globalTop.length === 0) {
      throw new Error(
        "No discovery recommendations available. Update discovery cache first.",
      );
    }

    const artists = [...recommendations, ...globalTop].slice(0, limit);

    if (!getLastfmApiKey()) {
      throw new Error("Last.fm API key required for recommended tracks");
    }

    const tracks = [];
    for (const artist of artists) {
      if (tracks.length >= limit) break;

      const artistName = (artist.name || artist.artistName || "").trim();
      if (!artistName) continue;

      try {
        const topTracks = await lastfmRequest("artist.getTopTracks", {
          artist: artistName,
          limit: 1,
        });

        if (topTracks?.toptracks?.track) {
          const trackList = Array.isArray(topTracks.toptracks.track)
            ? topTracks.toptracks.track
            : [topTracks.toptracks.track];
          const track = trackList[0];
          const trackName = track?.name?.trim();
          if (trackName) {
            tracks.push({ artistName, trackName });
          }
        }
      } catch (error) {
        console.warn(
          `[WeeklyFlowPlaylistSource] Failed to get tracks for ${artistName}:`,
          error.message,
        );
      }
    }

    return tracks;
  }

  async getLibraryTrackTitles(libraryManager, artistId) {
    const albums = await libraryManager.getAlbums(artistId);
    const titles = new Set();
    const maxAlbums = 15;
    for (const album of albums.slice(0, maxAlbums)) {
      const tracks = await libraryManager.getTracks(album.id);
      for (const t of tracks) {
        const name = (t.trackName || t.title || "").trim().toLowerCase();
        if (name) titles.add(name);
      }
    }
    return titles;
  }

  async getMixTracks(limit) {
    const { libraryManager } = await import("./libraryManager.js");
    const artists = await libraryManager.getAllArtists();
    if (artists.length === 0) {
      throw new Error("No artists in library. Add artists to enable Mix.");
    }

    if (!getLastfmApiKey()) {
      throw new Error("Last.fm API key required for Mix");
    }

    const shuffled = [...artists].sort(() => 0.5 - Math.random());
    const tracks = [];
    const maxArtistsToTry = Math.min(30, Math.max(limit * 2, 20));

    for (
      let i = 0;
      i < shuffled.length && tracks.length < limit && i < maxArtistsToTry;
      i++
    ) {
      const artist = shuffled[i];
      const artistName = (artist.artistName || artist.name || "").trim();
      if (!artistName) continue;

      try {
        const ownedTitles = await this.getLibraryTrackTitles(
          libraryManager,
          artist.id,
        );
        const topTracks = await lastfmRequest("artist.getTopTracks", {
          artist: artistName,
          limit: 25,
        });

        if (!topTracks?.toptracks?.track) continue;

        const trackList = Array.isArray(topTracks.toptracks.track)
          ? topTracks.toptracks.track
          : [topTracks.toptracks.track];

        const notOwned = trackList.find((t) => {
          const name = (t?.name || "").trim().toLowerCase();
          return name && !ownedTitles.has(name);
        });

        if (notOwned) {
          const trackName = (notOwned.name || "").trim();
          if (trackName) tracks.push({ artistName, trackName });
        }
      } catch (error) {
        console.warn(
          `[WeeklyFlowPlaylistSource] Failed to get Mix tracks for ${artistName}:`,
          error.message,
        );
      }
      await new Promise((r) => setTimeout(r, 150));
    }

    return tracks;
  }
}

export const playlistSource = new WeeklyFlowPlaylistSource();
