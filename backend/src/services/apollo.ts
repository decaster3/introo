import prisma from '../lib/prisma.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const APOLLO_BASE = 'https://api.apollo.io/api/v1';
const ENRICHMENT_CACHE_DAYS = 7;
const IS_DEV = process.env.NODE_ENV !== 'production';
const DEV_LIMIT_COMPANIES = 5;
const DEV_LIMIT_PEOPLE = 5;
const API_THROTTLE_MS = 200;
const FORCE_RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

function getApiKey(): string {
  const key = process.env.APOLLO_API_KEY;
  if (!key) throw new Error('APOLLO_API_KEY is not configured');
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isStale(enrichedAt: Date | null): boolean {
  if (!enrichedAt) return true;
  return Date.now() - enrichedAt.getTime() > ENRICHMENT_CACHE_DAYS * 24 * 60 * 60 * 1000;
}

// ─── Generic email detection ─────────────────────────────────────────────────

const GENERIC_PREFIXES = new Set([
  'info', 'team', 'hello', 'contact', 'support', 'admin', 'office',
  'sales', 'marketing', 'hr', 'jobs', 'careers', 'press', 'media',
  'help', 'billing', 'noreply', 'no-reply', 'notifications', 'alerts',
  'feedback', 'general', 'service', 'enquiry', 'inquiry',
]);

function isGenericEmail(email: string): boolean {
  const local = email.split('@')[0]?.toLowerCase() || '';
  if (GENERIC_PREFIXES.has(local)) return true;
  const firstPart = local.split(/[._\-+]/)[0];
  return !!(firstPart && GENERIC_PREFIXES.has(firstPart));
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface ApolloOrganization {
  id?: string;
  name?: string;
  website_url?: string;
  linkedin_url?: string;
  twitter_url?: string;
  facebook_url?: string;
  primary_domain?: string;
  estimated_num_employees?: number;
  industry?: string;
  short_description?: string;
  founded_year?: number;
  logo_url?: string;
  city?: string;
  state?: string;
  country?: string;
  annual_revenue?: number;
  total_funding?: number;
  latest_funding_round_date?: string;
  latest_funding_stage?: string;
  publicly_traded_symbol?: string;
  publicly_traded_exchange?: string;
  keywords?: string[];
}

interface ApolloMatchedPerson {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  headline?: string;
  linkedin_url?: string;
  photo_url?: string;
  twitter_url?: string;
  city?: string;
  state?: string;
  country?: string;
  organization_id?: string;
  organization?: ApolloOrganization;
  employment_history?: {
    organization_name?: string;
    title?: string;
    current?: boolean;
    start_date?: string;
  }[];
}

export interface BatchResult {
  total: number;
  enriched: number;
  skipped: number;
  errors: number;
  errorMessage?: string;
}

type CachedContact = {
  email: string;
  apolloId: string | null;
  name: string | null;
  title: string | null;
  headline: string | null;
  linkedinUrl: string | null;
  photoUrl: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
};

// ─── Apollo API wrappers ─────────────────────────────────────────────────────

/**
 * Enrich a company by domain. Returns full org data.
 * COSTS: 1 credit per call.
 */
export async function enrichOrganization(domain: string): Promise<ApolloOrganization | null> {
  const apiKey = getApiKey();
  try {
    const res = await fetch(`${APOLLO_BASE}/organizations/enrich?domain=${encodeURIComponent(domain)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      if (res.status === 422 && errBody.includes('insufficient credits')) {
        throw new Error('APOLLO_NO_CREDITS');
      }
      console.log(`[apollo] organizations/enrich ${res.status} for "${domain}"`);
      return null;
    }
    const data: any = await res.json();
    return data.organization || null;
  } catch (err: any) {
    if (err.message === 'APOLLO_NO_CREDITS') throw err;
    console.error(`[apollo] organizations/enrich error for "${domain}":`, err.message);
    return null;
  }
}

/**
 * Match a person by email. Returns full profile.
 * COSTS: 1 credit per call.
 */
async function matchPersonByEmail(email: string): Promise<ApolloMatchedPerson | null> {
  const apiKey = getApiKey();
  try {
    const res = await fetch(`${APOLLO_BASE}/people/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      if (res.status === 422 && errBody.includes('insufficient credits')) {
        throw new Error('APOLLO_NO_CREDITS');
      }
      console.log(`[apollo] people/match ${res.status} for "${email}"`);
      return null;
    }
    const data: any = await res.json();
    return data.person || null;
  } catch (err: any) {
    if (err.message === 'APOLLO_NO_CREDITS') throw err;
    console.error(`[apollo] people/match error for "${email}":`, err.message);
    return null;
  }
}

function hasRealData(person: ApolloMatchedPerson | null): boolean {
  if (!person || !person.id) return false;
  return !!(person.title || person.linkedin_url || person.photo_url || person.headline);
}

// ─── Helpers: apply cached / Apollo data to a contact ────────────────────────

function buildContactUpdate(cached: CachedContact): Record<string, any> {
  const data: Record<string, any> = { apolloId: cached.apolloId, enrichedAt: new Date() };
  if (cached.name) data.name = cached.name;
  if (cached.title) data.title = cached.title;
  if (cached.headline) data.headline = cached.headline;
  if (cached.linkedinUrl) data.linkedinUrl = cached.linkedinUrl;
  if (cached.photoUrl) data.photoUrl = cached.photoUrl;
  if (cached.city) data.city = cached.city;
  if (cached.state) data.state = cached.state;
  if (cached.country) data.country = cached.country;
  return data;
}

function buildPersonUpdate(person: ApolloMatchedPerson): Record<string, any> {
  const data: Record<string, any> = { apolloId: person.id, enrichedAt: new Date() };
  if (person.name) data.name = person.name;
  if (person.title) data.title = person.title;
  if (person.headline) data.headline = person.headline;
  if (person.linkedin_url) data.linkedinUrl = person.linkedin_url;
  if (person.photo_url) data.photoUrl = person.photo_url;
  if (person.city) data.city = person.city;
  if (person.state) data.state = person.state;
  if (person.country) data.country = person.country;
  return data;
}

async function stampEnrichedAt(contactId: string): Promise<void> {
  try {
    await prisma.contact.update({ where: { id: contactId }, data: { enrichedAt: new Date() } });
  } catch { /* ignore — contact may have been deleted */ }
}

// ─── Batch enrichment ────────────────────────────────────────────────────────

interface EnrichOptions {
  force?: boolean;
  signal?: { cancelled: boolean };
}

/**
 * Enrich contacts and companies using Apollo's paid endpoints:
 * - organizations/enrich: 1 credit per unique domain
 * - people/match: 1 credit per contact
 *
 * Default mode: only processes never-attempted contacts (enrichedAt is null).
 * Force mode: retries failed contacts after 24h cooldown + re-enriches stale data.
 * DEV mode: limits to 5 companies + 5 people.
 */
export async function enrichContactsFree(
  userId: string,
  onProgress?: (result: BatchResult) => void,
  options?: EnrichOptions,
): Promise<BatchResult> {
  const isCancelled = () => !!options?.signal?.cancelled;

  // ── 1. Load all contacts ───────────────────────────────────────────────
  const contacts = await prisma.contact.findMany({
    where: { userId },
    select: {
      id: true, email: true, name: true, enrichedAt: true, apolloId: true,
      companyId: true, company: { select: { id: true, domain: true, name: true, enrichedAt: true, apolloId: true, industry: true } },
    },
    orderBy: { lastSeenAt: 'desc' },
  });

  const result: BatchResult = { total: contacts.length, enriched: 0, skipped: 0, errors: 0 };

  // ── 2. Filter to contacts that need enrichment ─────────────────────────
  const toEnrich = options?.force
    ? contacts.filter(c => {
        if (c.apolloId && !isStale(c.enrichedAt)) return false;
        if (!c.apolloId && c.enrichedAt) {
          return Date.now() - c.enrichedAt.getTime() > FORCE_RETRY_COOLDOWN_MS;
        }
        return true;
      })
    : contacts.filter(c => !c.enrichedAt);

  result.skipped = contacts.length - toEnrich.length;

  if (IS_DEV) {
    console.log(`[enrich] ⚠️  DEV MODE: limiting to ${DEV_LIMIT_COMPANIES} companies + ${DEV_LIMIT_PEOPLE} people`);
  }
  console.log(`[enrich] userId=${userId} force=${!!options?.force} total=${contacts.length} toEnrich=${toEnrich.length} skipped=${result.skipped}`);

  if (toEnrich.length === 0) {
    console.log(`[enrich] Nothing to enrich, all contacts are fresh`);
    onProgress?.(result);
    return result;
  }

  // ── 3. Group by domain ─────────────────────────────────────────────────
  const byDomain = new Map<string, typeof toEnrich>();
  const noDomain: typeof toEnrich = [];
  for (const c of toEnrich) {
    const domain = c.company?.domain;
    if (domain) {
      const arr = byDomain.get(domain) || [];
      arr.push(c);
      byDomain.set(domain, arr);
    } else {
      noDomain.push(c);
    }
  }
  console.log(`[enrich] Grouped: ${byDomain.size} domains, ${noDomain.length} without domain`);

  // ── 4. Batch cache lookup ──────────────────────────────────────────────
  // Look up ALL previously attempted contacts (not just those with apolloId).
  // Contacts with apolloId → cache hit (copy data, 0 credits).
  // Contacts with enrichedAt but no apolloId → known no-match (skip, 0 credits).
  const allEmails = toEnrich.map(c => c.email);
  const cachedContacts = await prisma.contact.findMany({
    where: { email: { in: allEmails }, enrichedAt: { not: null } },
    select: {
      email: true, apolloId: true, name: true, title: true, headline: true,
      linkedinUrl: true, photoUrl: true, city: true, state: true, country: true,
    },
  });

  const cacheMap = new Map<string, CachedContact>();       // contacts WITH Apollo data
  const knownNoMatch = new Set<string>();                   // emails that were tried and found nothing
  for (const c of cachedContacts) {
    if (c.apolloId) {
      const existing = cacheMap.get(c.email);
      if (!existing || (c.linkedinUrl && !existing.linkedinUrl) || (c.photoUrl && !existing.photoUrl)) {
        cacheMap.set(c.email, c);
      }
    } else {
      // Previously attempted, no Apollo data found — skip without spending credits
      if (!cacheMap.has(c.email)) {
        knownNoMatch.add(c.email);
      }
    }
  }
  console.log(`[enrich] Internal cache: ${cacheMap.size} with data, ${knownNoMatch.size} known no-match`);

  // ── 5. Enrichment state ────────────────────────────────────────────────
  const enrichedCompanyIds = new Set<string>();
  let companiesEnrichedCount = 0;
  let peopleEnrichedCount = 0;
  let cacheHits = 0;
  let genericSkipped = 0;
  let outOfCredits = false;

  /**
   * Enrich a single contact. Returns true if an Apollo API call was made.
   * Shared by both domain and noDomain loops.
   */
  async function enrichContact(
    contact: typeof toEnrich[0],
  ): Promise<void> {
    // Generic email — skip
    if (isGenericEmail(contact.email)) {
      console.log(`[enrich] ⏭️ Generic email: "${contact.email}" (0 credits)`);
      await stampEnrichedAt(contact.id);
      result.skipped++;
      genericSkipped++;
      return;
    }

    // Cache hit — contact has Apollo data from another user
    const cached = cacheMap.get(contact.email);
    if (cached) {
      if (cached.apolloId === contact.apolloId) {
        await stampEnrichedAt(contact.id);
      } else {
        console.log(`[enrich] ♻️ Cache hit: "${contact.name || contact.email}" → title="${cached.title}" (0 credits)`);
        await prisma.contact.update({ where: { id: contact.id }, data: buildContactUpdate(cached) });
      }
      result.enriched++;
      cacheHits++;
      return;
    }

    // Known no-match — previously tried, Apollo had no data. Skip without spending credits.
    if (knownNoMatch.has(contact.email)) {
      console.log(`[enrich] ⏭️ Known no-match: "${contact.name || contact.email}" (0 credits)`);
      await stampEnrichedAt(contact.id);
      result.skipped++;
      cacheHits++;
      return;
    }

    // Apollo API call (1 credit)
    const person = await matchPersonByEmail(contact.email);
    if (person && hasRealData(person)) {
      console.log(`[enrich] ✓ Person "${contact.name || contact.email}" → title="${person.title}", linkedin=${person.linkedin_url ? 'yes' : 'no'} (1 credit)`);
      await prisma.contact.update({ where: { id: contact.id }, data: buildPersonUpdate(person) });
      result.enriched++;
    } else {
      console.log(`[enrich] ✗ No data: "${contact.name || contact.email}" (1 credit spent)`);
      await stampEnrichedAt(contact.id);
      result.skipped++;
    }
    peopleEnrichedCount++;
    await sleep(API_THROTTLE_MS);
  }

  // ── 6. Process contacts with domains ───────────────────────────────────
  const domains = Array.from(byDomain.keys());
  for (let i = 0; i < domains.length; i++) {
    if (isCancelled()) {
      console.log(`[enrich] ⛔ Cancelled by user — skipping remaining domains`);
      for (let j = i; j < domains.length; j++) {
        result.skipped += byDomain.get(domains[j])!.length;
      }
      break;
    }

    const domain = domains[i];
    const domainContacts = byDomain.get(domain)!;

    // Out of credits — stamp remaining and skip
    if (outOfCredits) {
      for (const c of domainContacts) { await stampEnrichedAt(c.id); }
      // Also stamp the company so it's not re-tried
      if (domainContacts[0]?.companyId && !enrichedCompanyIds.has(domainContacts[0].companyId)) {
        try { await prisma.company.update({ where: { id: domainContacts[0].companyId }, data: { enrichedAt: new Date() } }); } catch {}
        enrichedCompanyIds.add(domainContacts[0].companyId);
      }
      result.skipped += domainContacts.length;
      onProgress?.(result);
      continue;
    }

    try {
      // ── Step 1: Enrich company (1 credit per unique domain) ──────────
      const companyId = domainContacts[0]?.companyId;
      const company = domainContacts[0]?.company;
      const companyAlreadyHasData = !!(company?.apolloId || company?.industry);
      const companyNeedsEnrich = companyId
        && !enrichedCompanyIds.has(companyId)
        && !companyAlreadyHasData
        && isStale(company?.enrichedAt ?? null);

      if (companyNeedsEnrich) {
        if (IS_DEV && companiesEnrichedCount >= DEV_LIMIT_COMPANIES) {
          enrichedCompanyIds.add(companyId!);
          // Stamp enrichedAt to prevent re-trying this company on subsequent runs
          try { await prisma.company.update({ where: { id: companyId! }, data: { enrichedAt: new Date() } }); } catch {}
          console.log(`[enrich] ⏭️ DEV LIMIT: skipping company "${domain}" (stamped)`);
        } else {
          try {
            const org = await enrichOrganization(domain);
            if (org) {
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
              if (org.keywords) update.technologies = org.keywords;
              await prisma.company.update({ where: { id: companyId }, data: update });
              companiesEnrichedCount++;
              console.log(`[enrich] ✓ Company "${domain}": ${org.estimated_num_employees || '?'} employees, industry="${org.industry || '?'}" (1 credit)`);
            } else {
              await prisma.company.update({ where: { id: companyId! }, data: { enrichedAt: new Date() } });
              console.log(`[enrich] ✗ Company "${domain}": not found in Apollo`);
            }
            enrichedCompanyIds.add(companyId!);
            await sleep(API_THROTTLE_MS);
          } catch (err: any) {
            if (err.message === 'APOLLO_NO_CREDITS') {
              outOfCredits = true;
              result.errorMessage = 'Apollo credits exhausted';
              console.error(`[enrich] ⛔ Credits exhausted at company "${domain}"`);
            }
          }
        }
      }

      // ── Step 2: Enrich each contact ──────────────────────────────────
      for (const contact of domainContacts) {
        if (isCancelled()) { result.skipped++; continue; }
        if (outOfCredits) { await stampEnrichedAt(contact.id); result.skipped++; continue; }
        if (IS_DEV && peopleEnrichedCount >= DEV_LIMIT_PEOPLE) { await stampEnrichedAt(contact.id); result.skipped++; continue; }

        try {
          await enrichContact(contact);
        } catch (err: any) {
          if (err.message === 'APOLLO_NO_CREDITS') {
            outOfCredits = true;
            result.errorMessage = 'Apollo credits exhausted';
            console.error(`[enrich] ⛔ Credits exhausted at person "${contact.email}"`);
            await stampEnrichedAt(contact.id);
            result.skipped++;
          } else {
            result.errors++;
          }
        }
      }
    } catch (apiErr: any) {
      if (apiErr.message !== 'APOLLO_NO_CREDITS') {
        console.error(`[enrich] ✗ API error for domain ${domain}:`, apiErr.message);
        result.errors++;
      }
    }

    onProgress?.(result);
    if (i + 1 < domains.length) await sleep(API_THROTTLE_MS);
  }

  // ── 7. Process contacts without a domain ───────────────────────────────
  for (let ni = 0; ni < noDomain.length; ni++) {
    const contact = noDomain[ni];
    if (isCancelled()) {
      console.log(`[enrich] ⛔ Cancelled by user — skipping remaining no-domain contacts`);
      result.skipped += noDomain.length - ni;
      break;
    }
    if (outOfCredits || (IS_DEV && peopleEnrichedCount >= DEV_LIMIT_PEOPLE)) {
      await stampEnrichedAt(contact.id);
      result.skipped++;
      onProgress?.(result);
      continue;
    }

    try {
      await enrichContact(contact);
    } catch (err: any) {
      if (err.message === 'APOLLO_NO_CREDITS') {
        outOfCredits = true;
        result.errorMessage = 'Apollo credits exhausted';
      }
      await stampEnrichedAt(contact.id);
      result.skipped++;
    }
    onProgress?.(result);
  }

  // ── 8. Summary ─────────────────────────────────────────────────────────
  onProgress?.(result);
  const creditsUsed = companiesEnrichedCount + peopleEnrichedCount;
  console.log(`[enrich] DONE: enriched=${result.enriched}, skipped=${result.skipped}, errors=${result.errors}, total=${result.total}`);
  console.log(`[enrich] Credits: ~${creditsUsed} (${companiesEnrichedCount} companies + ${peopleEnrichedCount} people), cache hits: ${cacheHits}, generic skipped: ${genericSkipped}${IS_DEV ? ' [DEV]' : ''}`);
  if (outOfCredits) {
    console.error(`[enrich] ⛔ Enrichment stopped early — Apollo credits exhausted`);
  }
  return result;
}

// ─── User Profile Enrichment (1 credit) ──────────────────────────────────────

export async function enrichUserProfile(userId: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, title: true, company: true, companyDomain: true, linkedinUrl: true, headline: true, city: true, country: true },
    });
    if (!user) return;

    if (user.title && user.linkedinUrl && user.headline && user.city && user.country) {
      console.log(`[enrich-profile] User ${user.email} already has full profile, skipping`);
      return;
    }

    const person = await matchPersonByEmail(user.email);
    if (!person || !hasRealData(person)) {
      console.log(`[enrich-profile] No Apollo match for ${user.email}`);
      return;
    }

    const updateData: Record<string, any> = {};
    if (!user.title && person.title) updateData.title = person.title;
    if (!user.linkedinUrl && person.linkedin_url) updateData.linkedinUrl = person.linkedin_url;
    if (!user.headline && person.headline) updateData.headline = person.headline;
    if (!user.city && person.city) updateData.city = person.city;
    if (!user.country && person.country) updateData.country = person.country;

    if ((!user.company || !user.companyDomain) && person.employment_history?.length) {
      const current = person.employment_history.find(e => e.current);
      if (current?.organization_name) {
        if (!user.company) updateData.company = current.organization_name;
        if (!user.companyDomain) {
          const emailDomain = user.email.split('@')[1]?.toLowerCase();
          const genericDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'mail.ru', 'yandex.ru', 'protonmail.com'];
          if (emailDomain && !genericDomains.includes(emailDomain)) {
            updateData.companyDomain = emailDomain;
          }
        }
      }
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({ where: { id: userId }, data: updateData });
      console.log(`[enrich-profile] Updated ${user.email}: ${Object.keys(updateData).join(', ')} (1 credit)`);
    }
  } catch (err: any) {
    if (err.message === 'APOLLO_NO_CREDITS') {
      console.error(`[enrich-profile] Credits exhausted, skipping`);
      return;
    }
    console.error(`[enrich-profile] Error:`, err.message);
  }
}

