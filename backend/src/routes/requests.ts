import { Router } from 'express';
import { authMiddleware, optionalAuthMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { getPaginationParams, createPaginatedResponse } from '../lib/pagination.js';
import { sendNotificationEmail } from '../services/email.js';
import prisma from '../lib/prisma.js';

const router = Router();

// Get requests targeted at current user via 1-1 connection
router.get('/user/incoming', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    // Find requests where normalizedQuery.connectionPeerId matches current user
    const requests = await prisma.introRequest.findMany({
      where: {
        normalizedQuery: { path: ['connectionPeerId'], equals: userId },
        requesterId: { not: userId }, // not my own requests
      },
      include: {
        requester: {
          select: { id: true, name: true, avatar: true, email: true },
        },
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
    console.error('Error fetching incoming requests:', error);
    res.status(500).json({ error: 'Failed to fetch incoming requests' });
  }
});

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
    const { rawText, normalizedQuery, bidAmount, currency, spaceId, connectionPeerId } = req.body;

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

    // Merge connectionPeerId into normalizedQuery so we can query it later
    const mergedQuery = { ...(normalizedQuery || {}), ...(connectionPeerId ? { connectionPeerId } : {}) };

    const request = await prisma.introRequest.create({
      data: {
        requesterId: userId,
        rawText,
        normalizedQuery: mergedQuery,
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

    // Create notifications ONLY for connectors — space members who have
    // approved contacts at the target company (not all space members).
    if (spaceId) {
      try {
        const companyDomain = (normalizedQuery as Record<string, unknown>)?.companyDomain as string;
        const companyId = (normalizedQuery as Record<string, unknown>)?.companyId as string;
        const companyName = (normalizedQuery as Record<string, unknown>)?.companyName as string || 'a company';
        const requesterName = request.requester.name || 'Someone';
        const spaceName = request.space?.name || 'your space';

        // Get all approved space members except the requester
        const spaceMembers = await prisma.spaceMember.findMany({
          where: {
            spaceId,
            status: 'approved',
            userId: { not: userId },
          },
          select: { userId: true },
        });

        const memberUserIds = spaceMembers.map(m => m.userId);

        if (memberUserIds.length > 0) {
          // Find which of those members actually have approved contacts at the target company
          const connectorIds = new Set<string>();

          if (companyId) {
            const contacts = await prisma.contact.findMany({
              where: {
                userId: { in: memberUserIds },
                companyId,
                isApproved: true,
              },
              select: { userId: true },
            });
            contacts.forEach(c => connectorIds.add(c.userId));
          } else if (companyDomain) {
            // Fallback: match by company domain
            const company = await prisma.company.findUnique({ where: { domain: companyDomain } });
            if (company) {
              const contacts = await prisma.contact.findMany({
                where: {
                  userId: { in: memberUserIds },
                  companyId: company.id,
                  isApproved: true,
                },
                select: { userId: true },
              });
              contacts.forEach(c => connectorIds.add(c.userId));
            }
          }

          if (connectorIds.size > 0) {
            const introNotif = { type: 'intro_request', title: `Intro request: ${companyName}`, body: `${requesterName} is looking for an intro to ${companyName}. "${rawText}"` };
            await prisma.notification.createMany({
              data: Array.from(connectorIds).map(connectorUserId => ({
                userId: connectorUserId,
                ...introNotif,
                data: {
                  requestId: request.id,
                  spaceId,
                  spaceName,
                  spaceEmoji: request.space?.emoji || null,
                  companyName,
                  companyDomain: companyDomain || null,
                  companyId: companyId || null,
                  requesterId: userId,
                  requesterName,
                  rawText,
                },
              })),
            });
            for (const connectorUserId of connectorIds) {
              sendNotificationEmail(connectorUserId, introNotif).catch(() => {});
            }
          }
        }
      } catch (notifError) {
        console.error('Failed to create notifications:', notifError);
      }
    }

    // For 1-1 connection requests: notify the peer directly
    if (connectionPeerId && connectionPeerId !== userId) {
      try {
        const companyName = (normalizedQuery as Record<string, unknown>)?.companyName as string || 'a company';
        const requesterName = request.requester.name || 'Someone';
        const peerNotif = { type: 'intro_request', title: `Intro request: ${companyName}`, body: `${requesterName} is looking for an intro to ${companyName}. "${rawText}"` };
        await prisma.notification.create({
          data: {
            userId: connectionPeerId,
            ...peerNotif,
            data: {
              requestId: request.id,
              companyName,
              companyDomain: (normalizedQuery as Record<string, unknown>)?.companyDomain || null,
              companyId: (normalizedQuery as Record<string, unknown>)?.companyId || null,
              requesterId: userId,
              requesterName,
              connectionPeerId,
              rawText,
            },
          },
        });
        sendNotificationEmail(connectionPeerId, peerNotif).catch(() => {});
      } catch (notifError) {
        console.error('Failed to create 1-1 notification:', notifError);
      }
    }

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

// Decline request (anonymous — connector declines without revealing identity)
router.patch('/:id/decline', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { reason } = req.body || {};

    const existing = await prisma.introRequest.findUnique({
      where: { id: req.params.id },
      include: {
        space: { select: { id: true, name: true, emoji: true } },
      },
    });

    if (!existing) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    // Cannot decline your own request
    if (existing.requesterId === userId) {
      res.status(400).json({ error: 'Cannot decline your own request' });
      return;
    }

    // Must be a member of the space
    if (existing.spaceId) {
      const membership = await prisma.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId: existing.spaceId, userId } },
      });
      if (!membership || membership.status !== 'approved') {
        res.status(403).json({ error: 'You must be a member of the space' });
        return;
      }
    }

    // Update request status to declined
    const updated = await prisma.introRequest.update({
      where: { id: req.params.id },
      data: { status: 'declined' },
    });

    // Create anonymous notification for the requester
    const nq = existing.normalizedQuery as Record<string, unknown> || {};
    const companyName = (nq.companyName as string) || 'a company';
    const companyDomain = (nq.companyDomain as string) || null;
    const spaceId = existing.spaceId;
    const spaceName = existing.space?.name || null;
    const spaceEmoji = (existing.space as any)?.emoji || null;
    const connPeerId = (nq.connectionPeerId as string) || null;

    // For 1-1 requests, look up the peer's name
    let connPeerName: string | null = null;
    if (connPeerId && !spaceId) {
      const peer = await prisma.user.findUnique({ where: { id: connPeerId }, select: { name: true } });
      connPeerName = peer?.name || null;
    }

    let notifBody = `Your intro request to ${companyName} was declined.`;
    if (reason) {
      notifBody += ` Reason: "${reason}"`;
    }

    const declineNotif = { type: 'intro_declined', title: `Declined: ${companyName}`, body: notifBody };
    await prisma.notification.create({
      data: {
        userId: existing.requesterId,
        ...declineNotif,
        data: {
          requestId: existing.id,
          companyName,
          companyDomain,
          spaceId: spaceId || null,
          spaceName: spaceName || null,
          spaceEmoji: spaceEmoji || null,
          reason: reason || null,
          connectionPeerId: connPeerId,
          connectionPeerName: connPeerName,
        },
      },
    });
    sendNotificationEmail(existing.requesterId, declineNotif).catch(() => {});

    res.json(updated);
  } catch (error: unknown) {
    console.error('Decline request error:', error);
    res.status(500).json({ error: 'Failed to decline request' });
  }
});

