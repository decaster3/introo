import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { getPaginationParams, createPaginatedResponse } from '../lib/pagination.js';
import { sendNotificationEmail } from '../services/email.js';
import { notifyConnectors } from '../lib/notifyConnectors.js';
import prisma from '../lib/prisma.js';

const router = Router();

// Get requests targeted at current user (1:1 connections + space requests they were notified about)
router.get('/user/incoming', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    // Find space request IDs the user was notified about (as connector or as space owner for review)
    const spaceNotifications = await prisma.notification.findMany({
      where: {
        userId,
        type: { in: ['intro_request', 'intro_review'] },
        data: { path: ['spaceId'], not: 'null' },
      },
      select: { data: true },
    });
    const notifiedRequestIds = spaceNotifications
      .map(n => (n.data as Record<string, unknown>)?.requestId as string)
      .filter(Boolean);

    const requests = await prisma.introRequest.findMany({
      where: {
        requesterId: { not: userId },
        OR: [
          { normalizedQuery: { path: ['connectionPeerId'], equals: userId } },
          ...(notifiedRequestIds.length > 0 ? [{ id: { in: notifiedRequestIds } }] : []),
        ],
      },
      include: {
        requester: {
          select: { id: true, name: true, avatar: true, email: true },
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
        declinedBy: {
          select: { id: true, name: true },
        },
        detailsRequestedBy: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const enriched = await Promise.all(requests.map(async (r) => {
      const nq = (r.normalizedQuery as Record<string, unknown>) || {};
      const connPeerId = nq.connectionPeerId as string | undefined;
      let connectionPeerName: string | undefined;
      if (connPeerId) {
        const peer = await prisma.user.findUnique({ where: { id: connPeerId }, select: { name: true } });
        connectionPeerName = peer?.name || undefined;
      }
      const declinedByName = r.declinedBy?.name || undefined;
      const detailsRequestedByName = r.detailsRequestedBy?.name || undefined;
      const detailsRequestedById = r.detailsRequestedById || undefined;
      return { ...r, connectionPeerName, declinedByName, detailsRequestedByName, detailsRequestedById, declinedBy: undefined, detailsRequestedBy: undefined };
    }));

    res.json(enriched);
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
        declinedBy: {
          select: { id: true, name: true },
        },
        detailsRequestedBy: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Batch-fetch notified connector counts per request from stored notifications
    const spaceRequestIds = requests.filter(r => r.spaceId).map(r => r.id);
    const notifiedCountMap = new Map<string, number>();
    if (spaceRequestIds.length > 0) {
      const notifs = await prisma.notification.findMany({
        where: {
          type: 'intro_request',
          OR: spaceRequestIds.map(id => ({ data: { path: ['requestId'], equals: id } })),
        },
        select: { data: true },
      });
      for (const n of notifs) {
        const rid = (n.data as Record<string, unknown>)?.requestId as string;
        if (rid) notifiedCountMap.set(rid, (notifiedCountMap.get(rid) || 0) + 1);
      }
    }

    const enriched = await Promise.all(requests.map(async (r) => {
      const nq = (r.normalizedQuery as Record<string, unknown>) || {};
      const connPeerId = nq.connectionPeerId as string | undefined;
      let connectionPeerName: string | undefined;
      if (connPeerId) {
        const peer = await prisma.user.findUnique({ where: { id: connPeerId }, select: { name: true } });
        connectionPeerName = peer?.name || undefined;
      }
      // For Space requests, hide who declined (privacy). For 1-1, include the name.
      // Details requester name is always shown (they actively engaged with the request).
      const declinedByName = (r.declinedBy && !r.spaceId) ? r.declinedBy.name : undefined;
      const detailsRequestedByName = r.detailsRequestedBy?.name || undefined;
      const detailsRequestedById = r.detailsRequestedById || undefined;
      const notifiedCount = r.spaceId ? (notifiedCountMap.get(r.id) || 0) : (connPeerId ? 1 : 0);
      return { ...r, connectionPeerName, declinedByName, detailsRequestedByName, detailsRequestedById, notifiedCount, declinedBy: undefined, detailsRequestedBy: undefined };
    }));

    res.json(enriched);
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// Get requests relevant to the current user (with pagination)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const pagination = getPaginationParams(req);
    const { status } = req.query;

    const where: Record<string, unknown> = {
      OR: [
        { requesterId: userId },
        { normalizedQuery: { path: ['connectionPeerId'], equals: userId } },
        { space: { members: { some: { userId, status: 'approved' } } } },
      ],
    };
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
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

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

    // Authorization: must be the requester, or a member of the request's space,
    // or the targeted connection peer
    const isRequester = request.requesterId === userId;
    const nq = (request.normalizedQuery as Record<string, unknown>) || {};
    const isConnectionPeer = nq.connectionPeerId === userId;

    let isSpaceMember = false;
    if (request.spaceId) {
      const membership = await prisma.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId: request.spaceId, userId } },
      });
      isSpaceMember = !!membership && membership.status === 'approved';
    }

    if (!isRequester && !isSpaceMember && !isConnectionPeer) {
      res.status(403).json({ error: 'Not authorized to view this request' });
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
    let spaceData: { introReviewMode: string; ownerId: string } | null = null;
    if (spaceId) {
      const membership = await prisma.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId, userId } },
      });
      if (!membership || membership.status !== 'approved') {
        res.status(403).json({ error: 'You must be an approved member of this space to create a request' });
        return;
      }
      const space = await prisma.space.findUnique({
        where: { id: spaceId },
        select: { introReviewMode: true, ownerId: true },
      });
      spaceData = space;
    }

    const isAdminReview = spaceData?.introReviewMode === 'admin_review';
    const isOwnerRequest = spaceData?.ownerId === userId;

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
        adminStatus: isAdminReview ? (isOwnerRequest ? 'approved' : 'pending_review') : null,
        ...(isAdminReview && isOwnerRequest ? { adminReviewedById: userId, adminReviewedAt: new Date() } : {}),
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

    // For admin_review spaces, notify only the space owner (unless owner created the request)
    if (spaceId && isAdminReview && spaceData && !isOwnerRequest) {
      try {
        const companyName = (normalizedQuery as Record<string, unknown>)?.companyName as string || 'a company';
        const requesterName = request.requester.name || 'Someone';
        const spaceName = request.space?.name || 'your space';
        const reviewNotif = { type: 'intro_review', title: `Review request: ${companyName}`, body: `${requesterName} requested an intro to ${companyName} in ${spaceName}. This request needs your approval.` };
        await prisma.notification.create({
          data: {
            userId: spaceData.ownerId,
            ...reviewNotif,
            data: {
              requestId: request.id,
              spaceId,
              spaceName,
              spaceEmoji: request.space?.emoji || null,
              companyName,
              requesterId: userId,
              requesterName,
              rawText,
            },
          },
        });
        sendNotificationEmail(spaceData.ownerId, reviewNotif).catch(() => {});
      } catch (notifError) {
        console.error('Failed to create admin review notification:', notifError);
      }
    }

    // Notify connectors (space members with contacts at target company).
    // Skip for admin_review spaces unless the owner created the request (auto-approved).
    if (spaceId && (!isAdminReview || isOwnerRequest)) {
      try {
        const nq = (normalizedQuery as Record<string, unknown>) || {};
        await notifyConnectors({
          requestId: request.id,
          spaceId,
          requesterId: userId,
          requesterName: request.requester.name || 'Someone',
          rawText,
          companyId: nq.companyId as string,
          companyDomain: nq.companyDomain as string,
          companyName: (nq.companyName as string) || 'a company',
          spaceName: request.space?.name || 'your space',
          spaceEmoji: request.space?.emoji,
        });
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

    // Enforce valid status transitions
    const validTransitions: Record<string, string[]> = {
      open: ['accepted', 'completed'],
      accepted: ['completed'],
      completed: [],
      declined: [],
    };
    const allowed = validTransitions[existing.status] || [];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: `Cannot transition from "${existing.status}" to "${status}"` });
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

    if (existing.status !== 'open') {
      res.status(400).json({ error: `Request is already ${existing.status}` });
      return;
    }

    if (existing.adminStatus === 'pending_review') {
      res.status(400).json({ error: 'Request is still pending admin review' });
      return;
    }

    // Must be a member of the space, or the connectionPeer for 1-1 requests
    const declineNq = (existing.normalizedQuery as Record<string, unknown>) || {};
    const declineConnPeerId = declineNq.connectionPeerId as string | undefined;
    if (existing.spaceId) {
      const membership = await prisma.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId: existing.spaceId, userId } },
      });
      if (!membership || membership.status !== 'approved') {
        res.status(403).json({ error: 'You must be a member of the space' });
        return;
      }
    } else if (declineConnPeerId) {
      if (declineConnPeerId !== userId) {
        res.status(403).json({ error: 'You are not authorized to decline this request' });
        return;
      }
    } else {
      res.status(403).json({ error: 'You are not authorized to decline this request' });
      return;
    }

    // Update request status to declined
    const updated = await prisma.introRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'declined',
        declineReason: reason || null,
        declinedById: userId,
      },
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

    if (existing.status !== 'open') {
      res.status(400).json({ error: `Request is already ${existing.status}` });
      return;
    }

    if (existing.adminStatus === 'pending_review') {
      res.status(400).json({ error: 'Request is still pending admin review' });
      return;
    }

    // Must be a member of the space, or the connectionPeer for 1-1 requests
    const doneNq = (existing.normalizedQuery as Record<string, unknown>) || {};
    const doneConnPeerId = doneNq.connectionPeerId as string | undefined;
    if (existing.spaceId) {
      const membership = await prisma.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId: existing.spaceId, userId } },
      });
      if (!membership || membership.status !== 'approved') {
        res.status(403).json({ error: 'You must be a member of the space' });
        return;
      }
    } else if (doneConnPeerId) {
      if (doneConnPeerId !== userId) {
        res.status(403).json({ error: 'You are not authorized to mark this request as done' });
        return;
      }
    } else {
      res.status(403).json({ error: 'You are not authorized to mark this request as done' });
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

      return { updated, offer };
    });

    const withOffers = await prisma.introRequest.findUnique({
      where: { id: req.params.id },
      include: {
        requester: { select: { id: true, name: true, avatar: true } },
        space: { select: { id: true, name: true, emoji: true } },
        offers: {
          include: { introducer: { select: { id: true, name: true, avatar: true } } },
        },
      },
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
            companyDomain: (nq.companyDomain as string) || null,
            spaceId: existing.spaceId || null,
            spaceName: existing.space?.name || null,
            spaceEmoji: (existing.space as any)?.emoji || null,
            introducerId: userId,
            introducerName,
          },
        },
      });
      sendNotificationEmail(existing.requesterId, doneNotif).catch(() => {});
    } catch (notifErr) {
      console.error('Failed to create intro_done notification:', notifErr);
    }

    res.json(withOffers || result.updated);
  } catch (error: unknown) {
    console.error('Mark done error:', error);
    res.status(500).json({ error: 'Failed to mark request as done' });
  }
});

