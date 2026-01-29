import { lastfmRequest, getLastfmApiKey } from "./apiClients.js";
import { getDiscoveryCache } from "./discoveryService.js";

export class WeeklyFlowPlaylistSource {
  async getTracksForPlaylist(playlistType, limit = 30) {
    switch (playlistType) {
      case "discover":
        return await this.getDiscoverTracks(limit);
      case "recommended":
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
        limit: Math.min(limit * 2, 100),
      });

      if (!trackData?.tracks?.track) {
        return [];
      }

      const tracks = Array.isArray(trackData.tracks.track)
        ? trackData.tracks.track
        : [trackData.tracks.track];

      const result = [];
      for (const track of tracks) {
        if (result.length >= limit) break;

        const artistName = track.artist?.name || track.artist?.["#text"];
        const trackName = track.name;

        if (artistName && trackName) {
          result.push({
            artistName: artistName.trim(),
            trackName: trackName.trim(),
          });
        }
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

    const artists = [...recommendations, ...globalTop].slice(
      0,
      Math.min(limit, 20),
    );

    if (!getLastfmApiKey()) {
      throw new Error("Last.fm API key required for recommended tracks");
    }

    const tracks = [];
    const seen = new Set();

    for (const artist of artists) {
      if (tracks.length >= limit) break;

      const artistName = artist.name || artist.artistName;
      if (!artistName) continue;

      try {
        const topTracks = await lastfmRequest("artist.getTopTracks", {
          artist: artistName,
          limit: 3,
        });

        if (topTracks?.toptracks?.track) {
          const trackList = Array.isArray(topTracks.toptracks.track)
            ? topTracks.toptracks.track
            : [topTracks.toptracks.track];

          for (const track of trackList) {
            if (tracks.length >= limit) break;

            const trackName = track.name;
            if (!trackName) continue;

            const key = `${artistName.toLowerCase()}-${trackName.toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);

            tracks.push({
              artistName: artistName.trim(),
              trackName: trackName.trim(),
            });
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
    const sample = shuffled.slice(0, Math.min(20, artists.length));
    const tracks = [];
    const seen = new Set();

    for (const artist of sample) {
      if (tracks.length >= limit) break;

      const artistName = artist.artistName || artist.name;
      if (!artistName) continue;

      try {
        const topTracks = await lastfmRequest("artist.getTopTracks", {
          artist: artistName,
          limit: 5,
        });

        if (topTracks?.toptracks?.track) {
          const trackList = Array.isArray(topTracks.toptracks.track)
            ? topTracks.toptracks.track
            : [topTracks.toptracks.track];

          for (const track of trackList) {
            if (tracks.length >= limit) break;

            const trackName = track.name;
            if (!trackName) continue;

            const key = `${artistName.toLowerCase()}-${trackName.toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);

            tracks.push({
              artistName: artistName.trim(),
              trackName: trackName.trim(),
            });
          }
        }
      } catch (error) {
        console.warn(
          `[WeeklyFlowPlaylistSource] Failed to get Mix tracks for ${artistName}:`,
          error.message,
        );
      }
    }

    return tracks;
  }
}

export const playlistSource = new WeeklyFlowPlaylistSource();
