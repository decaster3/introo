import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import {
  enrichContactsFree,
  enrichOrganization,
  getEnrichmentStats,
  type BatchResult,
} from '../services/apollo.js';
import prisma from '../lib/prisma.js';

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
const batchProgress = new Map<string, { type: string; result: BatchResult; done: boolean; error?: string }>();
// Cleanup timers per key — so we can cancel stale timers when a new run starts
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Exported so the background cron can trigger enrichment too
export function runEnrichmentForUser(userId: string, options?: { force?: boolean }): void {
  const progressKey = `contacts-free:${userId}`;

  // Skip if already running
  const existing = batchProgress.get(progressKey);
  if (existing && !existing.done) return;

  // Cancel any pending cleanup timer from a previous run so it doesn't
  // delete the new entry we're about to create
  const oldTimer = cleanupTimers.get(progressKey);
  if (oldTimer) {
    clearTimeout(oldTimer);
    cleanupTimers.delete(progressKey);
  }

  batchProgress.set(progressKey, {
    type: 'contacts-free',
    result: { total: 0, enriched: 0, skipped: 0, errors: 0 },
    done: false,
  });

  enrichContactsFree(userId, (result) => {
    const entry = batchProgress.get(progressKey);
    if (entry) entry.result = result;
  }, options).then((finalResult) => {
    const entry = batchProgress.get(progressKey);
    if (entry) {
      entry.result = finalResult;
      entry.done = true;
    }
    const timer = setTimeout(() => {
      batchProgress.delete(progressKey);
      cleanupTimers.delete(progressKey);
    }, 5 * 60 * 1000);
    cleanupTimers.set(progressKey, timer);
  }).catch((err) => {
    console.error('Free contacts enrichment failed:', err);
    const entry = batchProgress.get(progressKey);
    if (entry) {
      entry.done = true;
      entry.error = (err as Error).message || 'Enrichment failed';
      entry.result.errorMessage = entry.error;
    }
    const timer = setTimeout(() => {
      batchProgress.delete(progressKey);
      cleanupTimers.delete(progressKey);
    }, 5 * 60 * 1000);
    cleanupTimers.set(progressKey, timer);
  });
}

router.post('/contacts-free', async (req, res) => {
  const userId = (req as AuthenticatedRequest).user!.id;
  const force = req.body?.force === true;
  console.log(`[enrich] POST /contacts-free userId=${userId} force=${force} body=`, req.body);

  // Check if already running
  const existing = batchProgress.get(`contacts-free:${userId}`);
  if (existing && !existing.done) {
    res.status(409).json({ error: 'Free enrichment already in progress', progress: existing.result });
    return;
  }

  runEnrichmentForUser(userId, { force });

  res.json({ message: 'Free enrichment started (0 credits)', key: `contacts-free:${userId}` });
});

// ─── Progress polling ────────────────────────────────────────────────────────

router.get('/progress', async (req, res) => {
  const userId = (req as AuthenticatedRequest).user!.id;

  const contactsFreeProgress = batchProgress.get(`contacts-free:${userId}`);

  res.json({
    contacts: null,
    companies: null,
    contactsFree: contactsFreeProgress
      ? { ...contactsFreeProgress.result, done: contactsFreeProgress.done, error: contactsFreeProgress.error || null }
      : null,
  });
});

// ─── Single company lookup / enrich by domain ────────────────────────────────

router.get('/company/:domain', async (req, res) => {
  try {
    const domain = req.params.domain.toLowerCase().replace(/^www\./, '');

    // 1) Check DB first
    let company = await prisma.company.findUnique({ where: { domain } });

    if (company) {
      res.json({ company, source: 'db' });
      return;
    }

    // 2) Not in DB → enrich via Apollo
    const org = await enrichOrganization(domain);

    if (org && org.name) {
      // Create the company in DB so future lookups are instant
      company = await prisma.company.create({
        data: {
          domain,
          name: org.name,
          industry: org.industry || null,
          employeeCount: org.estimated_num_employees || null,
          foundedYear: org.founded_year || null,
          linkedinUrl: org.linkedin_url || null,
          websiteUrl: org.website_url || null,
          logo: org.logo_url || null,
          city: org.city || null,
          state: org.state || null,
          country: org.country || null,
          description: org.short_description || null,
          apolloId: org.id || null,
          annualRevenue: org.annual_revenue ? String(org.annual_revenue) : null,
          totalFunding: org.total_funding ? String(org.total_funding) : null,
          lastFundingRound: org.latest_funding_stage || null,
          lastFundingDate: org.latest_funding_round_date ? new Date(org.latest_funding_round_date) : null,
          enrichedAt: new Date(),
        },
      });
      res.json({ company, source: 'apollo' });
      return;
    }

    // 3) Apollo has nothing → return minimal stub (no DB record created)
    res.json({
      company: { domain, name: domain },
      source: 'none',
    });
  } catch (error: any) {
    console.error('Company lookup error:', error.message);
    res.status(500).json({ error: 'Failed to look up company' });
  }
});

export default router;
