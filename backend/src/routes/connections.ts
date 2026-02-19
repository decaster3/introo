import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { sendNotificationEmail, sendInviteEmail } from '../services/email.js';
import prisma from '../lib/prisma.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function maskEmail(): string {
  return '••••••';
}

const router = Router();
router.use(authMiddleware);

// ─── List all connections (accepted + pending) ──────────────────────────────

router.get('/', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    const connections = await prisma.directConnection.findMany({
      where: {
        OR: [
          { fromUserId: userId },
          { toUserId: userId },
        ],
      },
      include: {
        fromUser: { select: { id: true, name: true, email: true, avatar: true } },
        toUser: { select: { id: true, name: true, email: true, avatar: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Normalize: always return the "other" user as `peer`
    const peerIds = connections.map(c => c.fromUserId === userId ? c.toUserId : c.fromUserId);

    // Count approved contacts per peer (with a company) for reach stats
    const peerStats = peerIds.length > 0
      ? await prisma.contact.groupBy({
          by: ['userId'],
          where: { userId: { in: peerIds }, isApproved: true, companyId: { not: null } },
          _count: { id: true },
        })
      : [];
    const peerCompanyStats = peerIds.length > 0
      ? await prisma.contact.groupBy({
          by: ['userId', 'companyId'],
          where: { userId: { in: peerIds }, isApproved: true, companyId: { not: null } },
        })
      : [];
    const contactCountMap = new Map(peerStats.map(s => [s.userId, s._count.id]));
    const companyCountMap = new Map<string, number>();
    peerCompanyStats.forEach(s => {
      companyCountMap.set(s.userId, (companyCountMap.get(s.userId) || 0) + 1);
    });

    const result = connections.map(c => {
      const isFrom = c.fromUserId === userId;
      const peerId = isFrom ? c.toUserId : c.fromUserId;
      return {
        id: c.id,
        status: c.status,
        direction: isFrom ? 'sent' : 'received',
        createdAt: c.createdAt,
        peer: isFrom ? c.toUser : c.fromUser,
        peerContactCount: contactCountMap.get(peerId) || 0,
        peerCompanyCount: companyCountMap.get(peerId) || 0,
      };
    });

    res.json(result);
  } catch (error: any) {
    console.error('List connections error:', error.message);
    res.status(500).json({ error: 'Failed to list connections' });
  }
});

// ─── Send connection request (by email) ─────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { email } = req.body as { email: string };

    if (!email?.trim()) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    if (!EMAIL_REGEX.test(email.trim())) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    // Find the target user by primary email or any linked calendar account email
    const normalizedEmail = email.trim().toLowerCase();
    let targetUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!targetUser) {
      // Check calendar account emails
      const calAccount = await prisma.calendarAccount.findFirst({
        where: { email: normalizedEmail, isActive: true },
        select: { userId: true },
      });
      if (calAccount) {
        targetUser = await prisma.user.findUnique({ where: { id: calAccount.userId } });
      }
    }
    if (!targetUser) {
      // User not on the platform — create a pending invite and send an invite email
      const sender = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });

      // Check if already invited (1:1 connection, no spaceId)
      const existingInvite = await prisma.pendingInvite.findFirst({
        where: { fromUserId: userId, email: normalizedEmail, spaceId: null, status: 'pending' },
      });
      if (existingInvite) {
        res.status(409).json({ error: 'Invitation already sent to this email' });
        return;
      }

      // Create the invite
      const invite = await prisma.pendingInvite.create({
        data: { fromUserId: userId, email: normalizedEmail },
      });

      // Send invite email (non-blocking)
      sendInviteEmail({
        senderName: sender?.name || 'Someone',
        senderEmail: sender?.email || '',
        recipientEmail: normalizedEmail,
      }).catch(err => console.error('Invite email error:', err));

      res.json({
        id: invite.id,
        status: 'invited',
        peer: { id: null, name: normalizedEmail.split('@')[0], email: normalizedEmail, avatar: null },
        invited: true,
      });
      return;
    }

    if (targetUser.id === userId) {
      res.status(400).json({ error: 'Cannot connect with yourself' });
      return;
    }

    // Check if connection already exists (in either direction)
    const existing = await prisma.directConnection.findFirst({
      where: {
        OR: [
          { fromUserId: userId, toUserId: targetUser.id },
          { fromUserId: targetUser.id, toUserId: userId },
        ],
      },
    });

    if (existing) {
      if (existing.status === 'accepted') {
        res.status(409).json({ error: 'Already connected' });
        return;
      }
      if (existing.status === 'pending') {
        // If they sent us a request, auto-accept it
        if (existing.fromUserId === targetUser.id) {
          const updated = await prisma.directConnection.update({
            where: { id: existing.id },
            data: { status: 'accepted' },
            include: {
              fromUser: { select: { id: true, name: true, email: true, avatar: true } },
              toUser: { select: { id: true, name: true, email: true, avatar: true } },
            },
          });
          res.json({ id: updated.id, status: 'accepted', peer: updated.fromUser, autoAccepted: true });
          return;
        }
        res.status(409).json({ error: 'Connection request already pending' });
        return;
      }
      // If rejected, allow re-request by updating
      const reSender = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      await prisma.directConnection.update({
        where: { id: existing.id },
        data: { status: 'pending', fromUserId: userId, toUserId: targetUser.id },
      });

      // Notify the target user about the new request
      const reNotif = { type: 'connection_request', title: `${reSender?.name || 'Someone'} wants to connect`, body: 'Accept to share your networks with each other.' };
      await prisma.notification.create({
        data: {
          userId: targetUser.id,
          ...reNotif,
          data: { connectionId: existing.id, fromUserId: userId, fromUserName: reSender?.name },
        },
      });
      sendNotificationEmail(targetUser.id, reNotif).catch(() => {});

      res.json({ id: existing.id, status: 'pending', peer: { id: targetUser.id, name: targetUser.name, email: targetUser.email, avatar: targetUser.avatar } });
      return;
    }

    // Create new connection
    const sender = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const connection = await prisma.directConnection.create({
      data: { fromUserId: userId, toUserId: targetUser.id },
      include: {
        toUser: { select: { id: true, name: true, email: true, avatar: true } },
      },
    });

    // Notify the target user
    const connNotif = { type: 'connection_request', title: `${sender?.name || 'Someone'} wants to connect`, body: 'Accept to share your networks with each other.' };
    await prisma.notification.create({
      data: {
        userId: targetUser.id,
        ...connNotif,
        data: { connectionId: connection.id, fromUserId: userId, fromUserName: sender?.name },
      },
    });
    sendNotificationEmail(targetUser.id, connNotif).catch(() => {});

    res.json({
      id: connection.id,
      status: 'pending',
      peer: connection.toUser,
    });
  } catch (error: any) {
    console.error('Send connection error:', error.message);
    res.status(500).json({ error: 'Failed to send connection request' });
  }
});

