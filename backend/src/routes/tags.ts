import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import prisma from '../lib/prisma.js';

const router = Router();

// Get all tags and company-tag assignments for the current user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;

    const tags = await prisma.tag.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    const companyTags = await prisma.companyTag.findMany({
      where: { userId },
    });

    // Format: { tagDefs: { name: color }, companyTags: { domain: [tagName, ...] } }
    const tagDefs: Record<string, string> = {};
    const tagIdToName: Record<string, string> = {};
    tags.forEach(t => {
      tagDefs[t.name] = t.color;
      tagIdToName[t.id] = t.name;
    });

    const companyTagsMap: Record<string, string[]> = {};
    companyTags.forEach(ct => {
      const tagName = tagIdToName[ct.tagId];
      if (!tagName) return;
      if (!companyTagsMap[ct.companyDomain]) {
        companyTagsMap[ct.companyDomain] = [];
      }
      companyTagsMap[ct.companyDomain].push(tagName);
    });

    res.json({ tagDefs, companyTags: companyTagsMap });
  } catch (error: any) {
    console.error('Get tags error:', error.message);
    res.status(500).json({ error: 'Failed to get tags' });
  }
});

// Create a new tag definition
router.post('/', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { name, color } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Tag name is required' });
      return;
    }

    const tag = await prisma.tag.upsert({
      where: { userId_name: { userId, name: name.trim() } },
      update: { color: color || '#5b8def' },
      create: { userId, name: name.trim(), color: color || '#5b8def' },
    });

    res.json({ tag: { name: tag.name, color: tag.color } });
  } catch (error: any) {
    console.error('Create tag error:', error.message);
    res.status(500).json({ error: 'Failed to create tag' });
  }
});

// Delete a tag definition (and all its company assignments)
router.delete('/:name', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const name = decodeURIComponent(req.params.name);

    await prisma.tag.deleteMany({
      where: { userId, name },
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete tag error:', error.message);
    res.status(500).json({ error: 'Failed to delete tag' });
  }
});

// Toggle a tag on a company
router.post('/toggle', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { tagName, companyDomain } = req.body;

    if (!tagName || !companyDomain) {
      res.status(400).json({ error: 'tagName and companyDomain are required' });
      return;
    }

    // Find the tag
    const tag = await prisma.tag.findUnique({
      where: { userId_name: { userId, name: tagName } },
    });
    if (!tag) {
      res.status(404).json({ error: 'Tag not found' });
      return;
    }

    // Find company by domain (optional link)
    const company = await prisma.company.findUnique({ where: { domain: companyDomain } });

    // Check if assignment exists
    const existing = await prisma.companyTag.findUnique({
      where: { tagId_companyDomain: { tagId: tag.id, companyDomain } },
    });

    if (existing) {
      await prisma.companyTag.delete({ where: { id: existing.id } });
      res.json({ action: 'removed' });
    } else {
      await prisma.companyTag.create({
        data: {
          tagId: tag.id,
          companyDomain,
          companyId: company?.id || null,
          userId,
        },
      });
      res.json({ action: 'added' });
    }
  } catch (error: any) {
    console.error('Toggle tag error:', error.message);
    res.status(500).json({ error: 'Failed to toggle tag' });
  }
});

// Bulk sync — replace all tags from client state (for migration from localStorage)
router.put('/sync', authMiddleware, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { tagDefs, companyTags } = req.body as {
      tagDefs: Record<string, string>;
      companyTags: Record<string, string[]>;
    };

    if (!tagDefs || typeof tagDefs !== 'object') {
      res.status(400).json({ error: 'tagDefs is required' });
      return;
    }

    // Delete all existing tags for user (cascades to CompanyTag)
    await prisma.tag.deleteMany({ where: { userId } });

    // Create tag definitions
    const tagNameToId: Record<string, string> = {};
    for (const [name, color] of Object.entries(tagDefs)) {
      const tag = await prisma.tag.create({
        data: { userId, name, color },
      });
      tagNameToId[name] = tag.id;
    }

    // Create company-tag assignments
    if (companyTags && typeof companyTags === 'object') {
      const rows: { tagId: string; companyDomain: string; companyId: string | null; userId: string }[] = [];

      for (const [domain, tagNames] of Object.entries(companyTags)) {
        const company = await prisma.company.findUnique({ where: { domain } });
        for (const tagName of tagNames) {
          const tagId = tagNameToId[tagName];
          if (tagId) {
            rows.push({ tagId, companyDomain: domain, companyId: company?.id || null, userId });
          }
        }
      }

      if (rows.length > 0) {
        await prisma.companyTag.createMany({ data: rows });
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Sync tags error:', error.message);
    res.status(500).json({ error: 'Failed to sync tags' });
  }
});

export default router;
