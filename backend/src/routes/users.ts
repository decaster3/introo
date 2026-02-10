import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import prisma from '../lib/prisma.js';

const router = Router();

// Get all users (community members)
router.get('/', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        avatar: true,
      },
      orderBy: { name: 'asc' },
    });
    res.json(users);
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get current user's stats - must be before /:id to avoid conflict
router.get('/me/stats', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    const [relationshipsCount, requestsCount, offersCount] = await Promise.all([
      prisma.relationship.count({ where: { userId } }),
      prisma.introRequest.count({ where: { requesterId: userId } }),
      prisma.introOffer.count({ where: { introducerId: userId } }),
    ]);

    res.json({
      connections: relationshipsCount,
      asks: requestsCount,
      introsMade: offersCount,
    });
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get user by ID
router.get('/:id', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        avatar: true,
        createdAt: true,
        _count: {
          select: {
            relationships: true,
            introRequests: true,
            introOffers: true,
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(user);
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

export default router;
