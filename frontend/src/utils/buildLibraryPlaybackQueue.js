import { getLibraryAlbums, getLibraryArtists, getLibraryTracks } from "./api";
import {
  isDownloadedLibraryAlbum,
  normalizeQueueTrack,
} from "./audioQueue";

export async function buildLibraryPlaybackQueue({ onProgress } = {}) {
  const artists = await getLibraryArtists();
  const queue = [];
  const seen = new Set();
  let processed = 0;

  const pushTrack = (track) => {
    if (!track?.src || seen.has(track.id)) return;
    seen.add(track.id);
    queue.push(track);
  };

  for (const artist of artists) {
    const artistId = artist?.id;
    const artistName = artist?.artistName || "Unknown Artist";
    if (!artistId) continue;

    const albums = await getLibraryAlbums(artistId).catch(() => []);
    const downloaded = albums.filter((album) =>
      isDownloadedLibraryAlbum(album),
    );

    for (const album of downloaded) {
      const tracks = await getLibraryTracks(
        album.id,
        album.mbid || album.foreignAlbumId,
        {
          artistName,
          albumTitle: album.title,
        },
      ).catch(() => []);

      for (const track of tracks) {
        if (!track?.preview_url) continue;
        pushTrack(
          normalizeQueueTrack({
            id: `lib-${artistId}-${album.id}-${track.id}`,
            title: track.title,
            artist: artistName,
            album: album.title,
            src: track.preview_url,
            streamFormat: track.streamFormat,
            quality: track.quality,
          }),
        );
      }
    }

    processed += 1;
    onProgress?.({ processed, total: artists.length, queueLength: queue.length });
  }

  return queue;
}
