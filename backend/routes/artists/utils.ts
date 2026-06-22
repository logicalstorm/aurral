import { getArtistImage } from '../../services/imageService.js';

export const parseLastFmDate = (dateStr: string) => {
  if (!dateStr) return '';
  const d = new Date(dateStr.split(',')[0].trim());
  if (isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
};

export const sendSSE = (res: { write: (chunk: string) => void; flush?: () => void }, event: string, data: unknown) => {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (res.flush && typeof res.flush === 'function') {
      res.flush();
    }
  } catch (err: unknown) {
    console.error(`[SSE] Error sending event ${event}:`, (err as { message?: string })?.message);
  }
};

export const pendingCoverRequests = new Map();
export const pendingArtistRequests = new Map();

export const buildArtistRequestKey = ({
  mbid,
  mode = 'full',
  selectedReleaseTypes = null,
  appearsOnLimit = null,
}: {
  mbid: string;
  mode?: string;
  selectedReleaseTypes?: string[] | null;
  appearsOnLimit?: string | number | null;
}) => {
  const releaseTypesKey = Array.isArray(selectedReleaseTypes)
    ? [...selectedReleaseTypes].filter(Boolean).sort().join(',')
    : '';
  const limitValue = Number.parseInt(String(appearsOnLimit || ''), 10);
  const limitKey = Number.isFinite(limitValue) && limitValue > 0 ? String(limitValue) : '';
  return [String(mbid || '').trim(), mode, releaseTypesKey, limitKey].join(':');
};

export const fetchCoverInBackground = async (mbid: string, artistName: string | null = null) => {
  if (pendingCoverRequests.has(mbid)) return;

  const fetchPromise = (async () => {
    try {
      await getArtistImage(mbid, {
        forceRefresh: true,
        artistName,
      });
    } catch (e) {
      console.warn('[fetchCoverInBackground] Failed to fetch artist image:', e);
    }
  })();

  pendingCoverRequests.set(mbid, fetchPromise);
  try {
    await fetchPromise;
  } finally {
    pendingCoverRequests.delete(mbid);
  }
};
