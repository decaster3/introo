import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import prisma from '../lib/prisma.js';

const router = Router();

// Get all saved views for the current user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    const views = await prisma.savedView.findMany({
      where: { userId },
      orderBy: { position: 'asc' },
    });

    res.json(views.map(v => ({
      id: v.id,
      title: v.title,
      keywords: v.keywords,
      filters: v.filters,
      sortRules: v.sortRules,
      groupBy: v.groupBy,
      position: v.position,
      createdAt: v.createdAt,
    })));
  } catch (error: any) {
    console.error('Get views error:', error.message);
    res.status(500).json({ error: 'Failed to get views' });
  }
});

// Create a new saved view
router.post('/', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { title, keywords, filters, sortRules, groupBy } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    const maxPos = await prisma.savedView.aggregate({
      where: { userId },
      _max: { position: true },
    });

    const view = await prisma.savedView.create({
      data: {
        userId,
        title: title.trim(),
        keywords: keywords || [],
        filters: filters || {},
        sortRules: sortRules || [],
        groupBy: groupBy || undefined,
        position: (maxPos._max.position ?? -1) + 1,
      },
    });

    res.json({
      id: view.id,
      title: view.title,
      keywords: view.keywords,
      filters: view.filters,
      sortRules: view.sortRules,
      groupBy: view.groupBy,
      position: view.position,
      createdAt: view.createdAt,
    });
  } catch (error: any) {
    console.error('Create view error:', error.message);
    res.status(500).json({ error: 'Failed to create view' });
  }
});

// Update a saved view (rename, update filters, etc.)
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { id } = req.params;
    const { title, keywords, filters, sortRules, groupBy } = req.body;

    const existing = await prisma.savedView.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      res.status(404).json({ error: 'View not found' });
      return;
    }

    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title.trim();
    if (keywords !== undefined) data.keywords = keywords;
    if (filters !== undefined) data.filters = filters;
    if (sortRules !== undefined) data.sortRules = sortRules;
    if (groupBy !== undefined) data.groupBy = groupBy;

    const view = await prisma.savedView.update({
      where: { id },
      data,
    });

    res.json({
      id: view.id,
      title: view.title,
      keywords: view.keywords,
      filters: view.filters,
      sortRules: view.sortRules,
      groupBy: view.groupBy,
      position: view.position,
      createdAt: view.createdAt,
    });
  } catch (error: any) {
    console.error('Update view error:', error.message);
    res.status(500).json({ error: 'Failed to update view' });
  }
});

// Delete a saved view
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { id } = req.params;

    const existing = await prisma.savedView.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      res.status(404).json({ error: 'View not found' });
      return;
    }

    await prisma.savedView.delete({ where: { id } });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete view error:', error.message);
    res.status(500).json({ error: 'Failed to delete view' });
  }
});

export default router;
