import express from 'express';
import { downloadQueue } from '../services/downloadQueue.js';
import { downloadManager } from '../services/downloadManager.js';
import { dbOps } from '../config/db-helpers.js';

const router = express.Router();

/**
 * GET /downloads/queue
 * Get current queue status
 */
router.get('/queue', (req, res) => {
  try {
    const status = downloadQueue.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get queue status',
      message: error.message,
    });
  }
});

/**
 * GET /downloads/queue/stats
 * Get queue statistics
 */
router.get('/queue/stats', async (req, res) => {
  try {
    const stats = await downloadQueue.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get queue stats',
      message: error.message,
    });
  }
});

/**
 * POST /downloads/queue
 * Add item to queue
 * Body: { type, artistId, albumId?, trackId?, trackName?, artistMbid?, ... }
 */
router.post('/queue', async (req, res) => {
  try {
    const { type, artistId, albumId, trackId, trackName, artistMbid, ...other } = req.body;

    if (!type || !artistId) {
      return res.status(400).json({
        error: 'type and artistId are required',
      });
    }

    // Create download record
    const downloadRecord = {
      id: downloadManager.generateId(),
      type,
      artistId,
      albumId,
      trackId,
      trackName,
      artistMbid,
      status: 'requested',
      requestedAt: new Date().toISOString(),
      retryCount: 0,
      requeueCount: 0,
      progress: 0,
      events: [],
      ...other,
    };

    // Add to queue
    const queueItem = await downloadQueue.enqueue(downloadRecord);

    res.json({
      success: true,
      queueItem,
      message: 'Added to download queue',
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to add to queue',
      message: error.message,
    });
  }
});

/**
 * DELETE /downloads/queue/:id
 * Remove item from queue
 */
router.delete('/queue/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const item = await downloadQueue.dequeue(id);

    if (!item) {
      return res.status(404).json({
        error: 'Item not found in queue',
      });
    }

    res.json({
      success: true,
      message: 'Removed from queue',
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to remove from queue',
      message: error.message,
    });
  }
});

/**
 * POST /downloads/queue/clear
 * Clear queue (optionally filtered by type or status)
 * Body: { type?, status? }
 */
router.post('/queue/clear', async (req, res) => {
  try {
    const { type, status } = req.body;
    const result = await downloadQueue.clear({ type, status });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to clear queue',
      message: error.message,
    });
  }
});

/**
 * POST /downloads/queue/pause
 * Pause queue processing
 */
router.post('/queue/pause', (req, res) => {
  try {
    downloadQueue.pause();
    res.json({
      success: true,
      message: 'Queue paused',
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to pause queue',
      message: error.message,
    });
  }
});

/**
 * POST /downloads/queue/resume
 * Resume queue processing
 */
router.post('/queue/resume', (req, res) => {
  try {
    downloadQueue.resume();
    res.json({
      success: true,
      message: 'Queue resumed',
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to resume queue',
      message: error.message,
    });
  }
});

/**
 * GET /downloads/queue/search
 * Search queue
 * Query: ?q=searchterm
 */
router.get('/queue/search', (req, res) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({
        error: 'Query parameter q is required',
      });
    }

    const results = downloadQueue.search(q);
    res.json({
      results,
      count: results.length,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to search queue',
      message: error.message,
    });
  }
});

/**
 * GET /downloads
 * Get all downloads (from database)
 * Query: ?type=album|track|weekly-flow, ?status=downloading|completed|failed
 */
router.get('/', (req, res) => {
  try {
    const { type, status } = req.query;
    const filters = {};
    if (type) filters.type = type;
    if (status) filters.status = status;
    
    let downloads = dbOps.getDownloads(filters);

    // Sort by most recent first
    downloads.sort((a, b) => {
      const aTime = new Date(a.startedAt || a.requestedAt || 0);
      const bTime = new Date(b.startedAt || b.requestedAt || 0);
      return bTime - aTime;
    });

    res.json({
      downloads,
      count: downloads.length,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get downloads',
      message: error.message,
    });
  }
});

/**
 * GET /downloads/:id
 * Get specific download
 */
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const download = dbOps.getDownloadById(id);

    if (!download) {
      return res.status(404).json({
        error: 'Download not found',
      });
    }

    res.json(download);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get download',
      message: error.message,
    });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    await downloadQueue.dequeue(id);

    dbOps.deleteDownload(id);

    res.json({
      success: true,
      message: 'Download deleted',
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to delete download',
      message: error.message,
    });
  }
});

router.get('/health/metrics', (req, res) => {
  try {
    const metrics = downloadQueue.getHealthMetrics();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get health metrics',
      message: error.message,
    });
  }
});

router.get('/dlq', (req, res) => {
  try {
    const { type, limit } = req.query;
    const filters = {};
    if (type) filters.type = type;
    if (limit) filters.limit = parseInt(limit, 10);
    
    const items = downloadQueue.getDeadLetterQueue(filters);
    res.json({
      items,
      count: items.length,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get dead letter queue',
      message: error.message,
    });
  }
});

router.post('/dlq/:id/retry', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await downloadQueue.retryFromDeadLetter(id);
    
    if (!result.success) {
      return res.status(400).json({
        error: 'Failed to retry',
        message: result.error,
      });
    }
    
    res.json({
      success: true,
      message: 'Item requeued successfully',
      download: result.download,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retry from dead letter queue',
      message: error.message,
    });
  }
});

