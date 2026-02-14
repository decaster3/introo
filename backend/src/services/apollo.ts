import prisma from '../lib/prisma.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const APOLLO_BASE = 'https://api.apollo.io/api/v1';
const ENRICHMENT_CACHE_DAYS = 7;

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
  const age = Date.now() - enrichedAt.getTime();
  return age > ENRICHMENT_CACHE_DAYS * 24 * 60 * 60 * 1000;
}

// ─── Apollo API helpers ─────────────────────────────────────────────────────

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
  sic_codes?: string[];
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
  employment_history?: {
    organization_name?: string;
    title?: string;
    current?: boolean;
    start_date?: string;
  }[];
}

interface ApolloSearchPerson {
  id?: string;
  first_name?: string;
  last_name?: string;
  last_name_obfuscated?: string;
  name?: string;
  title?: string;
  headline?: string;
  linkedin_url?: string;
  photo_url?: string;
  city?: string;
  state?: string;
  country?: string;
  has_email?: boolean;
}

/**
 * Try to extract a name from an email address.
 * e.g. "john.smith@company.com" -> "john smith"
 * e.g. "y.shevchenko@company.com" -> "y shevchenko"
 * Keeps single-character parts (initials like "y", "a", "j").
 */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] || '';
  const parts = local.split(/[._\-+]/).filter(p => p.length >= 1 && !/^\d+$/.test(p));
  if (parts.length === 0) return '';
  return parts.join(' ').toLowerCase();
}

/**
 * Check if a name string is obfuscated by Apollo's free tier.
 * Apollo masks last names like "Sh***K", "Jo***N", etc.
 */
function isObfuscatedName(name: string): boolean {
  return /\*{2,}/.test(name);
}

/**
 * Check if an Apollo person response has real enrichment data
 * (not just a placeholder ID with all fields null).
 */
function hasRealData(person: ApolloMatchedPerson | null): boolean {
  if (!person || !person.id) return false;
  return !!(person.title || person.linkedin_url || person.photo_url || person.headline);
}

// ─── Organization Enrichment (via /organizations/enrich) ────────────────────

/**
 * Enrich a company by domain using Apollo's organizations/enrich endpoint.
 * Returns full company data: industry, employee count, location, funding, etc.
 */
export async function enrichOrganization(domain: string): Promise<ApolloOrganization | null> {
  const apiKey = getApiKey();
  try {
    const res = await fetch(`${APOLLO_BASE}/organizations/enrich?domain=${encodeURIComponent(domain)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data.organization || null;
  } catch {
    return null;
  }
}

// ─── People Match (via /people/match) ───────────────────────────────────────

/**
 * Match a person by name + organization using Apollo's people/match endpoint.
 * Returns full profile: name, linkedin, photo, headline, employment history.
 */
async function matchPerson(params: {
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string;
  organization_name?: string;
  domain?: string;
}): Promise<ApolloMatchedPerson | null> {
  const apiKey = getApiKey();
  try {
    const res = await fetch(`${APOLLO_BASE}/people/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      console.log(`[apollo] people/match ${res.status} for`, params);
      return null;
    }
    const data: any = await res.json();
    const person = data.person || null;
    // Debug: log raw response keys and key fields for first few calls
    if (person) {
      console.log(`[apollo] people/match raw response keys:`, Object.keys(person).join(', '));
      console.log(`[apollo] people/match sample:`, JSON.stringify({
        id: person.id, name: person.name, first_name: person.first_name, last_name: person.last_name,
        title: person.title, headline: person.headline,
        linkedin_url: person.linkedin_url, photo_url: person.photo_url,
      }));
    }
    return person;
  } catch (err) {
    console.error(`[apollo] people/match error:`, err);
    return null;
  }
}

// ─── Free People Search (for name matching) ─────────────────────────────────

interface ApolloSearchResponse {
  people?: ApolloSearchPerson[];
}

