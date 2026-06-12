import { getNormalizedText } from "./providers/brainzmashRanking.js";

function titleMatchesQuery(query, title) {
  const normalizedQuery = getNormalizedText(query);
  const normalizedTitle = getNormalizedText(title);
  if (!normalizedQuery || !normalizedTitle) return false;
  if (normalizedQuery === normalizedTitle) return true;
  return (
    normalizedTitle.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedTitle)
  );
}

function mapInferredArtist({ artistMbid, artistName, score }) {
  if (!artistMbid || !artistName) return null;
  return {
    type: "artist",
    source: "aurral-search",
    id: artistMbid,
    key: artistMbid,
    name: artistName,
    sortName: artistName,
    inLibrary: false,
    hasMbid: true,
    score,
  };
}

export function inferArtistsFromCatalog(catalog, query) {
  const normalizedQuery = getNormalizedText(query);
  const byMbid = new Map();

  for (const album of catalog?.albums || []) {
    if (!album?.artistMbid || !album?.artistName) continue;
    let score = Number(album.score) || 0;
    const normalizedTitle = getNormalizedText(album.title);
    if (normalizedQuery && normalizedTitle === normalizedQuery) {
      score += 35;
    } else if (titleMatchesQuery(query, album.title)) {
      score += 18;
    }
    const existing = byMbid.get(album.artistMbid);
    if (!existing || score > existing.score) {
      const mapped = mapInferredArtist({
        artistMbid: album.artistMbid,
        artistName: album.artistName,
        score,
      });
      if (mapped) byMbid.set(album.artistMbid, mapped);
    }
  }

  for (const track of catalog?.tracks || []) {
    if (!track?.artistMbid || !track?.artistName) continue;
    let score = Number(track.score) || 0;
    const normalizedTitle = getNormalizedText(track.title);
    if (normalizedQuery && normalizedTitle === normalizedQuery) {
      score += 30;
    } else if (titleMatchesQuery(query, track.title)) {
      score += 15;
    }
    const existing = byMbid.get(track.artistMbid);
    if (!existing || score > existing.score) {
      const mapped = mapInferredArtist({
        artistMbid: track.artistMbid,
        artistName: track.artistName,
        score,
      });
      if (mapped) byMbid.set(track.artistMbid, mapped);
    }
  }

  return Array.from(byMbid.values());
}

export function demoteShadowArtists(artists, catalog, query) {
  const normalizedQuery = getNormalizedText(query);
  if (!normalizedQuery) return artists;

  const hasExactAlbumTitle = (catalog?.albums || []).some(
    (album) => getNormalizedText(album?.title) === normalizedQuery,
  );
  if (!hasExactAlbumTitle) return artists;

  return artists.map((artist) => {
    if (getNormalizedText(artist?.name) !== normalizedQuery) return artist;
    return {
      ...artist,
      score: Math.max(0, (Number(artist.score) || 0) - 45),
    };
  });
}

export function enrichCatalogArtists(catalog, query) {
  const inferred = inferArtistsFromCatalog(catalog, query);
  const merged = [...inferred, ...(catalog?.artists || [])];
  return demoteShadowArtists(merged, catalog, query);
}
