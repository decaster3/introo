import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import {
  enrichContactsFree,
  enrichOrganizationFree,
  matchPersonByEmail,
  enrichOrganization,
  getEnrichmentStats,
  type BatchResult,
} from '../services/apollo.js';
import prisma from '../lib/prisma.js';

const router = Router();
router.use(authMiddleware);

// ─── Status ──────────────────────────────────────────────────────────────────

router.get('/status', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    res.json(await getEnrichmentStats(userId));
  } catch (error: any) {
    console.error('Enrichment status error:', error.message);
    res.status(500).json({ error: 'Failed to fetch enrichment status' });
  }
});

// ─── In-memory progress tracking ─────────────────────────────────────────────

const PROGRESS_CLEANUP_MS = 5 * 60 * 1000; // keep completed progress for 5 min

const batchProgress = new Map<string, { type: string; result: BatchResult; done: boolean; error?: string }>();
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
const cancelSignals = new Map<string, { cancelled: boolean }>();

function progressKey(userId: string) { return `contacts:${userId}`; }

function scheduleCleanup(key: string) {
  const existing = cleanupTimers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    batchProgress.delete(key);
    cleanupTimers.delete(key);
  }, PROGRESS_CLEANUP_MS);
  cleanupTimers.set(key, timer);
}

// ─── Start enrichment ────────────────────────────────────────────────────────

export function runEnrichmentForUser(userId: string, options?: { force?: boolean }): void {
  const key = progressKey(userId);

  // Skip if already running
  const existing = batchProgress.get(key);
  if (existing && !existing.done) return;

  // Cancel any pending cleanup timer from a previous run
  const oldTimer = cleanupTimers.get(key);
  if (oldTimer) { clearTimeout(oldTimer); cleanupTimers.delete(key); }

  batchProgress.set(key, {
    type: 'contacts',
    result: { total: 0, enriched: 0, skipped: 0, errors: 0 },
    done: false,
  });

  const signal = { cancelled: false };
  cancelSignals.set(userId, signal);

  enrichContactsFree(userId, (result) => {
    const entry = batchProgress.get(key);
    if (entry) entry.result = result;
  }, { ...options, signal })
    .then((finalResult) => {
      cancelSignals.delete(userId);
      const entry = batchProgress.get(key);
      if (entry) { entry.result = finalResult; entry.done = true; }
      scheduleCleanup(key);
    })
    .catch((err) => {
      cancelSignals.delete(userId);
      console.error('Enrichment failed:', err);
      const entry = batchProgress.get(key);
      if (entry) {
        entry.done = true;
        entry.error = (err as Error).message || 'Enrichment failed';
        entry.result.errorMessage = entry.error;
      }
      scheduleCleanup(key);
    });
}

router.post('/contacts-free', async (req, res) => {
  const userId = (req as AuthenticatedRequest).user!.id;
  const force = req.body?.force === true;
  console.log(`[enrich] POST /contacts-free userId=${userId} force=${force}`);

  const key = progressKey(userId);
  const existing = batchProgress.get(key);
  if (existing && !existing.done) {
    res.status(409).json({ error: 'Enrichment already in progress', progress: existing.result });
    return;
  }

  runEnrichmentForUser(userId, { force });
  res.json({ message: 'Enrichment started', key });
});

// ─── Stop enrichment ─────────────────────────────────────────────────────────

router.post('/stop', async (req, res) => {
  const userId = (req as AuthenticatedRequest).user!.id;
  const key = progressKey(userId);

  const signal = cancelSignals.get(userId);
  const entry = batchProgress.get(key);

  if (!entry || entry.done) {
    res.json({ message: 'No enrichment running', stopped: false });
    return;
  }

  if (signal) {
    signal.cancelled = true;
    console.log(`[enrich] ⛔ Stop requested by user ${userId}`);
  }

  entry.done = true;
  cancelSignals.delete(userId);

  res.json({ message: 'Enrichment stopped', stopped: true, progress: entry.result });
});

// ─── Progress polling ────────────────────────────────────────────────────────

router.get('/progress', async (req, res) => {
  const userId = (req as AuthenticatedRequest).user!.id;
  const entry = batchProgress.get(progressKey(userId));

  res.json({
    contacts: null,
    companies: null,
    contactsFree: entry
      ? { ...entry.result, done: entry.done, error: entry.error || null }
      : null,
  });
});

// ─── Single company lookup ───────────────────────────────────────────────────

