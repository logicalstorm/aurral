import { mbCache } from "./musicbrainz.js";
import { lastfmCache } from "./lastfm.js";
import { listenbrainzCache } from "./listenbrainz.js";
import { deezerArtistCache } from "./deezer.js";
import { musicbrainzArtistNameCache, musicbrainzReleaseGroupsCache } from "./musicbrainz.js";
import { deezerAlbumCache, deezerAlbumTrackCache, deezerPreviewMatchCache } from "./deezer.js";
import { youtubeVideoCache } from "./crossProvider.js";

export function clearApiCaches() {
  mbCache.flushAll();
  lastfmCache.flushAll();
  listenbrainzCache.flushAll();
  deezerArtistCache.flushAll();
  musicbrainzArtistNameCache.flushAll();
  musicbrainzReleaseGroupsCache.flushAll();
  deezerAlbumCache.flushAll();
  deezerAlbumTrackCache.flushAll();
  deezerPreviewMatchCache.flushAll();
  youtubeVideoCache.flushAll();
}
