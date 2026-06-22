const MIN_SEARCH_MS = 30 * 1000;
const STALE_SEARCH_MS = 5 * 60 * 1000;
const RECENT_COMMAND_MS = 2 * 60 * 60 * 1000;
const RECENT_HISTORY_MS = 60 * 60 * 1000;

const normalizeItems = (value: unknown): unknown[] => (Array.isArray(value) ? value : ((value as Record<string, unknown>)?.records as unknown[]) || []);

const getCommandAlbumIds = (command: Record<string, unknown>): unknown[] => {
  if (Array.isArray((command?.body as Record<string, unknown>)?.albumIds)) return (command.body as Record<string, unknown>).albumIds as unknown[];
  if (Array.isArray(command?.albumIds)) return command.albumIds as unknown[];
  return [];
};

export const parseLidarrSearchContext = ({ queue, history, commands }: { queue?: unknown; history?: unknown; commands?: unknown } = {}) => {
  const queueItems = normalizeItems(queue);
  const historyItems = normalizeItems(history);
  const commandItems = normalizeItems(commands);
  const now = Date.now();
  const searchingAlbumIds = new Set();
  const recentlyCompletedSearchAlbumIds = new Set();
  const queueAlbumIds = new Set();
  const activeHistoryAlbumIds = new Set();

  for (const command of commandItems) {
    const cmd = command as Record<string, unknown>;
    const name = String(cmd?.name || cmd?.commandName || '')
      .toLowerCase()
      .trim();
    if (!name.includes('albumsearch')) continue;
    const albumIds = getCommandAlbumIds(cmd);
    const status = String(cmd?.status || '')
      .toLowerCase()
      .trim();
    if (
      status === 'completed' ||
      status === 'failed' ||
      status === 'aborted' ||
      status === 'canceled' ||
      status === 'cancelled'
    ) {
      const endedAt = new Date(
        String(cmd?.ended || cmd?.completedAt || cmd?.endTime || 0),
      ).getTime();
      if (endedAt > 0 && now - endedAt <= RECENT_COMMAND_MS) {
        for (const id of albumIds) {
          if (id != null) recentlyCompletedSearchAlbumIds.add(id);
        }
      }
      continue;
    }
    for (const id of albumIds) {
      if (id != null) searchingAlbumIds.add(id);
    }
  }

  for (const item of queueItems) {
    const qItem = item as Record<string, unknown>;
    const albumId = qItem?.albumId ?? (qItem?.album as Record<string, unknown>)?.id;
    if (albumId != null) queueAlbumIds.add(albumId);
  }

  for (const record of historyItems) {
    const rec = record as Record<string, unknown>;
    const albumId = rec?.albumId;
    if (albumId == null) continue;
    const recordTime = new Date(String(rec?.date || rec?.eventDate || 0)).getTime();
    if (!Number.isFinite(recordTime) || now - recordTime > RECENT_HISTORY_MS) {
      continue;
    }
    const eventType = String(rec?.eventType || '').toLowerCase();
    const sourceTitle = String(rec?.sourceTitle || '').toLowerCase();
    const dataString = JSON.stringify(rec?.data || {}).toLowerCase();
    const isGrabbed =
      eventType.includes('grabbed') ||
      sourceTitle.includes('grabbed') ||
      dataString.includes('grabbed');
    const isImport = eventType.includes('import');
    if (isGrabbed || isImport) {
      activeHistoryAlbumIds.add(albumId);
    }
  }

  return {
    searchingAlbumIds,
    recentlyCompletedSearchAlbumIds,
    queueAlbumIds,
    activeHistoryAlbumIds,
  };
};

export const resolveAlbumSearchOutcome = (albumId: string | number, context: Record<string, unknown> | null, { searchStartedAt = 0 }: { searchStartedAt?: number } = {}) => {
  const lidarrAlbumId = parseInt(String(albumId), 10);
  if (isNaN(lidarrAlbumId) || !context) return null;

  const searchingAlbumIds = context['searchingAlbumIds'] as Set<unknown> | undefined;
  const recentlyCompletedSearchAlbumIds = context['recentlyCompletedSearchAlbumIds'] as Set<unknown> | undefined;
  const queueAlbumIds = context['queueAlbumIds'] as Set<unknown> | undefined;
  const activeHistoryAlbumIds = context['activeHistoryAlbumIds'] as Set<unknown> | undefined;

  if (searchingAlbumIds?.has(lidarrAlbumId)) {
    return { status: 'searching' };
  }
  if (queueAlbumIds?.has(lidarrAlbumId)) {
    return { status: 'downloading' };
  }
  if (activeHistoryAlbumIds?.has(lidarrAlbumId)) {
    return { status: 'processing' };
  }

  const age = searchStartedAt > 0 ? Date.now() - searchStartedAt : 0;
  if (age > 0 && age < MIN_SEARCH_MS) {
    return { status: 'searching' };
  }

  if (recentlyCompletedSearchAlbumIds?.has(lidarrAlbumId)) {
    return { status: 'failed', statusLabel: 'Not found' };
  }

  if (age >= STALE_SEARCH_MS) {
    return { status: 'failed', statusLabel: 'Not found' };
  }

  if (searchStartedAt > 0) {
    return { status: 'searching' };
  }

  return null;
};
