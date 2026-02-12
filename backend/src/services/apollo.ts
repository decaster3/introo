import prisma from '../lib/prisma.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const APOLLO_BASE = 'https://api.apollo.io/api/v1';
const ENRICHMENT_CACHE_DAYS = 30;

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

// ─── Free People Search (0 credits) ─────────────────────────────────────────

interface ApolloSearchPerson {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  headline?: string;
  linkedin_url?: string;
  photo_url?: string;
  city?: string;
  state?: string;
  country?: string;
  organization?: {
    id?: string;
    name?: string;
    website_url?: string;
    linkedin_url?: string;
    primary_domain?: string;
    estimated_num_employees?: number;
    industry?: string;
    short_description?: string;
    founded_year?: number;
    city?: string;
    state?: string;
    country?: string;
  };
}

interface ApolloSearchResponse {
  people?: ApolloSearchPerson[];
  pagination?: {
    page?: number;
    per_page?: number;
    total_entries?: number;
    total_pages?: number;
  };
}

/**
 * Free people search endpoint — does NOT consume credits.
 * Returns basic profile data (title, photo, linkedin, city, org info)
 * but does NOT return emails or phone numbers.
 */
export async function searchPeopleByDomain(
  domain: string,
  perPage: number = 100,
): Promise<ApolloSearchPerson[]> {
  const apiKey = getApiKey();
  const res = await fetch(`${APOLLO_BASE}/mixed_people/api_search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      q_organization_domains: [domain],
      per_page: perPage,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apollo mixed_people/api_search failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as ApolloSearchResponse;
  return data.people || [];
}

/**
 * Search for a specific person by name + domain (free, 0 credits).
 */
export async function searchPersonByNameAndDomain(
  name: string,
  domain: string,
): Promise<ApolloSearchPerson | null> {
  const apiKey = getApiKey();
  const res = await fetch(`${APOLLO_BASE}/mixed_people/api_search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      q_person_name: name,
      q_organization_domains: [domain],
      per_page: 1,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apollo mixed_people/api_search failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as ApolloSearchResponse;
  return data.people?.[0] || null;
}

// ─── Free batch enrichment (0 credits) ──────────────────────────────────────

export interface BatchResult {
  total: number;
  enriched: number;
  skipped: number;
  errors: number;
}

/**
 * Enrich contacts using the FREE mixed_people/api_search endpoint.
 * Groups contacts by company domain, searches all people at each domain,
 * then matches by name. Also updates basic company data from org info.
 * Costs 0 Apollo credits.
 */
export async function enrichContactsFree(
  userId: string,
  onProgress?: (result: BatchResult) => void,
): Promise<BatchResult> {
  // Get all contacts that need enrichment, with their company domain
  const contacts = await prisma.contact.findMany({
    where: { userId },
    select: { id: true, email: true, name: true, enrichedAt: true, companyId: true, company: { select: { id: true, domain: true } } },
    orderBy: { lastSeenAt: 'desc' },
  });

  const result: BatchResult = { total: contacts.length, enriched: 0, skipped: 0, errors: 0 };

  // Filter out recently enriched
  const toEnrich = contacts.filter(c => isStale(c.enrichedAt));
  result.skipped = contacts.length - toEnrich.length;

  if (toEnrich.length === 0) {
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

  // Process domain by domain using free search
  const domains = Array.from(byDomain.keys());
  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i];
    const domainContacts = byDomain.get(domain)!;

    try {
      const people = await searchPeopleByDomain(domain, 100);

      for (const contact of domainContacts) {
        // Match by name (case-insensitive fuzzy)
        const contactName = (contact.name || '').toLowerCase().trim();
        const matched = people.find(p => {
          const pName = (p.name || '').toLowerCase().trim();
          if (!pName || !contactName) return false;
          // Exact match or one contains the other
          return pName === contactName ||
            pName.includes(contactName) ||
            contactName.includes(pName);
        });

        if (matched) {
          try {
            await prisma.contact.update({
              where: { id: contact.id },
              data: {
                title: matched.title || undefined,
                headline: matched.headline || undefined,
                linkedinUrl: matched.linkedin_url || undefined,
                photoUrl: matched.photo_url || undefined,
                city: matched.city || undefined,
                state: matched.state || undefined,
                country: matched.country || undefined,
                apolloId: matched.id || undefined,
                enrichedAt: new Date(),
                name: matched.name || undefined,
              },
            });

            // Update basic company data from org info (free data)
            if (matched.organization && contact.companyId) {
              const org = matched.organization;
              await prisma.company.update({
                where: { id: contact.companyId },
                data: {
                  employeeCount: org.estimated_num_employees ?? undefined,
                  industry: org.industry ?? undefined,
                  foundedYear: org.founded_year ?? undefined,
                  linkedinUrl: org.linkedin_url ?? undefined,
                  websiteUrl: org.website_url ?? undefined,
                  city: org.city ?? undefined,
                  state: org.state ?? undefined,
                  country: org.country ?? undefined,
                  description: org.short_description ?? undefined,
                  apolloId: org.id ?? undefined,
                },
              });
            }

            result.enriched++;
          } catch (dbErr: any) {
            console.error(`Free enrich DB update ${contact.id}:`, dbErr.message);
            result.errors++;
          }
        } else {
          result.skipped++;
        }
      }
    } catch (apiErr: any) {
      console.error(`Free search for domain ${domain}:`, apiErr.message);
      result.errors += domainContacts.length;
    }

    onProgress?.(result);

    // Rate limit (be gentle even though it's free)
    if (i + 1 < domains.length) {
      await sleep(300);
    }
  }

  // Contacts without a domain can't be searched
  for (const _contact of noDomain) {
    result.skipped++;
  }

  onProgress?.(result);
  return result;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export async function getEnrichmentStats(userId: string) {
  const [totalContacts, enrichedContacts, totalCompanies, enrichedCompanies] = await Promise.all([
    prisma.contact.count({ where: { userId } }),
    prisma.contact.count({ where: { userId, enrichedAt: { not: null } } }),
    prisma.company.count({ where: { contacts: { some: { userId } } } }),
    prisma.company.count({ where: { contacts: { some: { userId } }, enrichedAt: { not: null } } }),
  ]);

  return {
    contacts: { total: totalContacts, enriched: enrichedContacts },
    companies: { total: totalCompanies, enriched: enrichedCompanies },
  };
}
