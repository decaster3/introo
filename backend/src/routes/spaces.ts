import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import prisma from '../lib/prisma.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get all spaces for current user (owned + member of)
router.get('/', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

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
          select: {
            members: { where: { status: 'approved' } },
            requests: { where: { status: 'open' } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(spaces);
  } catch (error: unknown) {
    console.error('Error fetching spaces:', error);
    res.status(500).json({ error: 'Failed to fetch spaces' });
  }
});

// Get spaces where current user has a pending membership request
router.get('/my-pending', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    const pendingMemberships = await prisma.spaceMember.findMany({
      where: { userId, status: 'pending' },
      include: {
        space: {
          select: { id: true, name: true, emoji: true, isPrivate: true },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    res.json(pendingMemberships.map((m: any) => ({
      id: m.space.id,
      name: m.space.name,
      emoji: m.space.emoji,
      isPrivate: m.space.isPrivate,
      membershipId: m.id,
      appliedAt: m.joinedAt,
    })));
  } catch (error: unknown) {
    console.error('Error fetching pending spaces:', error);
    res.status(500).json({ error: 'Failed to fetch pending spaces' });
  }
});

// Get single space by ID
router.get('/:id', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
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
  } catch (error: unknown) {
    console.error('Error fetching space:', error);
    res.status(500).json({ error: 'Failed to fetch space' });
  }
});

// Create a new space
router.post('/', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
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
  } catch (error: unknown) {
    console.error('Error creating space:', error);
    res.status(500).json({ error: 'Failed to create space' });
  }
});

// Update a space
router.patch('/:id', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
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
  } catch (error: unknown) {
    console.error('Error updating space:', error);
    res.status(500).json({ error: 'Failed to update space' });
  }
});

// Delete a space
router.delete('/:id', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
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
  } catch (error: unknown) {
    console.error('Error deleting space:', error);
    res.status(500).json({ error: 'Failed to delete space' });
  }
});

// Get invite link for a space
router.get('/:id/invite', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
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
  } catch (error: unknown) {
    console.error('Error getting invite code:', error);
    res.status(500).json({ error: 'Failed to get invite code' });
  }
});

// Join a space via invite code
router.post('/join/:inviteCode', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
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

    const joinerUser = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });

    if (status === 'pending') {
      // Notify space owner about pending join request
      await prisma.notification.create({
        data: {
          userId: space.ownerId,
          type: 'space_join_request',
          title: `Join request: ${space.name}`,
          body: `${joinerUser?.name || 'Someone'} wants to join ${space.emoji || ''} ${space.name}.`,
          data: { spaceId: space.id, spaceName: space.name, spaceEmoji: space.emoji, requesterId: userId },
        },
      }).catch(() => {});
      res.json({ message: 'Your request to join has been submitted and is pending approval', pending: true });
      return;
    }

    // Notify space owner that someone joined
    await prisma.notification.create({
      data: {
        userId: space.ownerId,
        type: 'space_member_joined',
        title: `New member: ${space.name}`,
        body: `${joinerUser?.name || 'Someone'} joined ${space.emoji || ''} ${space.name}.`,
        data: { spaceId: space.id, spaceName: space.name, spaceEmoji: space.emoji, memberId: userId },
      },
    }).catch(() => {});

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
  } catch (error: unknown) {
    console.error('Error joining space:', error);
    res.status(500).json({ error: 'Failed to join space' });
  }
});

// Request to join a public space
router.post('/:id/request', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
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
  } catch (error: unknown) {
    console.error('Error requesting to join space:', error);
    res.status(500).json({ error: 'Failed to request to join space' });
  }
});

// Get pending member requests (owner only)
router.get('/:id/pending', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
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
  } catch (error: unknown) {
    console.error('Error fetching pending members:', error);
    res.status(500).json({ error: 'Failed to fetch pending members' });
  }
});

// Approve pending member (owner only)
router.post('/:id/members/:memberId/approve', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
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

    // Notify the approved member
    await prisma.notification.create({
      data: {
        userId: memberId,
        type: 'space_approved',
        title: `Welcome to ${space.name}!`,
        body: `Your request to join ${space.emoji || ''} ${space.name} was approved.`,
        data: { spaceId: id, spaceName: space.name, spaceEmoji: space.emoji },
      },
    }).catch(() => {});

    res.json({ success: true, message: 'Member approved' });
  } catch (error: unknown) {
    console.error('Error approving member:', error);
    res.status(500).json({ error: 'Failed to approve member' });
  }
});

