import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import prisma from '../lib/prisma.js';
const router = Router();
// All routes require authentication
router.use(authMiddleware);
// Get all spaces for current user (owned + member of)
router.get('/', async (req, res) => {
    try {
        const userId = req.user.id;
        const spaces = await prisma.space.findMany({
            where: {
                OR: [
                    { ownerId: userId },
                    { members: { some: { userId, status: 'approved' } } },
                ],
            },
            include: {
                owner: {
                    select: { id: true, name: true, avatar: true },
                },
                members: {
                    where: { status: 'approved' },
                    include: {
                        user: {
                            select: { id: true, name: true, avatar: true, email: true },
                        },
                    },
                },
                _count: {
                    select: { members: { where: { status: 'approved' } } },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json(spaces);
    }
    catch (error) {
        console.error('Error fetching spaces:', error);
        res.status(500).json({ error: 'Failed to fetch spaces' });
    }
});
// Get single space by ID
router.get('/:id', async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const space = await prisma.space.findFirst({
            where: {
                id,
                OR: [
                    { ownerId: userId },
                    { members: { some: { userId, status: 'approved' } } },
                ],
            },
            include: {
                owner: {
                    select: { id: true, name: true, avatar: true },
                },
                members: {
                    where: { status: 'approved' },
                    include: {
                        user: {
                            select: { id: true, name: true, avatar: true, email: true },
                        },
                    },
                },
                requests: {
                    include: {
                        requester: {
                            select: { id: true, name: true, avatar: true },
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
                },
            },
        });
        if (!space) {
            res.status(404).json({ error: 'Space not found' });
            return;
        }
        // If user is owner, also include pending members count
        if (space.ownerId === userId) {
            const pendingCount = await prisma.spaceMember.count({
                where: { spaceId: id, status: 'pending' },
            });
            res.json({ ...space, pendingCount });
            return;
        }
        res.json(space);
    }
    catch (error) {
        console.error('Error fetching space:', error);
        res.status(500).json({ error: 'Failed to fetch space' });
    }
});
// Create a new space
router.post('/', async (req, res) => {
    try {
        const userId = req.user.id;
        const { name, description, emoji, isPrivate } = req.body;
        if (!name || name.trim().length === 0) {
            res.status(400).json({ error: 'Space name is required' });
            return;
        }
        const space = await prisma.space.create({
            data: {
                name: name.trim(),
                description: description?.trim() || null,
                emoji: emoji || '🫛',
                isPrivate: isPrivate !== false,
                ownerId: userId,
                members: {
                    create: {
                        userId,
                        role: 'owner',
                    },
                },
            },
            include: {
                owner: {
                    select: { id: true, name: true, avatar: true },
                },
                members: {
                    include: {
                        user: {
                            select: { id: true, name: true, avatar: true, email: true },
                        },
                    },
                },
            },
        });
        res.status(201).json(space);
    }
    catch (error) {
        console.error('Error creating space:', error);
        res.status(500).json({ error: 'Failed to create space' });
    }
});
// Update a space
router.patch('/:id', async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { name, description, emoji, isPrivate } = req.body;
        // Check ownership
        const space = await prisma.space.findFirst({
            where: { id, ownerId: userId },
        });
        if (!space) {
            res.status(404).json({ error: 'Space not found or you are not the owner' });
            return;
        }
        const updated = await prisma.space.update({
            where: { id },
            data: {
                name: name?.trim() || space.name,
                description: description?.trim(),
                emoji: emoji || space.emoji,
                isPrivate: isPrivate ?? space.isPrivate,
            },
            include: {
                owner: {
                    select: { id: true, name: true, avatar: true },
                },
                members: {
                    where: { status: 'approved' },
                    include: {
                        user: {
                            select: { id: true, name: true, avatar: true, email: true },
                        },
                    },
                },
            },
        });
        res.json(updated);
    }
    catch (error) {
        console.error('Error updating space:', error);
        res.status(500).json({ error: 'Failed to update space' });
    }
});
// Delete a space
router.delete('/:id', async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        // Check ownership
        const space = await prisma.space.findFirst({
            where: { id, ownerId: userId },
        });
        if (!space) {
            res.status(404).json({ error: 'Space not found or you are not the owner' });
            return;
        }
        await prisma.space.delete({ where: { id } });
        res.json({ success: true });
    }
    catch (error) {
        console.error('Error deleting space:', error);
        res.status(500).json({ error: 'Failed to delete space' });
    }
});
// Get invite link for a space
router.get('/:id/invite', async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const space = await prisma.space.findFirst({
            where: {
                id,
                OR: [
                    { ownerId: userId },
                    { members: { some: { userId, role: { in: ['owner', 'admin'] } } } },
                ],
            },
        });
        if (!space) {
            res.status(404).json({ error: 'Space not found or insufficient permissions' });
            return;
        }
        res.json({ inviteCode: space.inviteCode });
    }
    catch (error) {
        console.error('Error getting invite code:', error);
        res.status(500).json({ error: 'Failed to get invite code' });
    }
});
// Join a space via invite code
router.post('/join/:inviteCode', async (req, res) => {
    try {
        const userId = req.user.id;
        const { inviteCode } = req.params;
        const space = await prisma.space.findUnique({
            where: { inviteCode },
        });
        if (!space) {
            res.status(404).json({ error: 'Invalid invite code' });
            return;
        }
        // Check if already a member
        const existing = await prisma.spaceMember.findUnique({
            where: { spaceId_userId: { spaceId: space.id, userId } },
        });
        if (existing) {
            if (existing.status === 'pending') {
                res.status(400).json({ error: 'Your request is pending approval' });
                return;
            }
            res.status(400).json({ error: 'You are already a member of this space' });
            return;
        }
        // For private spaces, create pending membership requiring owner approval
        // For public spaces, approve immediately
        const status = space.isPrivate ? 'pending' : 'approved';
        await prisma.spaceMember.create({
            data: {
                spaceId: space.id,
                userId,
                role: 'member',
                status,
            },
        });
        if (status === 'pending') {
            res.json({ message: 'Your request to join has been submitted and is pending approval', pending: true });
            return;
        }
        const updatedSpace = await prisma.space.findUnique({
            where: { id: space.id },
            include: {
                owner: {
                    select: { id: true, name: true, avatar: true },
                },
                members: {
                    where: { status: 'approved' },
                    include: {
                        user: {
                            select: { id: true, name: true, avatar: true, email: true },
                        },
                    },
                },
            },
        });
        res.json(updatedSpace);
    }
    catch (error) {
        console.error('Error joining space:', error);
        res.status(500).json({ error: 'Failed to join space' });
    }
});
// Request to join a public space
router.post('/:id/request', async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const space = await prisma.space.findUnique({
            where: { id },
        });
        if (!space) {
            res.status(404).json({ error: 'Space not found' });
            return;
        }
        // Check if already a member
        const existing = await prisma.spaceMember.findUnique({
            where: { spaceId_userId: { spaceId: id, userId } },
        });
        if (existing) {
            if (existing.status === 'pending') {
                res.status(400).json({ error: 'Your request is already pending approval' });
                return;
            }
            res.status(400).json({ error: 'You are already a member of this space' });
            return;
        }
        // Create pending membership
        await prisma.spaceMember.create({
            data: {
                spaceId: id,
                userId,
                role: 'member',
                status: 'pending',
            },
        });
        res.json({ message: 'Your request to join has been submitted', pending: true });
    }
    catch (error) {
        console.error('Error requesting to join space:', error);
        res.status(500).json({ error: 'Failed to request to join space' });
    }
});
// Get pending member requests (owner only)
router.get('/:id/pending', async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        // Check if user is owner
        const space = await prisma.space.findFirst({
            where: { id, ownerId: userId },
        });
        if (!space) {
            res.status(404).json({ error: 'Space not found or you are not the owner' });
            return;
        }
        const pendingMembers = await prisma.spaceMember.findMany({
            where: { spaceId: id, status: 'pending' },
            include: {
                user: {
                    select: { id: true, name: true, avatar: true, email: true },
                },
            },
            orderBy: { joinedAt: 'asc' },
        });
        res.json(pendingMembers);
    }
    catch (error) {
        console.error('Error fetching pending members:', error);
        res.status(500).json({ error: 'Failed to fetch pending members' });
    }
});
// Approve pending member (owner only)
router.post('/:id/members/:memberId/approve', async (req, res) => {
    try {
        const userId = req.user.id;
        const { id, memberId } = req.params;
        // Check if user is owner
        const space = await prisma.space.findFirst({
            where: { id, ownerId: userId },
        });
        if (!space) {
            res.status(404).json({ error: 'Space not found or you are not the owner' });
            return;
        }
        // Find the pending member
        const member = await prisma.spaceMember.findFirst({
            where: { spaceId: id, userId: memberId, status: 'pending' },
        });
        if (!member) {
            res.status(404).json({ error: 'Pending member not found' });
            return;
        }
        await prisma.spaceMember.update({
            where: { id: member.id },
            data: { status: 'approved' },
        });
        res.json({ success: true, message: 'Member approved' });
    }
    catch (error) {
        console.error('Error approving member:', error);
        res.status(500).json({ error: 'Failed to approve member' });
    }
});
// Reject pending member (owner only)
router.post('/:id/members/:memberId/reject', async (req, res) => {
    try {
        const userId = req.user.id;
        const { id, memberId } = req.params;
        // Check if user is owner
        const space = await prisma.space.findFirst({
            where: { id, ownerId: userId },
        });
        if (!space) {
            res.status(404).json({ error: 'Space not found or you are not the owner' });
            return;
        }
        // Find the pending member
        const member = await prisma.spaceMember.findFirst({
            where: { spaceId: id, userId: memberId, status: 'pending' },
        });
        if (!member) {
            res.status(404).json({ error: 'Pending member not found' });
            return;
        }
        // Delete the pending membership
        await prisma.spaceMember.delete({
            where: { id: member.id },
        });
        res.json({ success: true, message: 'Member rejected' });
    }
    catch (error) {
        console.error('Error rejecting member:', error);
        res.status(500).json({ error: 'Failed to reject member' });
    }
});
// Delete an intro request from the space (owner only)
router.delete('/:id/requests/:requestId', async (req, res) => {
    try {
        const userId = req.user.id;
        const { id, requestId } = req.params;
        // Check if user is owner
        const space = await prisma.space.findFirst({
            where: { id, ownerId: userId },
        });
        if (!space) {
            res.status(404).json({ error: 'Space not found or you are not the owner' });
            return;
        }
        // Find and delete the request
        const request = await prisma.introRequest.findFirst({
            where: { id: requestId, spaceId: id },
        });
        if (!request) {
            res.status(404).json({ error: 'Request not found' });
            return;
        }
        await prisma.introRequest.delete({
            where: { id: requestId },
        });
        res.json({ success: true, message: 'Request deleted' });
    }
    catch (error) {
        console.error('Error deleting request:', error);
        res.status(500).json({ error: 'Failed to delete request' });
    }
});
// Add member to space (by email)
router.post('/:id/members', async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { email } = req.body;
        // Check if user has permission to add members
        const space = await prisma.space.findFirst({
            where: {
                id,
                OR: [
                    { ownerId: userId },
                    { members: { some: { userId, role: { in: ['owner', 'admin'] } } } },
                ],
            },
        });
        if (!space) {
            res.status(404).json({ error: 'Space not found or insufficient permissions' });
            return;
        }
        // Find user by email
        const userToAdd = await prisma.user.findUnique({
            where: { email },
        });
        if (!userToAdd) {
            res.status(404).json({ error: 'User not found with that email' });
            return;
        }
        // Check if already a member
        const existing = await prisma.spaceMember.findUnique({
            where: { spaceId_userId: { spaceId: id, userId: userToAdd.id } },
        });
        if (existing) {
            res.status(400).json({ error: 'User is already a member' });
            return;
        }
        await prisma.spaceMember.create({
            data: {
                spaceId: id,
                userId: userToAdd.id,
                role: 'member',
                status: 'approved', // Directly added by admin/owner, no approval needed
            },
        });
        const updatedSpace = await prisma.space.findUnique({
            where: { id },
            include: {
                owner: {
                    select: { id: true, name: true, avatar: true },
                },
                members: {
                    where: { status: 'approved' },
                    include: {
                        user: {
                            select: { id: true, name: true, avatar: true, email: true },
                        },
                    },
                },
            },
        });
        res.json(updatedSpace);
    }
    catch (error) {
        console.error('Error adding member:', error);
        res.status(500).json({ error: 'Failed to add member' });
    }
});
// Remove member from space
router.delete('/:id/members/:memberId', async (req, res) => {
    try {
        const userId = req.user.id;
        const { id, memberId } = req.params;
        // Check if user has permission (owner or admin, or removing self)
        const space = await prisma.space.findFirst({
            where: { id },
            include: {
                members: true,
            },
        });
        if (!space) {
            res.status(404).json({ error: 'Space not found' });
            return;
        }
        const userMember = space.members.find(m => m.userId === userId);
        const targetMember = space.members.find(m => m.userId === memberId);
        if (!targetMember) {
            res.status(404).json({ error: 'Member not found' });
            return;
        }
        // Can't remove the owner
        if (targetMember.role === 'owner') {
            res.status(400).json({ error: 'Cannot remove the space owner' });
            return;
        }
        // Check permissions: must be owner/admin, or removing yourself
        const canRemove = userId === memberId || // removing self
            space.ownerId === userId || // is owner
            userMember?.role === 'admin'; // is admin
        if (!canRemove) {
            res.status(403).json({ error: 'Insufficient permissions' });
            return;
        }
        await prisma.spaceMember.delete({
            where: { spaceId_userId: { spaceId: id, userId: memberId } },
        });
        res.json({ success: true });
    }
    catch (error) {
        console.error('Error removing member:', error);
        res.status(500).json({ error: 'Failed to remove member' });
    }
});
// Leave a space
router.post('/:id/leave', async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const space = await prisma.space.findUnique({
            where: { id },
        });
        if (!space) {
            res.status(404).json({ error: 'Space not found' });
            return;
        }
        if (space.ownerId === userId) {
            res.status(400).json({ error: 'Owner cannot leave the space. Transfer ownership or delete the space instead.' });
            return;
        }
        await prisma.spaceMember.delete({
            where: { spaceId_userId: { spaceId: id, userId } },
        });
        res.json({ success: true });
    }
    catch (error) {
        console.error('Error leaving space:', error);
        res.status(500).json({ error: 'Failed to leave space' });
    }
});
export default router;
//# sourceMappingURL=spaces.js.map