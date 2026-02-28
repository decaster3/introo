import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import prisma from '../lib/prisma.js';

const router = Router();
const MAX_ITEMS = 10;

router.use(authMiddleware);

// ─── Search history ──────────────────────────────────────────────────────────

router.get('/searches', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    const items = await prisma.searchHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: MAX_ITEMS,
      select: { id: true, query: true, createdAt: true },
    });

    res.json(items);
  } catch (error) {
    console.error('Get search history error:', error);
    res.status(500).json({ error: 'Failed to get search history' });
  }
});

router.post('/searches', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { query } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      res.status(400).json({ error: 'Query must be at least 2 characters' });
      return;
    }

    const trimmed = query.trim();

    // Upsert-style: delete previous identical query so it moves to top
    await prisma.searchHistory.deleteMany({
      where: { userId, query: trimmed },
    });

    const item = await prisma.searchHistory.create({
      data: { userId, query: trimmed },
      select: { id: true, query: true, createdAt: true },
    });

    // Prune: keep only the latest MAX_ITEMS
    const all = await prisma.searchHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (all.length > MAX_ITEMS) {
      const idsToDelete = all.slice(MAX_ITEMS).map(r => r.id);
      await prisma.searchHistory.deleteMany({
        where: { id: { in: idsToDelete } },
      });
    }

    res.json(item);
  } catch (error) {
    console.error('Save search error:', error);
    res.status(500).json({ error: 'Failed to save search' });
  }
});

// ─── Company view history ────────────────────────────────────────────────────

router.get('/company-views', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    const items = await prisma.companyViewHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: MAX_ITEMS,
      select: { id: true, companyDomain: true, companyName: true, createdAt: true },
    });

    res.json(items);
  } catch (error) {
    console.error('Get company view history error:', error);
    res.status(500).json({ error: 'Failed to get company view history' });
  }
});

router.post('/company-views', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { companyDomain, companyName } = req.body;

    if (!companyDomain || typeof companyDomain !== 'string') {
      res.status(400).json({ error: 'companyDomain is required' });
      return;
    }

    // Remove previous view of same company so it moves to top
    await prisma.companyViewHistory.deleteMany({
      where: { userId, companyDomain },
    });

    const item = await prisma.companyViewHistory.create({
      data: {
        userId,
        companyDomain,
        companyName: companyName || companyDomain,
      },
      select: { id: true, companyDomain: true, companyName: true, createdAt: true },
    });

    // Prune
    const all = await prisma.companyViewHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (all.length > MAX_ITEMS) {
      const idsToDelete = all.slice(MAX_ITEMS).map(r => r.id);
      await prisma.companyViewHistory.deleteMany({
        where: { id: { in: idsToDelete } },
      });
    }

    res.json(item);
  } catch (error) {
    console.error('Save company view error:', error);
    res.status(500).json({ error: 'Failed to save company view' });
  }
});

// ─── Contact view history ────────────────────────────────────────────────────

router.get('/contact-views', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    const items = await prisma.contactViewHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: MAX_ITEMS,
      select: { id: true, contactEmail: true, contactName: true, createdAt: true },
    });

    res.json(items);
  } catch (error) {
    console.error('Get contact view history error:', error);
    res.status(500).json({ error: 'Failed to get contact view history' });
  }
});

router.post('/contact-views', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { contactEmail, contactName } = req.body;

    if (!contactEmail || typeof contactEmail !== 'string') {
      res.status(400).json({ error: 'contactEmail is required' });
      return;
    }

    await prisma.contactViewHistory.deleteMany({
      where: { userId, contactEmail },
    });

    const item = await prisma.contactViewHistory.create({
      data: {
        userId,
        contactEmail,
        contactName: contactName || contactEmail,
      },
      select: { id: true, contactEmail: true, contactName: true, createdAt: true },
    });

    const all = await prisma.contactViewHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (all.length > MAX_ITEMS) {
      const idsToDelete = all.slice(MAX_ITEMS).map(r => r.id);
      await prisma.contactViewHistory.deleteMany({
        where: { id: { in: idsToDelete } },
      });
    }

    res.json(item);
  } catch (error) {
    console.error('Save contact view error:', error);
    res.status(500).json({ error: 'Failed to save contact view' });
  }
});

// ─── Combined recent views (companies + contacts, sorted by time) ────────────

router.get('/recent-views', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const limit = Math.min(Number(req.query.limit) || 5, 20);

    const [companies, contacts] = await Promise.all([
      prisma.companyViewHistory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true, companyDomain: true, companyName: true, createdAt: true },
      }),
      prisma.contactViewHistory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true, contactEmail: true, contactName: true, createdAt: true },
      }),
    ]);

    const merged = [
      ...companies.map(c => ({ type: 'company' as const, id: c.id, domain: c.companyDomain, name: c.companyName, createdAt: c.createdAt })),
      ...contacts.map(c => ({ type: 'contact' as const, id: c.id, email: c.contactEmail, name: c.contactName, createdAt: c.createdAt })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
     .slice(0, limit);

    res.json(merged);
  } catch (error) {
    console.error('Get recent views error:', error);
    res.status(500).json({ error: 'Failed to get recent views' });
  }
});

export default router;
