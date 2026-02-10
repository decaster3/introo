import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import prisma from '../lib/prisma.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get all signals for current user
router.get('/', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    const signals = await prisma.signal.findMany({
      where: { userId },
      include: {
        _count: {
          select: { matches: { where: { isRead: false } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(signals);
  } catch (error: unknown) {
    console.error('Error fetching signals:', error);
    res.status(500).json({ error: 'Failed to fetch signals' });
  }
});

// Get signal matches (triggered signals)
router.get('/matches', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { signalId, unreadOnly } = req.query;

    const where: Record<string, unknown> = {
      signal: { userId },
    };

    if (signalId && typeof signalId === 'string') {
      where.signalId = signalId;
    }

    if (unreadOnly === 'true') {
      where.isRead = false;
    }

    const matches = await prisma.signalMatch.findMany({
      where,
      include: {
        signal: {
          select: { id: true, name: true, entityType: true, triggerType: true },
        },
      },
      orderBy: { matchedAt: 'desc' },
      take: 100,
    });

    // Fix N+1 query: Batch fetch entities by grouping IDs
    const contactIds = matches
      .filter(m => m.entityType === 'contact')
      .map(m => m.entityId);
    const companyIds = matches
      .filter(m => m.entityType === 'company')
      .map(m => m.entityId);

    // Fetch all entities in batch
    const [contacts, companies] = await Promise.all([
      contactIds.length > 0
        ? prisma.contact.findMany({
            where: { id: { in: contactIds } },
            include: { company: true },
          })
        : Promise.resolve([]),
      companyIds.length > 0
        ? prisma.company.findMany({
            where: { id: { in: companyIds } },
          })
        : Promise.resolve([]),
    ]);

    // Create lookup maps
    const contactMap = new Map(contacts.map(c => [c.id, c]));
    const companyMap = new Map(companies.map(c => [c.id, c]));

    // Enrich matches with entity data from maps
    const enrichedMatches = matches.map(match => {
      let entity = null;
      if (match.entityType === 'contact') {
        entity = contactMap.get(match.entityId) || null;
      } else if (match.entityType === 'company') {
        entity = companyMap.get(match.entityId) || null;
      }
      return { ...match, entity };
    });

    res.json(enrichedMatches);
  } catch (error: unknown) {
    console.error('Error fetching signal matches:', error);
    res.status(500).json({ error: 'Failed to fetch signal matches' });
  }
});

// Get unread matches count
router.get('/matches/count', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    const count = await prisma.signalMatch.count({
      where: {
        signal: { userId },
        isRead: false,
      },
    });

    res.json({ count });
  } catch (error: unknown) {
    console.error('Error fetching matches count:', error);
    res.status(500).json({ error: 'Failed to fetch matches count' });
  }
});

// Create a new signal
router.post('/', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { name, description, entityType, triggerType, config } = req.body;

    if (!name || !entityType || !triggerType) {
      res.status(400).json({ error: 'Name, entityType, and triggerType are required' });
      return;
    }

    const signal = await prisma.signal.create({
      data: {
        userId,
        name,
        description,
        entityType,
        triggerType,
        config: config || {},
      },
    });

    res.status(201).json(signal);
  } catch (error: unknown) {
    console.error('Error creating signal:', error);
    res.status(500).json({ error: 'Failed to create signal' });
  }
});

// Update a signal
router.patch('/:id', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { id } = req.params;
    const { name, description, config, isActive } = req.body;

    // Verify ownership
    const existing = await prisma.signal.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      res.status(404).json({ error: 'Signal not found' });
      return;
    }

    const updated = await prisma.signal.update({
      where: { id },
      data: {
        name: name ?? existing.name,
        description: description ?? existing.description,
        config: config ?? existing.config,
        isActive: isActive ?? existing.isActive,
      },
    });

    res.json(updated);
  } catch (error: unknown) {
    console.error('Error updating signal:', error);
    res.status(500).json({ error: 'Failed to update signal' });
  }
});

// Delete a signal
router.delete('/:id', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { id } = req.params;

    // Verify ownership
    const existing = await prisma.signal.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      res.status(404).json({ error: 'Signal not found' });
      return;
    }

    await prisma.signal.delete({ where: { id } });

    res.json({ success: true });
  } catch (error: unknown) {
    console.error('Error deleting signal:', error);
    res.status(500).json({ error: 'Failed to delete signal' });
  }
});

// Mark match as read
router.post('/matches/:id/read', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { id } = req.params;

    // Verify ownership through signal
    const match = await prisma.signalMatch.findFirst({
      where: { id },
      include: { signal: true },
    });

    if (!match || match.signal.userId !== userId) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    await prisma.signalMatch.update({
      where: { id },
      data: { isRead: true },
    });

    res.json({ success: true });
  } catch (error: unknown) {
    console.error('Error marking match as read:', error);
    res.status(500).json({ error: 'Failed to mark match as read' });
  }
});

// Mark all matches as read
router.post('/matches/read-all', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    await prisma.signalMatch.updateMany({
      where: {
        signal: { userId },
        isRead: false,
      },
      data: { isRead: true },
    });

    res.json({ success: true });
  } catch (error: unknown) {
    console.error('Error marking all matches as read:', error);
    res.status(500).json({ error: 'Failed to mark all matches as read' });
  }
});

// Create a test match (for development/demo purposes)
router.post('/:id/test', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { id } = req.params;

    // Verify ownership
    const signal = await prisma.signal.findFirst({
      where: { id, userId },
    });

    if (!signal) {
      res.status(404).json({ error: 'Signal not found' });
      return;
    }

    // Get a random contact or company based on signal entityType
    let entity: { id: string; [key: string]: unknown } | null = null;
    let entityType = 'contact';

    if (signal.entityType === 'person') {
      entity = await prisma.contact.findFirst({
        where: { userId },
        include: { company: true },
      });
      entityType = 'contact';
    } else {
      entity = await prisma.company.findFirst();
      entityType = 'company';
    }

    if (!entity) {
      res.status(400).json({ error: 'No entities available for test match' });
      return;
    }

    // Generate a sample summary based on signal config
    const config = signal.config as Record<string, unknown>;
    let summary = 'Test signal triggered';
    
    if (signal.triggerType === 'field_change') {
      if (config.field === 'title') {
        summary = `Changed role from "${config.oldValue || 'Previous Role'}" to "${config.newValue || 'New Role'}"`;
      } else if (config.field === 'company') {
        summary = `Moved to a new company`;
      } else if (config.field === 'headcount') {
        summary = `Team grew by 15% in the last quarter`;
      }
    } else if (signal.triggerType === 'prompt_based') {
      const promptStr = typeof config.prompt === 'string' ? config.prompt : '';
      summary = promptStr ? `AI detected: ${promptStr.substring(0, 50)}...` : 'AI detected interesting update';
    }

    const match = await prisma.signalMatch.create({
      data: {
        signalId: id,
        entityType,
        entityId: entity.id,
        summary,
        data: JSON.parse(JSON.stringify({
          signalConfig: config,
          entitySnapshot: entity,
        })),
      },
      include: {
        signal: {
          select: { id: true, name: true, entityType: true, triggerType: true },
        },
      },
    });

    res.status(201).json({ ...match, entity });
  } catch (error: unknown) {
    console.error('Error creating test match:', error);
    res.status(500).json({ error: 'Failed to create test match' });
  }
});

export default router;
