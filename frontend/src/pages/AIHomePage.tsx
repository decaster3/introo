import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAppState, useAppActions } from '../store';
import { API_BASE, enrichmentApi, calendarApi, authApi } from '../lib/api';
import { calculateStrength } from '../types';
import { PersonAvatar, CompanyLogo } from '../components';
import { openOfferIntroEmail } from '../lib/offerIntro';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseRevenueMillions(rev: string): number {
  const lower = rev.toLowerCase().replace(/[,$]/g, '');
  if (lower.includes('billion')) {
    const n = parseFloat(lower);
    return isNaN(n) ? 0 : n * 1000;
  }
  if (lower.includes('million')) {
    const n = parseFloat(lower);
    return isNaN(n) ? 0 : n;
  }
  // Try parsing as raw number (could be in various formats)
  const n = parseFloat(lower);
  return isNaN(n) ? 0 : n;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface SpaceCompany {
  id: string;
  domain: string;
  name: string;
  industry?: string;
  contactCount: number;
  spaceId?: string;
  contacts: {
    id: string; name: string; email: string; title?: string;
    userId: string; userName: string; spaceId?: string;
  }[];
}

interface Space {
  id: string;
  name: string;
  emoji: string;
  memberCount?: number;
  description?: string | null;
  inviteCode?: string;
  ownerId?: string;
  members?: { id: string; role: string; user: { id: string; name: string; email: string; avatar: string | null } }[];
}

interface PendingSpace {
  id: string;
  name: string;
  emoji: string;
  isPrivate: boolean;
  membershipId: string;
  appliedAt: string;
}

interface PendingMember {
  id: string;
  userId: string;
  user: { id: string; name: string; email: string; avatar: string | null };
}

interface DirectConnection {
  id: string;
  status: 'pending' | 'accepted' | 'rejected';
  direction: 'sent' | 'received';
  createdAt: string;
  peer: { id: string; name: string; email: string; avatar: string | null };
}

interface ConnectionCompany {
  id: string;
  domain: string;
  name: string;
  industry?: string | null;
  contactCount: number;
  connectionId: string;
  contacts: {
    id: string; name: string; email: string; title?: string;
    userId: string; userName: string; connectionId?: string;
  }[];
}

interface DisplayContact {
  id: string; name: string; email: string; title: string;
  company: string; companyDomain: string;
  lastSeenAt: string; meetingsCount: number;
  connectionStrength: 'strong' | 'medium' | 'weak';
  linkedinUrl?: string | null;
  photoUrl?: string | null;
  city?: string | null;
  country?: string | null;
  headline?: string | null;
  enrichedAt?: string | null;
  // Company enrichment (passed through for tile rendering)
  companyData?: {
    id?: string;
    employeeCount?: number | null;
    foundedYear?: number | null;
    annualRevenue?: string | null;
    totalFunding?: string | null;
    lastFundingRound?: string | null;
    city?: string | null;
    country?: string | null;
    industry?: string | null;
    description?: string | null;
    linkedinUrl?: string | null;
    enrichedAt?: string | null;
  };
}

interface MergedCompany {
  id?: string; // DB company id for deep enrichment
  domain: string;
  name: string;
  myContacts: DisplayContact[];
  spaceContacts: { id: string; name: string; email: string; title?: string; userName: string; spaceId?: string }[];
  myCount: number;
  spaceCount: number;
  totalCount: number;
  hasStrongConnection: boolean;
  bestStrength: 'strong' | 'medium' | 'weak' | 'none';
  source: 'mine' | 'space' | 'both';
  matchingHunts: string[];
  spaceIds: string[];
  connectionIds: string[];
  // Enrichment data
  employeeCount?: number | null;
  foundedYear?: number | null;
  annualRevenue?: string | null;
  totalFunding?: string | null;
  lastFundingRound?: string | null;
  city?: string | null;
  country?: string | null;
  industry?: string | null;
  description?: string | null;
  linkedinUrl?: string | null;
  enrichedAt?: string | null;
}

interface Hunt {
  id: string;
  title: string;
  keywords: string[];
  isActive: boolean;
}

interface InlinePanel {
  type: 'person' | 'intro-request' | 'intro-offer' | 'company' | 'space' | 'spaces-manage' | 'connection' | 'connections-manage' | 'network-manage' | 'settings';
  company?: MergedCompany;
  contact?: DisplayContact | { id: string; name: string; email: string; title?: string; userName?: string };
  spaceId?: string;
  connectionId?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AIHomePage() {
  const { currentUser, contacts: storeContacts, isCalendarConnected } = useAppState();
  const { logout, syncCalendar } = useAppActions();
  const searchRef = useRef<HTMLInputElement>(null);

  // UI State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedHunt, setSelectedHunt] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'mine' | 'spaces' | 'both'>('all');
  const [strengthFilter, setStrengthFilter] = useState<'all' | 'strong' | 'medium' | 'weak'>('all');
  const [spaceFilter, setSpaceFilter] = useState<string>('all');
  const [connectionFilter, setConnectionFilter] = useState<string>('all');
  const [sortBy] = useState<'relevance' | 'contacts' | 'name' | 'strength'>('relevance');
  const [gridPage, setGridPage] = useState(0);
  const GRID_PAGE_SIZE = 50;
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const [inlinePanel, setInlinePanel] = useState<InlinePanel | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // AI search state
  const [aiParsing, setAiParsing] = useState(false);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);

  // Space management state
  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const [showJoinSpace, setShowJoinSpace] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [newSpaceEmoji, setNewSpaceEmoji] = useState('🫛');
  const [joinCode, setJoinCode] = useState('');
  const [joinStatus, setJoinStatus] = useState<{ type: 'success' | 'error' | 'pending'; message: string } | null>(null);

  // Connection management state
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [connectEmail, setConnectEmail] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);

  // Calendar state
  const [calendarSyncing, setCalendarSyncing] = useState(false);
  const [lastCalendarSync, setLastCalendarSync] = useState<string | null>(null);

  // Enrichment state
  const [enriching, setEnriching] = useState(false);
  const [autoEnrichTriggered, setAutoEnrichTriggered] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState<{
    contacts: { total: number; enriched: number; skipped: number; errors: number; done: boolean } | null;
    companies: { total: number; enriched: number; skipped: number; errors: number; done: boolean } | null;
    contactsFree?: { total: number; enriched: number; skipped: number; errors: number; done: boolean } | null;
  }>({ contacts: null, companies: null });
  const [enrichStats, setEnrichStats] = useState<{
    contacts: { total: number; enriched: number };
    companies: { total: number; enriched: number };
  } | null>(null);

  // Sidebar filter section open/closed state
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    source: true,
    strength: true,
    description: false,
    employees: false,
    location: false,
    funding: false,
    founded: false,
    revenue: false,
    hiring: false,
    technologies: false,
    traffic: false,
  });

  // Sidebar filter values (live filters)
  const [sidebarFilters, setSidebarFilters] = useState({
    description: '',
    categories: [] as string[],
    excludeKeywords: '',
    employeeRanges: [] as string[],
    country: '',
    city: '',
    fundingRounds: [] as string[],
    fundingRecency: 'any' as 'any' | '6m' | '1y',
    foundedFrom: '',
    foundedTo: '',
    revenueRanges: [] as string[],
    isHiring: false,
    technologies: [] as string[],
  });

  const toggleSection = useCallback((key: string) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const toggleCategory = useCallback((cat: string) => {
    setSidebarFilters(prev => ({
      ...prev,
      categories: prev.categories.includes(cat)
        ? prev.categories.filter(c => c !== cat)
        : [...prev.categories, cat],
    }));
  }, []);

  const toggleFundingRound = useCallback((round: string) => {
    setSidebarFilters(prev => ({
      ...prev,
      fundingRounds: prev.fundingRounds.includes(round)
        ? prev.fundingRounds.filter(r => r !== round)
        : [...prev.fundingRounds, round],
    }));
  }, []);

  // Data
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [spaceCompanies, setSpaceCompanies] = useState<SpaceCompany[]>([]);
  const [pendingSpaces, setPendingSpaces] = useState<PendingSpace[]>([]);
  const [pendingMembers, setPendingMembers] = useState<Record<string, PendingMember[]>>({});
  const [connections, setConnections] = useState<DirectConnection[]>([]);
  const [connectionCompanies, setConnectionCompanies] = useState<ConnectionCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [hunts, setHunts] = useState<Hunt[]>([
    { id: '1', title: 'CTO at Series A Fintech', keywords: ['cto', 'chief technology', 'fintech'], isActive: true },
  ]);

  // ─── Data transforms ────────────────────────────────────────────────────────

  const contacts: DisplayContact[] = useMemo(() => {
    return storeContacts.filter(c => c.isApproved).map(c => ({
      id: c.id,
      name: c.name || c.email.split('@')[0],
      email: c.email,
      title: c.title || c.headline || '',
      company: c.company?.name || '',
      companyDomain: c.company?.domain || c.email.split('@')[1] || '',
      lastSeenAt: c.lastSeenAt,
      meetingsCount: c.meetingsCount,
      connectionStrength: calculateStrength(c.lastSeenAt, c.meetingsCount),
      linkedinUrl: c.linkedinUrl,
      photoUrl: c.photoUrl,
      city: c.city,
      country: c.country,
      headline: c.headline,
      enrichedAt: c.enrichedAt,
      companyData: c.company ? {
        id: c.company.id,
        employeeCount: c.company.employeeCount,
        foundedYear: c.company.foundedYear,
        annualRevenue: c.company.annualRevenue,
        totalFunding: c.company.totalFunding,
        lastFundingRound: c.company.lastFundingRound,
        city: c.company.city,
        country: c.company.country,
        industry: c.company.industry,
        description: c.company.description,
        linkedinUrl: c.company.linkedinUrl,
        enrichedAt: c.company.enrichedAt,
      } : undefined,
    }));
  }, [storeContacts]);

  // Merge my network + space network into unified view
  const mergedCompanies = useMemo((): MergedCompany[] => {
    const map = new Map<string, MergedCompany>();

    const strengthOrder = { strong: 0, medium: 1, weak: 2, none: 3 };

    // My contacts
    contacts.forEach(c => {
      const d = c.companyDomain || 'unknown';
      if (!map.has(d)) {
        map.set(d, {
          domain: d, name: c.company || d,
          myContacts: [], spaceContacts: [],
          myCount: 0, spaceCount: 0, totalCount: 0,
          hasStrongConnection: false, bestStrength: 'none',
          source: 'mine', matchingHunts: [], spaceIds: [], connectionIds: [],
        });
      }
      const co = map.get(d)!;
      co.myContacts.push(c);
      // Carry enrichment data from the first contact's company
      if (c.companyData && !co.enrichedAt) {
        co.id = c.companyData.id;
        co.employeeCount = c.companyData.employeeCount;
        co.foundedYear = c.companyData.foundedYear;
        co.annualRevenue = c.companyData.annualRevenue;
        co.totalFunding = c.companyData.totalFunding;
        co.lastFundingRound = c.companyData.lastFundingRound;
        co.city = c.companyData.city;
        co.country = c.companyData.country;
        co.industry = c.companyData.industry;
        co.description = c.companyData.description;
        co.linkedinUrl = c.companyData.linkedinUrl;
        co.enrichedAt = c.companyData.enrichedAt;
      }
      co.myCount++;
      co.totalCount++;
      if (c.connectionStrength === 'strong') co.hasStrongConnection = true;
      if (strengthOrder[c.connectionStrength] < strengthOrder[co.bestStrength]) {
        co.bestStrength = c.connectionStrength;
      }
    });

    // Space contacts
    spaceCompanies.forEach(sc => {
      if (!map.has(sc.domain)) {
        map.set(sc.domain, {
          domain: sc.domain, name: sc.name,
          myContacts: [], spaceContacts: [],
          myCount: 0, spaceCount: 0, totalCount: 0,
          hasStrongConnection: false, bestStrength: 'none',
          source: 'space', matchingHunts: [], spaceIds: [], connectionIds: [],
        });
      }
      const co = map.get(sc.domain)!;
      sc.contacts.forEach(contact => {
        if (!co.spaceContacts.some(ec => ec.email === contact.email) &&
            !co.myContacts.some(mc => mc.email === contact.email)) {
          co.spaceContacts.push({ ...contact, spaceId: contact.spaceId });
          co.spaceCount++;
          co.totalCount++;
        }
        if (contact.spaceId && !co.spaceIds.includes(contact.spaceId)) {
          co.spaceIds.push(contact.spaceId);
        }
      });
      if (co.myCount > 0 && co.spaceCount > 0) co.source = 'both';
      else if (co.spaceCount > 0 && co.myCount === 0) co.source = 'space';
    });

    // 1-1 Connection contacts (merge like space contacts)
    connectionCompanies.forEach(cc => {
      if (!map.has(cc.domain)) {
        map.set(cc.domain, {
          domain: cc.domain, name: cc.name,
          myContacts: [], spaceContacts: [],
          myCount: 0, spaceCount: 0, totalCount: 0,
          hasStrongConnection: false, bestStrength: 'none',
          source: 'space', matchingHunts: [], spaceIds: [], connectionIds: [],
        });
      }
      const co = map.get(cc.domain)!;
      if (!co.connectionIds.includes(cc.connectionId)) {
        co.connectionIds.push(cc.connectionId);
      }
      cc.contacts.forEach(contact => {
        if (!co.spaceContacts.some(ec => ec.email === contact.email) &&
            !co.myContacts.some(mc => mc.email === contact.email)) {
          co.spaceContacts.push({ ...contact, spaceId: undefined });
          co.spaceCount++;
          co.totalCount++;
        }
      });
      if (co.myCount > 0 && co.spaceCount > 0) co.source = 'both';
      else if (co.spaceCount > 0 && co.myCount === 0) co.source = 'space';
    });

    // Match hunts
    const companies = Array.from(map.values());
    companies.forEach(co => {
      hunts.forEach(hunt => {
        const allText = [
          co.name, co.domain,
          co.description || '', co.industry || '',
          co.city || '', co.country || '',
          co.lastFundingRound || '', co.annualRevenue || '',
          ...co.myContacts.map(c => `${c.title} ${c.name}`),
          ...co.spaceContacts.map(c => `${c.title || ''} ${c.name}`),
        ].join(' ').toLowerCase();

        if (hunt.keywords.some(k => allText.includes(k))) {
          co.matchingHunts.push(hunt.id);
        }
      });
    });

    return companies.sort((a, b) => {
      // Both > mine > space, then by strong > count
      const sourceOrder = { both: 0, mine: 1, space: 2 };
      if (sourceOrder[a.source] !== sourceOrder[b.source]) return sourceOrder[a.source] - sourceOrder[b.source];
      if (a.hasStrongConnection !== b.hasStrongConnection) return a.hasStrongConnection ? -1 : 1;
      return b.totalCount - a.totalCount;
    });
  }, [contacts, spaceCompanies, connectionCompanies, hunts]);

  // Filter by search + active hunt + source + strength + space + sort
  const filteredCompanies = useMemo(() => {
    let result = mergedCompanies;
    const sf = sidebarFilters;

    // Filter by source
    if (sourceFilter === 'mine') {
      result = result.filter(c => c.myCount > 0);
    } else if (sourceFilter === 'spaces') {
      result = result.filter(c => c.spaceCount > 0);
    } else if (sourceFilter === 'both') {
      result = result.filter(c => c.source === 'both');
    }

    // Filter by connection strength
    if (strengthFilter !== 'all') {
      result = result.filter(c =>
        c.myContacts.some(mc => mc.connectionStrength === strengthFilter)
      );
    }

    // Filter by specific space
    if (spaceFilter !== 'all') {
      result = result.filter(c => c.spaceIds.includes(spaceFilter));
    }

    // Filter by specific connection
    if (connectionFilter !== 'all') {
      result = result.filter(c => c.connectionIds.includes(connectionFilter));
    }

    // Filter by active hunt
    if (selectedHunt) {
      result = result.filter(c => c.matchingHunts.includes(selectedHunt));
    }

    // Filter by search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.domain.toLowerCase().includes(q) ||
        c.myContacts.some(contact => contact.name.toLowerCase().includes(q) || contact.title.toLowerCase().includes(q)) ||
        c.spaceContacts.some(contact => contact.name.toLowerCase().includes(q) || (contact.title || '').toLowerCase().includes(q))
      );
    }

    // ── Business description / categories / exclude ──
    if (sf.description) {
      const q = sf.description.toLowerCase();
      result = result.filter(c =>
        (c.description && c.description.toLowerCase().includes(q)) ||
        (c.industry && c.industry.toLowerCase().includes(q)) ||
        c.name.toLowerCase().includes(q)
      );
    }
    if (sf.categories.length > 0) {
      result = result.filter(c => {
        const text = [c.description, c.industry, c.name].filter(Boolean).join(' ').toLowerCase();
        return sf.categories.some(cat => text.includes(cat.toLowerCase()));
      });
    }
    if (sf.excludeKeywords) {
      const excludes = sf.excludeKeywords.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
      if (excludes.length > 0) {
        result = result.filter(c => {
          const text = [c.description, c.industry, c.name].filter(Boolean).join(' ').toLowerCase();
          return !excludes.some(ex => text.includes(ex));
        });
      }
    }

    // ── Employee count ──
    if (sf.employeeRanges.length > 0) {
      result = result.filter(c => {
        if (!c.employeeCount) return false;
        const emp = c.employeeCount;
        return sf.employeeRanges.some(range => {
          if (range === '5000+') return emp >= 5000;
          const [min, max] = range.split('-').map(Number);
          return emp >= min && emp <= max;
        });
      });
    }

    // ── Location ──
    if (sf.country) {
      result = result.filter(c => c.country === sf.country);
    }
    if (sf.city) {
      const cityQ = sf.city.toLowerCase();
      result = result.filter(c => c.city && c.city.toLowerCase().includes(cityQ));
    }

    // ── Funding round ──
    if (sf.fundingRounds.length > 0) {
      result = result.filter(c => {
        const round = (c.lastFundingRound || '').toLowerCase();
        return sf.fundingRounds.some(fr => {
          if (fr === 'no-funding') return !c.lastFundingRound && !c.totalFunding;
          if (fr === 'pre-seed') return round.includes('pre') || round.includes('seed') || round.includes('angel');
          if (fr === 'series-a') return round.includes('series_a') || round === 'a' || round.includes('series a');
          if (fr === 'series-b') {
            return round.includes('series_b') || round.includes('series_c') || round.includes('series_d') ||
                   round.includes('series_e') || round.includes('series b') || round.includes('series c') ||
                   round.includes('series d') || round.includes('series e') ||
                   round === 'b' || round === 'c' || round === 'd' || round === 'e';
          }
          return false;
        });
      });
    }

    // ── Funding recency ── (placeholder - will activate when lastFundingDate is on MergedCompany)

    // ── Founded year ──
    if (sf.foundedFrom) {
      const from = parseInt(sf.foundedFrom);
      result = result.filter(c => c.foundedYear && c.foundedYear >= from);
    }
    if (sf.foundedTo) {
      const to = parseInt(sf.foundedTo);
      result = result.filter(c => c.foundedYear && c.foundedYear <= to);
    }

    // ── Revenue ──
    if (sf.revenueRanges.length > 0) {
      result = result.filter(c => {
        if (!c.annualRevenue) return false;
        const rev = c.annualRevenue.toLowerCase();
        return sf.revenueRanges.some(range => {
          if (range === '100m+') return rev.includes('billion') || (rev.includes('million') && parseRevenueMillions(rev) >= 100);
          if (range === '0-1m') return parseRevenueMillions(rev) < 1;
          if (range === '1-10m') { const m = parseRevenueMillions(rev); return m >= 1 && m < 10; }
          if (range === '10-50m') { const m = parseRevenueMillions(rev); return m >= 10 && m < 50; }
          if (range === '50-100m') { const m = parseRevenueMillions(rev); return m >= 50 && m < 100; }
          return false;
        });
      });
    }

    // ── Technologies ──
    if (sf.technologies.length > 0) {
      result = result.filter(c => {
        // Technologies not yet on MergedCompany - search description as fallback
        const text = (c.description || '').toLowerCase();
        return sf.technologies.some(tech => text.includes(tech.toLowerCase()));
      });
    }

    // Sort
    if (sortBy !== 'relevance') {
      result = [...result].sort((a, b) => {
        if (sortBy === 'name') return a.name.localeCompare(b.name);
        if (sortBy === 'contacts') return b.totalCount - a.totalCount;
        if (sortBy === 'strength') {
          const order = { strong: 0, medium: 1, weak: 2, none: 3 };
          return order[a.bestStrength] - order[b.bestStrength];
        }
        return 0;
      });
    }

    return result;
  }, [mergedCompanies, selectedHunt, searchQuery, sourceFilter, strengthFilter, spaceFilter, connectionFilter, sortBy, sidebarFilters]);

  // When filtering by a connection or space, split into "new to you" and "overlap"
  const { networkUnique, networkOverlap } = useMemo(() => {
    if (connectionFilter === 'all' && spaceFilter === 'all') return { networkUnique: [], networkOverlap: [] };
    const unique: MergedCompany[] = [];
    const overlap: MergedCompany[] = [];
    filteredCompanies.forEach(c => {
      if (c.myCount > 0) overlap.push(c);
      else unique.push(c);
    });
    return { networkUnique: unique, networkOverlap: overlap };
  }, [filteredCompanies, connectionFilter, spaceFilter]);

  // Reset page when filters change
  useEffect(() => { setGridPage(0); }, [filteredCompanies.length]);

  // Hunt match counts
  // Dynamic country list from enriched data
  const availableCountries = useMemo(() => {
    const counts: Record<string, number> = {};
    mergedCompanies.forEach(c => {
      if (c.country) counts[c.country] = (counts[c.country] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [mergedCompanies]);

  // Chip counts for employee ranges
  const employeeRangeCounts = useMemo(() => {
    const ranges = [
      { value: '1-10', min: 1, max: 10 },
      { value: '11-50', min: 11, max: 50 },
      { value: '51-200', min: 51, max: 200 },
      { value: '201-500', min: 201, max: 500 },
      { value: '501-1000', min: 501, max: 1000 },
      { value: '1000-5000', min: 1000, max: 5000 },
      { value: '5000+', min: 5000, max: Infinity },
    ];
    const counts: Record<string, number> = {};
    ranges.forEach(r => {
      counts[r.value] = mergedCompanies.filter(c =>
        c.employeeCount && c.employeeCount >= r.min && (r.max === Infinity || c.employeeCount <= r.max)
      ).length;
    });
    return counts;
  }, [mergedCompanies]);

  // Chip counts for revenue ranges
  const revenueRangeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    ['0-1m', '1-10m', '10-50m', '50-100m', '100m+'].forEach(range => {
      counts[range] = mergedCompanies.filter(c => {
        if (!c.annualRevenue) return false;
        const rev = c.annualRevenue.toLowerCase();
        const m = parseRevenueMillions(rev);
        if (range === '0-1m') return m < 1;
        if (range === '1-10m') return m >= 1 && m < 10;
        if (range === '10-50m') return m >= 10 && m < 50;
        if (range === '50-100m') return m >= 50 && m < 100;
        if (range === '100m+') return m >= 100;
        return false;
      }).length;
    });
    return counts;
  }, [mergedCompanies]);

  // Chip counts for funding rounds
  const fundingRoundCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    ['no-funding', 'pre-seed', 'series-a', 'series-b'].forEach(fr => {
      counts[fr] = mergedCompanies.filter(c => {
        const round = (c.lastFundingRound || '').toLowerCase();
        if (fr === 'no-funding') return !c.lastFundingRound && !c.totalFunding;
        if (fr === 'pre-seed') return round.includes('pre') || round.includes('seed') || round.includes('angel');
        if (fr === 'series-a') return round.includes('series_a') || round === 'a' || round.includes('series a');
        if (fr === 'series-b') {
          return round.includes('series_b') || round.includes('series_c') || round.includes('series_d') ||
                 round.includes('series_e') || round.includes('series b') || round.includes('series c') ||
                 round.includes('series d') || round.includes('series e') ||
                 round === 'b' || round === 'c' || round === 'd' || round === 'e';
        }
        return false;
      }).length;
    });
    return counts;
  }, [mergedCompanies]);

  const huntMatchCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    hunts.forEach(h => {
      counts[h.id] = mergedCompanies.filter(c => c.matchingHunts.includes(h.id)).length;
    });
    return counts;
  }, [hunts, mergedCompanies]);

  // Count active filters
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (sourceFilter !== 'all') n++;
    if (strengthFilter !== 'all') n++;
    if (spaceFilter !== 'all') n++;
    if (connectionFilter !== 'all') n++;
    if (selectedHunt) n++;
    const sf = sidebarFilters;
    if (sf.description) n++;
    if (sf.categories.length > 0) n++;
    if (sf.excludeKeywords) n++;
    if (sf.employeeRanges.length > 0) n++;
    if (sf.country) n++;
    if (sf.city) n++;
    if (sf.fundingRounds.length > 0) n++;
    if (sf.fundingRecency !== 'any') n++;
    if (sf.foundedFrom) n++;
    if (sf.foundedTo) n++;
    if (sf.revenueRanges.length > 0) n++;
    if (sf.technologies.length > 0) n++;
    return n;
  }, [sourceFilter, strengthFilter, spaceFilter, connectionFilter, selectedHunt, sidebarFilters]);

  const clearAllFilters = useCallback(() => {
    setSourceFilter('all');
    setStrengthFilter('all');
    setSpaceFilter('all');
    setConnectionFilter('all');
    setSelectedHunt(null);
    setGridPage(0);
    setAiExplanation(null);
    setSidebarFilters({
      description: '',
      categories: [],
      excludeKeywords: '',
      employeeRanges: [],
      country: '',
      city: '',
      fundingRounds: [],
      fundingRecency: 'any',
      foundedFrom: '',
      foundedTo: '',
      revenueRanges: [],
      isHiring: false,
      technologies: [],
    });
  }, []);

  // Stats
  const stats = useMemo(() => ({
    myCompanies: mergedCompanies.filter(c => c.source === 'mine' || c.source === 'both').length,
    spaceCompanies: mergedCompanies.filter(c => c.source === 'space' || c.source === 'both').length,
    overlap: mergedCompanies.filter(c => c.source === 'both').length,
    total: mergedCompanies.length,
    strongTies: contacts.filter(c => c.connectionStrength === 'strong').length,
  }), [mergedCompanies, contacts]);

  // Signals (derived)
  // ─── Data fetching ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (spaces.length === 0) return;
    Promise.all(
      spaces.map(s =>
        fetch(`${API_BASE}/api/spaces/${s.id}/reach`, { credentials: 'include' })
          .then(r => r.ok ? r.json() : { companies: [] }).catch(() => ({ companies: [] }))
          .then(r => ({ spaceId: s.id, companies: r.companies || [] }))
      )
    ).then(results => {
      const all: SpaceCompany[] = [];
      results.forEach(({ spaceId, companies }) => {
        (companies as SpaceCompany[]).forEach((c) => {
          // Tag each contact with its spaceId
          c.contacts.forEach(ct => { ct.spaceId = spaceId; });
          c.spaceId = spaceId;
          all.push(c);
        });
      });
      setSpaceCompanies(all);
    });
  }, [spaces]);

  // ─── Connections data fetching ──────────────────────────────────────────────

  const fetchConnectionsList = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/connections`, { credentials: 'include' });
      const data = await res.json();
      if (Array.isArray(data)) setConnections(data);
    } catch (e) { console.error('Failed to fetch connections:', e); }
  }, []);

  useEffect(() => {
    fetchConnectionsList();
  }, [fetchConnectionsList]);

  // Fetch reach for accepted connections
  useEffect(() => {
    const accepted = connections.filter(c => c.status === 'accepted');
    if (accepted.length === 0) { setConnectionCompanies([]); return; }

    Promise.all(
      accepted.map(c =>
        fetch(`${API_BASE}/api/connections/${c.id}/reach`, { credentials: 'include' })
          .then(r => r.ok ? r.json() : { companies: [] }).catch(() => ({ companies: [] }))
          .then(r => ({ connectionId: c.id, companies: (r.companies || []) as ConnectionCompany[] }))
      )
    ).then(results => {
      const map = new Map<string, ConnectionCompany>();
      results.forEach(({ connectionId, companies }) => {
        companies.forEach(c => {
          c.connectionId = connectionId;
          c.contacts.forEach(ct => { ct.connectionId = connectionId; });
          if (!map.has(c.domain)) {
            map.set(c.domain, c);
          } else {
            const ex = map.get(c.domain)!;
            const emails = new Set(ex.contacts.map(x => x.email));
            c.contacts.forEach(x => { if (!emails.has(x.email)) { ex.contacts.push(x); ex.contactCount++; } });
          }
        });
      });
      setConnectionCompanies(Array.from(map.values()));
    });
  }, [connections]);

  // ─── Keyboard ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setInlinePanel(null);
        setSearchQuery('');
        setSelectedHunt(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ─── Actions ────────────────────────────────────────────────────────────────

  const toggleHunt = useCallback((huntId: string) => {
    setSelectedHunt(prev => prev === huntId ? null : huntId);
    setExpandedDomain(null);
  }, []);

  const addHunt = useCallback(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 3) return;
    const keywords = searchQuery.toLowerCase().split(/[\s,]+/).filter(k => k.length > 2);
    setHunts(prev => [...prev, {
      id: Date.now().toString(),
      title: searchQuery.trim(),
      keywords,
      isActive: true,
    }]);
    setSearchQuery('');
  }, [searchQuery]);

  // AI-powered search: parse natural language into structured filters
  const aiSearch = useCallback(async (query: string) => {
    setAiParsing(true);
    setAiExplanation(null);
    try {
      const res = await fetch(`${API_BASE}/api/ai/parse-query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          query,
          availableCountries: availableCountries.map(c => c.name),
          availableSpaces: spaces.map(s => s.name),
        }),
      });

      if (!res.ok) throw new Error('AI parse failed');
      const data = await res.json();
      const { filters, semanticKeywords, explanation } = data;

      // Clear existing filters first, then apply AI-parsed ones
      setConnectionFilter('all');
      setSelectedHunt(null);
      setGridPage(0);

      // Apply structured filters
      if (filters.sourceFilter && filters.sourceFilter !== 'all') {
        setSourceFilter(filters.sourceFilter);
      } else {
        setSourceFilter('all');
      }

      if (filters.strengthFilter && filters.strengthFilter !== 'all') {
        setStrengthFilter(filters.strengthFilter);
      } else {
        setStrengthFilter('all');
      }

      // Match space by name
      if (filters.spaceFilter) {
        const matched = spaces.find(s => s.name.toLowerCase().includes(filters.spaceFilter.toLowerCase()));
        setSpaceFilter(matched ? matched.id : 'all');
      } else {
        setSpaceFilter('all');
      }

      setSidebarFilters(prev => ({
        ...prev,
        description: filters.description || '',
        categories: [],
        excludeKeywords: '',
        employeeRanges: filters.employeeRanges || [],
        country: filters.country || '',
        city: filters.city || '',
        fundingRounds: filters.fundingRounds || [],
        fundingRecency: 'any',
        foundedFrom: filters.foundedFrom || '',
        foundedTo: filters.foundedTo || '',
        revenueRanges: filters.revenueRanges || [],
        technologies: [],
      }));

      // Pin semantic keywords as an enhanced hunt
      if (semanticKeywords && semanticKeywords.length > 0) {
        const huntId = Date.now().toString();
        setHunts(prev => [...prev, {
          id: huntId,
          title: query.trim(),
          keywords: semanticKeywords.map((k: string) => k.toLowerCase()),
          isActive: true,
        }]);
        setSelectedHunt(huntId);
      }

      setSearchQuery('');
      setAiExplanation(explanation || null);

      // Auto-dismiss explanation after 8 seconds
      if (explanation) {
        setTimeout(() => setAiExplanation(null), 8000);
      }
    } catch (e) {
      console.error('AI search failed, falling back to keyword search:', e);
      // Fallback: use existing addHunt behavior
      const keywords = query.toLowerCase().split(/[\s,]+/).filter(k => k.length > 2);
      if (keywords.length > 0) {
        const huntId = Date.now().toString();
        setHunts(prev => [...prev, {
          id: huntId,
          title: query.trim(),
          keywords,
          isActive: true,
        }]);
        setSelectedHunt(huntId);
      }
      setSearchQuery('');
    } finally {
      setAiParsing(false);
    }
  }, [availableCountries, spaces]);

  const removeHunt = useCallback((id: string) => {
    setHunts(prev => prev.filter(h => h.id !== id));
    if (selectedHunt === id) setSelectedHunt(null);
  }, [selectedHunt]);

  const openIntroPanel = useCallback((company: MergedCompany) => {
    setInlinePanel({ type: 'intro-request', company });
  }, []);

  const openPersonPanel = useCallback((contact: DisplayContact | { id: string; name: string; email: string; title?: string; userName?: string }, company?: MergedCompany) => {
    setInlinePanel({ type: 'person', contact, company });
  }, []);

  const handleOfferIntro = useCallback((contact: { email: string; name: string }, companyName: string) => {
    openOfferIntroEmail({
      requesterEmail: contact.email,
      requesterName: contact.name,
      targetCompany: companyName,
      senderName: currentUser?.name,
    });
  }, [currentUser]);

  // ─── Space management ──────────────────────────────────────────────────────

  const fetchSpacesList = useCallback(async () => {
    try {
      const [spacesRes, pendingRes] = await Promise.all([
        fetch(`${API_BASE}/api/spaces`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/spaces/my-pending`, { credentials: 'include' }),
      ]);
      const data = await spacesRes.json();
      const pendingData = await pendingRes.json().catch(() => []);
      if (Array.isArray(data)) {
        const spacesList = data.map((s: any) => ({
          id: s.id, name: s.name, emoji: s.emoji,
          memberCount: s.members?.length || 0,
          description: s.description,
          inviteCode: s.inviteCode,
          ownerId: s.ownerId,
          members: s.members,
        }));
        setSpaces(spacesList);

        // Fetch pending members for spaces I own
        const ownedSpaces = spacesList.filter((s: Space) => s.ownerId === currentUser?.id);
        if (ownedSpaces.length > 0) {
          const pendingResults = await Promise.all(
            ownedSpaces.map((s: Space) =>
              fetch(`${API_BASE}/api/spaces/${s.id}/pending`, { credentials: 'include' })
                .then(r => r.ok ? r.json() : [])
                .then(members => ({ spaceId: s.id, members: members as PendingMember[] }))
                .catch(() => ({ spaceId: s.id, members: [] as PendingMember[] }))
            )
          );
          const pm: Record<string, PendingMember[]> = {};
          pendingResults.forEach(r => { if (r.members.length > 0) pm[r.spaceId] = r.members; });
          setPendingMembers(pm);
        } else {
          setPendingMembers({});
        }
      }
      if (Array.isArray(pendingData)) setPendingSpaces(pendingData);
    } catch (e) { console.error('Failed to fetch spaces:', e); }
  }, [currentUser?.id]);

  useEffect(() => {
    setLoading(true);
    fetchSpacesList().finally(() => setLoading(false));
  }, [fetchSpacesList]);

  // Refresh spaces & pending members every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => { fetchSpacesList(); }, 30000);
    return () => clearInterval(interval);
  }, [fetchSpacesList]);

  const createSpace = useCallback(async () => {
    if (!newSpaceName.trim()) return;
    try {
      await fetch(`${API_BASE}/api/spaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newSpaceName, emoji: newSpaceEmoji }),
      });
      setNewSpaceName('');
      setNewSpaceEmoji('🫛');
      setShowCreateSpace(false);
      fetchSpacesList();
    } catch (e) { console.error('Failed to create space:', e); }
  }, [newSpaceName, newSpaceEmoji, fetchSpacesList]);

  const joinSpace = useCallback(async () => {
    if (!joinCode.trim()) return;
    setJoinStatus(null);
    try {
      const res = await fetch(`${API_BASE}/api/spaces/join/${joinCode.trim()}`, {
        method: 'POST', credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.pending) {
          setJoinStatus({ type: 'pending', message: 'Request sent! Waiting for owner approval.' });
        } else {
          setJoinStatus({ type: 'success', message: 'Joined successfully!' });
        }
        setJoinCode('');
        fetchSpacesList();
        setTimeout(() => { setJoinStatus(null); setShowJoinSpace(false); }, 2000);
      } else {
        setJoinStatus({ type: 'error', message: data.error || 'Failed to join space' });
      }
    } catch (e) {
      console.error('Failed to join space:', e);
      setJoinStatus({ type: 'error', message: 'Network error. Please try again.' });
    }
  }, [joinCode, fetchSpacesList]);

  const copyInviteCode = useCallback((code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  }, []);

  const leaveSpace = useCallback(async (spaceId: string) => {
    try {
      await fetch(`${API_BASE}/api/spaces/${spaceId}/leave`, {
        method: 'POST', credentials: 'include',
      });
      fetchSpacesList();
    } catch (e) { console.error('Failed to leave space:', e); }
  }, [fetchSpacesList]);

  const inviteMemberToSpace = useCallback(async (spaceId: string, email: string) => {
    try {
      await fetch(`${API_BASE}/api/spaces/${spaceId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });
      fetchSpacesList();
    } catch (e) { console.error('Failed to invite member:', e); }
  }, [fetchSpacesList]);

  const approveSpaceMember = useCallback(async (spaceId: string, memberId: string) => {
    try {
      await fetch(`${API_BASE}/api/spaces/${spaceId}/members/${memberId}/approve`, {
        method: 'POST', credentials: 'include',
      });
      fetchSpacesList();
    } catch (e) { console.error('Failed to approve member:', e); }
  }, [fetchSpacesList]);

  const rejectSpaceMember = useCallback(async (spaceId: string, memberId: string) => {
    try {
      await fetch(`${API_BASE}/api/spaces/${spaceId}/members/${memberId}/reject`, {
        method: 'POST', credentials: 'include',
      });
      fetchSpacesList();
    } catch (e) { console.error('Failed to reject member:', e); }
  }, [fetchSpacesList]);

  // ─── Connection management ─────────────────────────────────────────────────

  const sendConnectionRequest = useCallback(async (email: string) => {
    if (!email.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to send connection request');
        return;
      }
      setConnectEmail('');
      setShowConnectForm(false);
      fetchConnectionsList();
    } catch (e) { console.error('Failed to send connection:', e); }
  }, [fetchConnectionsList]);

  const acceptConnection = useCallback(async (id: string) => {
    try {
      await fetch(`${API_BASE}/api/connections/${id}/accept`, { method: 'POST', credentials: 'include' });
      fetchConnectionsList();
    } catch (e) { console.error('Failed to accept connection:', e); }
  }, [fetchConnectionsList]);

  const rejectConnection = useCallback(async (id: string) => {
    try {
      await fetch(`${API_BASE}/api/connections/${id}/reject`, { method: 'POST', credentials: 'include' });
      fetchConnectionsList();
    } catch (e) { console.error('Failed to reject connection:', e); }
  }, [fetchConnectionsList]);

  const removeConnection = useCallback(async (id: string) => {
    try {
      await fetch(`${API_BASE}/api/connections/${id}`, { method: 'DELETE', credentials: 'include' });
      fetchConnectionsList();
    } catch (e) { console.error('Failed to remove connection:', e); }
  }, [fetchConnectionsList]);

  // ─── Enrichment ─────────────────────────────────────────────────────────────

  // Fetch enrichment stats on mount
  useEffect(() => {
    enrichmentApi.getStatus()
      .then(setEnrichStats)
      .catch(() => {});
  }, []);

  // Poll progress when enrichment is running
  useEffect(() => {
    if (!enriching) return;
    const interval = setInterval(() => {
      enrichmentApi.getProgress()
        .then(progress => {
          setEnrichProgress(progress);
          const contactsDone = !progress.contacts || progress.contacts.done;
          const companiesDone = !progress.companies || progress.companies.done;
          const contactsFreeDone = !progress.contactsFree || progress.contactsFree.done;
          if (contactsDone && companiesDone && contactsFreeDone) {
            setEnriching(false);
            // Refresh stats
            enrichmentApi.getStatus().then(setEnrichStats).catch(() => {});
          }
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [enriching]);

  // Start FREE enrichment (0 credits) — safe to run anytime
  const startEnrichment = useCallback(async () => {
    if (enriching) return;
    setEnriching(true);
    setEnrichProgress({ contacts: null, companies: null });
    try {
      await enrichmentApi.enrichContactsFree();
    } catch (err) {
      console.error('Failed to start free enrichment:', err);
      setEnriching(false);
    }
  }, [enriching]);

  // Auto-enrich once per week (check localStorage timestamp)
  useEffect(() => {
    if (autoEnrichTriggered || enriching) return;
    if (!enrichStats) return;
    setAutoEnrichTriggered(true);

    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const lastRun = localStorage.getItem('pods_last_enrich');
    const lastRunTime = lastRun ? parseInt(lastRun, 10) : 0;
    const elapsed = Date.now() - lastRunTime;

    if (elapsed >= WEEK_MS && enrichStats.contacts.enriched < enrichStats.contacts.total) {
      localStorage.setItem('pods_last_enrich', String(Date.now()));
      startEnrichment();
    }
  }, [enrichStats, autoEnrichTriggered, enriching, startEnrichment]);

  // Fetch calendar last sync time
  useEffect(() => {
    calendarApi.getStatus()
      .then(status => { setLastCalendarSync(status.lastSyncedAt); })
      .catch(() => {});
  }, []);

  // Calendar sync handler
  const handleCalendarSync = useCallback(async () => {
    if (calendarSyncing) return;
    setCalendarSyncing(true);
    try {
      await syncCalendar();
      const status = await calendarApi.getStatus();
      setLastCalendarSync(status.lastSyncedAt);
    } catch (err) {
      console.error('Calendar sync failed:', err);
    } finally {
      setCalendarSyncing(false);
    }
  }, [calendarSyncing, syncCalendar]);

  // ─── Sidebar section helper ────────────────────────────────────────────────

  const SidebarSection = useCallback(({ id, icon, title, children }: {
    id: string; icon: string; title: string; children: React.ReactNode;
  }) => (
    <div className={`sb-section ${openSections[id] ? 'open' : ''}`}>
      <button className="sb-section-header" onClick={() => toggleSection(id)}>
        <span className="sb-section-icon">{icon}</span>
        <span className="sb-section-title">{title}</span>
        <svg className="sb-section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {openSections[id] && <div className="sb-section-body">{children}</div>}
    </div>
  ), [openSections, toggleSection]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="u-root">
      <div className="u-ambient" />

      <div className="u-layout">
        {/* ═══════ LEFT SIDEBAR ═══════ */}
        <aside className={`sb ${sidebarOpen ? 'open' : 'closed'}`}>
          <div className="sb-header">
            <span className="sb-header-title">Filters</span>
            {activeFilterCount > 0 && (
              <button className="sb-clear" onClick={clearAllFilters}>
                Clear all ({activeFilterCount})
              </button>
            )}
            <button className="sb-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d={sidebarOpen ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
              </svg>
            </button>
          </div>
          <div className="sb-scroll">
            {/* ── Spaces ── */}
            <SidebarSection id="source" icon="📂" title="Source">
              {/* All / Mine / Network / Overlap chips */}
              <div className="sb-chips">
                {([
                  { key: 'all', label: 'All', count: stats.total },
                  { key: 'mine', label: 'Mine', count: stats.myCompanies },
                  { key: 'spaces', label: 'Network', count: stats.spaceCompanies },
                  { key: 'both', label: 'Overlap', count: stats.overlap },
                ] as const).map(f => (
                  <button
                    key={f.key}
                    className={`sb-chip ${sourceFilter === f.key ? 'active' : ''}`}
                    onClick={() => { setSourceFilter(f.key); setSpaceFilter('all'); setConnectionFilter('all'); }}
                  >
                    {f.label} <span className="sb-chip-count">{f.count}</span>
                  </button>
                ))}
              </div>

              {/* Per-space filter pills */}
              {spaces.length > 0 && (
                <div className="sb-spaces-list" style={{ marginTop: '0.5rem' }}>
                  {spaces.map(s => (
                    <button
                      key={s.id}
                      className={`sb-space-pill ${spaceFilter === s.id ? 'active' : ''}`}
                      onClick={() => { setSpaceFilter(spaceFilter === s.id ? 'all' : s.id); setSourceFilter('all'); setConnectionFilter('all'); }}
                      onDoubleClick={() => setInlinePanel({ type: 'space', spaceId: s.id })}
                      title={`${s.name} — ${s.memberCount || 0} members. Double-click for details.`}
                    >
                      <span className="sb-space-emoji">{s.emoji}</span>
                      <span className="sb-space-name">{s.name}</span>
                      <span className="sb-space-count">{s.memberCount || 0}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Connections pills */}
              {connections.filter(c => c.status === 'accepted').length > 0 && (
                <div className="sb-spaces-list" style={{ marginTop: '0.35rem' }}>
                  {connections.filter(c => c.status === 'accepted').map(c => (
                    <button
                      key={c.id}
                      className={`sb-space-pill ${connectionFilter === c.id ? 'active' : ''}`}
                      onClick={() => { setConnectionFilter(connectionFilter === c.id ? 'all' : c.id); setSpaceFilter('all'); setSourceFilter('all'); }}
                      onDoubleClick={() => setInlinePanel({ type: 'connection', connectionId: c.id })}
                      title={`${c.peer.name} — ${c.peer.email}. Double-click for details.`}
                    >
                      <PersonAvatar email={c.peer.email} name={c.peer.name} avatarUrl={c.peer.avatar} size={20} />
                      <span className="sb-space-name">{c.peer.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Pending connection requests */}
              {connections.filter(c => c.status === 'pending' && c.direction === 'received').length > 0 && (
                <div className="sb-spaces-list" style={{ marginTop: '0.35rem' }}>
                  {connections.filter(c => c.status === 'pending' && c.direction === 'received').map(c => (
                    <div key={c.id} className="sb-conn-pending">
                      <PersonAvatar email={c.peer.email} name={c.peer.name} avatarUrl={c.peer.avatar} size={20} />
                      <span className="sb-space-name" style={{ flex: 1 }}>{c.peer.name}</span>
                      <button className="sb-space-action-btn primary" style={{ fontSize: '0.6rem', padding: '0.15rem 0.35rem' }} onClick={() => acceptConnection(c.id)}>Accept</button>
                      <button className="sb-space-action-btn" style={{ fontSize: '0.6rem', padding: '0.15rem 0.35rem' }} onClick={() => rejectConnection(c.id)}>×</button>
                    </div>
                  ))}
                </div>
              )}

            </SidebarSection>

            {/* ── Business description ── */}
            <SidebarSection id="description" icon="🔍" title="Business description">
              <input
                className="sb-input"
                placeholder="e.g. real estate agency"
                value={sidebarFilters.description}
                onChange={e => setSidebarFilters(p => ({ ...p, description: e.target.value }))}
              />
              <div className="sb-chips">
                {['B2B', 'SaaS', 'Tech company', 'Startup', 'Merchant', 'Digital', 'AI'].map(cat => (
                  <label key={cat} className="sb-checkbox-chip">
                    <input
                      type="checkbox"
                      checked={sidebarFilters.categories.includes(cat)}
                      onChange={() => toggleCategory(cat)}
                    />
                    <span>{cat}</span>
                  </label>
                ))}
              </div>
              <details className="sb-details">
                <summary>Exclude keywords</summary>
                <input
                  className="sb-input"
                  placeholder="e.g. agencies, consulting"
                  value={sidebarFilters.excludeKeywords}
                  onChange={e => setSidebarFilters(p => ({ ...p, excludeKeywords: e.target.value }))}
                />
              </details>
            </SidebarSection>

            {/* ── Strength (existing filter) ── */}
            <SidebarSection id="strength" icon="💪" title="Connection strength">
              <div className="sb-chips">
                {([
                  { key: 'all', label: 'Any' },
                  { key: 'strong', label: 'Strong' },
                  { key: 'medium', label: 'Medium' },
                  { key: 'weak', label: 'Weak' },
                ] as const).map(f => (
                  <button
                    key={f.key}
                    className={`sb-chip sb-chip--strength-${f.key} ${strengthFilter === f.key ? 'active' : ''}`}
                    onClick={() => setStrengthFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </SidebarSection>

            {/* ── Employee count ── */}
            <SidebarSection id="employees" icon="👥" title="Employee count">
              <div className="sb-chips">
                {[
                  { label: '1-10', value: '1-10' },
                  { label: '11-50', value: '11-50' },
                  { label: '51-200', value: '51-200' },
                  { label: '201-500', value: '201-500' },
                  { label: '501-1K', value: '501-1000' },
                  { label: '1K-5K', value: '1000-5000' },
                  { label: '5K+', value: '5000+' },
                ].map(r => {
                  const cnt = employeeRangeCounts[r.value] || 0;
                  return (
                  <label key={r.value} className={`sb-chip ${sidebarFilters.employeeRanges.includes(r.value) ? 'active' : ''} ${cnt === 0 ? 'sb-chip--empty' : ''}`}>
                    <input
                      type="checkbox"
                      checked={sidebarFilters.employeeRanges.includes(r.value)}
                      onChange={() => setSidebarFilters(p => ({
                        ...p,
                        employeeRanges: p.employeeRanges.includes(r.value)
                          ? p.employeeRanges.filter(x => x !== r.value)
                          : [...p.employeeRanges, r.value],
                      }))}
                      style={{ display: 'none' }}
                    />
                    {r.label} <span className="sb-chip-count">{cnt}</span>
                  </label>
                  );
                })}
              </div>
            </SidebarSection>

            {/* ── Location ── */}
            <SidebarSection id="location" icon="📍" title="Location">
              <label className="sb-field-label">Country</label>
              <select
                className="sb-select"
                value={sidebarFilters.country}
                onChange={e => setSidebarFilters(p => ({ ...p, country: e.target.value }))}
              >
                <option value="">Any country</option>
                {availableCountries.map(c => (
                  <option key={c.name} value={c.name}>{c.name} ({c.count})</option>
                ))}
              </select>
              <label className="sb-field-label">City / Region</label>
              <input
                className="sb-input"
                placeholder="e.g. San Francisco, London..."
                value={sidebarFilters.city}
                onChange={e => setSidebarFilters(p => ({ ...p, city: e.target.value }))}
              />
            </SidebarSection>

            {/* ── Funding ── */}
            <SidebarSection id="funding" icon="💰" title="Funding">
              <label className="sb-field-label">Last round</label>
              <div className="sb-checkboxes">
                {[
                  { key: 'no-funding', label: 'No funding' },
                  { key: 'pre-seed', label: 'Pre-Seed / Seed' },
                  { key: 'series-a', label: 'Series A' },
                  { key: 'series-b', label: 'Series B+' },
                ].map(r => (
                  <label key={r.key} className="sb-checkbox">
                    <input
                      type="checkbox"
                      checked={sidebarFilters.fundingRounds.includes(r.key)}
                      onChange={() => toggleFundingRound(r.key)}
                    />
                    <span>{r.label} <span className="sb-chip-count">{fundingRoundCounts[r.key] || 0}</span></span>
                  </label>
                ))}
              </div>
              <label className="sb-field-label">Last round date</label>
              <div className="sb-radios">
                {[
                  { key: 'any', label: 'Any time' },
                  { key: '6m', label: '< 6 months ago' },
                  { key: '1y', label: '< 1 year ago' },
                ].map(r => (
                  <label key={r.key} className="sb-radio">
                    <input
                      type="radio"
                      name="funding-recency"
                      checked={sidebarFilters.fundingRecency === r.key}
                      onChange={() => setSidebarFilters(p => ({ ...p, fundingRecency: r.key as typeof p.fundingRecency }))}
                    />
                    <span>{r.label}</span>
                  </label>
                ))}
              </div>
            </SidebarSection>

            {/* ── Founded ── */}
            <SidebarSection id="founded" icon="📅" title="Founded">
              <div className="sb-year-row">
                <div className="sb-year-field">
                  <label className="sb-field-label">From</label>
                  <select
                    className="sb-select"
                    value={sidebarFilters.foundedFrom}
                    onChange={e => setSidebarFilters(p => ({ ...p, foundedFrom: e.target.value }))}
                  >
                    <option value="">Year</option>
                    {Array.from({ length: 30 }, (_, i) => 2026 - i).map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <span className="sb-year-sep">–</span>
                <div className="sb-year-field">
                  <label className="sb-field-label">To</label>
                  <select
                    className="sb-select"
                    value={sidebarFilters.foundedTo}
                    onChange={e => setSidebarFilters(p => ({ ...p, foundedTo: e.target.value }))}
                  >
                    <option value="">Year</option>
                    {Array.from({ length: 30 }, (_, i) => 2026 - i).map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="sb-chips sb-chips--quick">
                <button className="sb-chip" onClick={() => setSidebarFilters(p => ({ ...p, foundedFrom: '2025', foundedTo: '' }))}>Last year</button>
                <button className="sb-chip" onClick={() => setSidebarFilters(p => ({ ...p, foundedFrom: '2023', foundedTo: '' }))}>3+ years</button>
                <button className="sb-chip" onClick={() => setSidebarFilters(p => ({ ...p, foundedFrom: '2016', foundedTo: '' }))}>10+ years</button>
              </div>
            </SidebarSection>

            {/* ── Annual Revenue ── */}
            {Object.values(revenueRangeCounts).some(c => c > 0) && (
            <SidebarSection id="revenue" icon="💵" title="Annual Revenue">
              <div className="sb-chips">
                {[
                  { label: '<$1M', value: '0-1m' },
                  { label: '$1-10M', value: '1-10m' },
                  { label: '$10-50M', value: '10-50m' },
                  { label: '$50-100M', value: '50-100m' },
                  { label: '$100M+', value: '100m+' },
                ].map(r => {
                  const cnt = revenueRangeCounts[r.value] || 0;
                  return (
                  <label key={r.value} className={`sb-chip ${sidebarFilters.revenueRanges.includes(r.value) ? 'active' : ''} ${cnt === 0 ? 'sb-chip--empty' : ''}`}>
                    <input
                      type="checkbox"
                      checked={sidebarFilters.revenueRanges.includes(r.value)}
                      onChange={() => setSidebarFilters(p => ({
                        ...p,
                        revenueRanges: p.revenueRanges.includes(r.value)
                          ? p.revenueRanges.filter(x => x !== r.value)
                          : [...p.revenueRanges, r.value],
                      }))}
                      style={{ display: 'none' }}
                    />
                    {r.label} <span className="sb-chip-count">{cnt}</span>
                  </label>
                  );
                })}
              </div>
            </SidebarSection>
            )}

            {/* ── Technologies (search company descriptions) ── */}
            <SidebarSection id="technologies" icon="⚙️" title="Technologies">
              <input
                className="sb-input"
                placeholder="e.g. React, Python, AWS..."
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val && !sidebarFilters.technologies.includes(val)) {
                      setSidebarFilters(p => ({ ...p, technologies: [...p.technologies, val] }));
                      (e.target as HTMLInputElement).value = '';
                    }
                  }
                }}
              />
              {sidebarFilters.technologies.length > 0 && (
                <div className="sb-chips">
                  {sidebarFilters.technologies.map(t => (
                    <span key={t} className="sb-chip active">
                      {t}
                      <button
                        className="sb-chip-x"
                        onClick={() => setSidebarFilters(p => ({ ...p, technologies: p.technologies.filter(x => x !== t) }))}
                      >×</button>
                    </span>
                  ))}
                </div>
              )}
            </SidebarSection>
          </div>
        </aside>

        {/* Sidebar reopen strip (always rendered when closed) */}
        {!sidebarOpen && (
          <button className="sb-reopen" onClick={() => setSidebarOpen(true)} title="Show filters">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m9 18 6-6-6-6" />
            </svg>
            <span className="sb-reopen-label">Filters</span>
          </button>
        )}

        {/* ═══════ MAIN CONTENT ═══════ */}
        <div className={`u-canvas ${inlinePanel ? 'has-panel' : ''}`}>
          {/* ── Top Bar ─────────────────────────────────────────── */}
          <header className="u-topbar">
            <a className="u-logo" href="/home" title="Introo">
              <span className="u-logo-mark">introo</span>
            </a>
            <div className={`u-omni ${searchFocused ? 'focused' : ''}`}>
              <div className="u-omni-pills">
                {hunts.map(h => (
                  <button
                    key={h.id}
                    className={`u-hunt-pill ${selectedHunt === h.id ? 'active' : ''} ${(huntMatchCounts[h.id] || 0) > 0 ? 'has-matches' : ''}`}
                    onClick={() => toggleHunt(h.id)}
                  >
                    <span className="u-hunt-pill-text">{h.title}</span>
                    {(huntMatchCounts[h.id] || 0) > 0 && (
                      <span className="u-hunt-pill-count">{huntMatchCounts[h.id]}</span>
                    )}
                    <button className="u-hunt-pill-x" onClick={(e) => { e.stopPropagation(); removeHunt(h.id); }}>×</button>
                  </button>
                ))}
              </div>
              <div className="u-omni-input-row">
                <svg className="u-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  ref={searchRef}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  placeholder={aiParsing ? 'Parsing with AI...' : hunts.length > 0 ? 'Refine or add a hunt...' : 'Search with AI: "fintech startups in NYC, 50+ people"'}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && searchQuery.trim().length > 2 && !aiParsing) {
                      aiSearch(searchQuery.trim());
                    }
                  }}
                  disabled={aiParsing}
                />
                {aiParsing && (
                  <span className="u-omni-loading">
                    <span className="u-spinner-sm" /> AI parsing...
                  </span>
                )}
                {searchQuery && !aiParsing && (
                  <button className="u-omni-pin" title="Pin as keyword hunt (no AI)" onMouseDown={e => { e.preventDefault(); addHunt(); }}>📌</button>
                )}
                {searchQuery && (
                  <button className="u-search-clear" onClick={() => setSearchQuery('')}>×</button>
                )}
                <kbd className="u-kbd">⌘K</kbd>
              </div>
            </div>

            <div className="u-topbar-right">
              {!sidebarOpen && (
                <button className="u-action-btn u-filter-toggle" onClick={() => setSidebarOpen(true)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 6h16M4 12h10M4 18h6" />
                  </svg>
                  Filters
                  {activeFilterCount > 0 && <span className="u-filter-toggle-badge">{activeFilterCount}</span>}
                </button>
              )}
              <button
                className={`u-network-btn ${inlinePanel?.type === 'network-manage' ? 'active' : ''}`}
                onClick={() => setInlinePanel(inlinePanel?.type === 'network-manage' ? null : { type: 'network-manage' })}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/>
                  <path d="M12 8v4M8.5 16.5 10 14M15.5 16.5 14 14"/>
                </svg>
                Network
              </button>
              {enriching && (
                <span className="u-topbar-enriching" title="Auto-enriching contacts...">
                  <span className="u-enrich-spinner" /> Enriching...
                </span>
              )}
              <button
                className={`u-action-btn u-settings-btn ${inlinePanel?.type === 'settings' ? 'active' : ''}`}
                onClick={() => setInlinePanel(inlinePanel?.type === 'settings' ? null : { type: 'settings' })}
                title="Settings"
              >
                ⚙
              </button>
            </div>
          </header>



          {/* ── Fast Filters ──────────────────────────────────── */}
          <div className="u-fast-filters">
            <div className="u-fast-group">
              {([
                { key: 'all', label: 'All', count: stats.total },
                { key: 'mine', label: 'Mine', count: stats.myCompanies, icon: '👤' },
                { key: 'spaces', label: 'Spaces', count: stats.spaceCompanies, icon: '🌐' },
                { key: 'both', label: 'Overlap', count: stats.overlap, icon: '⚡' },
              ] as const).map(f => (
                <button
                  key={f.key}
                  className={`u-ff-chip ${sourceFilter === f.key ? 'active' : ''} u-ff-chip--${f.key}`}
                  onClick={() => setSourceFilter(f.key)}
                >
                  {'icon' in f && f.icon && <span className="u-ff-icon">{f.icon}</span>}
                  <span>{f.label}</span>
                  <span className="u-ff-count">{f.count}</span>
                </button>
              ))}
            </div>
            <span className="u-ff-sep" />
            <div className="u-fast-group">
              {([
                { key: 'all', label: 'Any' },
                { key: 'strong', label: 'Strong' },
                { key: 'medium', label: 'Medium' },
                { key: 'weak', label: 'Weak' },
              ] as const).map(f => (
                <button
                  key={f.key}
                  className={`u-ff-chip u-ff-chip--str-${f.key} ${strengthFilter === f.key ? 'active' : ''}`}
                  onClick={() => setStrengthFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {activeFilterCount > 0 && (
              <>
                <span className="u-ff-sep" />
                <button className="u-ff-clear" onClick={clearAllFilters}>
                  Clear {activeFilterCount}
                </button>
              </>
            )}
          </div>

          {/* ── AI explanation banner ─────────────────────────── */}
          {aiExplanation && (
            <div className="u-ai-banner">
              <span className="u-ai-banner-icon">AI</span>
              <span className="u-ai-banner-text">{aiExplanation}</span>
              <button className="u-ai-banner-dismiss" onClick={() => setAiExplanation(null)}>×</button>
            </div>
          )}

          {/* ── Results bar ────────────────────────────────────── */}
          <div className="u-results-bar">
            <span className="u-results-count">
              <strong>{filteredCompanies.length}</strong> companies
              {filteredCompanies.length !== mergedCompanies.length && (
                <span className="u-results-of"> of {mergedCompanies.length}</span>
              )}
            </span>
            {activeFilterCount > 0 && (
              <button className="u-filters-clear" onClick={clearAllFilters}>
                Clear {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
              </button>
            )}
          </div>

          {/* ── Company Grid ──────────────────────────────────── */}
          <div className="u-grid">
            {loading ? (
              <div className="u-grid-loading"><div className="u-spinner" /> Loading...</div>
            ) : filteredCompanies.length === 0 ? (
              <div className="u-grid-empty">
                <span className="u-grid-empty-icon">{searchQuery || selectedHunt ? '🔍' : '📅'}</span>
                <span>{searchQuery ? `No results for "${searchQuery}"` : selectedHunt ? 'No matches for this hunt' : 'Connect your calendar to get started'}</span>
                {!searchQuery && !selectedHunt && (
                  <button onClick={() => setInlinePanel({ type: 'settings' })}>Connect Calendar</button>
                )}
              </div>
            ) : (() => {
              const renderCard = (company: MergedCompany) => (
                <div
                  key={company.domain}
                  className={[
                    'u-tile',
                    expandedDomain === company.domain ? 'expanded' : '',
                    company.source === 'both' ? 'u-tile--overlap' : '',
                    company.matchingHunts.length > 0 ? 'u-tile--hunt-match' : '',
                  ].filter(Boolean).join(' ')}
                >
                  {company.matchingHunts.length > 0 && (
                    <div className="u-tile-hunt-tags">
                      {company.matchingHunts.map(hId => {
                        const h = hunts.find(x => x.id === hId);
                        return h ? <span key={hId} className="u-tile-hunt-tag">{h.title} ⚡</span> : null;
                      })}
                    </div>
                  )}
                  <div
                    className="u-tile-header"
                    onClick={() => {
                      setInlinePanel({ type: 'company', company });
                    }}
                  >
                    <CompanyLogo domain={company.domain} name={company.name} size={28} />
                    <div className="u-tile-info">
                      <span className="u-tile-name">{company.name}</span>
                    </div>
                    <div className="u-tile-actions" onClick={e => e.stopPropagation()}>
                      {company.spaceCount > 0 && (
                        <button className="u-tile-btn u-tile-btn--intro" onClick={() => openIntroPanel(company)}>Intro</button>
                      )}
                    </div>
                  </div>
                  <div className="u-tile-badges" onClick={() => setInlinePanel({ type: 'company', company })}>
                    <span className="u-tile-meta-badge u-tile-meta-badge--mine">👤 {company.myCount}</span>
                    {company.spaceCount > 0 && <span className="u-tile-meta-badge u-tile-meta-badge--space">🌐 {company.spaceCount}</span>}
                    {company.hasStrongConnection && <span className="u-tile-strong">●</span>}
                    {company.employeeCount ? <span className="u-tile-meta-badge u-tile-meta-badge--enrich">{company.employeeCount.toLocaleString()} emp</span> : null}
                    {company.country ? <span className="u-tile-meta-badge u-tile-meta-badge--enrich">{company.city ? `${company.city}, ` : ''}{company.country}</span> : null}
                    {company.lastFundingRound ? <span className="u-tile-meta-badge u-tile-meta-badge--funding">{company.lastFundingRound}</span> : null}
                  </div>
                  {expandedDomain === company.domain && (
                    <div className="u-tile-body">
                      {company.myContacts.length > 0 && (
                        <>
                          <div className="u-tile-section-label u-tile-section-label--mine">
                            <span className="u-tile-section-icon">👤</span> My contacts ({company.myContacts.length})
                          </div>
                          {company.myContacts.slice(0, 4).map(c => (
                            <div key={c.id} className="u-contact" onClick={() => openPersonPanel(c, company)}>
                              <PersonAvatar email={c.email} name={c.name} avatarUrl={c.photoUrl} size={24} />
                              <div className="u-contact-info">
                                <span className="u-contact-name">{c.name}</span>
                                <span className="u-contact-title">{c.title || c.email}</span>
                              </div>
                              <span className={`u-strength u-strength--${c.connectionStrength}`}>{c.connectionStrength}</span>
                              {c.linkedinUrl && (
                                <a className="u-contact-action u-contact-li" href={c.linkedinUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title="LinkedIn">in</a>
                              )}
                              <button className="u-contact-action" onClick={(e) => { e.stopPropagation(); handleOfferIntro(c, company.name); }}>✉</button>
                            </div>
                          ))}
                          {company.myContacts.length > 4 && (
                            <div className="u-tile-more">+{company.myContacts.length - 4} more of yours</div>
                          )}
                        </>
                      )}
                      {company.spaceContacts.length > 0 && (
                        <>
                          <div className="u-tile-section-label u-tile-section-label--space">
                            <span className="u-tile-section-icon">🌐</span> Via network ({company.spaceContacts.length})
                          </div>
                          {company.spaceContacts.slice(0, 4).map(c => (
                            <div key={c.id} className="u-contact u-contact--space" onClick={() => openPersonPanel(c, company)}>
                              <PersonAvatar email={c.email} name={c.name} size={24} />
                              <div className="u-contact-info">
                                <span className="u-contact-name">{c.name}</span>
                                <span className="u-contact-title">{c.title || 'Contact'} <span className="u-via">via {c.userName}</span></span>
                              </div>
                              <button className="u-contact-action" onClick={(e) => { e.stopPropagation(); openIntroPanel(company); }}>Intro</button>
                            </div>
                          ))}
                          {company.spaceContacts.length > 4 && (
                            <div className="u-tile-more">+{company.spaceContacts.length - 4} more from network</div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );

              // When filtered by a connection or space, show sectioned view
              if (connectionFilter !== 'all' || spaceFilter !== 'all') {
                let sectionLabel = '';
                if (connectionFilter !== 'all') {
                  const connPeer = connections.find(c => c.id === connectionFilter)?.peer;
                  sectionLabel = `${connPeer?.name || 'Connection'}'s network`;
                } else {
                  const space = spaces.find(s => s.id === spaceFilter);
                  sectionLabel = `New from ${space?.name || 'space'}`;
                }
                return (
                  <>
                    {networkUnique.length > 0 && (
                      <>
                        <div className="u-grid-section-header">
                          <span className="u-grid-section-title">{sectionLabel}</span>
                          <span className="u-grid-section-count">{networkUnique.length}</span>
                        </div>
                        {networkUnique.map(renderCard)}
                      </>
                    )}
                    {networkOverlap.length > 0 && (() => {
                      const overlapPageStart = gridPage * GRID_PAGE_SIZE;
                      const overlapPageEnd = overlapPageStart + GRID_PAGE_SIZE;
                      const overlapTotalPages = Math.ceil(networkOverlap.length / GRID_PAGE_SIZE);
                      return (
                        <>
                          <div className="u-grid-section-header u-grid-section-header--overlap">
                            <span className="u-grid-section-title">Already in your network</span>
                            <span className="u-grid-section-count">{networkOverlap.length}</span>
                          </div>
                          {networkOverlap.slice(overlapPageStart, overlapPageEnd).map(renderCard)}
                          {overlapTotalPages > 1 && (
                            <div className="u-grid-pagination">
                              <button className="u-grid-page-btn" disabled={gridPage === 0} onClick={() => setGridPage(gridPage - 1)}>← Prev</button>
                              <span className="u-grid-page-info">{gridPage + 1} / {overlapTotalPages}</span>
                              <button className="u-grid-page-btn" disabled={gridPage >= overlapTotalPages - 1} onClick={() => setGridPage(gridPage + 1)}>Next →</button>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </>
                );
              }

              const pageStart = gridPage * GRID_PAGE_SIZE;
              const pageEnd = pageStart + GRID_PAGE_SIZE;
              const totalPages = Math.ceil(filteredCompanies.length / GRID_PAGE_SIZE);
              return (
                <>
                  {filteredCompanies.slice(pageStart, pageEnd).map(renderCard)}
                  {totalPages > 1 && (
                    <div className="u-grid-pagination">
                      <button className="u-grid-page-btn" disabled={gridPage === 0} onClick={() => setGridPage(gridPage - 1)}>← Prev</button>
                      <span className="u-grid-page-info">{gridPage + 1} / {totalPages}</span>
                      <button className="u-grid-page-btn" disabled={gridPage >= totalPages - 1} onClick={() => setGridPage(gridPage + 1)}>Next →</button>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>

      {/* ── Inline Panel ────────────────────────────────────────────── */}
      {inlinePanel && (
        <div className="u-panel">
            <button className="u-panel-close" onClick={() => setInlinePanel(null)}>×</button>

            {inlinePanel.type === 'person' && inlinePanel.contact && (() => {
              const c = inlinePanel.contact;
              const dc = 'connectionStrength' in c ? (c as DisplayContact) : null;
              const co = inlinePanel.company;
              return (
              <div className="u-panel-person">
                <PersonAvatar email={c.email} name={c.name} avatarUrl={dc?.photoUrl} size={56} />
                <h2>{c.name}</h2>
                <p className="u-panel-subtitle">
                  {dc?.headline || c.title || ''}
                  {co && !dc?.headline && ` at ${co.name}`}
                </p>
                <p className="u-panel-email">{c.email}</p>

                {/* Badges row */}
                <div className="u-panel-badges">
                  {dc?.connectionStrength && (
                    <span className={`u-panel-badge u-strength--${dc.connectionStrength}`}>
                      {dc.connectionStrength}
                    </span>
                  )}
                  {'userName' in c && (c as any).userName && (
                    <span className="u-panel-badge u-panel-badge--via">via {(c as any).userName}</span>
                  )}
                  {dc?.enrichedAt && <span className="u-panel-badge u-panel-badge--enriched">Enriched</span>}
                </div>

                {/* Contact details */}
                <div className="u-panel-details">
                  {(dc?.city || dc?.country) && (
                    <div className="u-panel-detail-row">
                      <span className="u-panel-detail-icon">📍</span>
                      <span>{[dc.city, dc.country].filter(Boolean).join(', ')}</span>
                    </div>
                  )}
                  {dc?.linkedinUrl && (
                    <div className="u-panel-detail-row">
                      <span className="u-panel-detail-icon">in</span>
                      <a href={dc.linkedinUrl} target="_blank" rel="noopener noreferrer" className="u-panel-link">LinkedIn Profile</a>
                    </div>
                  )}
                  {dc && dc.meetingsCount > 0 && (
                    <div className="u-panel-detail-row">
                      <span className="u-panel-detail-icon">📅</span>
                      <span>{dc.meetingsCount} meeting{dc.meetingsCount !== 1 ? 's' : ''} &middot; last {new Date(dc.lastSeenAt).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>

                {/* Company section */}
                {co && (
                  <div className="u-panel-company-section">
                    <div className="u-panel-section-header">
                      <CompanyLogo domain={co.domain} name={co.name} size={20} />
                      <span className="u-panel-section-title">{co.name}</span>
                      {co.linkedinUrl && (
                        <a href={co.linkedinUrl} target="_blank" rel="noopener noreferrer" className="u-panel-link-sm">in</a>
                      )}
                    </div>
                    {co.description && (
                      <p className="u-panel-company-desc">{co.description.length > 200 ? co.description.slice(0, 200) + '...' : co.description}</p>
                    )}
                    <div className="u-panel-company-meta">
                      {co.industry && (
                        <span className="u-panel-meta-tag">{co.industry}</span>
                      )}
                      {co.employeeCount && (
                        <span className="u-panel-meta-tag">{co.employeeCount.toLocaleString()} employees</span>
                      )}
                      {co.foundedYear && (
                        <span className="u-panel-meta-tag">Est. {co.foundedYear}</span>
                      )}
                      {(co.city || co.country) && (
                        <span className="u-panel-meta-tag">📍 {[co.city, co.country].filter(Boolean).join(', ')}</span>
                      )}
                      {co.totalFunding && (
                        <span className="u-panel-meta-tag u-panel-meta-tag--funding">💰 {co.totalFunding}</span>
                      )}
                      {co.lastFundingRound && (
                        <span className="u-panel-meta-tag u-panel-meta-tag--funding">{co.lastFundingRound}</span>
                      )}
                      {co.annualRevenue && (
                        <span className="u-panel-meta-tag">Revenue: {co.annualRevenue}</span>
                      )}
                    </div>
                  </div>
                )}

                <div className="u-panel-actions">
                  {dc?.linkedinUrl && (
                    <a
                      className="u-action-btn"
                      href={dc.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      LinkedIn
                    </a>
                  )}
                  <button
                    className="u-primary-btn"
                    onClick={() => {
                      if (co) openIntroPanel(co);
                    }}
                  >
                    ✨ Request Intro
                  </button>
                  <button
                    className="u-action-btn"
                    onClick={() => window.open(`mailto:${c.email}`, '_blank')}
                  >
                    ✉ Email
                  </button>
                </div>
              </div>
              );
            })()}

            {inlinePanel.type === 'company' && inlinePanel.company && (() => {
              const co = inlinePanel.company;
              return (
              <div className="u-panel-company">
                <div className="u-panel-company-hero">
                  <CompanyLogo domain={co.domain} name={co.name} size={48} />
                  <div>
                    <h2>{co.name}</h2>
                    <span className="u-panel-company-domain">{co.domain}</span>
                  </div>
                </div>

                {/* Quick stats */}
                <div className="u-panel-company-stats">
                  <div className="u-panel-stat">
                    <span className="u-panel-stat-value">{co.myCount}</span>
                    <span className="u-panel-stat-label">My contacts</span>
                  </div>
                  <div className="u-panel-stat">
                    <span className="u-panel-stat-value">{co.spaceCount}</span>
                    <span className="u-panel-stat-label">Via spaces</span>
                  </div>
                  {co.employeeCount && (
                    <div className="u-panel-stat">
                      <span className="u-panel-stat-value">{co.employeeCount.toLocaleString()}</span>
                      <span className="u-panel-stat-label">Employees</span>
                    </div>
                  )}
                  {co.foundedYear && (
                    <div className="u-panel-stat">
                      <span className="u-panel-stat-value">{co.foundedYear}</span>
                      <span className="u-panel-stat-label">Founded</span>
                    </div>
                  )}
                </div>

                {/* Description */}
                {co.description && (
                  <div className="u-panel-section">
                    <h4 className="u-panel-section-h">About</h4>
                    <p className="u-panel-section-text">{co.description}</p>
                  </div>
                )}

                {/* Details grid */}
                <div className="u-panel-section">
                  <h4 className="u-panel-section-h">Details</h4>
                  <div className="u-panel-detail-grid">
                    {co.industry && (
                      <div className="u-panel-detail-cell">
                        <span className="u-panel-detail-key">Industry</span>
                        <span className="u-panel-detail-val">{co.industry}</span>
                      </div>
                    )}
                    {(co.city || co.country) && (
                      <div className="u-panel-detail-cell">
                        <span className="u-panel-detail-key">Location</span>
                        <span className="u-panel-detail-val">{[co.city, co.country].filter(Boolean).join(', ')}</span>
                      </div>
                    )}
                    {co.annualRevenue && (
                      <div className="u-panel-detail-cell">
                        <span className="u-panel-detail-key">Revenue</span>
                        <span className="u-panel-detail-val">{co.annualRevenue}</span>
                      </div>
                    )}
                    {co.totalFunding && (
                      <div className="u-panel-detail-cell">
                        <span className="u-panel-detail-key">Total Funding</span>
                        <span className="u-panel-detail-val">{co.totalFunding}</span>
                      </div>
                    )}
                    {co.lastFundingRound && (
                      <div className="u-panel-detail-cell">
                        <span className="u-panel-detail-key">Last Round</span>
                        <span className="u-panel-detail-val">{co.lastFundingRound}</span>
                      </div>
                    )}
                    {co.enrichedAt && (
                      <div className="u-panel-detail-cell">
                        <span className="u-panel-detail-key">Enriched</span>
                        <span className="u-panel-detail-val">{new Date(co.enrichedAt).toLocaleDateString()}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Links */}
                {(co.linkedinUrl || co.domain) && (
                  <div className="u-panel-links">
                    {co.linkedinUrl && (
                      <a href={co.linkedinUrl} target="_blank" rel="noopener noreferrer" className="u-panel-link-btn">
                        LinkedIn
                      </a>
                    )}
                    <a href={`https://${co.domain}`} target="_blank" rel="noopener noreferrer" className="u-panel-link-btn">
                      Website
                    </a>
                  </div>
                )}

                {/* My contacts at this company */}
                {co.myContacts.length > 0 && (
                  <div className="u-panel-section">
                    <h4 className="u-panel-section-h">My contacts ({co.myContacts.length})</h4>
                    <div className="u-panel-contact-list">
                      {co.myContacts.map(c => (
                        <div key={c.id} className="u-panel-contact-row" onClick={() => openPersonPanel(c, co)}>
                          <PersonAvatar email={c.email} name={c.name} avatarUrl={c.photoUrl} size={28} />
                          <div className="u-panel-contact-info">
                            <span className="u-panel-contact-name">{c.name}</span>
                            <span className="u-panel-contact-title">{c.title}</span>
                          </div>
                          <span className={`u-strength u-strength--${c.connectionStrength}`}>{c.connectionStrength}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Space contacts at this company */}
                {co.spaceContacts.length > 0 && (
                  <div className="u-panel-section">
                    <h4 className="u-panel-section-h">Via spaces ({co.spaceContacts.length})</h4>
                    <div className="u-panel-contact-list">
                      {co.spaceContacts.map(c => (
                        <div key={c.id} className="u-panel-contact-row" onClick={() => openPersonPanel(c, co)}>
                          <PersonAvatar email={c.email} name={c.name} size={28} />
                          <div className="u-panel-contact-info">
                            <span className="u-panel-contact-name">{c.name}</span>
                            <span className="u-panel-contact-title">{c.title || 'Contact'}</span>
                          </div>
                          <span className="u-panel-contact-via">{c.userName}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="u-panel-actions">
                  {co.spaceCount > 0 && (
                    <button className="u-primary-btn" onClick={() => openIntroPanel(co)}>
                      ✨ Request Intro
                    </button>
                  )}
                  <button className="u-action-btn" onClick={() => window.open(`https://${co.domain}`, '_blank')}>
                    🌐 Visit
                  </button>
                </div>
              </div>
              );
            })()}

            {/* ── Space Detail Panel ── */}
            {inlinePanel.type === 'space' && inlinePanel.spaceId && (() => {
              const space = spaces.find(s => s.id === inlinePanel.spaceId);
              if (!space) return null;
              const isOwner = space.ownerId === currentUser?.id;
              const spaceCompanyCount = mergedCompanies.filter(c => c.spaceIds.includes(space.id)).length;
              return (
              <div className="u-panel-space">
                <div className="u-panel-space-hero">
                  <span className="u-panel-space-emoji">{space.emoji}</span>
                  <div>
                    <h2>{space.name}</h2>
                    <span className="u-panel-space-meta">{space.memberCount} members · {spaceCompanyCount} companies</span>
                  </div>
                </div>

                {space.description && (
                  <div className="u-panel-section">
                    <p className="u-panel-section-text">{space.description}</p>
                  </div>
                )}

                {/* Members */}
                <div className="u-panel-section">
                  <h4 className="u-panel-section-h">Members</h4>
                  <div className="u-panel-contact-list">
                    {(space.members || []).map(m => (
                      <div key={m.id} className="u-panel-contact-row">
                        <PersonAvatar email={m.user.email} name={m.user.name} avatarUrl={m.user.avatar} size={28} />
                        <div className="u-panel-contact-info">
                          <span className="u-panel-contact-name">{m.user.name}</span>
                          <span className="u-panel-contact-title">{m.role}</span>
                        </div>
                        {m.user.id === space.ownerId && <span className="u-panel-badge">owner</span>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Invite member */}
                {isOwner && (
                  <div className="u-panel-section">
                    <h4 className="u-panel-section-h">Invite member</h4>
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <input
                        className="sb-input"
                        placeholder="Email address"
                        style={{ flex: 1 }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const input = e.currentTarget;
                            inviteMemberToSpace(space.id, input.value);
                            input.value = '';
                          }
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Quick actions */}
                <div className="u-panel-actions">
                  <button className="u-action-btn" onClick={() => setInlinePanel({ type: 'network-manage' })}>
                    ← Back
                  </button>
                  <button
                    className="u-primary-btn"
                    onClick={() => {
                      setSpaceFilter(spaceFilter === space.id ? 'all' : space.id);
                      setInlinePanel(null);
                    }}
                  >
                    {spaceFilter === space.id ? 'Show all companies' : `Filter to ${space.name}`}
                  </button>
                  {isOwner && space.inviteCode && (
                    <button className="u-action-btn" onClick={() => copyInviteCode(space.inviteCode!)}>
                      {copiedCode ? '✓ Copied!' : 'Copy invite code'}
                    </button>
                  )}
                  {!isOwner && (
                    <button className="u-action-btn" onClick={() => { leaveSpace(space.id); setInlinePanel({ type: 'network-manage' }); }}>
                      Leave space
                    </button>
                  )}
                </div>
              </div>
              );
            })()}

            {/* ── Network Panel (Spaces + 1:1 Connections) ── */}
            {(inlinePanel.type === 'network-manage' || inlinePanel.type === 'spaces-manage' || inlinePanel.type === 'connections-manage') && (
              <div className="u-panel-spaces">
                <h2>Your Network</h2>
                <p className="u-panel-space-meta">{spaces.length} spaces · {connections.filter(c => c.status === 'accepted').length} connections</p>

                {/* Spaces section */}
                <div className="u-panel-section">
                  <h4 className="u-panel-section-h">Spaces</h4>
                  <div className="u-panel-spaces-list">
                    {spaces.map(s => {
                      const isOwner = s.ownerId === currentUser?.id;
                      const companyCount = mergedCompanies.filter(c => c.spaceIds.includes(s.id)).length;
                      return (
                        <div key={s.id} className="u-panel-space-card" onClick={() => setInlinePanel({ type: 'space', spaceId: s.id })}>
                          <span className="u-panel-space-emoji">{s.emoji}</span>
                          <div className="u-panel-space-card-info">
                            <span className="u-panel-space-card-name">{s.name}</span>
                            <span className="u-panel-space-card-stats">{s.memberCount} members · {companyCount} companies</span>
                          </div>
                          {isOwner && <span className="u-panel-badge">owner</span>}
                        </div>
                      );
                    })}
                    {spaces.length === 0 && pendingSpaces.length === 0 && <div className="u-panel-spaces-empty">No spaces yet</div>}
                  </div>

                  {/* Pending spaces I applied to */}
                  {pendingSpaces.length > 0 && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.35rem' }}>Pending approval</span>
                      {pendingSpaces.map(ps => (
                        <div key={ps.id} className="u-panel-space-card" style={{ opacity: 0.6 }}>
                          <span className="u-panel-space-emoji">{ps.emoji}</span>
                          <div className="u-panel-space-card-info">
                            <span className="u-panel-space-card-name">{ps.name}</span>
                            <span className="u-panel-space-card-stats">Waiting for owner approval</span>
                          </div>
                          <span className="u-panel-badge" style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>pending</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Pending members wanting to join my spaces */}
                  {Object.keys(pendingMembers).length > 0 && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.35rem' }}>Requests to join</span>
                      {Object.entries(pendingMembers).map(([spaceId, members]) => {
                        const space = spaces.find(s => s.id === spaceId);
                        if (!space || members.length === 0) return null;
                        return members.map(m => (
                          <div key={m.id} className="u-panel-space-card">
                            <PersonAvatar email={m.user.email} name={m.user.name} avatarUrl={m.user.avatar} size={32} />
                            <div className="u-panel-space-card-info">
                              <span className="u-panel-space-card-name">{m.user.name}</span>
                              <span className="u-panel-space-card-stats">wants to join {space.emoji} {space.name}</span>
                            </div>
                            <button className="u-action-btn" style={{ flex: 0, fontSize: '0.7rem', padding: '0.2rem 0.5rem', background: 'rgba(52,211,153,0.15)', color: '#34d399' }} onClick={() => approveSpaceMember(spaceId, m.userId)}>Accept</button>
                            <button className="u-action-btn" style={{ flex: 0, fontSize: '0.7rem', padding: '0.2rem 0.35rem' }} onClick={() => rejectSpaceMember(spaceId, m.userId)}>×</button>
                          </div>
                        ));
                      })}
                    </div>
                  )}

                  <div className="sb-spaces-actions" style={{ marginTop: '0.5rem' }}>
                    <button className="sb-space-action-btn primary" onClick={() => { setShowCreateSpace(true); setSidebarOpen(true); }}>+ Create</button>
                    <button className="sb-space-action-btn" onClick={() => { setShowJoinSpace(v => !v); setJoinCode(''); setJoinStatus(null); }}>
                      {showJoinSpace ? 'Cancel' : 'Join'}
                    </button>
                  </div>

                  {/* Inline join space form */}
                  {showJoinSpace && (
                    <div className="sb-space-form-row" style={{ marginTop: '0.5rem' }}>
                      <input
                        className="sb-input"
                        style={{ flex: 1 }}
                        placeholder="Paste invite code"
                        value={joinCode}
                        onChange={e => setJoinCode(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && joinCode.trim()) joinSpace(); }}
                        autoFocus
                      />
                      <button className="sb-space-action-btn primary" onClick={joinSpace} disabled={!joinCode.trim()}>→</button>
                    </div>
                  )}
                  {joinStatus && (
                    <div style={{
                      marginTop: '0.35rem',
                      padding: '0.4rem 0.6rem',
                      borderRadius: '0.5rem',
                      fontSize: '0.75rem',
                      background: joinStatus.type === 'error' ? 'rgba(239,68,68,0.15)' : joinStatus.type === 'pending' ? 'rgba(251,191,36,0.15)' : 'rgba(52,211,153,0.15)',
                      color: joinStatus.type === 'error' ? '#ef4444' : joinStatus.type === 'pending' ? '#fbbf24' : '#34d399',
                    }}>
                      {joinStatus.message}
                    </div>
                  )}
                </div>

                {/* 1:1 Connections section */}
                <div className="u-panel-section">
                  <h4 className="u-panel-section-h">1:1 Connections</h4>
                  <div className="u-panel-spaces-list">
                    {connections.filter(c => c.status === 'accepted').map(c => (
                      <div key={c.id} className="u-panel-space-card" onClick={() => setInlinePanel({ type: 'connection', connectionId: c.id })}>
                        <PersonAvatar email={c.peer.email} name={c.peer.name} avatarUrl={c.peer.avatar} size={32} />
                        <div className="u-panel-space-card-info">
                          <span className="u-panel-space-card-name">{c.peer.name}</span>
                          <span className="u-panel-space-card-stats">{c.peer.email}</span>
                        </div>
                      </div>
                    ))}
                    {connections.filter(c => c.status === 'accepted').length === 0 && <div className="u-panel-spaces-empty">No connections yet</div>}
                  </div>

                  {/* Pending requests */}
                  {connections.filter(c => c.status === 'pending').length > 0 && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: '0.35rem' }}>Pending</span>
                      {connections.filter(c => c.status === 'pending').map(c => (
                        <div key={c.id} className="u-panel-space-card" style={{ opacity: c.direction === 'sent' ? 0.6 : 1 }}>
                          <PersonAvatar email={c.peer.email} name={c.peer.name} avatarUrl={c.peer.avatar} size={32} />
                          <div className="u-panel-space-card-info">
                            <span className="u-panel-space-card-name">{c.peer.name}</span>
                            <span className="u-panel-space-card-stats">{c.direction === 'sent' ? 'Waiting for response' : 'Wants to connect'}</span>
                          </div>
                          {c.direction === 'received' && (
                            <button className="u-action-btn" style={{ flex: 0, fontSize: '0.75rem', padding: '0.25rem 0.5rem' }} onClick={() => acceptConnection(c.id)}>Accept</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="sb-space-form" style={{ marginTop: '0.5rem' }}>
                    <input
                      className="sb-input"
                      placeholder="Email address to connect"
                      value={connectEmail}
                      onChange={e => setConnectEmail(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && connectEmail.trim()) { sendConnectionRequest(connectEmail); } }}
                    />
                    <button className="sb-space-action-btn primary" style={{ marginTop: '0.35rem', width: '100%' }} onClick={() => sendConnectionRequest(connectEmail)} disabled={!connectEmail.trim()}>+ Connect</button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Connection Detail Panel ── */}
            {inlinePanel.type === 'connection' && inlinePanel.connectionId && (() => {
              const conn = connections.find(c => c.id === inlinePanel.connectionId);
              if (!conn) return null;
              const connCompanyCount = connectionCompanies.filter(cc => cc.connectionId === conn.id).length;
              return (
              <div className="u-panel-space">
                <div className="u-panel-space-hero">
                  <PersonAvatar email={conn.peer.email} name={conn.peer.name} avatarUrl={conn.peer.avatar} size={48} />
                  <div>
                    <h2>{conn.peer.name}</h2>
                    <span className="u-panel-space-meta">{conn.peer.email}</span>
                  </div>
                </div>

                <div className="u-panel-company-stats">
                  <div className="u-panel-stat">
                    <span className="u-panel-stat-value">{connCompanyCount}</span>
                    <span className="u-panel-stat-label">Companies</span>
                  </div>
                  <div className="u-panel-stat">
                    <span className="u-panel-stat-value">{conn.status}</span>
                    <span className="u-panel-stat-label">Status</span>
                  </div>
                </div>

                <div className="u-panel-actions">
                  <button className="u-action-btn" onClick={() => setInlinePanel({ type: 'network-manage' })}>
                    ← Back
                  </button>
                  <button className="u-action-btn" onClick={() => { removeConnection(conn.id); setInlinePanel({ type: 'network-manage' }); }}>
                    Disconnect
                  </button>
                </div>
              </div>
              );
            })()}

            {/* ── Settings Panel ── */}
            {inlinePanel.type === 'settings' && (
              <div className="u-panel-settings">
                <h2>Settings</h2>

                {/* Account */}
                <div className="u-panel-section">
                  <h4 className="u-panel-section-h">Account</h4>
                  {currentUser && (
                    <div className="u-settings-account">
                      <PersonAvatar email={currentUser.email} name={currentUser.name} avatarUrl={currentUser.avatar} size={40} />
                      <div className="u-settings-account-info">
                        <span className="u-settings-account-name">{currentUser.name}</span>
                        <span className="u-settings-account-email">{currentUser.email}</span>
                      </div>
                    </div>
                  )}
                  <button className="u-action-btn u-settings-logout" onClick={logout}>
                    Log out
                  </button>
                </div>

                {/* Connected Accounts */}
                <div className="u-panel-section">
                  <h4 className="u-panel-section-h">Connected Accounts</h4>

                  {/* Google Calendar */}
                  <div className="u-settings-row">
                    <div className="u-settings-row-info">
                      <span className="u-settings-row-label">Google Calendar</span>
                      <span className="u-settings-row-status">
                        {isCalendarConnected ? (
                          <><span className="u-settings-dot connected" /> Connected</>
                        ) : (
                          <><span className="u-settings-dot" /> Not connected</>
                        )}
                      </span>
                    </div>
                    {isCalendarConnected ? (
                      <button className="u-action-btn" onClick={handleCalendarSync} disabled={calendarSyncing}>
                        {calendarSyncing ? 'Syncing...' : 'Sync'}
                      </button>
                    ) : (
                      <button className="u-primary-btn" onClick={() => { window.location.href = authApi.getGoogleAuthUrl(); }}>
                        Connect
                      </button>
                    )}
                  </div>
                  {lastCalendarSync && (
                    <span className="u-settings-meta">Last synced: {new Date(lastCalendarSync).toLocaleDateString()} {new Date(lastCalendarSync).toLocaleTimeString()}</span>
                  )}

                  {/* Add another Google account */}
                  <div className="u-settings-row" style={{ borderTop: '1px solid var(--border)', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
                    <div className="u-settings-row-info">
                      <span className="u-settings-row-label">Add Google Account</span>
                      <span className="u-settings-row-status">Connect additional calendars</span>
                    </div>
                    <button className="u-action-btn" onClick={() => { window.location.href = authApi.getGoogleAuthUrl(); }}>
                      + Add
                    </button>
                  </div>

                  {/* Coming soon integrations */}
                  <div className="u-settings-row u-settings-row-disabled">
                    <div className="u-settings-row-info">
                      <span className="u-settings-row-label">LinkedIn</span>
                      <span className="u-settings-row-status">Import connections</span>
                    </div>
                    <span className="u-settings-coming-soon">Coming soon</span>
                  </div>
                  <div className="u-settings-row u-settings-row-disabled">
                    <div className="u-settings-row-info">
                      <span className="u-settings-row-label">Microsoft Outlook</span>
                      <span className="u-settings-row-status">Calendar & email contacts</span>
                    </div>
                    <span className="u-settings-coming-soon">Coming soon</span>
                  </div>
                  <div className="u-settings-row u-settings-row-disabled">
                    <div className="u-settings-row-info">
                      <span className="u-settings-row-label">Email (Gmail / IMAP)</span>
                      <span className="u-settings-row-status">People you've emailed</span>
                    </div>
                    <span className="u-settings-coming-soon">Coming soon</span>
                  </div>
                </div>

                {/* Data Enrichment */}
                <div className="u-panel-section">
                  <h4 className="u-panel-section-h">Data Enrichment</h4>
                  <div className="u-settings-row">
                    <div className="u-settings-row-info">
                      <span className="u-settings-row-label">Auto-enrich</span>
                      <span className="u-settings-row-status">
                        {enriching ? (
                          <><span className="u-enrich-spinner" /> Running...</>
                        ) : enrichStats ? (
                          <>{enrichStats.contacts.enriched}/{enrichStats.contacts.total} contacts enriched</>
                        ) : (
                          <>Loading...</>
                        )}
                      </span>
                    </div>
                    <button
                      className={`u-action-btn ${enriching ? 'enriching' : ''}`}
                      onClick={startEnrichment}
                      disabled={enriching}
                    >
                      {enriching ? 'Enriching...' : 'Run now'}
                    </button>
                  </div>
                  <span className="u-settings-meta">
                    Runs automatically once per week. Use "Run now" to trigger manually.
                  </span>
                  {enriching && (enrichProgress.contacts || enrichProgress.companies || enrichProgress.contactsFree) && (
                    <div className="u-enrich-progress" style={{ marginTop: '0.5rem' }}>
                      {enrichProgress.contactsFree && (
                        <div className="u-enrich-progress-row">
                          <span className="u-enrich-progress-label">Contacts</span>
                          <div className="u-enrich-progress-bar">
                            <div
                              className="u-enrich-progress-fill"
                              style={{ width: `${enrichProgress.contactsFree.total > 0 ? ((enrichProgress.contactsFree.enriched + enrichProgress.contactsFree.skipped + enrichProgress.contactsFree.errors) / enrichProgress.contactsFree.total) * 100 : 0}%` }}
                            />
                          </div>
                          <span className="u-enrich-progress-text">
                            {enrichProgress.contactsFree.enriched}/{enrichProgress.contactsFree.total}
                            {enrichProgress.contactsFree.done && ' ✓'}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {inlinePanel.type === 'intro-request' && inlinePanel.company && (
              <div className="u-panel-intro">
                <h2>Request Intro</h2>
                <div className="u-panel-target">
                  <CompanyLogo domain={inlinePanel.company.domain} name={inlinePanel.company.name} size={32} />
                  <span>{inlinePanel.company.name}</span>
                </div>

                <div className="u-panel-paths">
                  <h4>Intro paths</h4>
                  {inlinePanel.company.spaceContacts.slice(0, 3).map(c => (
                    <div key={c.id} className="u-panel-path">
                      <PersonAvatar email={c.email} name={c.name} size={28} />
                      <div>
                        <span className="u-panel-path-name">{c.name}</span>
                        <span className="u-panel-path-via">via {c.userName}</span>
                      </div>
                    </div>
                  ))}
                  {inlinePanel.company.myContacts.slice(0, 2).map(c => (
                    <div key={c.id} className="u-panel-path">
                      <PersonAvatar email={c.email} name={c.name} size={28} />
                      <div>
                        <span className="u-panel-path-name">{c.name}</span>
                        <span className="u-panel-path-via">your contact · {c.connectionStrength}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <textarea className="u-panel-textarea" placeholder="What would you like to discuss with them?" rows={3} />

                <div className="u-panel-actions">
                  <button className="u-primary-btn" onClick={() => {
                    const firstContact = inlinePanel.company?.myContacts?.[0];
                    openOfferIntroEmail({
                      requesterEmail: firstContact?.email || '',
                      requesterName: firstContact?.name || '',
                      targetCompany: inlinePanel.company!.name,
                    });
                    setInlinePanel(null);
                  }}>
                    Send Request
                  </button>
                  <button className="u-action-btn" onClick={() => setInlinePanel(null)}>Cancel</button>
                </div>
              </div>
            )}
        </div>
      )}
      </div>{/* end u-layout */}
    </div>
  );
}
