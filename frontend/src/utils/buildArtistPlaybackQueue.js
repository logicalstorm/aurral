import { getLibraryTracks } from "./api";
import {
  isDownloadedLibraryAlbum,
  normalizePreviewTrack,
  normalizeQueueTrack,
} from "./audioQueue";

export async function buildArtistPlaybackQueue({
  artistName,
  previewTracks = [],
  existsInLibrary = false,
  libraryArtist = null,
  libraryAlbums = [],
  downloadStatuses = {},
  albumTracksCache = {},
}) {
  const queue = [];
  const seen = new Set();

  const pushTrack = (track) => {
    if (!track?.src || seen.has(track.id)) return;
    seen.add(track.id);
    queue.push(track);
  };

  if (existsInLibrary && libraryArtist?.id && Array.isArray(libraryAlbums)) {
    const downloaded = libraryAlbums.filter((album) =>
      isDownloadedLibraryAlbum(album, downloadStatuses),
    );
    for (const album of downloaded) {
      const cacheKey = String(album.id ?? "");
      let tracks = albumTracksCache[cacheKey];
      if (!tracks) {
        tracks = await getLibraryTracks(
          album.id,
          album.mbid || album.foreignAlbumId,
          {
            artistName,
            albumTitle: album.title,
          },
        );
      }
      for (const track of tracks) {
        if (!track?.preview_url) continue;
        pushTrack(
          normalizeQueueTrack({
            id: `lib-${album.id}-${track.id}`,
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
  }

  for (const track of previewTracks) {
    if (!track?.preview_url) continue;
    pushTrack(normalizePreviewTrack(track, artistName));
  }

  return queue;
}