// Reject pending member (owner only)
router.post('/:id/members/:memberId/reject', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
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
  } catch (error: unknown) {
    console.error('Error rejecting member:', error);
    res.status(500).json({ error: 'Failed to reject member' });
  }
});

// Delete an intro request from the space (owner only)
router.delete('/:id/requests/:requestId', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
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
  } catch (error: unknown) {
    console.error('Error deleting request:', error);
    res.status(500).json({ error: 'Failed to delete request' });
  }
});

// Add member to space (by email)
router.post('/:id/members', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
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

    // Find user by primary email or any linked calendar account email
    const normalizedEmail = email.trim().toLowerCase();
    let userToAdd = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (!userToAdd) {
      const calAccount = await prisma.calendarAccount.findFirst({
        where: { email: normalizedEmail, isActive: true },
        select: { userId: true },
      });
      if (calAccount) {
        userToAdd = await prisma.user.findUnique({ where: { id: calAccount.userId } });
      }
    }

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
        status: 'pending', // Invitation — user must accept first
      },
    });

    // Notify the invited user
    const inviter = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    await prisma.notification.create({
      data: {
        userId: userToAdd.id,
        type: 'space_invited',
        title: `Invitation to ${space.name}`,
        body: `${inviter?.name || 'Someone'} invited you to join ${space.emoji || ''} ${space.name}.`,
        data: { spaceId: id, spaceName: space.name, spaceEmoji: space.emoji, inviterId: userId },
      },
    }).catch(() => {});

    res.json({ success: true, message: 'Invitation sent', pending: true });
  } catch (error: unknown) {
    console.error('Error adding member:', error);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// Remove member from space
router.delete('/:id/members/:memberId', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
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
    const canRemove = 
      userId === memberId || // removing self
      space.ownerId === userId || // is owner
      userMember?.role === 'admin'; // is admin

    if (!canRemove) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    const isRemovingSelf = userId === memberId;

    await prisma.spaceMember.delete({
      where: { spaceId_userId: { spaceId: id, userId: memberId } },
    });

    if (isRemovingSelf) {
      // User left voluntarily — notify space owner
      const leaverUser = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      await prisma.notification.create({
        data: {
          userId: space.ownerId,
          type: 'space_member_left',
          title: `Member left: ${space.name}`,
          body: `${leaverUser?.name || 'Someone'} left ${space.emoji || ''} ${space.name}.`,
          data: { spaceId: id, spaceName: space.name, spaceEmoji: space.emoji, memberId: userId },
        },
      }).catch(() => {});
    } else {
      // Removed by owner/admin — notify the removed member
      await prisma.notification.create({
        data: {
          userId: memberId,
          type: 'space_removed',
          title: `Removed from ${space.name}`,
          body: `You were removed from ${space.emoji || ''} ${space.name}.`,
          data: { spaceId: id, spaceName: space.name, spaceEmoji: space.emoji },
        },
      }).catch(() => {});
    }

    res.json({ success: true });
  } catch (error: unknown) {
    console.error('Error removing member:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// Leave a space
router.post('/:id/leave', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
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

    // Notify space owner
    const leaverUser = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    await prisma.notification.create({
      data: {
        userId: space.ownerId,
        type: 'space_member_left',
        title: `Member left: ${space.name}`,
        body: `${leaverUser?.name || 'Someone'} left ${space.emoji || ''} ${space.name}.`,
        data: { spaceId: id, spaceName: space.name, spaceEmoji: space.emoji, memberId: userId },
      },
    }).catch(() => {});

    res.json({ success: true });
  } catch (error: unknown) {
    console.error('Error leaving space:', error);
    res.status(500).json({ error: 'Failed to leave space' });
  }
});

// Accept a space invitation (invited user)
router.post('/:id/accept-invite', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { id } = req.params;

    const membership = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: id, userId } },
    });

    if (!membership || membership.status !== 'pending') {
      res.status(404).json({ error: 'No pending invitation found' });
      return;
    }

    await prisma.spaceMember.update({
      where: { id: membership.id },
      data: { status: 'approved' },
    });

    const space = await prisma.space.findUnique({ where: { id }, select: { name: true, emoji: true, ownerId: true } });
    const accepter = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });

    // Notify space owner
    if (space) {
      await prisma.notification.create({
        data: {
          userId: space.ownerId,
          type: 'space_member_joined',
          title: `New member: ${space.name}`,
          body: `${accepter?.name || 'Someone'} accepted the invitation to ${space.emoji || ''} ${space.name}.`,
          data: { spaceId: id, spaceName: space.name, spaceEmoji: space.emoji, memberId: userId },
        },
      }).catch(() => {});
    }

    res.json({ success: true, message: 'Invitation accepted' });
  } catch (error: unknown) {
    console.error('Error accepting space invitation:', error);
    res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

// Reject a space invitation (invited user)
router.post('/:id/reject-invite', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { id } = req.params;

    const membership = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: id, userId } },
    });

    if (!membership || membership.status !== 'pending') {
      res.status(404).json({ error: 'No pending invitation found' });
      return;
    }

    await prisma.spaceMember.delete({
      where: { id: membership.id },
    });

    res.json({ success: true, message: 'Invitation declined' });
  } catch (error: unknown) {
    console.error('Error rejecting space invitation:', error);
    res.status(500).json({ error: 'Failed to decline invitation' });
  }
});

