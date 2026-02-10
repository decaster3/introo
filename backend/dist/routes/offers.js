import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import prisma from '../lib/prisma.js';
const router = Router();
// Get offers for current user (as introducer) - must be before /:id routes
router.get('/mine', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
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
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch offers' });
    }
});
// Create offer for a request
router.post('/', authMiddleware, validate(schemas.createOffer), async (req, res) => {
    try {
        const userId = req.user.id;
        const { requestId, message, connectionStrength } = req.body;
        // Verify request exists and is open
        const request = await prisma.introRequest.findUnique({
            where: { id: requestId },
        });
        if (!request) {
            res.status(404).json({ error: 'Request not found' });
            return;
        }
        if (request.status !== 'open') {
            res.status(400).json({ error: 'Request is no longer open' });
            return;
        }
        if (request.requesterId === userId) {
            res.status(400).json({ error: 'Cannot offer intro to your own request' });
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
                    select: { id: true, rawText: true, requesterId: true },
                },
            },
        });
        res.status(201).json(offer);
    }
    catch (error) {
        console.error('Create offer error:', error);
        res.status(500).json({ error: 'Failed to create offer' });
    }
});
// Accept/reject offer
router.patch('/:id/status', authMiddleware, validate(schemas.updateOfferStatus), async (req, res) => {
    try {
        const userId = req.user.id;
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
    }
    catch (error) {
        console.error('Update offer error:', error);
        res.status(500).json({ error: 'Failed to update offer' });
    }
});
export default router;
//# sourceMappingURL=offers.js.map