// ─── Accept connection ──────────────────────────────────────────────────────

router.post('/:id/accept', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    const connection = await prisma.directConnection.findFirst({
      where: { id: req.params.id, toUserId: userId, status: 'pending' },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection request not found' });
      return;
    }

    const accepter = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const updated = await prisma.directConnection.update({
      where: { id: connection.id },
      data: { status: 'accepted' },
      include: {
        fromUser: { select: { id: true, name: true, email: true, avatar: true } },
      },
    });

    // Notify the original sender that their request was accepted
    const acceptNotif = { type: 'connection_accepted', title: `${accepter?.name || 'Someone'} accepted your connection`, body: 'You are now connected.' };
    await prisma.notification.create({
      data: {
        userId: connection.fromUserId,
        ...acceptNotif,
        data: { connectionId: connection.id, peerId: userId, peerName: accepter?.name },
      },
    });
    sendNotificationEmail(connection.fromUserId, acceptNotif).catch(() => {});

    res.json({ id: updated.id, status: 'accepted', peer: updated.fromUser });
  } catch (error: any) {
    console.error('Accept connection error:', error.message);
    res.status(500).json({ error: 'Failed to accept connection' });
  }
});

// ─── Reject connection ──────────────────────────────────────────────────────

router.post('/:id/reject', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    const connection = await prisma.directConnection.findFirst({
      where: { id: req.params.id, toUserId: userId, status: 'pending' },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection request not found' });
      return;
    }

    await prisma.directConnection.update({
      where: { id: connection.id },
      data: { status: 'rejected' },
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Reject connection error:', error.message);
    res.status(500).json({ error: 'Failed to reject connection' });
  }
});

// ─── Remove connection ──────────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    const connection = await prisma.directConnection.findFirst({
      where: {
        id: req.params.id,
        OR: [{ fromUserId: userId }, { toUserId: userId }],
      },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    await prisma.directConnection.delete({ where: { id: connection.id } });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Remove connection error:', error.message);
    res.status(500).json({ error: 'Failed to remove connection' });
  }
});

