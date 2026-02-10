import { Router } from 'express';
import { authMiddleware, optionalAuthMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { getPaginationParams, createPaginatedResponse } from '../lib/pagination.js';
import prisma from '../lib/prisma.js';

const router = Router();

// Get all relationships (community-wide for matching)
router.get('/', optionalAuthMiddleware, async (req, res) => {
  try {
    const relationships = await prisma.relationship.findMany({
      include: {
        user: {
          select: { id: true, name: true, avatar: true },
        },
        company: {
          select: { id: true, domain: true, name: true, industry: true, logo: true },
        },
      },
      orderBy: { strengthScore: 'desc' },
    });

    res.json(relationships);
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to fetch relationships' });
  }
});

// Get current user's relationships
router.get('/mine', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    const relationships = await prisma.relationship.findMany({
      where: { userId },
      include: {
        company: {
          select: { id: true, domain: true, name: true, industry: true, logo: true, geo: true },
        },
      },
      orderBy: { strengthScore: 'desc' },
    });

    res.json(relationships);
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to fetch relationships' });
  }
});

// Get companies (for the reach view) - with pagination
router.get('/companies', async (req, res) => {
  try {
    const pagination = getPaginationParams(req, 50);
    const { search, industry } = req.query;
    
    const where: Record<string, unknown> = {};
    if (search && typeof search === 'string') {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { domain: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (industry && typeof industry === 'string') {
      where.industry = industry;
    }

    const [companies, total] = await Promise.all([
      prisma.company.findMany({
        where,
        include: {
          _count: {
            select: { relationships: true },
          },
        },
        orderBy: { name: 'asc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.company.count({ where }),
    ]);

    res.json(createPaginatedResponse(companies, total, pagination));
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
});

// Get contacts for current user - with pagination
router.get('/contacts', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const pagination = getPaginationParams(req, 50);
    const { approved, search } = req.query;
    
    const where: Record<string, unknown> = { userId };
    
    if (approved === 'true') {
      where.isApproved = true;
    } else if (approved === 'false') {
      where.isApproved = false;
    }
    
    if (search && typeof search === 'string') {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        include: {
          company: {
            select: { id: true, domain: true, name: true, logo: true },
          },
          meetings: {
            orderBy: { date: 'desc' },
            take: 5,
          },
        },
        orderBy: { lastSeenAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      prisma.contact.count({ where }),
    ]);

    res.json(createPaginatedResponse(contacts, total, pagination));
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// Approve contacts (add to network)
router.post('/contacts/approve', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { contactIds } = req.body as { contactIds: string[] };

    if (!contactIds || !Array.isArray(contactIds)) {
      res.status(400).json({ error: 'contactIds array is required' });
      return;
    }

    // Update contacts to approved
    await prisma.contact.updateMany({
      where: {
        id: { in: contactIds },
        userId, // Ensure user owns these contacts
      },
      data: { isApproved: true },
    });

    // Get approved contacts with companies
    const approvedContacts = await prisma.contact.findMany({
      where: {
        id: { in: contactIds },
        userId,
        isApproved: true,
        companyId: { not: null },
      },
      select: {
        companyId: true,
        meetingsCount: true,
        lastSeenAt: true,
      },
    });

    // Aggregate by company and create/update relationships
    const companyData = new Map<string, { meetingsCount: number; lastSeenAt: Date }>();
    for (const contact of approvedContacts) {
      if (!contact.companyId) continue;
      const existing = companyData.get(contact.companyId);
      if (existing) {
        existing.meetingsCount += contact.meetingsCount;
        if (contact.lastSeenAt > existing.lastSeenAt) {
          existing.lastSeenAt = contact.lastSeenAt;
        }
      } else {
        companyData.set(contact.companyId, {
          meetingsCount: contact.meetingsCount,
          lastSeenAt: contact.lastSeenAt,
        });
      }
    }

    // Upsert relationships
    const now = new Date();
    for (const [companyId, data] of companyData) {
      const daysSinceLast = Math.max(0, (now.getTime() - data.lastSeenAt.getTime()) / (1000 * 60 * 60 * 24));
      const recencyScore = Math.max(0, 1 - daysSinceLast / 365);
      const frequencyScore = Math.min(1, data.meetingsCount / 20);
      const strengthScore = (recencyScore * 0.6 + frequencyScore * 0.4) * 100;

      await prisma.relationship.upsert({
        where: {
          userId_companyId: { userId, companyId },
        },
        update: {
          meetingsCount: data.meetingsCount,
          lastSeenAt: data.lastSeenAt,
          strengthScore,
        },
        create: {
          userId,
          companyId,
          meetingsCount: data.meetingsCount,
          lastSeenAt: data.lastSeenAt,
          strengthScore,
        },
      });
    }

    res.json({ approved: contactIds.length, relationshipsCreated: companyData.size });
  } catch (error: unknown) {
    console.error('Error approving contacts:', error);
    res.status(500).json({ error: 'Failed to approve contacts' });
  }
});

// Approve all pending contacts
router.post('/contacts/approve-all', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    // Get all unapproved contacts
    const pendingContacts = await prisma.contact.findMany({
      where: { userId, isApproved: false },
      select: { id: true },
    });

    const contactIds = pendingContacts.map(c => c.id);

    if (contactIds.length === 0) {
      res.json({ approved: 0, relationshipsCreated: 0 });
      return;
    }

    // Use the same logic as approve
    await prisma.contact.updateMany({
      where: { id: { in: contactIds }, userId },
      data: { isApproved: true },
    });

    // Get approved contacts with companies
    const approvedContacts = await prisma.contact.findMany({
      where: {
        id: { in: contactIds },
        userId,
        companyId: { not: null },
      },
      select: {
        companyId: true,
        meetingsCount: true,
        lastSeenAt: true,
      },
    });

    // Aggregate by company
    const companyData = new Map<string, { meetingsCount: number; lastSeenAt: Date }>();
    for (const contact of approvedContacts) {
      if (!contact.companyId) continue;
      const existing = companyData.get(contact.companyId);
      if (existing) {
        existing.meetingsCount += contact.meetingsCount;
        if (contact.lastSeenAt > existing.lastSeenAt) {
          existing.lastSeenAt = contact.lastSeenAt;
        }
      } else {
        companyData.set(contact.companyId, {
          meetingsCount: contact.meetingsCount,
          lastSeenAt: contact.lastSeenAt,
        });
      }
    }

    // Upsert relationships
    const now = new Date();
    for (const [companyId, data] of companyData) {
      const daysSinceLast = Math.max(0, (now.getTime() - data.lastSeenAt.getTime()) / (1000 * 60 * 60 * 24));
      const recencyScore = Math.max(0, 1 - daysSinceLast / 365);
      const frequencyScore = Math.min(1, data.meetingsCount / 20);
      const strengthScore = (recencyScore * 0.6 + frequencyScore * 0.4) * 100;

      await prisma.relationship.upsert({
        where: {
          userId_companyId: { userId, companyId },
        },
        update: {
          meetingsCount: data.meetingsCount,
          lastSeenAt: data.lastSeenAt,
          strengthScore,
        },
        create: {
          userId,
          companyId,
          meetingsCount: data.meetingsCount,
          lastSeenAt: data.lastSeenAt,
          strengthScore,
        },
      });
    }

    res.json({ approved: contactIds.length, relationshipsCreated: companyData.size });
  } catch (error: unknown) {
    console.error('Error approving all contacts:', error);
    res.status(500).json({ error: 'Failed to approve contacts' });
  }
});

export default router;
