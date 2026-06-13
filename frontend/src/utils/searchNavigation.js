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

function buildReleaseFocusState(item, releaseGroupMbid) {
  const releaseTitle = item?.type === "album" ? item.title : item?.albumTitle;
  const releaseDate =
    item?.releaseDate ||
    item?.firstReleaseDate ||
    (item?.releaseYear ? String(item.releaseYear) : "");
  return {
    id: releaseGroupMbid,
    title: releaseTitle || "",
    firstReleaseDate: releaseDate || "",
    primaryType: item?.primaryType || item?.releaseType || "Album",
    secondaryTypes: Array.isArray(item?.secondaryTypes)
      ? item.secondaryTypes
      : [],
    coverUrl: item?.coverUrl || item?.imageUrl || item?.image || "",
    deezerAlbumId: item?._deezerAlbumId || item?.deezerAlbumId || "",
  };
}

export function getAlbumTracklistNavigationTarget(item) {
  if (!item?.artistMbid) return null;
  const releaseGroupMbid = item.type === "album" ? item.id : item.albumMbid;
  if (!releaseGroupMbid) return null;
  const state = buildArtistFocusState(item, {
    focusReleaseGroupMbid: releaseGroupMbid,
    focusReleaseGroup: buildReleaseFocusState(item, releaseGroupMbid),
  });
  if (item.type === "track") {
    const trackMbid = item.id || item.trackMbid;
    if (trackMbid) state.focusTrackMbid = trackMbid;
    if (item.title) state.focusTrackTitle = item.title;
  }
  return {
    pathname: `/artist/${item.artistMbid}/albums`,
    state,
  };
}

export function getReleaseNavigationTarget(item) {
  if (!item?.artistMbid) return null;
  const releaseGroupMbid = item.type === "album" ? item.id : item.albumMbid;
  if (!releaseGroupMbid) return null;
  const state = buildArtistFocusState(item, {
    focusReleaseGroupMbid: releaseGroupMbid,
    focusReleaseGroup: buildReleaseFocusState(item, releaseGroupMbid),
  });
  if (item.type === "track") {
    const trackMbid = item.id || item.trackMbid;
    if (trackMbid) state.focusTrackMbid = trackMbid;
    if (item.title) state.focusTrackTitle = item.title;
  }
  return {
    pathname: `/artist/${item.artistMbid}/release/${releaseGroupMbid}`,
    state,
  };
}

export function navigateFromSearchResult(
  navigate,
  item,
  { query = "", albumDestination = "release" } = {},
) {
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
    const target =
      albumDestination === "tracklist"
        ? getAlbumTracklistNavigationTarget(item)
        : getReleaseNavigationTarget(item);
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
    const target =
      albumDestination === "tracklist"
        ? getAlbumTracklistNavigationTarget(item)
        : getReleaseNavigationTarget(item);
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
    if (item.discoverPresetId && item.source === "discover") {
      navigate("/discover");
      return;
    }
    if (item.sourceFlowId) {
      navigate("/flows", { state: { selectedFlowId: item.sourceFlowId } });
      return;
    }
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
  const seen = new Set();
  const result = [];
  for (const artist of artists) {
    const key = normalizeSearchText(artist?.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(artist);
  }
  return result;
}

function getSearchResultBuckets(data) {
  return [
    ...(data.library?.playlists || []),
    ...(data.library?.tracks || []),
    ...(data.library?.artists || []),
    ...(data.catalog?.artists || []),
    ...(data.catalog?.albums || []),
    ...(data.catalog?.tracks || []),
  ];
}

export function buildMixedSearchPageItems(
  data,
  { limit = 24, excludeArtist = null, excludeItem = null, libraryFlags = {} } = {},
) {
  if (!data) return [];

  const excluded = excludeItem || excludeArtist;
  const excludeName = excluded?.type === "artist"
    ? normalizeSearchText(excluded.name)
    : "";
  const excludeId = excluded?.id || null;
  const excludeIdentity = getResultIdentity(excluded);

  const candidates = prepareSearchCandidates(
    getSearchResultBuckets(data),
    libraryFlags,
  ).filter((item) => {
    if (!excluded) return true;
    if (excludeIdentity && getResultIdentity(item) === excludeIdentity) {
      return false;
    }
    if (excludeId && item.id === excludeId && item.type === excluded.type) {
      return false;
    }
    if (item.type !== "artist") return true;
    if (excludeName && normalizeSearchText(item.name) === excludeName) {
      return false;
    }
    return true;
  });

  const seen = new Set();
  const seenArtistNames = new Set();
  if (excludeName) seenArtistNames.add(excludeName);
  return dedupeItems(candidates, seen, seenArtistNames).slice(0, limit);
}

export function buildMixedSuggestionItems(data, limit = 8, libraryFlags = {}) {
  if (!data) return [];

  const seen = new Set();
  const seenArtistNames = new Set();
  const result = [];

  const topItem = data.top
    ? prepareSearchCandidates([data.top], libraryFlags)[0]
    : null;
  if (topItem) {
    result.push(topItem);
    const identity = getResultIdentity(topItem);
    if (identity) seen.add(identity);
    if (topItem.type === "artist") {
      const nameKey = normalizeSearchText(topItem.name);
      if (nameKey) seenArtistNames.add(nameKey);
    }
  }

  const candidates = prepareSearchCandidates(
    getSearchResultBuckets(data),
    libraryFlags,
  );
  for (const item of dedupeItems(candidates, seen, seenArtistNames)) {
    if (result.length >= limit) break;
    result.push(item);
  }
  return result.slice(0, limit);
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
    data.catalog?.artists || [],
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