// ─── Get connected user's shared contacts (reach) ───────────────────────────

router.get('/:id/reach', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    // Verify it's an accepted connection
    const connection = await prisma.directConnection.findFirst({
      where: {
        id: req.params.id,
        status: 'accepted',
        OR: [{ fromUserId: userId }, { toUserId: userId }],
      },
      include: {
        fromUser: { select: { id: true, name: true } },
        toUser: { select: { id: true, name: true } },
      },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection not found or not accepted' });
      return;
    }

    const peerId = connection.fromUserId === userId ? connection.toUserId : connection.fromUserId;
    const peerName = connection.fromUserId === userId ? connection.toUser.name : connection.fromUser.name;

    // Get peer's approved contacts grouped by company
    const contacts = await prisma.contact.findMany({
      where: {
        userId: peerId,
        isApproved: true,
        companyId: { not: null },
      },
      include: {
        company: true,
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
      employeeCount: number | null;
      foundedYear: number | null;
      annualRevenue: string | null;
      totalFunding: string | null;
      lastFundingRound: string | null;
      lastFundingDate: Date | null;
      city: string | null;
      country: string | null;
      description: string | null;
      linkedinUrl: string | null;
      enrichedAt: Date | null;
      contactCount: number;
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

      const contactInfo = {
        id: contact.id,
        name: contact.name || contact.email.split('@')[0],
        email: maskEmail(),
        title: contact.title,
        userId: peerId,
        userName: peerName,
        linkedinUrl: contact.linkedinUrl,
        photoUrl: contact.photoUrl,
        city: contact.city,
        country: contact.country,
        meetingsCount: contact.meetingsCount,
        lastSeenAt: contact.lastSeenAt,
      };

      const existing = companyMap.get(contact.company.id);
      if (existing) {
        existing.contacts.push(contactInfo);
        existing.contactCount++;
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
          contactCount: 1,
          contacts: [contactInfo],
        });
      }
    }

    res.json({
      connectionId: connection.id,
      peerId,
      peerName,
      companies: Array.from(companyMap.values()).sort((a, b) => b.contactCount - a.contactCount),
    });
  } catch (error: any) {
    console.error('Connection reach error:', error.message);
    res.status(500).json({ error: 'Failed to fetch connection reach' });
  }
});

// ─── List pending invites (emails not yet on platform) ───────────────────────

router.get('/invites', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    const invites = await prisma.pendingInvite.findMany({
      where: { fromUserId: userId, status: 'pending', spaceId: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, status: true, createdAt: true },
    });

    res.json(invites);
  } catch (error: any) {
    console.error('List invites error:', error.message);
    res.status(500).json({ error: 'Failed to list invites' });
  }
});

// ─── Cancel a pending invite ─────────────────────────────────────────────────

router.delete('/invites/:id', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    const invite = await prisma.pendingInvite.findFirst({
      where: { id: req.params.id, fromUserId: userId },
    });
    if (!invite) {
      res.status(404).json({ error: 'Invite not found' });
      return;
    }

    await prisma.pendingInvite.delete({ where: { id: invite.id } });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Cancel invite error:', error.message);
    res.status(500).json({ error: 'Failed to cancel invite' });
  }
});

export default router;