// Admin review request (space owner only)
router.patch('/:id/admin-review', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { action, reason } = req.body || {};

    if (!action || !['approve', 'reject'].includes(action)) {
      res.status(400).json({ error: 'Invalid action. Must be "approve" or "reject"' });
      return;
    }

    const existing = await prisma.introRequest.findUnique({
      where: { id: req.params.id },
      include: {
        requester: { select: { id: true, name: true, avatar: true, email: true } },
        space: { select: { id: true, name: true, emoji: true, ownerId: true, introReviewMode: true } },
      },
    });

    if (!existing) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    if (!existing.spaceId || !existing.space) {
      res.status(400).json({ error: 'Only space requests can be admin-reviewed' });
      return;
    }

    if (existing.space.ownerId !== userId) {
      res.status(403).json({ error: 'Only the space owner can review requests' });
      return;
    }

    if (existing.adminStatus !== 'pending_review') {
      res.status(400).json({ error: `Request is not pending review (current: ${existing.adminStatus || 'none'})` });
      return;
    }

    if (action === 'approve') {
      const updated = await prisma.introRequest.update({
        where: { id: req.params.id },
        data: {
          adminStatus: 'approved',
          adminReviewedById: userId,
          adminReviewedAt: new Date(),
        },
        include: {
          requester: { select: { id: true, name: true, avatar: true, email: true } },
          space: { select: { id: true, name: true, emoji: true } },
          offers: { include: { introducer: { select: { id: true, name: true, avatar: true } } } },
        },
      });

      const nq = (existing.normalizedQuery as Record<string, unknown>) || {};
      const companyName = (nq.companyName as string) || 'a company';
      const spaceName = existing.space.name || 'your space';

      // Notify the requester that their request was approved
      try {
        const approvedNotif = { type: 'intro_approved', title: `Approved: ${companyName}`, body: `Your intro request to ${companyName} in ${spaceName} was approved. Space members are now reviewing it.` };
        await prisma.notification.create({
          data: {
            userId: existing.requesterId,
            ...approvedNotif,
            data: {
              requestId: existing.id,
              companyName,
              companyDomain: (nq.companyDomain as string) || null,
              spaceId: existing.spaceId,
              spaceName,
              spaceEmoji: existing.space.emoji || null,
            },
          },
        });
        sendNotificationEmail(existing.requesterId, approvedNotif).catch(() => {});
      } catch (notifErr) {
        console.error('Failed to notify requester after admin approval:', notifErr);
      }

      // Notify connectors
      try {
        await notifyConnectors({
          requestId: existing.id,
          spaceId: existing.spaceId!,
          requesterId: existing.requesterId,
          requesterName: existing.requester.name || 'Someone',
          rawText: existing.rawText,
          companyId: nq.companyId as string,
          companyDomain: nq.companyDomain as string,
          companyName,
          spaceName,
          spaceEmoji: existing.space.emoji,
        });
      } catch (notifError) {
        console.error('Failed to notify connectors after admin approval:', notifError);
      }

      res.json(updated);
    } else {
      // Reject
      const updated = await prisma.introRequest.update({
        where: { id: req.params.id },
        data: {
          adminStatus: 'rejected',
          status: 'declined',
          adminReviewedById: userId,
          adminReviewedAt: new Date(),
          adminRejectReason: reason || null,
          declinedById: userId,
          declineReason: reason || 'Declined by space admin',
        },
        include: {
          requester: { select: { id: true, name: true, avatar: true, email: true } },
          space: { select: { id: true, name: true, emoji: true } },
          offers: { include: { introducer: { select: { id: true, name: true, avatar: true } } } },
        },
      });

      // Notify requester
      try {
        const nq = (existing.normalizedQuery as Record<string, unknown>) || {};
        const companyName = (nq.companyName as string) || 'a company';
        let notifBody = `Your intro request to ${companyName} was not approved by the space admin.`;
        if (reason) notifBody += ` Reason: "${reason}"`;
        const rejectNotif = { type: 'intro_declined', title: `Not approved: ${companyName}`, body: notifBody };
        await prisma.notification.create({
          data: {
            userId: existing.requesterId,
            ...rejectNotif,
            data: {
              requestId: existing.id,
              companyName,
              companyDomain: (nq.companyDomain as string) || null,
              spaceId: existing.spaceId,
              spaceName: existing.space.name || null,
              spaceEmoji: existing.space.emoji || null,
              reason: reason || null,
            },
          },
        });
        sendNotificationEmail(existing.requesterId, rejectNotif).catch(() => {});
      } catch (notifErr) {
        console.error('Failed to notify requester after admin rejection:', notifErr);
      }

      res.json(updated);
    }
  } catch (error: unknown) {
    console.error('Admin review error:', error);
    res.status(500).json({ error: 'Failed to review request' });
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

    await prisma.$transaction(async (tx) => {
      await tx.introOffer.deleteMany({
        where: { requestId: req.params.id },
      });

      await tx.notification.deleteMany({
        where: { data: { path: ['requestId'], equals: req.params.id } },
      });

      await tx.introRequest.delete({
        where: { id: req.params.id },
      });
    });

    res.json({ success: true, message: 'Request deleted' });
  } catch (error: unknown) {
    console.error('Delete request error:', error);
    res.status(500).json({ error: 'Failed to delete request' });
  }
});

export default router;