router.get('/company/:domain', async (req, res) => {
  try {
    const domain = req.params.domain.toLowerCase().replace(/^www\./, '');

    let company = await prisma.company.findUnique({ where: { domain } });
    if (company) {
      res.json({ company, source: 'db' });
      return;
    }

    const org = await enrichOrganizationFree(domain);
    if (org && org.name) {
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

    res.json({ company: { domain, name: domain }, source: 'none' });
  } catch (error: any) {
    console.error('Company lookup error:', error.message);
    res.status(500).json({ error: 'Failed to look up company' });
  }
});

// ─── Lookup contact by email (for manual add) ────────────────────────────────

router.post('/lookup-contact', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { email } = req.body as { email?: string };

    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Valid email is required' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const domain = normalizedEmail.split('@')[1];

    // Check if contact already exists for this user
    const existing = await prisma.contact.findUnique({
      where: { userId_email: { userId, email: normalizedEmail } },
      select: { id: true, name: true, email: true },
    });
    if (existing) {
      res.status(409).json({ error: 'Contact already exists', contactId: existing.id });
      return;
    }

    // Enrich person via Apollo
    const person = await matchPersonByEmail(normalizedEmail).catch(() => null);

    // Enrich company via Apollo (or find in DB)
    let companyData: Record<string, any> | null = null;
    const genericDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'mail.ru', 'yandex.ru', 'protonmail.com', 'live.com', 'aol.com'];
    const isGenericDomain = genericDomains.includes(domain);

    if (!isGenericDomain) {
      const dbCompany = await prisma.company.findUnique({ where: { domain } });
      if (dbCompany) {
        companyData = dbCompany;
      } else {
        const org = await enrichOrganization(domain).catch(() => null);
        if (org && org.name) {
          companyData = {
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
            annualRevenue: org.annual_revenue ? String(org.annual_revenue) : null,
            totalFunding: org.total_funding ? String(org.total_funding) : null,
            lastFundingRound: org.latest_funding_stage || null,
          };
        }
      }
    }

    const enrichedPerson = person ? {
      name: person.name || null,
      title: person.title || null,
      headline: person.headline || null,
      linkedinUrl: person.linkedin_url || null,
      photoUrl: person.photo_url || null,
      city: person.city || null,
      country: person.country || null,
      company: person.organization?.name || null,
      companyDomain: person.organization?.primary_domain || domain,
    } : null;

    res.json({
      person: enrichedPerson,
      company: companyData,
      email: normalizedEmail,
      domain: isGenericDomain ? null : domain,
      source: person ? 'apollo' : (companyData ? 'partial' : 'none'),
    });
  } catch (error: any) {
    console.error('Lookup contact error:', error.message);
    res.status(500).json({ error: 'Failed to look up contact' });
  }
});

// ─── Save manually added contact ──────────────────────────────────────────────

router.post('/add-contact', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const {
      email, name, title, linkedinUrl, photoUrl, city, country,
      companyName, companyDomain, websiteUrl,
    } = req.body as {
      email: string; name?: string; title?: string; linkedinUrl?: string;
      photoUrl?: string; city?: string; country?: string;
      companyName?: string; companyDomain?: string; websiteUrl?: string;
    };

    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Valid email is required' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check for duplicates
    const existing = await prisma.contact.findUnique({
      where: { userId_email: { userId, email: normalizedEmail } },
    });
    if (existing) {
      res.status(409).json({ error: 'Contact already exists', contactId: existing.id });
      return;
    }

    // Upsert company if domain provided
    let companyId: string | null = null;
    const domain = companyDomain?.trim().toLowerCase();
    if (domain) {
      const company = await prisma.company.upsert({
        where: { domain },
        update: {
          ...(companyName && { name: companyName }),
          ...(websiteUrl && { websiteUrl }),
        },
        create: {
          domain,
          name: companyName || domain,
          websiteUrl: websiteUrl || null,
        },
      });
      companyId = company.id;
    }

    // Create contact
    const contact = await prisma.contact.create({
      data: {
        userId,
        email: normalizedEmail,
        name: name || null,
        title: title || null,
        linkedinUrl: linkedinUrl || null,
        photoUrl: photoUrl || null,
        city: city || null,
        country: country || null,
        companyId,
        isApproved: true,
        source: 'manual',
        meetingsCount: 0,
        lastSeenAt: new Date(),
      },
      include: {
        company: true,
      },
    });

    res.json({ contact });
  } catch (error: any) {
    console.error('Add contact error:', error.message);
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

export default router;