// Mark request as done (connector marks intro as completed)
router.patch('/:id/done', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    const existing = await prisma.introRequest.findUnique({
      where: { id: req.params.id },
      include: {
        requester: { select: { id: true, name: true } },
        space: { select: { id: true, name: true, emoji: true } },
      },
    });

    if (!existing) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    if (existing.requesterId === userId) {
      res.status(400).json({ error: 'Cannot mark your own request as done' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const offer = await tx.introOffer.create({
        data: {
          requestId: req.params.id,
          introducerId: userId,
          message: 'Intro completed',
          status: 'accepted',
        },
      });

      const updated = await tx.introRequest.update({
        where: { id: req.params.id },
        data: { status: 'accepted' },
      });

      await tx.introOffer.updateMany({
        where: {
          requestId: req.params.id,
          id: { not: offer.id },
          status: 'pending',
        },
        data: { status: 'rejected' },
      });

      return updated;
    });

    // Notify requester
    try {
      const nq = (existing.normalizedQuery as Record<string, unknown>) || {};
      const companyName = (nq.companyName as string) || 'a company';
      const introducer = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      const introducerName = introducer?.name || 'Someone';

      const doneNotif = { type: 'intro_offered', title: `Intro done: ${companyName}`, body: `${introducerName} made an introduction for you to ${companyName}.` };
      await prisma.notification.create({
        data: {
          userId: existing.requesterId,
          ...doneNotif,
          data: {
            requestId: req.params.id,
            companyName,
            introducerId: userId,
            introducerName,
          },
        },
      });
      sendNotificationEmail(existing.requesterId, doneNotif).catch(() => {});
    } catch (notifErr) {
      console.error('Failed to create intro_done notification:', notifErr);
    }

    res.json(result);
  } catch (error: unknown) {
    console.error('Mark done error:', error);
    res.status(500).json({ error: 'Failed to mark request as done' });
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
