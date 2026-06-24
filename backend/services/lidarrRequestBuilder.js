const STALE_GRABBED_MS = 15 * 60 * 1000;

const toIso = (value) => {
  if (value == null) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const isPlaceholder = (value, fallback) => {
  if (!value) return true;
  const normalized = String(value).trim().toLowerCase();
  return normalized === String(fallback).trim().toLowerCase();
};

const containsAny = (haystack, needles) =>
  needles.some((n) => haystack.includes(n));

export const buildLidarrRequests = async (lidarrClient) => {
  const [queue, history] = await Promise.all([
    lidarrClient.getQueue().catch(() => []),
    lidarrClient.getHistory(1, 200).catch(() => ({ records: [] })),
  ]);

  const requestsByAlbumId = new Map();

  const queueItems = Array.isArray(queue) ? queue : queue?.records || [];
  const queueByAlbumId = new Map();
  for (const item of queueItems) {
    const albumId = item?.albumId ?? item?.album?.id;
    if (albumId == null) continue;
    queueByAlbumId.set(String(albumId), item);
  }

  for (const item of queueItems) {
    const albumId = item?.albumId ?? item?.album?.id;
    if (albumId == null) continue;

    const albumName = item?.album?.title || item?.title || "Album";
    const artistName = item?.artist?.artistName || "Artist";
    const artistMbid = item?.artist?.foreignArtistId || null;

    const queueStatus = String(item.status || "").toLowerCase();
    const title = String(item.title || "").toLowerCase();
    const trackedDownloadState = String(
      item.trackedDownloadState || "",
    ).toLowerCase();
    const trackedDownloadStatus = String(
      item.trackedDownloadStatus || "",
    ).toLowerCase();
    const errorMessage = String(item.errorMessage || "").toLowerCase();
    const statusMessages = Array.isArray(item.statusMessages)
      ? item.statusMessages
          .map((m) => String(m || "").toLowerCase())
          .join(" ")
      : "";

    const isFailed =
      trackedDownloadState === "importfailed" ||
      trackedDownloadState === "importFailed" ||
      containsAny(queueStatus, ["fail"]) ||
      containsAny(title, ["import fail", "downloaded - import fail"]) ||
      containsAny(trackedDownloadState, ["fail"]) ||
      containsAny(trackedDownloadStatus, ["fail"]) ||
      trackedDownloadStatus === "warning" ||
      containsAny(errorMessage, ["fail", "retrying"]) ||
      containsAny(statusMessages, ["fail", "unmatched"]);

    const status = isFailed ? "failed" : "processing";

    requestsByAlbumId.set(String(albumId), {
      id: `lidarr-queue-${item.id ?? albumId}`,
      source: "lidarr",
      type: "album",
      albumId: String(albumId),
      albumMbid: item?.album?.foreignAlbumId || null,
      albumName,
      artistId: item?.artist?.id != null ? String(item.artist.id) : null,
      artistMbid,
      artistName,
      status,
      statusLabel: isFailed ? "Failed" : "Downloading",
      requestedAt: toIso(item?.added),
      mbid: artistMbid,
      name: albumName,
      image: null,
      inQueue: true,
      canReSearch: isFailed,
    });
  }

  const historyRecords = Array.isArray(history?.records)
    ? history.records
    : Array.isArray(history)
      ? history
      : [];

  const latestHistoryByAlbum = new Map();
  for (const record of historyRecords) {
    const albumId = record?.albumId;
    if (albumId == null) continue;
    const recordTime = new Date(
      record?.date || record?.eventDate || 0,
    ).getTime();
    const existing = latestHistoryByAlbum.get(String(albumId));
    if (!existing || recordTime > existing.recordTime) {
      latestHistoryByAlbum.set(String(albumId), {
        record,
        recordTime,
      });
    }
  }

  for (const [albumId, { record, recordTime }] of latestHistoryByAlbum) {
    const existing = requestsByAlbumId.get(String(albumId));
    if (existing) continue;

    const albumName = record?.album?.title || record?.sourceTitle || "Album";
    const artistName = record?.artist?.artistName || "Artist";
    const artistMbid = record?.artist?.foreignArtistId || null;

    const eventType = String(record?.eventType || "").toLowerCase();
    const data = record?.data || {};
    const statusMessages = Array.isArray(data?.statusMessages)
      ? data.statusMessages
          .map((m) => String(m || "").toLowerCase())
          .join(" ")
      : String(data?.statusMessages?.[0] || "").toLowerCase();
    const errorMessage = String(data?.errorMessage || "").toLowerCase();
    const sourceTitle = String(record?.sourceTitle || "").toLowerCase();
    const dataString = JSON.stringify(data).toLowerCase();
    const hasQueue = queueByAlbumId.has(String(albumId));
    const isGrabbed = containsAny(eventType, ["grabbed"]) ||
      containsAny(sourceTitle, ["grabbed"]) ||
      containsAny(dataString, ["grabbed"]);
    const isFailedDownload =
      containsAny(eventType, ["fail"]) ||
      containsAny(statusMessages, ["fail", "error"]) ||
      containsAny(errorMessage, ["fail", "error"]) ||
      containsAny(sourceTitle, ["fail"]) ||
      containsAny(dataString, ["fail"]);

    const isFailedImport =
      eventType === "albumimportincomplete" ||
      containsAny(eventType, ["incomplete"]) ||
      containsAny(statusMessages, ["fail", "error", "import fail", "incomplete"]) ||
      containsAny(errorMessage, ["fail", "error"]) ||
      containsAny(sourceTitle, ["import fail"]) ||
      containsAny(dataString, ["import fail"]);

    const isSuccessfulImport =
      eventType.includes("import") &&
      !isFailedImport &&
      eventType !== "albumimportincomplete";
    const isStaleGrabbed =
      isGrabbed && !hasQueue && Date.now() - recordTime > STALE_GRABBED_MS;
    const isActive =
      hasQueue || (isGrabbed && !isStaleGrabbed);
    if (!isActive && !isSuccessfulImport) {
      if (!(isFailedImport || isFailedDownload || isStaleGrabbed)) {
        continue;
      }
    }
    const status = hasQueue
      ? "processing"
      : isSuccessfulImport
        ? "available"
        : isFailedImport || isFailedDownload || isStaleGrabbed
          ? "failed"
          : "processing";
    const statusLabel =
      status === "available"
        ? "Complete"
        : status === "failed"
          ? "Failed"
          : isGrabbed
            ? "Downloading"
            : "In progress";

    requestsByAlbumId.set(String(albumId), {
      id: `lidarr-history-${record.id ?? albumId}`,
      source: "lidarr",
      type: "album",
      albumId: String(albumId),
      albumMbid: record?.album?.foreignAlbumId || null,
      albumName,
      artistId: record?.artistId != null ? String(record.artistId) : null,
      artistMbid,
      artistName,
      status,
      statusLabel,
      requestedAt: toIso(record?.date || record?.eventDate),
      mbid: artistMbid,
      name: albumName,
      image: null,
      inQueue: false,
      canReSearch: status === "failed",
    });
  }

  let sorted = [...requestsByAlbumId.values()].sort(
    (a, b) => new Date(b.requestedAt) - new Date(a.requestedAt),
  );

  const missingAlbumIds = new Set();
  const missingArtistIds = new Set();

  for (const request of sorted) {
    if (request.albumId) {
      if (
        !request.albumMbid ||
        isPlaceholder(request.albumName, "Album") ||
        !request.artistId
      ) {
        missingAlbumIds.add(String(request.albumId));
      }
    }
    if (request.artistId) {
      if (
        !request.artistMbid ||
        isPlaceholder(request.artistName, "Artist")
      ) {
        missingArtistIds.add(String(request.artistId));
      }
    }
  }

  const albumDetailsById = new Map();
  const artistDetailsById = new Map();

  if (missingAlbumIds.size > 0) {
    const albumIds = Array.from(missingAlbumIds);
    const albums = await Promise.all(
      albumIds.map((id) => lidarrClient.getAlbum(id).catch(() => null)),
    );
    for (let i = 0; i < albumIds.length; i++) {
      if (albums[i]) {
        albumDetailsById.set(String(albumIds[i]), albums[i]);
        if (albums[i]?.artistId != null) {
          missingArtistIds.add(String(albums[i].artistId));
        }
      }
    }
  }

  if (missingArtistIds.size > 0) {
    const artistIds = Array.from(missingArtistIds);
    const artists = await Promise.all(
      artistIds.map((id) => lidarrClient.getArtist(id).catch(() => null)),
    );
    for (let i = 0; i < artistIds.length; i++) {
      if (artists[i]) {
        artistDetailsById.set(String(artistIds[i]), artists[i]);
      }
    }
  }

  if (albumDetailsById.size > 0 || artistDetailsById.size > 0) {
    sorted = sorted.map((request) => {
      const enriched = { ...request };
      if (
        enriched.albumId &&
        albumDetailsById.has(String(enriched.albumId))
      ) {
        const album = albumDetailsById.get(String(enriched.albumId));
        if (album) {
          if (!enriched.albumMbid && album.foreignAlbumId) {
            enriched.albumMbid = album.foreignAlbumId;
          }
          if (isPlaceholder(enriched.albumName, "Album") && album.title) {
            enriched.albumName = album.title;
            enriched.name = album.title;
          }
          if (!enriched.artistId && album.artistId != null) {
            enriched.artistId = String(album.artistId);
          }
        }
      }
      if (
        enriched.artistId &&
        artistDetailsById.has(String(enriched.artistId))
      ) {
        const artist = artistDetailsById.get(String(enriched.artistId));
        if (artist) {
          if (
            isPlaceholder(enriched.artistName, "Artist") &&
            artist.artistName
          ) {
            enriched.artistName = artist.artistName;
          }
          if (!enriched.artistMbid && artist.foreignArtistId) {
            enriched.artistMbid = artist.foreignArtistId;
            enriched.mbid = artist.foreignArtistId;
          }
        }
      }
      return enriched;
    });
  }

  return sorted;
};
