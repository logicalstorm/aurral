export async function enrichPlaylistTracksForAdoption(playlist, enrichTracks) {
  if (!playlist || !Array.isArray(playlist.tracks) || playlist.tracks.length === 0) {
    return playlist;
  }

  const nextPlaylist = {
    ...playlist,
    tracks: playlist.tracks.map((track) => ({ ...track })),
  };
  const missingAlbums = nextPlaylist.tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => !track.albumName);
  if (missingAlbums.length === 0) return nextPlaylist;

  const enriched = await enrichTracks(missingAlbums.map(({ track }) => track));
  for (let index = 0; index < missingAlbums.length; index += 1) {
    const trackIndex = missingAlbums[index].index;
    nextPlaylist.tracks[trackIndex] = {
      ...nextPlaylist.tracks[trackIndex],
      albumName: enriched[index]?.albumName || null,
    };
  }
  return nextPlaylist;
}
