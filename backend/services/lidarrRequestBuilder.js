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

  const STATUS_FAIL_INDICATORS = {
    trackedDownloadState: ["importfailed", "importFailed"],
    status: ["failed"],
    title: ["import fail", "downloaded - import fail"],
    trackedDownloadStatus: ["warning"],
    statusMessages: ["fail", "unmatched"],
  };

  for (const item of queueItems) {
    const albumId = item?.albumId ?? item?.album?.id;
    if (albumId == null) continue;

    const albumName = item?.album?.title || item?.title || "Album";
    const artistName = item?.artist?.artistName || "Artist";
    const artistMbid = item?.artist?.foreignArtistId || null;

    const qStatus = String(item.status || "").toLowerCase();
    const title = String(item.title || "").toLowerCase();
    const downloadState = String(item.trackedDownloadState || "").toLowerCase();
    const downloadStatus = String(item.trackedDownloadStatus || "").toLowerCase();
    const errMsg = String(item.errorMessage || "").toLowerCase();
    const msgs = Array.isArray(item.statusMessages)
      ? item.statusMessages.map((m) => String(m || "").toLowerCase()).join(" ")
      : "";

    const isFailed =
      STATUS_FAIL_INDICATORS.trackedDownloadState.some((s) => downloadState === s) ||
      qStatus === "failed" ||
      STATUS_FAIL_INDICATORS.title.some((s) => title.includes(s)) ||
      downloadStatus === "warning" ||
      errMsg.includes("fail") || errMsg.includes("retrying") ||
      STATUS_FAIL_INDICATORS.statusMessages.some((s) => msgs.includes(s));

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

  const HISTORY_FAIL_WORDS = ["fail", "error"];
  const HISTORY_IMPORT_FAIL_WORDS = ["fail", "error", "import fail", "incomplete"];

  for (const [albumId, { record, recordTime }] of latestHistoryByAlbum) {
    const existing = requestsByAlbumId.get(String(albumId));
    if (existing) continue;

    const albumName = record?.album?.title || record?.sourceTitle || "Album";
    const artistName = record?.artist?.artistName || "Artist";
    const artistMbid = record?.artist?.foreignArtistId || null;

    const eventType = String(record?.eventType || "").toLowerCase();
    const data = record?.data || {};
    const msgs = Array.isArray(data?.statusMessages)
      ? data.statusMessages.map((m) => String(m || "").toLowerCase()).join(" ")
      : String(data?.statusMessages?.[0] || "").toLowerCase();
    const errMsg = String(data?.errorMessage || "").toLowerCase();
    const sourceTitle = String(record?.sourceTitle || "").toLowerCase();
    const dataString = JSON.stringify(data).toLowerCase();
    const hasQueue = queueByAlbumId.has(String(albumId));

    const isGrabbed =
      eventType.includes("grabbed") ||
      sourceTitle.includes("grabbed") ||
      dataString.includes("grabbed");

    const isFailedDownload =
      eventType.includes("fail") ||
      HISTORY_FAIL_WORDS.some((w) => msgs.includes(w)) ||
      HISTORY_FAIL_WORDS.some((w) => errMsg.includes(w)) ||
      sourceTitle.includes("fail") ||
      dataString.includes("fail");

    const isFailedImport =
      eventType === "albumimportincomplete" ||
      eventType.includes("incomplete") ||
      HISTORY_IMPORT_FAIL_WORDS.some((w) => msgs.includes(w)) ||
      HISTORY_FAIL_WORDS.some((w) => errMsg.includes(w)) ||
      sourceTitle.includes("import fail") ||
      dataString.includes("import fail");

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
      requestsByAlbumId.set(String(albumId), {
        id: `lidarr-history-${record.id || albumId}`,
        source: "lidarr",
        type: "album",
        albumId: String(albumId),
        albumMbid: record?.album?.foreignAlbumId || null,
        albumName,
        artistId: record?.artist?.id != null ? String(record.artist.id) : null,
        artistMbid,
        artistName,
        status: "failed",
        statusLabel: "Failed",
        requestedAt: toIso(record?.date || record?.eventDate),
        mbid: artistMbid,
        name: albumName,
        image: null,
        inQueue: false,
        canReSearch: true,
      });
    }
  }

  return [...requestsByAlbumId.values()];
};
