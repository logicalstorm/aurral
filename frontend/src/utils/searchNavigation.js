export function getSearchResultLabel(item) {
  if (!item) return "";
  if (item.type === "artist") return item.name || "";
  if (item.type === "playlist") return item.name || "";
  if (item.type === "album") {
    const title = item.title || "";
    const artist = item.artistName || "";
    return artist ? `${title} — ${artist}` : title;
  }
  if (item.type === "track") {
    const title = item.title || "";
    const artist = item.artistName || "";
    return artist ? `${title} — ${artist}` : title;
  }
  return "";
}

export function getSearchResultKey(item, index = 0) {
  if (!item) return `search-item-${index}`;
  return (
    item.key ||
    item.id ||
    `${item.type}:${getSearchResultLabel(item).toLowerCase()}:${index}`
  );
}

export function buildArtistFocusState(item, overrides = {}) {
  const state = { ...overrides };
  if (item?.artistName) state.artistName = item.artistName;
  if (typeof item?.inLibrary === "boolean") state.inLibrary = item.inLibrary;
  return state;
}

export function getReleaseNavigationTarget(item) {
  if (!item?.artistMbid) return null;
  const releaseGroupMbid = item.type === "album" ? item.id : item.albumMbid;
  if (!releaseGroupMbid) return null;
  const state = buildArtistFocusState(item, {
    focusReleaseGroupMbid: releaseGroupMbid,
  });
  if (item.type === "track") {
    const trackMbid = item.id || item.trackMbid;
    if (trackMbid) state.focusTrackMbid = trackMbid;
  }
  return {
    pathname: `/artist/${item.artistMbid}/albums`,
    state,
  };
}

