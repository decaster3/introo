import { Router } from 'express';
import { authMiddleware, optionalAuthMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { getPaginationParams, createPaginatedResponse } from '../lib/pagination.js';
import prisma from '../lib/prisma.js';

const router = Router();

// Get current user's requests - must be before /:id
router.get('/user/mine', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    const requests = await prisma.introRequest.findMany({
      where: { requesterId: userId },
      include: {
        offers: {
          include: {
            introducer: {
              select: { id: true, name: true, avatar: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(requests);
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// Get all open requests (with pagination)
router.get('/', optionalAuthMiddleware, async (req, res) => {
  try {
    const pagination = getPaginationParams(req);
    const { status } = req.query;
    
    const where: Record<string, unknown> = {};
    if (status && typeof status === 'string') {
      where.status = status;
    }

    const [requests, total] = await Promise.all([
      prisma.introRequest.findMany({
        where,
        include: {
          requester: {
            select: { id: true, name: true, avatar: true },
          },
          space: {
            select: { id: true, name: true, emoji: true },
          },
          offers: {
            select: {
              id: true,
              introducerId: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.introRequest.count({ where }),
    ]);

    res.json(createPaginatedResponse(requests, total, pagination));
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// Get single request
router.get('/:id', optionalAuthMiddleware, async (req, res) => {
  try {
    const request = await prisma.introRequest.findUnique({
      where: { id: req.params.id },
      include: {
        requester: {
          select: { id: true, name: true, avatar: true },
        },
        space: {
          select: { id: true, name: true, emoji: true },
        },
        offers: {
          include: {
            introducer: {
              select: { id: true, name: true, avatar: true },
            },
          },
        },
      },
    });

    if (!request) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    res.json(request);
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to fetch request' });
  }
});

// Create new request
router.post('/', authMiddleware, validate(schemas.createRequest), async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { rawText, normalizedQuery, bidAmount, currency, spaceId } = req.body;

    // If spaceId is provided, verify user is an approved member of the space
    if (spaceId) {
      const membership = await prisma.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId, userId } },
      });
      if (!membership || membership.status !== 'approved') {
        res.status(403).json({ error: 'You must be an approved member of this space to create a request' });
        return;
      }
    }

    const request = await prisma.introRequest.create({
      data: {
        requesterId: userId,
        rawText,
        normalizedQuery: normalizedQuery || {},
        bidAmount: bidAmount || 0,
        currency: currency || 'USD',
        status: 'open',
        spaceId: spaceId || null,
      },
      include: {
        requester: {
          select: { id: true, name: true, avatar: true },
        },
        space: {
          select: { id: true, name: true, emoji: true },
        },
      },
    });

    res.status(201).json(request);
  } catch (error: unknown) {
    console.error('Create request error:', error);
    res.status(500).json({ error: 'Failed to create request' });
  }
});

// Update request status
router.patch('/:id/status', authMiddleware, validate(schemas.updateRequestStatus), async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { status } = req.body;

    // Verify ownership
    const existing = await prisma.introRequest.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    if (existing.requesterId !== userId) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    const request = await prisma.introRequest.update({
      where: { id: req.params.id },
      data: { status },
    });

    res.json(request);
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to update request' });
  }
});

// Delete request (owner only)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    // Verify ownership
    const existing = await prisma.introRequest.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    if (existing.requesterId !== userId) {
      res.status(403).json({ error: 'Not authorized to delete this request' });
      return;
    }

    // Delete associated offers first
    await prisma.introOffer.deleteMany({
      where: { requestId: req.params.id },
    });

    // Delete the request
    await prisma.introRequest.delete({
      where: { id: req.params.id },
    });

    res.json({ success: true, message: 'Request deleted' });
  } catch (error: unknown) {
    console.error('Delete request error:', error);
    res.status(500).json({ error: 'Failed to delete request' });
  }
});

export default router;
