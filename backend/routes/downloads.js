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

/**
 * DELETE /downloads/:id
 * Delete download record
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Remove from queue if present
    await downloadQueue.dequeue(id);

    // Remove from database
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

export default router;