export function navigateFromSearchResult(navigate, item, { query = "" } = {}) {
  if (!item || typeof navigate !== "function") return;

  if (item.type === "artist") {
    if (item.id) {
      navigate(`/artist/${item.id}`, {
        state: buildArtistFocusState(item),
      });
      return;
    }
    navigate(`/search?q=${encodeURIComponent(item.name || query)}&filter=artists`);
    return;
  }

  if (item.type === "album") {
    const target = getReleaseNavigationTarget(item);
    if (target) {
      navigate(target.pathname, { state: target.state });
      return;
    }
    navigate(
      `/search?q=${encodeURIComponent(item.title || query)}&filter=albums`,
    );
    return;
  }

  if (item.type === "track") {
    if (item.source === "library" && item.streamPath && !item.albumMbid) {
      navigate("/library");
      return;
    }
    const target = getReleaseNavigationTarget(item);
    if (target) {
      navigate(target.pathname, { state: target.state });
      return;
    }
    if (item.artistMbid) {
      navigate(`/artist/${item.artistMbid}`, {
        state: buildArtistFocusState(item),
      });
      return;
    }
    navigate(
      `/search?q=${encodeURIComponent(
        [item.artistName, item.title].filter(Boolean).join(" ") || query,
      )}&filter=tracks`,
    );
    return;
  }

  if (item.type === "playlist" && item.id) {
    navigate("/playlists", { state: { selectedPlaylistId: item.id } });
  }
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SEARCH_RANK = {
  PLAYLIST: 5000,
  LIBRARY_TRACK: 4000,
  LIBRARY_ARTIST: 3500,
  LIBRARY_ITEM: 3000,
};

const LIBRARY_PRIORITY_MIN_SCORE = 82;

function getLibraryTierBoost(item, base) {
  if (base < LIBRARY_PRIORITY_MIN_SCORE) return 0;
  if (item?.type === "playlist") return SEARCH_RANK.PLAYLIST;
  if (item?.inLibrary) {
    if (item.type === "track") return SEARCH_RANK.LIBRARY_TRACK;
    if (item.type === "artist") return SEARCH_RANK.LIBRARY_ARTIST;
    return SEARCH_RANK.LIBRARY_ITEM;
  }
  return 0;
}

export function getSearchRankScore(item) {
  const base = Number(item?.score) || 0;
  return base + getLibraryTierBoost(item, base);
}

export function compareSearchResults(left, right) {
  return getSearchRankScore(right) - getSearchRankScore(left);
}

function applyLibraryFlags(item, libraryFlags = {}) {
  if (!item || item.inLibrary) return item;
  const artistIds = libraryFlags.artistIds;
  const albumIds = libraryFlags.albumIds;
  if (item.type === "artist" && item.id && artistIds?.has(item.id)) {
    return { ...item, inLibrary: true };
  }
  if (item.type === "album" && item.id && albumIds?.has(item.id)) {
    return { ...item, inLibrary: true };
  }
  if (
    item.type === "track" &&
    item.albumMbid &&
    albumIds?.has(item.albumMbid)
  ) {
    return { ...item, inLibrary: true };
  }
  return item;
}

function prepareSearchCandidates(items, libraryFlags) {
  return items
    .filter(Boolean)
    .map((item) => applyLibraryFlags(item, libraryFlags));
}

function titleMatchesQuery(query, title) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedTitle = normalizeSearchText(title);
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
  const normalizedQuery = normalizeSearchText(query);
  const byMbid = new Map();

  for (const album of catalog?.albums || []) {
    if (!album?.artistMbid || !album?.artistName) continue;
    let score = Number(album.score) || 0;
    const normalizedTitle = normalizeSearchText(album.title);
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
    const normalizedTitle = normalizeSearchText(track.title);
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

function demoteShadowArtists(artists, catalog, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return artists;

  const hasExactAlbumTitle = (catalog?.albums || []).some(
    (album) => normalizeSearchText(album?.title) === normalizedQuery,
  );
  if (!hasExactAlbumTitle) return artists;

  return artists.map((artist) => {
    if (normalizeSearchText(artist?.name) !== normalizedQuery) return artist;
    return {
      ...artist,
      score: Math.max(0, (Number(artist.score) || 0) - 45),
    };
  });
}

export function getCatalogArtists(data, query) {
  if (!data) return [];
  const catalog = {
    artists: data.catalog?.artists || [],
    albums: data.catalog?.albums || [],
    tracks: data.catalog?.tracks || [],
  };
  const inferred = inferArtistsFromCatalog(catalog, query);
  return demoteShadowArtists(
    [...inferred, ...catalog.artists],
    catalog,
    query,
  );
}

function getResultIdentity(item) {
  if (!item) return null;
  if (item.id) return `${item.type}:${item.id}`;
  if (item.key) return String(item.key);
  return null;
}

function dedupeItems(items, seen, seenArtistNames = null) {
  const unique = [];
  for (const item of items) {
    if (item.type === "artist" && seenArtistNames) {
      const nameKey = normalizeSearchText(item.name);
      if (nameKey) {
        if (seenArtistNames.has(nameKey)) continue;
        seenArtistNames.add(nameKey);
      }
    }
    const identity = getResultIdentity(item);
    if (identity) {
      if (seen.has(identity)) continue;
      seen.add(identity);
    }
    unique.push(item);
  }
  return unique;
}

export function dedupeArtistsByName(artists) {
  const bestByName = new Map();
  for (const artist of artists) {
    const key = normalizeSearchText(artist?.name);
    if (!key) continue;
    const existing = bestByName.get(key);
    if (!existing) {
      bestByName.set(key, artist);
      continue;
    }
    if (compareSearchResults(artist, existing) < 0) {
      bestByName.set(key, artist);
    }
  }
  return Array.from(bestByName.values()).sort(compareSearchResults);
}

export function pickTopSearchArtist(data, libraryFlags = {}, query = "") {
  if (!data) return null;
  const searchQuery = query || data.query || "";
  const artists = dedupeArtistsByName(
    prepareSearchCandidates(
      [
        ...(data.library?.artists || []),
        ...getCatalogArtists(data, searchQuery),
      ],
      libraryFlags,
    ),
  ).filter((artist) => artist?.id);
  const libraryArtist = artists.find((artist) => artist.inLibrary);
  if (libraryArtist) return libraryArtist;
  return artists[0] || null;
}

export function buildMixedSearchPageItems(
  data,
  { limit = 24, excludeArtist = null, libraryFlags = {} } = {},
) {
  if (!data) return [];

  const excludeName = excludeArtist
    ? normalizeSearchText(excludeArtist.name)
    : "";
  const excludeId = excludeArtist?.id || null;

  const candidates = prepareSearchCandidates(
    [
      ...(data.library?.playlists || []),
      ...(data.library?.tracks || []),
      ...(data.library?.artists || []),
      ...getCatalogArtists(data, data.query || ""),
      ...(data.catalog?.tracks || []),
      ...(data.catalog?.albums || []),
    ],
    libraryFlags,
  )
    .filter((item) => {
      if (item.type !== "artist" || !excludeArtist) return true;
      if (excludeId && item.id === excludeId) return false;
      if (excludeName && normalizeSearchText(item.name) === excludeName) {
        return false;
      }
      return true;
    })
    .sort(compareSearchResults);

  const seen = new Set();
  const seenArtistNames = new Set();
  if (excludeName) seenArtistNames.add(excludeName);
  return dedupeItems(candidates, seen, seenArtistNames).slice(0, limit);
}

export function buildMixedSuggestionItems(data, limit = 8, libraryFlags = {}) {
  if (!data) return [];

  const candidates = prepareSearchCandidates(
    [
      ...(data.library?.playlists || []),
      ...(data.library?.tracks || []),
      ...(data.library?.artists || []),
      ...getCatalogArtists(data, data.query || ""),
      ...(data.catalog?.tracks || []),
      ...(data.catalog?.albums || []),
    ],
    libraryFlags,
  ).sort(compareSearchResults);

  const seen = new Set();
  const seenArtistNames = new Set();
  return dedupeItems(candidates, seen, seenArtistNames).slice(0, limit);
}

export function buildUnifiedSuggestionSections(data) {
  if (!data) return [];

  const seen = new Set();
  const seenArtistNames = new Set();
  const sections = [];

  if (data.top) {
    const identity = getResultIdentity(data.top);
    if (identity) seen.add(identity);
    if (data.top.type === "artist") {
      const nameKey = normalizeSearchText(data.top.name);
      if (nameKey) seenArtistNames.add(nameKey);
    }
    sections.push({ key: "top", label: "Top result", items: [data.top] });
  }

  const libraryItems = dedupeItems(
    [...(data.library?.tracks || []), ...(data.library?.artists || [])],
    seen,
    seenArtistNames,
  );
  if (libraryItems.length > 0) {
    sections.push({
      key: "library",
      label: "Your Library",
      items: libraryItems,
    });
  }

  const playlists = dedupeItems(
    data.library?.playlists || [],
    seen,
    seenArtistNames,
  );
  if (playlists.length > 0) {
    sections.push({
      key: "playlists",
      label: "Playlists",
      items: playlists,
    });
  }

  const artists = dedupeItems(
    getCatalogArtists(data, data.query || ""),
    seen,
    seenArtistNames,
  );
  if (artists.length > 0) {
    sections.push({
      key: "artists",
      label: "Artists",
      items: artists,
    });
  }

  const albums = dedupeItems(data.catalog?.albums || [], seen, seenArtistNames);
  if (albums.length > 0) {
    sections.push({
      key: "albums",
      label: "Albums",
      items: albums,
    });
  }

  const tracks = dedupeItems(
    data.catalog?.tracks || [],
    seen,
    seenArtistNames,
  );
  if (tracks.length > 0) {
    sections.push({
      key: "tracks",
      label: "Songs",
      items: tracks,
    });
  }

  return sections;
}

export function flattenSuggestionSections(sections) {
  const rows = [];
  for (const section of sections) {
    rows.push({
      kind: "header",
      key: `header:${section.key}`,
      label: section.label,
    });
    section.items.forEach((item, index) => {
      rows.push({
        kind: "item",
        key: `${section.key}:${getSearchResultKey(item, index)}`,
        item,
      });
    });
  }
  return rows;
}
