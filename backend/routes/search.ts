import express from 'express';
import { noCache } from '../middleware/cache.js';
import { searchAlbums, searchArtists, searchTags } from '../services/searchService.js';
import { searchUnified } from '../services/unifiedSearchService.js';

const router = express.Router();

router.get('/', noCache, async (req, res) => {
  try {
    const {
      q,
      scope = 'artist',
      limit = 24,
      offset = 0,
      releaseTypes = '',
      sort = 'relevance',
    } = req.query;

    if (!String(q || '').trim()) {
      return res.status(400).json({ error: 'q parameter is required' });
    }

    if (scope === 'album') {
      return res.json(await searchAlbums(String(q), Number(limit), Number(offset), String(releaseTypes), String(sort)));
    }

    if (scope === 'tag') {
      return res.json(await searchTags(String(q), Number(limit), Number(offset)));
    }

    return res.json(await searchArtists(String(q), Number(limit), Number(offset)));
  } catch (error: unknown) {
    res.status(500).json({
      error: 'Failed to search',
      message: (error as Error).message,
    });
  }
});

router.get('/unified', noCache, async (req, res) => {
  try {
    const { q, mode = 'suggest', limit } = req.query;
    if (!String(q || '').trim()) {
      return res.status(400).json({ error: 'q parameter is required' });
    }
    return res.json(
      await searchUnified(String(q), {
        mode: String(mode),
        limit: limit ? Number(limit) : undefined,
        user: req.user || null,
      }),
    );
  } catch (error: unknown) {
    res.status(500).json({
      error: 'Failed to run unified search',
      message: (error as Error).message,
    });
  }
});

router.get('/artists', noCache, async (req, res) => {
  try {
    const { query, limit = 24, offset = 0 } = req.query;
    if (!String(query || '').trim()) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }
    const result = await searchArtists(String(query), Number(limit), Number(offset));
    return res.json({
      artists: ((result as Record<string, unknown>).items as Record<string, unknown>[]).map((artist: Record<string, unknown>) => ({
        id: artist.id,
        name: artist.name,
        'sort-name': artist.sortName,
        image: artist.imageUrl,
        imageUrl: artist.imageUrl,
        listeners: null,
      })),
      count: (result as Record<string, unknown>).count,
      offset: (result as Record<string, unknown>).offset,
    });
  } catch (error: unknown) {
    res.status(500).json({
      error: 'Failed to search artists',
      message: (error as Error).message,
    });
  }
});

export default router;