async function searchPeopleByDomain(domain: string, perPage = 100): Promise<ApolloSearchPerson[]> {
  const apiKey = getApiKey();
  const res = await fetch(`${APOLLO_BASE}/mixed_people/api_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'x-api-key': apiKey },
    body: JSON.stringify({ q_organization_domains_list: [domain], per_page: perPage }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as ApolloSearchResponse;
  return data.people || [];
}

// ─── Batch enrichment ───────────────────────────────────────────────────────

export interface BatchResult {
  total: number;
  enriched: number;
  skipped: number;
  errors: number;
  errorMessage?: string;
}

/**
 * Enrich contacts and companies using Apollo's rich endpoints:
 * 1. organizations/enrich — full company data (industry, employees, location, funding)
 * 2. people/match — full contact data (name, photo, linkedin, headline)
 * 3. mixed_people/api_search — free fallback for name matching
 */
export async function enrichContactsFree(
  userId: string,
  onProgress?: (result: BatchResult) => void,
  options?: { force?: boolean },
): Promise<BatchResult> {
  const contacts = await prisma.contact.findMany({
    where: { userId },
    select: {
      id: true, email: true, name: true, enrichedAt: true, apolloId: true,
      companyId: true, company: { select: { id: true, domain: true, name: true, enrichedAt: true } },
    },
    orderBy: { lastSeenAt: 'desc' },
  });

  const result: BatchResult = { total: contacts.length, enriched: 0, skipped: 0, errors: 0 };

  const toEnrich = options?.force
    ? contacts // force = re-enrich ALL contacts regardless of staleness
    : contacts.filter(c => isStale(c.enrichedAt));
  result.skipped = contacts.length - toEnrich.length;

  console.log(`[enrich] userId=${userId} force=${!!options?.force} total=${contacts.length} toEnrich=${toEnrich.length} skipped=${result.skipped}`);

  if (toEnrich.length === 0) {
    console.log(`[enrich] Nothing to enrich, all contacts are fresh`);
    onProgress?.(result);
    return result;
  }

  // Group contacts by company domain
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

  // Track which company IDs we've already enriched (avoid duplicate API calls)
  const enrichedCompanyIds = new Set<string>();

  const domains = Array.from(byDomain.keys());
  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i];
    const domainContacts = byDomain.get(domain)!;

    try {
      // ── Step 1: Enrich the company via organizations/enrich ────────────
      const companyId = domainContacts[0]?.companyId;
      const companyAlreadyEnriched = companyId ? enrichedCompanyIds.has(companyId) : true;
      
      if (companyId && !companyAlreadyEnriched) {
        const org = await enrichOrganization(domain);
        if (org) {
          const companyUpdate: Record<string, any> = { enrichedAt: new Date() };
          if (org.name) companyUpdate.name = org.name;
          if (org.estimated_num_employees) companyUpdate.employeeCount = org.estimated_num_employees;
          if (org.industry) companyUpdate.industry = org.industry;
          if (org.founded_year) companyUpdate.foundedYear = org.founded_year;
          if (org.linkedin_url) companyUpdate.linkedinUrl = org.linkedin_url;
          if (org.website_url) companyUpdate.websiteUrl = org.website_url;
          if (org.logo_url) companyUpdate.logo = org.logo_url;
          if (org.city) companyUpdate.city = org.city;
          if (org.state) companyUpdate.state = org.state;
          if (org.country) companyUpdate.country = org.country;
          if (org.short_description) companyUpdate.description = org.short_description;
          if (org.id) companyUpdate.apolloId = org.id;
          if (org.annual_revenue) companyUpdate.annualRevenue = String(org.annual_revenue);
          if (org.total_funding) companyUpdate.totalFunding = String(org.total_funding);
          if (org.latest_funding_stage) companyUpdate.lastFundingRound = org.latest_funding_stage;
          if (org.latest_funding_round_date) companyUpdate.lastFundingDate = new Date(org.latest_funding_round_date);
          if (org.keywords) companyUpdate.technologies = org.keywords;

          await prisma.company.update({ where: { id: companyId }, data: companyUpdate });
          enrichedCompanyIds.add(companyId);
          console.log(`[enrich] ✓ Company "${domain}": ${org.estimated_num_employees || '?'} employees, industry="${org.industry || '?'}"`);
        } else {
          console.log(`[enrich] ✗ Company "${domain}": not found in Apollo`);
        }
        await sleep(200);
      }

      // ── Step 2: Enrich each contact ────────────────────────────────
      // people/match returns full profile data.
      // Strategy: try email first (most precise), then name + domain.
      // A match is only considered "real" if it has actual data beyond
      // just an ID (title, linkedin, or photo).
      const searchPeople = await searchPeopleByDomain(domain, 100);

      for (const contact of domainContacts) {
        const contactName = (contact.name || '').trim();
        // If the stored name is obfuscated from a previous bad enrichment, ignore it
        const cleanContactName = isObfuscatedName(contactName) ? '' : contactName;
        const emailName = nameFromEmail(contact.email);
        const searchName = cleanContactName || emailName;

        // ── Try people/match ────────────────────────────────────────
        let person: ApolloMatchedPerson | null = null;

        // 1) Try by email first — most precise match
        person = await matchPerson({ email: contact.email });
        if (!hasRealData(person)) {
          person = null;
        }

        // 2) Try by name + domain if email didn't return real data
        if (!person && searchName && searchName.length >= 2) {
          await sleep(200);
          const nameParts = searchName.split(/\s+/);
          const firstName = nameParts[0] || '';
          const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

          if (firstName && lastName) {
            person = await matchPerson({ first_name: firstName, last_name: lastName, domain });
            if (!hasRealData(person)) person = null;
          }
          if (!person && firstName) {
            await sleep(200);
            person = await matchPerson({ first_name: firstName, domain });
            if (!hasRealData(person)) person = null;
          }
          if (!person && firstName && !lastName) {
            await sleep(200);
            person = await matchPerson({ last_name: firstName, domain });
            if (!hasRealData(person)) person = null;
          }
        }

        if (person && person.id) {
          const apolloNameObfuscated = person.name ? isObfuscatedName(person.name) : false;
          console.log(`[enrich] ✓ Match "${cleanContactName || contact.email}" → name="${person.name}"${apolloNameObfuscated ? ' (obfuscated, keeping original)' : ''}, title="${person.title}", linkedin=${person.linkedin_url ? 'yes' : 'no'}, photo=${person.photo_url ? 'yes' : 'no'}`);
          try {
            const updateData: Record<string, any> = {
              apolloId: person.id,
              enrichedAt: new Date(),
            };
            if (person.name && !apolloNameObfuscated) {
              updateData.name = person.name;
            } else if (person.name && apolloNameObfuscated && !cleanContactName) {
              updateData.name = person.name;
            }
            if (person.title) updateData.title = person.title;
            if (person.headline) updateData.headline = person.headline;
            if (person.linkedin_url) updateData.linkedinUrl = person.linkedin_url;
            if (person.photo_url) updateData.photoUrl = person.photo_url;
            if (person.city) updateData.city = person.city;
            if (person.state) updateData.state = person.state;
            if (person.country) updateData.country = person.country;

            await prisma.contact.update({ where: { id: contact.id }, data: updateData });
            result.enriched++;
          } catch (dbErr: any) {
            console.error(`[enrich] DB error ${contact.id}:`, dbErr.message);
            result.errors++;
          }
        } else {
          // ── Fallback: free search (limited data) ─────────────────
          if (searchName && searchName.length >= 2) {
            const nameParts = searchName.split(/\s+/);
            const pFirst = (nameParts[0] || '').toLowerCase();
            const pLast = nameParts.length > 1 ? nameParts.slice(1).join(' ').toLowerCase() : '';
            const freeMatch = searchPeople.find(p => {
              const f = (p.first_name || '').toLowerCase();
              const l = (p.last_name || '').toLowerCase();
              if (pFirst && pLast) return f === pFirst && l === pLast;
              if (pFirst && f === pFirst) return true;
              if (pFirst && l === pFirst) return true;
              return false;
            });
            if (freeMatch && freeMatch.title) {
              console.log(`[enrich] ~ Fallback match "${cleanContactName || contact.email}" → title="${freeMatch.title}" (free search)`);
              try {
                const updateData: Record<string, any> = { enrichedAt: new Date() };
                if (freeMatch.title) updateData.title = freeMatch.title;
                if (freeMatch.id) updateData.apolloId = freeMatch.id;
                if (freeMatch.linkedin_url) updateData.linkedinUrl = freeMatch.linkedin_url;
                if (freeMatch.photo_url) updateData.photoUrl = freeMatch.photo_url;
                await prisma.contact.update({ where: { id: contact.id }, data: updateData });
                result.enriched++;
              } catch { result.errors++; }
            } else {
              console.log(`[enrich] ✗ No match: "${cleanContactName || contact.email}" @ ${domain}`);
              try {
                await prisma.contact.update({ where: { id: contact.id }, data: { enrichedAt: new Date() } });
              } catch { /* ignore */ }
              result.skipped++;
            }
          } else {
            console.log(`[enrich] ✗ No searchable name: "${contact.email}" @ ${domain}`);
            try {
              await prisma.contact.update({ where: { id: contact.id }, data: { enrichedAt: new Date() } });
            } catch { /* ignore */ }
            result.skipped++;
          }
        }

        await sleep(200); // Rate limit
      }
    } catch (apiErr: any) {
      console.error(`[enrich] ✗ API error for domain ${domain}:`, apiErr.message);
      result.errors += domainContacts.length;
    }

    onProgress?.(result);

    if (i + 1 < domains.length) {
      await sleep(200);
    }
  }

  // Contacts without a domain — try people/match by email
  for (const contact of noDomain) {
    try {
      const person = await matchPerson({ email: contact.email });
      if (person && person.id) {
        const existingName = (contact.name || '').trim();
        const apolloNameObfuscated = person.name ? isObfuscatedName(person.name) : false;
        const updateData: Record<string, any> = { apolloId: person.id, enrichedAt: new Date() };
        // Only update name if Apollo returned a clean name, or contact has no name
        if (person.name && !apolloNameObfuscated) {
          updateData.name = person.name;
        } else if (person.name && apolloNameObfuscated && !existingName) {
          updateData.name = person.name;
        }
        if (person.title) updateData.title = person.title;
        if (person.headline) updateData.headline = person.headline;
        if (person.linkedin_url) updateData.linkedinUrl = person.linkedin_url;
        if (person.photo_url) updateData.photoUrl = person.photo_url;
        if (person.city) updateData.city = person.city;
        if (person.state) updateData.state = person.state;
        if (person.country) updateData.country = person.country;
        await prisma.contact.update({ where: { id: contact.id }, data: updateData });
        result.enriched++;
      } else {
        result.skipped++;
        await prisma.contact.update({ where: { id: contact.id }, data: { enrichedAt: new Date() } });
      }
    } catch { result.skipped++; }
    await sleep(200);
  }

  onProgress?.(result);
  return result;
}

// ─── User Profile Enrichment ─────────────────────────────────────────────────

/**
 * Enrich a user's own profile from Apollo using their email.
 * Only fills in fields that are currently empty.
 */
export async function enrichUserProfile(userId: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, title: true, company: true, companyDomain: true, linkedinUrl: true, headline: true, city: true, country: true },
    });
    if (!user) return;

    // If all fields are already filled, skip
    if (user.title && user.linkedinUrl && user.headline && user.city && user.country) {
      console.log(`[enrich-profile] User ${user.email} already has full profile, skipping`);
      return;
    }

    const person = await matchPerson({ email: user.email });
    if (!person || !person.id) {
      console.log(`[enrich-profile] No Apollo match for ${user.email}`);
      return;
    }

    if (!hasRealData(person)) {
      console.log(`[enrich-profile] Apollo returned empty data for ${user.email}`);
      return;
    }

    const updateData: Record<string, any> = {};
    // Only fill empty fields — don't overwrite user-edited data
    if (!user.title && person.title) updateData.title = person.title;
    if (!user.linkedinUrl && person.linkedin_url) updateData.linkedinUrl = person.linkedin_url;
    if (!user.headline && person.headline) updateData.headline = person.headline;
    if (!user.city && person.city) updateData.city = person.city;
    if (!user.country && person.country) updateData.country = person.country;

    // Try to extract company from employment history + derive domain
    if ((!user.company || !user.companyDomain) && person.employment_history?.length) {
      const current = person.employment_history.find(e => e.current);
      if (current?.organization_name) {
        if (!user.company) updateData.company = current.organization_name;

        // Derive company domain from user's email domain (work email = company domain)
        if (!user.companyDomain) {
          const emailDomain = user.email.split('@')[1]?.toLowerCase();
          // Skip generic email providers
          const genericDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'mail.ru', 'yandex.ru', 'protonmail.com'];
          if (emailDomain && !genericDomains.includes(emailDomain)) {
            updateData.companyDomain = emailDomain;
          }
        }
      }
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({ where: { id: userId }, data: updateData });
      console.log(`[enrich-profile] Updated ${user.email}:`, Object.keys(updateData).join(', '));
    } else {
      console.log(`[enrich-profile] No new data for ${user.email}`);
    }
  } catch (err: any) {
    console.error(`[enrich-profile] Error:`, err.message);
  }
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export async function getEnrichmentStats(userId: string) {
  const [totalContacts, enrichedWithData, totalCompanies, enrichedCompanies, lastEnrichedContact] = await Promise.all([
    prisma.contact.count({ where: { userId } }),
    // Contacts that matched in Apollo (have apolloId)
    prisma.contact.count({ where: { userId, apolloId: { not: null } } }),
    prisma.company.count({ where: { contacts: { some: { userId } } } }),
    prisma.company.count({ where: { contacts: { some: { userId } }, enrichedAt: { not: null } } }),
    // Last enrichment timestamp
    prisma.contact.findFirst({
      where: { userId, enrichedAt: { not: null } },
      orderBy: { enrichedAt: 'desc' },
      select: { enrichedAt: true },
    }),
  ]);

  return {
    contacts: { total: totalContacts, enriched: enrichedWithData, notFound: totalContacts - enrichedWithData },
    companies: { total: totalCompanies, enriched: enrichedCompanies },
    lastEnrichedAt: lastEnrichedContact?.enrichedAt || null,
  };
}
