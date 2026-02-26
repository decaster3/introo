import { Router } from 'express';
import { authMiddleware, adminMiddleware, invalidateUserCache, AuthenticatedRequest } from '../middleware/auth.js';
import prisma from '../lib/prisma.js';

const router = Router();

router.use(authMiddleware);
router.use(adminMiddleware);

// ---------------------------------------------------------------------------
// GET /api/admin/stats  — aggregate funnel + intro counts
// ---------------------------------------------------------------------------
router.get('/stats', async (_req, res) => {
  try {
    const [
      totalUsers,
      usersWithCalendar,
      usersWithEnrichedContacts,
      usersWithConnection,
      pendingInvites,
      totalIntroRequests,
      successfulIntroRequests,
      totalIntroOffers,
      usersWithIntroRequest,
      usersWithSuccessfulIntro,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.calendarAccount.groupBy({ by: ['userId'], _count: true }).then(r => r.length),
      prisma.contact.groupBy({
        by: ['userId'],
        where: { enrichedAt: { not: null } },
        _count: true,
      }).then(r => r.length),
      prisma.$queryRaw<{ cnt: bigint }[]>`
        SELECT COUNT(DISTINCT u.id) AS cnt FROM users u
        LEFT JOIN direct_connections dc ON (dc."fromUserId" = u.id OR dc."toUserId" = u.id) AND dc.status = 'accepted'
        LEFT JOIN pod_members pm ON pm."userId" = u.id AND pm.status = 'approved'
        WHERE dc.id IS NOT NULL OR pm.id IS NOT NULL
      `.then(r => Number(r[0]?.cnt ?? 0)),
      prisma.pendingInvite.count({ where: { status: 'pending' } }),
      prisma.introRequest.count(),
      prisma.introRequest.count({ where: { status: { in: ['accepted', 'completed'] } } }),
      prisma.introOffer.count(),
      prisma.$queryRaw<{ cnt: bigint }[]>`
        SELECT COUNT(DISTINCT uid) AS cnt FROM (
          SELECT ir."requesterId" AS uid FROM intro_requests ir
          UNION
          SELECT pm."userId" AS uid FROM pod_members pm
            JOIN intro_requests ir2 ON ir2."podId" = pm."podId" AND ir2."requesterId" != pm."userId"
            WHERE pm.status = 'approved'
        ) t
      `.then(r => Number(r[0]?.cnt ?? 0)),
      prisma.$queryRaw<{ cnt: bigint }[]>`
        SELECT COUNT(DISTINCT uid) AS cnt FROM (
          SELECT ir."requesterId" AS uid FROM intro_requests ir WHERE ir.status IN ('accepted', 'completed')
          UNION
          SELECT io."introducerId" AS uid FROM intro_offers io
            JOIN intro_requests ir2 ON ir2.id = io."requestId" AND ir2.status IN ('accepted', 'completed')
        ) t
      `.then(r => Number(r[0]?.cnt ?? 0)),
    ]);

    const introCreatedOnly = usersWithIntroRequest - usersWithSuccessfulIntro;
    const connectionOnly = usersWithConnection - usersWithIntroRequest;
    const enrichedOnly = usersWithEnrichedContacts - usersWithConnection;
    const calendarOnly = usersWithCalendar - usersWithEnrichedContacts;
    const signedUpOnly = totalUsers - usersWithCalendar;

    res.json({
      totalUsers,
      pendingInvites,
      usersWithCalendar,
      usersWithEnrichedContacts,
      usersWithConnection,
      usersWithIntroRequest,
      usersWithSuccessfulIntro,
      funnelCounts: {
        invited: pendingInvites,
        signed_up: signedUpOnly,
        calendar_connected: calendarOnly,
        contacts_enriched: enrichedOnly,
        first_connection: connectionOnly,
        intro_created: introCreatedOnly,
        intro_success: usersWithSuccessfulIntro,
      },
      totalIntroRequests,
      successfulIntroRequests,
      totalIntroOffers,
    });
  } catch (error) {
    console.error('[admin] stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/users  — full user funnel table
// ---------------------------------------------------------------------------

type SortField = 'name' | 'email' | 'createdAt' | 'status' | 'introRequestsSent' | 'introRequestsSuccessful' | 'introRequestsReceived' | 'introRequestsReceivedSuccessful' | 'role';
const VALID_SORT_FIELDS = new Set<string>(['name', 'email', 'createdAt', 'status', 'introRequestsSent', 'introRequestsSuccessful', 'introRequestsReceived', 'introRequestsReceivedSuccessful', 'role']);

function deriveFunnelStatus(user: {
  calendarAccounts: { id: string }[];
  enrichedContactCount: number;
  hasConnection: boolean;
  hasIntroRequest: boolean;
  hasSuccessfulIntro: boolean;
}): string {
  if (user.hasSuccessfulIntro) return 'intro_success';
  if (user.hasIntroRequest) return 'intro_created';
  if (user.hasConnection) return 'first_connection';
  if (user.enrichedContactCount > 0) return 'contacts_enriched';
  if (user.calendarAccounts.length > 0) return 'calendar_connected';
  return 'signed_up';
}

router.get('/users', async (req, res) => {
  try {
    const search = (req.query.search as string || '').trim().toLowerCase();
    const statusFilter = req.query.status as string | undefined;
    const sortField = (req.query.sort as string) || 'createdAt';
    const sortOrder = (req.query.order as string) === 'asc' ? 'asc' : 'desc';
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));

    const users = await prisma.user.findMany({
      where: search
        ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] }
        : undefined,
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        role: true,
        createdAt: true,
        calendarAccounts: { select: { id: true }, where: { isActive: true } },
        _count: {
          select: {
            contacts: true,
            introRequests: true,
            introOffers: true,
            spaceMemberships: true,
            sentConnections: true,
            receivedConnections: true,
          },
        },
      },
      orderBy: VALID_SORT_FIELDS.has(sortField) && ['name', 'email', 'createdAt', 'role'].includes(sortField)
        ? { [sortField]: sortOrder }
        : { createdAt: 'desc' },
    });

    // Batch-fetch enriched contact counts and intro-received counts
    const userIds = users.map(u => u.id);

    const [enrichedCounts, identifiedCounts, connectionCounts, introReceivedRows, introReceivedSuccessRows] = await Promise.all([
      prisma.contact.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, enrichedAt: { not: null } },
        _count: true,
      }),
      prisma.contact.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, companyId: { not: null } },
        _count: true,
      }),
      prisma.directConnection.groupBy({
        by: ['fromUserId'],
        where: {
          status: 'accepted',
          OR: [{ fromUserId: { in: userIds } }, { toUserId: { in: userIds } }],
        },
        _count: true,
      }),
      // Intro requests received: requests in user's spaces where user is not the requester
      prisma.$queryRaw<{ userId: string; cnt: bigint }[]>`
        SELECT pm."userId", COUNT(DISTINCT ir.id) AS cnt
        FROM pod_members pm
        JOIN intro_requests ir ON ir."podId" = pm."podId" AND ir."requesterId" != pm."userId"
        WHERE pm."userId" = ANY(${userIds}) AND pm.status = 'approved'
        GROUP BY pm."userId"
      `,
      prisma.$queryRaw<{ userId: string; cnt: bigint }[]>`
        SELECT pm."userId", COUNT(DISTINCT ir.id) AS cnt
        FROM pod_members pm
        JOIN intro_requests ir ON ir."podId" = pm."podId" AND ir."requesterId" != pm."userId"
        WHERE pm."userId" = ANY(${userIds}) AND pm.status = 'approved' AND ir.status IN ('accepted', 'completed')
        GROUP BY pm."userId"
      `,
    ]);

    const enrichedMap = new Map(enrichedCounts.map(e => [e.userId, e._count]));
    const identifiedMap = new Map(identifiedCounts.map(e => [e.userId, e._count]));

    // Build accepted-connection set per user (both directions)
    const acceptedConns = await prisma.directConnection.findMany({
      where: { status: 'accepted', OR: [{ fromUserId: { in: userIds } }, { toUserId: { in: userIds } }] },
      select: { fromUserId: true, toUserId: true },
    });
    const connSet = new Set<string>();
    for (const c of acceptedConns) { connSet.add(c.fromUserId); connSet.add(c.toUserId); }

    const introReceivedMap = new Map(introReceivedRows.map(r => [r.userId, Number(r.cnt)]));
    const introReceivedSuccessMap = new Map(introReceivedSuccessRows.map(r => [r.userId, Number(r.cnt)]));

    // Also count approved space memberships per user
    const spaceMemberCounts = await prisma.spaceMember.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, status: 'approved' },
      _count: true,
    });
    const spaceMemberMap = new Map(spaceMemberCounts.map(s => [s.userId, s._count]));

    const successfulSentRows = await prisma.introRequest.groupBy({
      by: ['requesterId'],
      where: { requesterId: { in: userIds }, status: { in: ['accepted', 'completed'] } },
      _count: true,
    });
    const successfulSentMap = new Map(successfulSentRows.map(r => [r.requesterId, r._count]));

    // Activity tracking: days active in last 7 and 30 days, plus last active date
    const today = new Date();
    const date7ago = new Date(today); date7ago.setDate(date7ago.getDate() - 7);
    const date30ago = new Date(today); date30ago.setDate(date30ago.getDate() - 30);
    const d7 = date7ago.toISOString().slice(0, 10);
    const d30 = date30ago.toISOString().slice(0, 10);

    const [activity7, activity30, lastActive] = await Promise.all([
      prisma.userActivity.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, date: { gte: d7 } },
        _count: true,
      }),
      prisma.userActivity.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, date: { gte: d30 } },
        _count: true,
      }),
      prisma.$queryRaw<{ userId: string; lastDate: string }[]>`
        SELECT "userId", MAX(date) AS "lastDate"
        FROM user_activity
        WHERE "userId" = ANY(${userIds})
        GROUP BY "userId"
      `,
    ]);

    const activity7Map = new Map(activity7.map(a => [a.userId, a._count]));
    const activity30Map = new Map(activity30.map(a => [a.userId, a._count]));
    const lastActiveMap = new Map(lastActive.map(a => [a.userId, a.lastDate]));

    let result = users.map(u => {
      const enrichedContactCount = enrichedMap.get(u.id) || 0;
      const hasConnection = connSet.has(u.id) || (spaceMemberMap.get(u.id) || 0) > 0;
      const hasIntroRequest = (u._count.introRequests > 0) || ((introReceivedMap.get(u.id) || 0) > 0);
      const hasSuccessfulIntro = ((successfulSentMap.get(u.id) || 0) + (introReceivedSuccessMap.get(u.id) || 0)) > 0;
      const status = deriveFunnelStatus({ calendarAccounts: u.calendarAccounts, enrichedContactCount, hasConnection, hasIntroRequest, hasSuccessfulIntro });
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        avatar: u.avatar,
        role: u.role,
        createdAt: u.createdAt,
        status,
        calendarConnected: u.calendarAccounts.length > 0,
        contactsCount: u._count.contacts,
        identifiedContactCount: identifiedMap.get(u.id) || 0,
        enrichedContactCount,
        connectionsCount: (connSet.has(u.id) ? 1 : 0) + (spaceMemberMap.get(u.id) || 0),
        introRequestsSent: u._count.introRequests,
        introRequestsSuccessful: successfulSentMap.get(u.id) || 0,
        introRequestsReceived: introReceivedMap.get(u.id) || 0,
        introRequestsReceivedSuccessful: introReceivedSuccessMap.get(u.id) || 0,
        activeDays7: activity7Map.get(u.id) || 0,
        activeDays30: activity30Map.get(u.id) || 0,
        lastActiveAt: lastActiveMap.get(u.id) || null,
      };
    });

    // Filter by funnel status
    if (statusFilter && ['signed_up', 'calendar_connected', 'contacts_enriched', 'first_connection', 'intro_created', 'intro_success'].includes(statusFilter)) {
      result = result.filter(u => u.status === statusFilter);
    }

    // Sort by computed fields
    if (VALID_SORT_FIELDS.has(sortField) && !['name', 'email', 'createdAt', 'role'].includes(sortField)) {
      const key = sortField as keyof typeof result[0];
      result.sort((a, b) => {
        const av = (a as any)[key] ?? 0;
        const bv = (b as any)[key] ?? 0;
        return sortOrder === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
      });
    }

    const total = result.length;
    const paginated = result.slice((page - 1) * limit, page * limit);

    res.json({ data: paginated, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('[admin] users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/role  — promote/demote user
// ---------------------------------------------------------------------------
router.post('/users/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    if (!role || !['admin', 'user'].includes(role)) {
      res.status(400).json({ error: 'role must be "admin" or "user"' });
      return;
    }

    const currentUserId = (req as AuthenticatedRequest).user!.id;
    if (id === currentUserId && role === 'user') {
      res.status(400).json({ error: 'Cannot remove your own admin role' });
      return;
    }

    const user = await prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, name: true, email: true, role: true },
    });

    invalidateUserCache(id);
    res.json({ user });
  } catch (error: any) {
    if (error?.code === 'P2025') {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    console.error('[admin] set role error:', error);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/pending-invites  — invites not yet converted
// ---------------------------------------------------------------------------
router.get('/pending-invites', async (req, res) => {
  try {
    const invites = await prisma.pendingInvite.findMany({
      where: { status: 'pending' },
      include: {
        fromUser: { select: { id: true, name: true, email: true } },
        space: { select: { id: true, name: true, emoji: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(invites.map(inv => ({
      id: inv.id,
      email: inv.email,
      createdAt: inv.createdAt,
      invitedBy: inv.fromUser,
      space: inv.space,
    })));
  } catch (error) {
    console.error('[admin] pending-invites error:', error);
    res.status(500).json({ error: 'Failed to fetch pending invites' });
  }
});

export default router;
