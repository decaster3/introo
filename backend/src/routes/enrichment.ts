import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import {
  enrichContactsFree,
  getEnrichmentStats,
  type BatchResult,
} from '../services/apollo.js';

const router = Router();

// All enrichment routes require authentication
router.use(authMiddleware);

// ─── Status ──────────────────────────────────────────────────────────────────

router.get('/status', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const stats = await getEnrichmentStats(userId);
    res.json(stats);
  } catch (error: any) {
    console.error('Enrichment status error:', error.message);
    res.status(500).json({ error: 'Failed to fetch enrichment status' });
  }
});

// ─── Free batch enrichment (0 credits) ──────────────────────────────────────

// In-memory progress tracking per user
const batchProgress = new Map<string, { type: string; result: BatchResult; done: boolean }>();

router.post('/contacts-free', async (req, res) => {
  const userId = (req as AuthenticatedRequest).user!.id;

  // Check if already running
  const existing = batchProgress.get(`contacts-free:${userId}`);
  if (existing && !existing.done) {
    res.status(409).json({ error: 'Free enrichment already in progress', progress: existing.result });
    return;
  }

  const progressKey = `contacts-free:${userId}`;
  batchProgress.set(progressKey, {
    type: 'contacts-free',
    result: { total: 0, enriched: 0, skipped: 0, errors: 0 },
    done: false,
  });

  // Fire and forget — client polls /progress
  enrichContactsFree(userId, (result) => {
    const entry = batchProgress.get(progressKey);
    if (entry) entry.result = result;
  }).then((finalResult) => {
    const entry = batchProgress.get(progressKey);
    if (entry) {
      entry.result = finalResult;
      entry.done = true;
    }
    setTimeout(() => batchProgress.delete(progressKey), 5 * 60 * 1000);
  }).catch((err) => {
    console.error('Free contacts enrichment failed:', err);
    const entry = batchProgress.get(progressKey);
    if (entry) entry.done = true;
  });

  res.json({ message: 'Free enrichment started (0 credits)', key: progressKey });
});

// ─── Progress polling ────────────────────────────────────────────────────────

router.get('/progress', async (req, res) => {
  const userId = (req as AuthenticatedRequest).user!.id;

  const contactsFreeProgress = batchProgress.get(`contacts-free:${userId}`);

  res.json({
    contacts: null,
    companies: null,
    contactsFree: contactsFreeProgress ? { ...contactsFreeProgress.result, done: contactsFreeProgress.done } : null,
  });
});

export default router;
