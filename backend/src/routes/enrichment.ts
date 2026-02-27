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
import { embedCompany } from './embeddings.js';

const router = Router();
router.use(authMiddleware);

function normalizeCompanyName(domain: string): string {
  // Remove everything after the last dot (any TLD)
  const withoutTld = domain.replace(/\.[^.]+$/, '');
  // If there's still a dot (e.g. "co.uk" → remove secondary TLD too)
  const base = withoutTld.replace(/\.(co|com|org|net|ac|gov)$/, '');
  const name = base
    .split('.')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return name;
}

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
      const enrichData = {
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
      };
      company = await prisma.company.upsert({
        where: { domain },
        create: { domain, ...enrichData },
        update: enrichData,
      });
      embedCompany(company.id, company).catch(err =>
        console.error(`[embeddings] Auto-embed failed for ${domain}:`, err.message),
      );
      res.json({ company, source: 'apollo' });
      return;
    }

    res.json({ company: { domain, name: domain }, source: 'none' });
  } catch (error: any) {
    console.error('Company lookup error:', error.message);
    res.status(500).json({ error: 'Failed to look up company' });
  }
});

// ─── Helper: enrich an un-enriched company via Apollo ─────────────────────────

async function enrichCompanyIfNeeded(company: any, domain: string): Promise<any> {
  if (company.enrichedAt) return company;
  const org = await enrichOrganization(domain).catch(() => null);
  if (!org || !org.name) return company;
  const update: Record<string, any> = { enrichedAt: new Date() };
  if (org.name) update.name = org.name;
  if (org.estimated_num_employees) update.employeeCount = org.estimated_num_employees;
  if (org.industry) update.industry = org.industry;
  if (org.founded_year) update.foundedYear = org.founded_year;
  if (org.linkedin_url) update.linkedinUrl = org.linkedin_url;
  if (org.website_url) update.websiteUrl = org.website_url;
  if (org.logo_url) update.logo = org.logo_url;
  if (org.city) update.city = org.city;
  if (org.state) update.state = org.state;
  if (org.country) update.country = org.country;
  if (org.short_description) update.description = org.short_description;
  if (org.id) update.apolloId = org.id;
  if (org.annual_revenue) update.annualRevenue = String(org.annual_revenue);
  if (org.total_funding) update.totalFunding = String(org.total_funding);
  if (org.latest_funding_stage) update.lastFundingRound = org.latest_funding_stage;
  if (org.latest_funding_round_date) update.lastFundingDate = new Date(org.latest_funding_round_date);
  const updated = await prisma.company.update({ where: { domain }, data: update });
  embedCompany(updated.id, updated).catch(err =>
    console.error(`[embeddings] Auto-embed failed for ${domain}:`, err.message),
  );
  return updated;
}

async function createEnrichedCompany(domain: string): Promise<any | null> {
  const org = await enrichOrganization(domain).catch(() => null);
  if (!org || !org.name) return null;
  const enrichData = {
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
  };
  const company = await prisma.company.upsert({
    where: { domain },
    create: { domain, ...enrichData },
    update: enrichData,
  });
  embedCompany(company.id, company).catch(err =>
    console.error(`[embeddings] Auto-embed failed for ${domain}:`, err.message),
  );
  return company;
}

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
      let dbCompany = await prisma.company.findUnique({ where: { domain } });

      if (dbCompany) {
        dbCompany = await enrichCompanyIfNeeded(dbCompany, domain);
        companyData = dbCompany;
      } else {
        const created = await createEnrichedCompany(domain);
        if (created) companyData = created;
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
      email, name, title, linkedinUrl, photoUrl, headline, city, country,
      companyDomain,
    } = req.body as {
      email: string; name?: string; title?: string; linkedinUrl?: string;
      photoUrl?: string; headline?: string; city?: string; country?: string;
      companyDomain?: string;
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

    // Find or create company — Company table is Apollo-only (shared data).
    // User edits are stored on the Contact record, never on Company.
    let companyId: string | null = null;
    const domain = companyDomain?.trim().toLowerCase();
    if (domain) {
      const existing = await prisma.company.findUnique({ where: { domain } });
      if (existing) {
        const enriched = await enrichCompanyIfNeeded(existing, domain);
        companyId = enriched.id;
      } else {
        // Try to enrich from Apollo; fall back to bare record
        const enriched = await createEnrichedCompany(domain);
        if (enriched) {
          companyId = enriched.id;
        } else {
          const created = await prisma.company.upsert({
            where: { domain },
            create: { domain, name: normalizeCompanyName(domain) },
            update: {},
          });
          companyId = created.id;
        }
      }
    }

    // Create contact
    const contact = await prisma.contact.create({
      data: {
        userId,
        email: normalizedEmail,
        name: name || null,
        title: title || null,
        headline: headline || null,
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
