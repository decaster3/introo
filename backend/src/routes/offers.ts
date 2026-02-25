import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { sendNotificationEmail } from '../services/email.js';
import prisma from '../lib/prisma.js';

const router = Router();

// Get offers for current user (as introducer) - must be before /:id routes
router.get('/mine', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    const offers = await prisma.introOffer.findMany({
      where: { introducerId: userId },
      include: {
        request: {
          include: {
            requester: {
              select: { id: true, name: true, avatar: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(offers);
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to fetch offers' });
  }
});

// Create offer for a request
router.post('/', authMiddleware, validate(schemas.createOffer), async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { requestId, message, connectionStrength } = req.body;

    // Verify request exists and is open
    const request = await prisma.introRequest.findUnique({
      where: { id: requestId },
      include: { space: { select: { id: true, name: true, emoji: true } } },
    });

    if (!request) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    if (request.status !== 'open') {
      res.status(400).json({ error: 'Request is no longer open' });
      return;
    }

    if (request.adminStatus === 'pending_review') {
      res.status(400).json({ error: 'Request is still pending admin review' });
      return;
    }

    if (request.requesterId === userId) {
      res.status(400).json({ error: 'Cannot offer intro to your own request' });
      return;
    }

    // Verify user is authorized (space member or connection peer)
    const offerNq = (request.normalizedQuery as Record<string, unknown>) || {};
    const offerConnPeerId = offerNq.connectionPeerId as string | undefined;
    if (request.spaceId) {
      const membership = await prisma.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId: request.spaceId, userId } },
      });
      if (!membership || membership.status !== 'approved') {
        res.status(403).json({ error: 'You must be a member of the space' });
        return;
      }
    } else if (offerConnPeerId) {
      if (offerConnPeerId !== userId) {
        res.status(403).json({ error: 'You are not authorized to make an offer on this request' });
        return;
      }
    } else {
      res.status(403).json({ error: 'You are not authorized to make an offer on this request' });
      return;
    }

    // Check if user already made an offer
    const existingOffer = await prisma.introOffer.findFirst({
      where: { requestId, introducerId: userId },
    });

    if (existingOffer) {
      res.status(400).json({ error: 'You already made an offer for this request' });
      return;
    }

    const offer = await prisma.introOffer.create({
      data: {
        requestId,
        introducerId: userId,
        message,
        status: 'pending',
      },
      include: {
        introducer: {
          select: { id: true, name: true, avatar: true },
        },
        request: {
          select: { id: true, rawText: true, requesterId: true, spaceId: true, normalizedQuery: true },
        },
      },
    });

    // Notify the requester that someone offered an intro
    try {
      const nq = (request.normalizedQuery as Record<string, unknown>) || {};
      const companyName = (nq?.companyName as string) || 'a company';
      const introducerName = offer.introducer.name || 'Someone';
      const spaceId = request.spaceId;
      const spaceName = request.space?.name || null;
      const spaceEmoji = request.space?.emoji || null;
      const connPeerId = (nq?.connectionPeerId as string) || null;

      // For 1-1 requests, look up the peer's name
      let connPeerName: string | null = null;
      if (connPeerId && !spaceId) {
        const peer = await prisma.user.findUnique({ where: { id: connPeerId }, select: { name: true } });
        connPeerName = peer?.name || null;
      }

      const offerNotif = { type: 'intro_offered', title: `Intro offered: ${companyName}`, body: `${introducerName} offered to introduce you to someone at ${companyName}.` };
      await prisma.notification.create({
        data: {
          userId: request.requesterId,
          ...offerNotif,
          data: {
            requestId,
            offerId: offer.id,
            spaceId: spaceId || null,
            spaceName,
            spaceEmoji,
            companyName,
            companyDomain: (nq?.companyDomain as string) || null,
            introducerId: userId,
            introducerName,
            connectionPeerId: connPeerId,
            connectionPeerName: connPeerName,
          },
        },
      });
      sendNotificationEmail(request.requesterId, offerNotif).catch(() => {});
    } catch (notifError) {
      console.error('Failed to create intro_offered notification:', notifError);
    }

    res.status(201).json(offer);
  } catch (error: unknown) {
    console.error('Create offer error:', error);
    res.status(500).json({ error: 'Failed to create offer' });
  }
});

// Accept/reject offer
router.patch('/:id/status', authMiddleware, validate(schemas.updateOfferStatus), async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { status } = req.body;

    // Get offer with request
    const offer = await prisma.introOffer.findUnique({
      where: { id: req.params.id },
      include: { request: true },
    });

    if (!offer) {
      res.status(404).json({ error: 'Offer not found' });
      return;
    }

    // Only request owner can accept/reject offers
    if (offer.request.requesterId !== userId) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    // If accepting, use a transaction to update all related records atomically
    if (status === 'accepted') {
      const result = await prisma.$transaction(async (tx) => {
        // Update the offer
        const updatedOffer = await tx.introOffer.update({
          where: { id: req.params.id },
          data: { status },
          include: {
            introducer: {
              select: { id: true, name: true, avatar: true },
            },
          },
        });

        // Update request status
        await tx.introRequest.update({
          where: { id: offer.requestId },
          data: { status: 'accepted' },
        });

        // Reject other pending offers
        await tx.introOffer.updateMany({
          where: {
            requestId: offer.requestId,
            id: { not: req.params.id },
            status: 'pending',
          },
          data: { status: 'rejected' },
        });

        return updatedOffer;
      });

      res.json(result);
      return;
    }

    // For rejection, simple update
    const updatedOffer = await prisma.introOffer.update({
      where: { id: req.params.id },
      data: { status },
      include: {
        introducer: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    res.json(updatedOffer);
  } catch (error: unknown) {
    console.error('Update offer error:', error);
    res.status(500).json({ error: 'Failed to update offer' });
  }
});

export default router;