router.post('/dlq/retry-all', async (req, res) => {
  try {
    const { type } = req.body;
    const filters = {};
    if (type) filters.type = type;
    
    const results = await downloadQueue.retryAllFromDeadLetter(filters);
    
    res.json({
      success: true,
      ...results,
      message: `Retried ${results.success} items, ${results.failed} failed`,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retry all from dead letter queue',
      message: error.message,
    });
  }
});

router.delete('/dlq', async (req, res) => {
  try {
    const result = downloadQueue.clearDeadLetterQueue();
    
    res.json({
      success: true,
      message: 'Dead letter queue cleared',
      deleted: result.changes,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to clear dead letter queue',
      message: error.message,
    });
  }
});

router.get('/blocked-sources', (req, res) => {
  try {
    const sources = downloadQueue.getBlockedSources();
    res.json({
      sources,
      count: sources.length,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get blocked sources',
      message: error.message,
    });
  }
});

router.delete('/blocked-sources/:username', (req, res) => {
  try {
    const { username } = req.params;
    downloadQueue.unblockSource(decodeURIComponent(username));
    
    res.json({
      success: true,
      message: `Unblocked ${username}`,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to unblock source',
      message: error.message,
    });
  }
});

router.delete('/blocked-sources', (req, res) => {
  try {
    const result = downloadQueue.clearBlockedSources();
    
    res.json({
      success: true,
      message: 'Temporary blocked sources cleared',
      deleted: result.changes,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to clear blocked sources',
      message: error.message,
    });
  }
});

router.get('/:id/attempts', (req, res) => {
  try {
    const { id } = req.params;
    const attempts = dbOps.getDownloadAttempts(id);
    
    res.json({
      attempts,
      count: attempts.length,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get download attempts',
      message: error.message,
    });
  }
});

router.get('/:id/progress', (req, res) => {
  try {
    const { id } = req.params;
    const download = dbOps.getDownloadById(id);
    
    if (!download) {
      return res.status(404).json({ error: 'Download not found' });
    }
    
    const progressInfo = downloadQueue.updateTransferProgress(id, download.progress || 0);
    
    res.json({
      downloadId: id,
      status: download.status,
      progress: download.progress || 0,
      artistName: download.artistName,
      albumName: download.albumName,
      trackName: download.trackName,
      startedAt: download.startedAt,
      lastProgressUpdate: download.lastProgressUpdate,
      ...(progressInfo || {}),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get download progress',
      message: error.message,
    });
  }
});

router.post('/:id/progress', (req, res) => {
  try {
    const { id } = req.params;
    const { bytesTransferred, totalBytes, username } = req.body;
    
    if (username) {
      downloadQueue.trackTransferStart(id, username, totalBytes);
    }
    
    const progressInfo = downloadQueue.updateTransferProgress(id, bytesTransferred, totalBytes);
    
    if (progressInfo) {
      dbOps.updateDownload(id, {
        progress: totalBytes > 0 ? Math.round((bytesTransferred / totalBytes) * 100) : 0,
        lastProgressUpdate: new Date().toISOString(),
      });
    }
    
    res.json({
      success: true,
      ...progressInfo,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to update download progress',
      message: error.message,
    });
  }
});

router.get('/active/progress', (req, res) => {
  try {
    const sourceStats = downloadQueue.getSourceStats();
    const activeDownloads = dbOps.getDownloads({ status: 'downloading' });
    
    const progress = activeDownloads.map(d => ({
      downloadId: d.id,
      status: d.status,
      progress: d.progress || 0,
      artistName: d.artistName,
      albumName: d.albumName,
      trackName: d.trackName,
      type: d.type,
      startedAt: d.startedAt,
      lastProgressUpdate: d.lastProgressUpdate,
    }));
    
    res.json({
      activeDownloads: progress,
      count: progress.length,
      stats: sourceStats,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get active downloads progress',
      message: error.message,
    });
  }
});

router.get('/queue/export', (req, res) => {
  try {
    const state = downloadQueue.exportQueueState();
    res.json(state);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to export queue state',
      message: error.message,
    });
  }
});

router.post('/queue/import', async (req, res) => {
  try {
    const state = req.body;
    const results = await downloadQueue.importQueueState(state);
    
    res.json({
      success: true,
      ...results,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to import queue state',
      message: error.message,
    });
  }
});

router.post('/queue/verify', async (req, res) => {
  try {
    const results = await downloadQueue.verifyQueueIntegrity();
    
    res.json(results);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to verify queue integrity',
      message: error.message,
    });
  }
});

router.get('/queue/schedule', (req, res) => {
  try {
    const schedule = downloadQueue.getSchedule();
    res.json(schedule);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get schedule',
      message: error.message,
    });
  }
});

router.post('/queue/schedule', (req, res) => {
  try {
    const { enabled, startHour, endHour, daysOfWeek } = req.body;
    
    const schedule = downloadQueue.setSchedule({
      enabled: enabled !== undefined ? enabled : undefined,
      startHour: startHour !== undefined ? parseInt(startHour, 10) : undefined,
      endHour: endHour !== undefined ? parseInt(endHour, 10) : undefined,
      daysOfWeek: daysOfWeek !== undefined ? daysOfWeek : undefined,
    });
    
    res.json({
      success: true,
      schedule,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to set schedule',
      message: error.message,
    });
  }
});

export default router;
