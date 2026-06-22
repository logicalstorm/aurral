import axios from 'axios';
import { noCache } from '../../../middleware/cache.js';
import { verifyTokenAuth } from '../../../middleware/auth.js';
import { dbOps } from '../../../config/db-helpers.js';

export default function registerStream(router: Record<string, (...args: unknown[]) => unknown>) {
  router.get('/stream/:songId', noCache, async (req: Record<string, unknown>, res: Record<string, unknown>) => {
    if (!verifyTokenAuth(req as any)) {
      return (res as any)['status'](401).json({ error: 'Unauthorized' });
    }
    const { songId } = req['params'] as Record<string, string>;
    const settings = dbOps.getSettings() as Record<string, unknown>;
    const nd = (settings.integrations as Record<string, unknown>)?.navidrome as Record<string, string> | undefined;
    if (!nd?.url || !nd?.username || !nd?.password) {
      return (res as any)['status'](503).json({ error: 'Navidrome not configured' });
    }
    try {
      const { NavidromeClient } = await import('../../../services/navidrome.js');
      const client = new NavidromeClient(nd.url, nd.username, nd.password);
      const streamUrl = client.getStreamUrl(songId);
      const response = await axios.get(streamUrl, {
        responseType: 'stream',
        timeout: 30000,
        validateStatus: (s: number) => s >= 200 && s < 300,
      });
      const contentType = response.headers['content-type'];
      if (contentType) (res as any).setHeader('Content-Type', contentType);
      const contentLength = response.headers['content-length'];
      if (contentLength) (res as any).setHeader('Content-Length', contentLength);
      response.data.pipe(res);
    } catch (error: unknown) {
      const err = error as { response?: { status?: number }; message?: string };
      const status = err.response?.status || 500;
      if (!(res as Record<string, unknown>)['headersSent']) {
        (res as any)['status'](status).json({
          error: 'Stream failed',
          message: err.message,
        });
      }
    }
  });
}