// ─── Single company lookup (paid, 1 credit) ─────────────────────────────────

export async function enrichOrganizationFree(domain: string): Promise<ApolloOrganization | null> {
  try {
    return await enrichOrganization(domain);
  } catch {
    return null;
  }
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export async function getEnrichmentStats(userId: string) {
  const [totalContacts, contactsWithApollo, contactsProcessed, neverAttempted, totalCompanies, enrichedCompanies, lastEnrichedContact] = await Promise.all([
    prisma.contact.count({ where: { userId } }),
    prisma.contact.count({ where: { userId, apolloId: { not: null } } }),
    prisma.contact.count({ where: { userId, enrichedAt: { not: null } } }),
    prisma.contact.count({ where: { userId, enrichedAt: null } }),
    prisma.company.count({ where: { contacts: { some: { userId } } } }),
    prisma.company.count({ where: { contacts: { some: { userId } }, enrichedAt: { not: null } } }),
    prisma.contact.findFirst({
      where: { userId, enrichedAt: { not: null } },
      orderBy: { enrichedAt: 'desc' },
      select: { enrichedAt: true },
    }),
  ]);

  return {
    contacts: {
      total: totalContacts,
      enriched: contactsProcessed,
      identified: contactsWithApollo,
      notFound: contactsProcessed - contactsWithApollo,
      pending: neverAttempted,
    },
    companies: { total: totalCompanies, enriched: enrichedCompanies },
    lastEnrichedAt: lastEnrichedContact?.enrichedAt || null,
  };
}
