import { libraryManager } from "../../../services/libraryManager.js";
import { cacheMiddleware } from "../../../middleware/cache.js";

export default function registerTracks(router) {
  router.get("/tracks", cacheMiddleware(120), async (req, res) => {
    try {
      const { albumId, releaseGroupMbid } = req.query;

      let tracks = [];

      if (albumId) {
        tracks = await libraryManager.getTracks(albumId);
      }

      if (tracks.length === 0 && releaseGroupMbid) {
        if (String(releaseGroupMbid).startsWith("dz-")) {
          const { deezerGetAlbumTracks } = await import(
            "../../../services/apiClients.js"
          );
          const dzTracks = await deezerGetAlbumTracks(releaseGroupMbid);
          tracks = dzTracks.map((t) => ({
            ...t,
            path: null,
            hasFile: false,
            size: 0,
            quality: null,
            addedAt: new Date().toISOString(),
          }));
        } else {
          const { musicbrainzRequest } = await import(
            "../../../services/apiClients.js"
          );
          try {
            const rgData = await musicbrainzRequest(
              `/release-group/${releaseGroupMbid}`,
              { inc: "releases" }
            );

            if (rgData.releases && rgData.releases.length > 0) {
              const releaseId = rgData.releases[0].id;
              const releaseData = await musicbrainzRequest(
                `/release/${releaseId}`,
                {
                  inc: "recordings",
                }
              );

              if (releaseData.media && releaseData.media.length > 0) {
                tracks = [];
                for (const medium of releaseData.media) {
                  if (medium.tracks) {
                    for (const track of medium.tracks) {
                      const recording = track.recording;
                      if (recording) {
                        tracks.push({
                          id: recording.id,
                          mbid: recording.id,
                          trackName: recording.title,
                          trackNumber: track.position || 0,
                          title: recording.title,
                          path: null,
                          hasFile: false,
                          size: 0,
                          quality: null,
                          addedAt: new Date().toISOString(),
                        });
                      }
                    }
                  }
                }
              }
            }
          } catch (mbError) {
            console.warn(
              `[Library] Failed to fetch tracks from MusicBrainz: ${mbError.message}`
            );
          }
        }
      }

      const formatted = tracks.map((track) => ({
        ...track,
        title: track.trackName || track.title,
        trackNumber: track.trackNumber || 0,
      }));
      res.json(formatted);
    } catch (error) {
      res.status(500).json({
        error: "Failed to fetch tracks",
        message: error.message,
      });
    }
  });
}