// Get combined reach for a space (all companies from all members)
router.get('/:id/reach', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { id } = req.params;

    // Verify user is a member of the space
    const space = await prisma.space.findFirst({
      where: {
        id,
        OR: [
          { ownerId: userId },
          { members: { some: { userId, status: 'approved' } } },
        ],
      },
      include: {
        members: {
          where: { status: 'approved' },
          select: { userId: true },
        },
      },
    });

    if (!space) {
      res.status(404).json({ error: 'Space not found' });
      return;
    }

    // Get all member user IDs (including owner)
    const memberUserIds = [
      space.ownerId,
      ...space.members.map(m => m.userId).filter(id => id !== space.ownerId),
    ];

    // Get all approved contacts from all members, grouped by company
    const contacts = await prisma.contact.findMany({
      where: {
        userId: { in: memberUserIds },
        isApproved: true,
        companyId: { not: null },
      },
      include: {
        company: true,
        user: {
          select: { id: true, name: true },
        },
      },
    });

    // Aggregate by company
    const companyMap = new Map<string, {
      id: string;
      name: string;
      domain: string;
      industry: string | null;
      sizeBucket: string | null;
      logo: string | null;
      contacts: {
        id: string;
        name: string;
        email: string;
        title: string | null;
        userId: string;
        userName: string;
      }[];
    }>();

    for (const contact of contacts) {
      if (!contact.company) continue;

      const existing = companyMap.get(contact.company.id);
      const contactInfo = {
        id: contact.id,
        name: contact.name || contact.email.split('@')[0],
        email: contact.email,
        title: contact.title,
        userId: contact.userId,
        userName: contact.user.name,
      };

      if (existing) {
        // Avoid duplicates (same contact from same user)
        if (!existing.contacts.some(c => c.email === contact.email)) {
          existing.contacts.push(contactInfo);
        }
      } else {
        companyMap.set(contact.company.id, {
          id: contact.company.id,
          name: contact.company.name,
          domain: contact.company.domain,
          industry: contact.company.industry,
          sizeBucket: contact.company.sizeBucket,
          logo: contact.company.logo,
          employeeCount: contact.company.employeeCount,
          foundedYear: contact.company.foundedYear,
          annualRevenue: contact.company.annualRevenue,
          totalFunding: contact.company.totalFunding,
          lastFundingRound: contact.company.lastFundingRound,
          lastFundingDate: contact.company.lastFundingDate,
          city: contact.company.city,
          country: contact.company.country,
          description: contact.company.description,
          linkedinUrl: contact.company.linkedinUrl,
          enrichedAt: contact.company.enrichedAt,
          contacts: [contactInfo],
        });
      }
    }

    // Convert to array and sort by contact count
    const companies = Array.from(companyMap.values())
      .map(c => ({
        ...c,
        contactCount: c.contacts.length,
      }))
      .sort((a, b) => b.contactCount - a.contactCount);

    res.json({
      companies,
      totalCompanies: companies.length,
      totalContacts: contacts.length,
      memberCount: memberUserIds.length,
    });
  } catch (error: unknown) {
    console.error('Error fetching space reach:', error);
    res.status(500).json({ error: 'Failed to fetch space reach' });
  }
});

export default router;
