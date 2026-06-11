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

function getResultIdentity(item) {
  if (!item) return null;
  if (item.id) return `${item.type}:${item.id}`;
  if (item.key) return String(item.key);
  return null;
}

function dedupeItems(items, seen) {
  const unique = [];
  for (const item of items) {
    const identity = getResultIdentity(item);
    if (identity) {
      if (seen.has(identity)) continue;
      seen.add(identity);
    }
    unique.push(item);
  }
  return unique;
}

export function buildUnifiedSuggestionSections(data) {
  if (!data) return [];

  const seen = new Set();
  const sections = [];

  if (data.top) {
    const identity = getResultIdentity(data.top);
    if (identity) seen.add(identity);
    sections.push({ key: "top", label: "Top result", items: [data.top] });
  }

  const libraryItems = dedupeItems(
    [...(data.library?.tracks || []), ...(data.library?.artists || [])],
    seen,
  );
  if (libraryItems.length > 0) {
    sections.push({
      key: "library",
      label: "Your Library",
      items: libraryItems,
    });
  }

  const playlists = dedupeItems(data.library?.playlists || [], seen);
  if (playlists.length > 0) {
    sections.push({
      key: "playlists",
      label: "Playlists",
      items: playlists,
    });
  }

  const artists = dedupeItems(data.catalog?.artists || [], seen);
  if (artists.length > 0) {
    sections.push({
      key: "artists",
      label: "Artists",
      items: artists,
    });
  }

  const albums = dedupeItems(data.catalog?.albums || [], seen);
  if (albums.length > 0) {
    sections.push({
      key: "albums",
      label: "Albums",
      items: albums,
    });
  }

  const tracks = dedupeItems(data.catalog?.tracks || [], seen);
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
