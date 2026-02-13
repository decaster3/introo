import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAppState, useAppActions } from '../store';
import { API_BASE, enrichmentApi, calendarApi, authApi, requestsApi, notificationsApi, offersApi } from '../lib/api';
import { calculateStrength } from '../types';
import { PersonAvatar, CompanyLogo } from '../components';
import { openOfferIntroEmail, openDoubleIntroEmail } from '../lib/offerIntro';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

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

/** Display-friendly funding round label (normalizes Apollo data) */
function formatFundingRound(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const l = raw.toLowerCase();
  if (l.includes('venture')) return 'VC Backed';
  // Normalize underscores → spaces and title-case: series_a → Series A
  return raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Check if a raw funding round matches a filter key (Apollo-aware) */
function matchesFundingFilter(raw: string | null | undefined, totalFunding: string | null | undefined, filterKey: string): boolean {
  const round = (raw || '').toLowerCase();
  switch (filterKey) {
    case 'no-funding': return !raw && !totalFunding;
    case 'pre-seed': return /pre.?seed|seed|angel|convertible.?note/i.test(round);
    case 'series-a': return /series.?a\b/i.test(round);
    case 'series-b': return /series.?[b-z]\b/i.test(round);
    case 'vc-backed': return /venture|private.?equity/i.test(round);
    default: return false;
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface SpaceCompany {
  id: string;
  domain: string;
  name: string;
  industry?: string;
  contactCount: number;
  spaceId?: string;
  employeeCount?: number | null;
  foundedYear?: number | null;
  annualRevenue?: string | null;
  totalFunding?: string | null;
  lastFundingRound?: string | null;
  lastFundingDate?: string | null;
  city?: string | null;
  country?: string | null;
  description?: string | null;
  linkedinUrl?: string | null;
  enrichedAt?: string | null;
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
  openRequestCount?: number;
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
  employeeCount?: number | null;
  foundedYear?: number | null;
  annualRevenue?: string | null;
  totalFunding?: string | null;
  lastFundingRound?: string | null;
  lastFundingDate?: string | null;
  city?: string | null;
  country?: string | null;
  description?: string | null;
  linkedinUrl?: string | null;
  enrichedAt?: string | null;
  contacts: {
    id: string; name: string; email: string; title?: string;
    userId: string; userName: string; connectionId?: string;
  }[];
}

interface DisplayContact {
  id: string; name: string; email: string; title: string;
  company: string; companyDomain: string;
  lastSeenAt: string; meetingsCount: number;
  firstSeenAt: string;
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
    lastFundingDate?: string | null;
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
  lastFundingDate?: string | null;
  city?: string | null;
  country?: string | null;
  industry?: string | null;
  description?: string | null;
  linkedinUrl?: string | null;
  enrichedAt?: string | null;
}

interface HuntFilters {
  description?: string;
  categories?: string[];
  aiKeywords?: string[];
  excludeKeywords?: string;
  employeeRanges?: string[];
  country?: string;
  city?: string;
  fundingRounds?: string[];
  fundingRecency?: string;
  foundedFrom?: string;
  foundedTo?: string;
  revenueRanges?: string[];
  technologies?: string[];
  sourceFilter?: string;
  strengthFilter?: string;
}

interface Hunt {
  id: string;
  title: string;
  keywords: string[];
  filters?: HuntFilters;
  isActive: boolean;
}

interface InlinePanel {
  type: 'person' | 'intro-request' | 'intro-offer' | 'company' | 'space' | 'spaces-manage' | 'connection' | 'connections-manage' | 'network-manage' | 'settings' | 'notifications';
  company?: MergedCompany;
  contact?: DisplayContact | { id: string; name: string; email: string; title?: string; userName?: string };
  spaceId?: string;
  connectionId?: string;
  fromSpaceId?: string; // breadcrumb: which space the user navigated from
  introSourceFilter?: string; // snapshot of sourceFilter when opening intro panel
  introSpaceFilter?: string; // snapshot of spaceFilter when opening intro panel
  introConnectionFilter?: string; // snapshot of connectionFilter when opening intro panel
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AIHomePage() {
  const { currentUser, contacts: storeContacts, isCalendarConnected } = useAppState();
  const { logout, syncCalendar } = useAppActions();
  const searchRef = useRef<HTMLInputElement>(null);

  // UI State
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedSearchQuery, setAppliedSearchQuery] = useState('');
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
  const [introRequestText, setIntroRequestText] = useState('');
  const [introRequestSending, setIntroRequestSending] = useState(false);
  const [introRequestSent, setIntroRequestSent] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const [notifications, setNotifications] = useState<Awaited<ReturnType<typeof notificationsApi.getAll>>>([]);
  const [myIntroRequests, setMyIntroRequests] = useState<Awaited<ReturnType<typeof requestsApi.getMine>>>([]);
  const [spaceRequests, setSpaceRequests] = useState<Record<string, { id: string; rawText: string; status: string; createdAt: string; normalizedQuery: Record<string, unknown>; requester: { id: string; name: string; email?: string; avatar: string | null } }[]>>({});
  const [decliningRequestId, setDecliningRequestId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [dismissedRequestIds, setDismissedRequestIds] = useState<Set<string>>(new Set());
  const [incomingRequests, setIncomingRequests] = useState<{ id: string; rawText: string; status: string; createdAt: string; normalizedQuery: Record<string, unknown>; requester: { id: string; name: string; email?: string; avatar: string | null } }[]>([]);
  const [introPickerRequestId, setIntroPickerRequestId] = useState<string | null>(null);

  // AI search state
  const [aiParsing, setAiParsing] = useState(false);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [lastAiQuery, setLastAiQuery] = useState<{ query: string; keywords: string[] } | null>(null);

  // Space management state
  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const [showJoinSpace, setShowJoinSpace] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [newSpaceEmoji, setNewSpaceEmoji] = useState('🫛');
  const [joinCode, setJoinCode] = useState('');
  const [joinStatus, setJoinStatus] = useState<{ type: 'success' | 'error' | 'pending'; message: string } | null>(null);

  // Connection management state
  const [, setShowConnectForm] = useState(false);
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
    excludeKeywords: [] as string[],
    aiKeywords: [] as string[], // AI-expanded keywords for business description
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
    connectedYears: [] as string[],
    connectedMonths: [] as string[],
  });
  const [aiKeywordsLoading, setAiKeywordsLoading] = useState(false);

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

  // AI keyword expansion for business description
  const expandKeywords = useCallback(async (text: string) => {
    if (!text.trim() || text.trim().length < 2) return;
    setAiKeywordsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/ai/expand-keywords`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text: text.trim() }),
      });
      if (!res.ok) throw new Error('Expand keywords failed');
      const data = await res.json();
      if (data.keywords && data.keywords.length > 0) {
        setSidebarFilters(prev => ({
          ...prev,
          aiKeywords: data.keywords.map((k: string) => k.toLowerCase()),
        }));
      }
    } catch (e) {
      console.warn('AI keyword expansion failed:', e);
    } finally {
      setAiKeywordsLoading(false);
    }
  }, []);

  const removeAiKeyword = useCallback((keyword: string) => {
    setSidebarFilters(prev => ({
      ...prev,
      aiKeywords: prev.aiKeywords.filter(k => k !== keyword),
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
  const [hunts, setHunts] = useState<Hunt[]>([]);

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
      firstSeenAt: c.firstSeenAt || c.lastSeenAt,
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
        lastFundingDate: c.company.lastFundingDate,
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
        co.lastFundingDate = c.companyData.lastFundingDate;
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
      // Carry enrichment data from space company if not already enriched
      if (!co.enrichedAt && sc.enrichedAt) {
        co.id = sc.id;
        co.employeeCount = sc.employeeCount;
        co.foundedYear = sc.foundedYear;
        co.annualRevenue = sc.annualRevenue;
        co.totalFunding = sc.totalFunding;
        co.lastFundingRound = sc.lastFundingRound;
        co.lastFundingDate = sc.lastFundingDate;
        co.city = sc.city;
        co.country = sc.country;
        co.description = sc.description;
        co.linkedinUrl = sc.linkedinUrl;
        co.enrichedAt = sc.enrichedAt;
      }
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
      // Carry enrichment data from connection company if not already enriched
      if (!co.enrichedAt && cc.enrichedAt) {
        co.id = cc.id;
        co.employeeCount = cc.employeeCount;
        co.foundedYear = cc.foundedYear;
        co.annualRevenue = cc.annualRevenue;
        co.totalFunding = cc.totalFunding;
        co.lastFundingRound = cc.lastFundingRound;
        co.lastFundingDate = cc.lastFundingDate;
        co.city = cc.city;
        co.country = cc.country;
        co.description = cc.description;
        co.linkedinUrl = cc.linkedinUrl;
        co.enrichedAt = cc.enrichedAt;
      }
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

    // Match hunts (keywords + saved filters)
    const companies = Array.from(map.values());
    const parseRevM = (rev: string | null | undefined): number => {
      if (!rev) return 0;
      const m = rev.match(/([\d.]+)/);
      return m ? parseFloat(m[1]) : 0;
    };
    companies.forEach(co => {
      hunts.forEach(hunt => {
        let matches = false;

        // Keyword matching
        if (hunt.keywords.length > 0) {
          const allText = [
            co.name, co.domain,
            co.description || '', co.industry || '',
            co.city || '', co.country || '',
            co.lastFundingRound || '', co.annualRevenue || '',
            ...co.myContacts.map(c => `${c.title} ${c.name}`),
            ...co.spaceContacts.map(c => `${c.title || ''} ${c.name}`),
          ].join(' ').toLowerCase();
          if (hunt.keywords.some(k => allText.includes(k))) {
            matches = true;
          }
        }

        // Saved filter matching
        if (!matches && hunt.filters) {
          const hf = hunt.filters;
          let filterMatch = true;
          let hasAnyFilter = false;

          if (hf.employeeRanges && hf.employeeRanges.length > 0) {
            hasAnyFilter = true;
            const emp = co.employeeCount || 0;
            const inRange = hf.employeeRanges.some(r => {
              if (r === '1-10') return emp >= 1 && emp <= 10;
              if (r === '11-50') return emp >= 11 && emp <= 50;
              if (r === '51-200') return emp >= 51 && emp <= 200;
              if (r === '201-1000') return emp >= 201 && emp <= 1000;
              if (r === '1001-5000') return emp >= 1001 && emp <= 5000;
              if (r === '5000+') return emp > 5000;
              return false;
            });
            if (!inRange) filterMatch = false;
          }
          if (hf.country && filterMatch) {
            hasAnyFilter = true;
            if (!(co.country || '').toLowerCase().includes(hf.country.toLowerCase())) filterMatch = false;
          }
          if (hf.city && filterMatch) {
            hasAnyFilter = true;
            if (!(co.city || '').toLowerCase().includes(hf.city.toLowerCase())) filterMatch = false;
          }
          if (hf.fundingRounds && hf.fundingRounds.length > 0 && filterMatch) {
            hasAnyFilter = true;
            if (!hf.fundingRounds.some(r => matchesFundingFilter(co.lastFundingRound, co.totalFunding, r))) filterMatch = false;
          }
          if (hf.foundedFrom && filterMatch) {
            hasAnyFilter = true;
            if (!co.foundedYear || co.foundedYear < parseInt(hf.foundedFrom)) filterMatch = false;
          }
          if (hf.foundedTo && filterMatch) {
            hasAnyFilter = true;
            if (!co.foundedYear || co.foundedYear > parseInt(hf.foundedTo)) filterMatch = false;
          }
          if (hf.revenueRanges && hf.revenueRanges.length > 0 && filterMatch) {
            hasAnyFilter = true;
            const rev = parseRevM(co.annualRevenue);
            const inRange = hf.revenueRanges.some(r => {
              if (r === '0-1m') return rev < 1;
              if (r === '1-10m') return rev >= 1 && rev < 10;
              if (r === '10-50m') return rev >= 10 && rev < 50;
              if (r === '50-100m') return rev >= 50 && rev < 100;
              if (r === '100m+') return rev >= 100;
              return false;
            });
            if (!inRange) filterMatch = false;
          }

          if (hasAnyFilter && filterMatch) matches = true;
        }

        if (matches) co.matchingHunts.push(hunt.id);
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

    // Filter by connected time (year/month tags) — uses firstSeenAt (earliest calendar meeting)
    if (sf.connectedYears.length > 0 || sf.connectedMonths.length > 0) {
      result = result.filter(c =>
        c.myContacts.some(mc => {
          const d = new Date(mc.firstSeenAt);
          const y = String(d.getFullYear());
          const m = String(d.getMonth() + 1); // 1-indexed
          const yearOk = sf.connectedYears.length === 0 || sf.connectedYears.includes(y);
          const monthOk = sf.connectedMonths.length === 0 || sf.connectedMonths.includes(m);
          return yearOk && monthOk;
        })
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

    // Hunt selected → don't filter, just sort matches to top (done after all filters)

    // Filter by search (only applied on Enter)
    if (appliedSearchQuery) {
      const q = appliedSearchQuery.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.domain.toLowerCase().includes(q) ||
        c.myContacts.some(contact => contact.name.toLowerCase().includes(q) || contact.title.toLowerCase().includes(q)) ||
        c.spaceContacts.some(contact => contact.name.toLowerCase().includes(q) || (contact.title || '').toLowerCase().includes(q))
      );
    }

    // ── Business description / AI keywords / exclude ──
    // Only filter by AI-generated keywords (not by the description input text directly)
    if (sf.aiKeywords.length > 0) {
      result = result.filter(c => {
        const allText = [
          c.name, c.domain, c.description, c.industry,
          c.city, c.country,
          ...c.myContacts.map(ct => `${ct.title} ${ct.name}`),
          ...c.spaceContacts.map(ct => `${ct.title || ''} ${ct.name}`),
        ].filter(Boolean).join(' ').toLowerCase();
        return sf.aiKeywords.some(kw => allText.includes(kw));
      });
    }
    if (sf.excludeKeywords.length > 0) {
      {
        result = result.filter(c => {
          const text = [c.description, c.industry, c.name].filter(Boolean).join(' ').toLowerCase();
          return !sf.excludeKeywords.some(ex => text.includes(ex));
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
      result = result.filter(c =>
        sf.fundingRounds.some(fr => matchesFundingFilter(c.lastFundingRound, c.totalFunding, fr))
      );
    }

    // ── Funding recency ──
    if (sf.fundingRecency !== 'any') {
      const now = Date.now();
      const cutoff = sf.fundingRecency === '6m' ? now - 6 * 30 * 24 * 60 * 60 * 1000
                                                 : now - 365 * 24 * 60 * 60 * 1000;
      result = result.filter(c => {
        if (!c.lastFundingDate) return false;
        return new Date(c.lastFundingDate).getTime() >= cutoff;
      });
    }

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

    // When a hunt is selected, sort matching companies to the top
    if (selectedHunt) {
      result = [...result].sort((a, b) => {
        const aMatch = a.matchingHunts.includes(selectedHunt) ? 0 : 1;
        const bMatch = b.matchingHunts.includes(selectedHunt) ? 0 : 1;
        return aMatch - bMatch;
      });
    }

    return result;
  }, [mergedCompanies, selectedHunt, appliedSearchQuery, sourceFilter, strengthFilter, spaceFilter, connectionFilter, sortBy, sidebarFilters]);

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
    ['no-funding', 'pre-seed', 'series-a', 'series-b', 'vc-backed'].forEach(fr => {
      counts[fr] = mergedCompanies.filter(c => matchesFundingFilter(c.lastFundingRound, c.totalFunding, fr)).length;
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
    const sf = sidebarFilters;
    if (sf.categories.length > 0) n++;
    if (sf.aiKeywords.length > 0) n++;
    if (sf.excludeKeywords.length > 0) n++;
    if (sf.employeeRanges.length > 0) n++;
    if (sf.country) n++;
    if (sf.city) n++;
    if (sf.fundingRounds.length > 0) n++;
    if (sf.fundingRecency !== 'any') n++;
    if (sf.foundedFrom) n++;
    if (sf.foundedTo) n++;
    if (sf.revenueRanges.length > 0) n++;
    if (sf.technologies.length > 0) n++;
    if (sf.connectedYears.length > 0 || sf.connectedMonths.length > 0) n++;
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
    setLastAiQuery(null);
    setSidebarFilters({
      description: '',
      categories: [],
      excludeKeywords: [],
      aiKeywords: [],
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
      connectedYears: [],
      connectedMonths: [],
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
        setAppliedSearchQuery('');
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
    setAppliedSearchQuery('');
  }, [searchQuery]);

  // AI-powered search: parse natural language and directly fill sidebar filters
  const aiSearch = useCallback(async (query: string) => {
    setAiParsing(true);
    setAiExplanation(null);
    setLastAiQuery(null);
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

      // Directly apply to sidebar filters
      setConnectionFilter('all');
      setSelectedHunt(null);
      setGridPage(0);

      setSourceFilter(filters.sourceFilter && filters.sourceFilter !== 'all' ? filters.sourceFilter : 'all');
      setStrengthFilter(filters.strengthFilter && filters.strengthFilter !== 'all' ? filters.strengthFilter : 'all');

      if (filters.spaceFilter) {
        const matched = spaces.find((s: any) => s.name.toLowerCase().includes(filters.spaceFilter.toLowerCase()));
        setSpaceFilter(matched ? matched.id : 'all');
      } else {
        setSpaceFilter('all');
      }

      // Apply structural filters immediately
      setSidebarFilters(prev => ({
        ...prev,
        description: filters.description || '',
        categories: [],
        excludeKeywords: [],
        aiKeywords: [], // will be filled by expand-keywords below
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

      // Open the description section so user can see the AI keywords
      setOpenSections(prev => ({ ...prev, description: true }));
      setSearchQuery('');
      setAppliedSearchQuery('');
      setAiExplanation(explanation || null);

      // Now expand keywords via AI (the same way Business Description input does)
      const expandText = [
        filters.description || '',
        ...(semanticKeywords || []),
      ].filter(Boolean).join(', ');

      if (expandText.trim().length >= 2) {
        setAiKeywordsLoading(true);
        try {
          const kwRes = await fetch(`${API_BASE}/api/ai/expand-keywords`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ text: expandText.trim() }),
          });
          if (kwRes.ok) {
            const kwData = await kwRes.json();
            if (kwData.keywords?.length > 0) {
              const expandedKws = kwData.keywords.map((k: string) => k.toLowerCase());
              setSidebarFilters(prev => ({ ...prev, aiKeywords: expandedKws }));
              setLastAiQuery({ query: query.trim(), keywords: expandedKws });
            } else {
              // Fallback: use semantic keywords as-is
              const fallbackKws = (semanticKeywords || []).map((k: string) => k.toLowerCase());
              setSidebarFilters(prev => ({ ...prev, aiKeywords: fallbackKws }));
              setLastAiQuery({ query: query.trim(), keywords: fallbackKws });
            }
          }
        } catch {
          // Fallback: use semantic keywords as-is
          const fallbackKws = (semanticKeywords || []).map((k: string) => k.toLowerCase());
          setSidebarFilters(prev => ({ ...prev, aiKeywords: fallbackKws }));
          setLastAiQuery({ query: query.trim(), keywords: fallbackKws });
        } finally {
          setAiKeywordsLoading(false);
        }
      } else {
        setLastAiQuery({ query: query.trim(), keywords: [] });
      }
    } catch (e) {
      console.error('AI search failed, falling back to keyword search:', e);
      const keywords = query.toLowerCase().split(/[\s,]+/).filter(k => k.length > 2);
      if (keywords.length > 0) {
        setSidebarFilters(prev => ({ ...prev, aiKeywords: keywords, description: query.trim() }));
        setOpenSections(prev => ({ ...prev, description: true }));
        setLastAiQuery({ query: query.trim(), keywords });
      }
      setSearchQuery('');
      setAppliedSearchQuery('');
    } finally {
      setAiParsing(false);
    }
  }, [availableCountries, spaces]);

  // Save current AI search as a pinned hunt
  const saveAsHunt = useCallback(() => {
    if (!lastAiQuery) return;
    const { query, keywords } = lastAiQuery;
    if (keywords.length > 0) {
      const huntId = Date.now().toString();
      setHunts(prev => [...prev, {
        id: huntId,
        title: query,
        keywords,
        isActive: true,
      }]);
      setSelectedHunt(huntId);
    }
    setLastAiQuery(null);
    setAiExplanation(null);
  }, [lastAiQuery]);

  const removeHunt = useCallback((id: string) => {
    setHunts(prev => prev.filter(h => h.id !== id));
    if (selectedHunt === id) setSelectedHunt(null);
  }, [selectedHunt]);

  const openIntroPanel = useCallback((company: MergedCompany, overrideSourceFilter?: string, overrideSpaceFilter?: string) => {
    setInlinePanel({
      type: 'intro-request',
      company,
      introSourceFilter: overrideSourceFilter || sourceFilter,
      introSpaceFilter: overrideSpaceFilter || spaceFilter,
      introConnectionFilter: connectionFilter,
    });
  }, [sourceFilter, spaceFilter, connectionFilter]);

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
          openRequestCount: s._count?.requests || 0,
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

  // Fetch space detail requests when space panel opens
  useEffect(() => {
    if (inlinePanel?.type === 'space' && inlinePanel.spaceId) {
      const sid = inlinePanel.spaceId;
      fetch(`${API_BASE}/api/spaces/${sid}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.requests) {
            setSpaceRequests(prev => ({ ...prev, [sid]: data.requests }));
          }
        })
        .catch(() => {});
    }
  }, [inlinePanel]);

  // Fetch notifications + my intro requests
  const refreshIntroData = useCallback(() => {
    notificationsApi.getUnreadCount().then(r => setNotificationCount(r.count)).catch(() => {});
    notificationsApi.getAll().then(setNotifications).catch(() => {});
    requestsApi.getMine().then(setMyIntroRequests).catch(() => {});
    requestsApi.getIncoming().then(r => setIncomingRequests(r as any)).catch(() => {});
  }, []);

  useEffect(() => {
    refreshIntroData();
    const interval = setInterval(refreshIntroData, 30000);
    return () => clearInterval(interval);
  }, [refreshIntroData]);

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
                ] as const).map(f => (
                  <button
                    key={f.key}
                    className={`sb-chip sb-chip--${f.key} ${sourceFilter === f.key ? 'active' : ''}`}
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

            {/* ── Business description (AI keyword search) ── */}
            <SidebarSection id="description" icon="🔍" title="Business description">
              {/* AI search input */}
              <div className="sb-kw-section">
                <div className="sb-kw-section-header">
                  <span className="sb-kw-section-label">AI search</span>
                  {aiKeywordsLoading && <span className="sb-input-loading"><span className="u-spinner-sm" /></span>}
                </div>
                <div className="sb-input-wrap sb-input-with-btn">
                  <input
                    className="sb-input"
                    placeholder="e.g. b2b fintech"
                    value={sidebarFilters.description}
                    onChange={e => setSidebarFilters(p => ({ ...p, description: e.target.value }))}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && sidebarFilters.description.trim()) {
                        expandKeywords(sidebarFilters.description);
                      }
                    }}
                  />
                  <button
                    className="sb-input-search-btn"
                    disabled={!sidebarFilters.description.trim() || aiKeywordsLoading}
                    onClick={() => {
                      if (sidebarFilters.description.trim()) expandKeywords(sidebarFilters.description);
                    }}
                  >
                    {aiKeywordsLoading ? '...' : '→'}
                  </button>
                </div>
              </div>

              {/* Add keywords */}
              <div className="sb-kw-section">
                <div className="sb-kw-section-header">
                  <span className="sb-kw-section-label">Keywords</span>
                  {sidebarFilters.aiKeywords.length > 0 && (
                    <>
                      <span className="sb-kw-section-count">{sidebarFilters.aiKeywords.length}</span>
                      <button className="sb-kw-section-clear" onClick={() => setSidebarFilters(p => ({ ...p, aiKeywords: [] }))}>Clear</button>
                    </>
                  )}
                </div>
                <div className="sb-kw-chips">
                  {sidebarFilters.aiKeywords.map(kw => (
                    <span key={kw} className="sb-ai-kw-chip">
                      {kw}
                      <button className="sb-ai-kw-chip-x" onClick={() => removeAiKeyword(kw)}>×</button>
                    </span>
                  ))}
                  <input
                    className="sb-ai-kw-input"
                    placeholder="+ add"
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value.trim().toLowerCase();
                        if (val && !sidebarFilters.aiKeywords.includes(val)) {
                          setSidebarFilters(p => ({ ...p, aiKeywords: [...p.aiKeywords, val] }));
                        }
                        (e.target as HTMLInputElement).value = '';
                      }
                    }}
                  />
                </div>
              </div>

              {/* Exclude keywords */}
              <div className="sb-kw-section">
                <div className="sb-kw-section-header">
                  <span className="sb-kw-section-label">Exclude</span>
                  {sidebarFilters.excludeKeywords.length > 0 && (
                    <>
                      <span className="sb-kw-section-count">{sidebarFilters.excludeKeywords.length}</span>
                      <button className="sb-kw-section-clear" onClick={() => setSidebarFilters(p => ({ ...p, excludeKeywords: [] }))}>Clear</button>
                    </>
                  )}
                </div>
                <div className="sb-kw-chips">
                  {sidebarFilters.excludeKeywords.map(kw => (
                    <span key={kw} className="sb-exclude-chip">
                      {kw}
                      <button className="sb-exclude-chip-x" onClick={() => setSidebarFilters(p => ({ ...p, excludeKeywords: p.excludeKeywords.filter(k => k !== kw) }))}>×</button>
                    </span>
                  ))}
                  <input
                    className="sb-ai-kw-input"
                    placeholder="+ exclude"
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value.trim().toLowerCase();
                        if (val && !sidebarFilters.excludeKeywords.includes(val)) {
                          setSidebarFilters(p => ({ ...p, excludeKeywords: [...p.excludeKeywords, val] }));
                        }
                        (e.target as HTMLInputElement).value = '';
                      }
                    }}
                  />
                </div>
              </div>
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

            {/* ── Connected since (year/month tags) ── */}
            <SidebarSection id="connected-time" icon="📅" title="Connected since">
              <div className="sb-chips-group">
                <span className="sb-chips-label">Year</span>
                <div className="sb-chips">
                  {['2024', '2025', '2026'].map(y => (
                    <button
                      key={y}
                      className={`sb-chip sb-chip--time ${sidebarFilters.connectedYears.includes(y) ? 'active' : ''}`}
                      onClick={() => setSidebarFilters(prev => ({
                        ...prev,
                        connectedYears: prev.connectedYears.includes(y)
                          ? prev.connectedYears.filter(v => v !== y)
                          : [...prev.connectedYears, y],
                      }))}
                    >
                      {y}
                    </button>
                  ))}
                </div>
              </div>
              <div className="sb-chips-group">
                <span className="sb-chips-label">Month</span>
                <div className="sb-chips">
                  {[
                    { label: 'Jan', value: '1' },
                    { label: 'Feb', value: '2' },
                    { label: 'Mar', value: '3' },
                    { label: 'Apr', value: '4' },
                    { label: 'May', value: '5' },
                    { label: 'Jun', value: '6' },
                    { label: 'Jul', value: '7' },
                    { label: 'Aug', value: '8' },
                    { label: 'Sep', value: '9' },
                    { label: 'Oct', value: '10' },
                    { label: 'Nov', value: '11' },
                    { label: 'Dec', value: '12' },
                  ].map(m => (
                    <button
                      key={m.value}
                      className={`sb-chip sb-chip--time ${sidebarFilters.connectedMonths.includes(m.value) ? 'active' : ''}`}
                      onClick={() => setSidebarFilters(prev => ({
                        ...prev,
                        connectedMonths: prev.connectedMonths.includes(m.value)
                          ? prev.connectedMonths.filter(v => v !== m.value)
                          : [...prev.connectedMonths, m.value],
                      }))}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
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
                  { key: 'vc-backed', label: 'VC Backed' },
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
          {/* Save search button at bottom of sidebar — only for substantive filters, not source/strength */}
          {(sidebarFilters.aiKeywords.length > 0 || sidebarFilters.excludeKeywords.length > 0 || sidebarFilters.categories.length > 0 || sidebarFilters.employeeRanges.length > 0 || sidebarFilters.country || sidebarFilters.city || sidebarFilters.fundingRounds.length > 0 || sidebarFilters.fundingRecency !== 'any' || sidebarFilters.foundedFrom || sidebarFilters.foundedTo || sidebarFilters.revenueRanges.length > 0 || sidebarFilters.technologies.length > 0 || sidebarFilters.connectedYears.length > 0 || sidebarFilters.connectedMonths.length > 0) && (
            <div className="sb-save-search">
              <button className="sb-save-search-btn" onClick={() => {
                // Build keywords from text-based filters
                const keywords = [
                  ...sidebarFilters.aiKeywords,
                  ...sidebarFilters.categories.map(c => c.toLowerCase()),
                  ...(sidebarFilters.description ? sidebarFilters.description.toLowerCase().split(/\s+/).filter(w => w.length > 1) : []),
                ].filter((k, i, arr) => k && arr.indexOf(k) === i);

                // Capture all structural filters
                const sf = sidebarFilters;
                const savedFilters: HuntFilters = {};
                if (sf.employeeRanges.length > 0) savedFilters.employeeRanges = [...sf.employeeRanges];
                if (sf.country) savedFilters.country = sf.country;
                if (sf.city) savedFilters.city = sf.city;
                if (sf.fundingRounds.length > 0) savedFilters.fundingRounds = [...sf.fundingRounds];
                if (sf.fundingRecency !== 'any') savedFilters.fundingRecency = sf.fundingRecency;
                if (sf.foundedFrom) savedFilters.foundedFrom = sf.foundedFrom;
                if (sf.foundedTo) savedFilters.foundedTo = sf.foundedTo;
                if (sf.revenueRanges.length > 0) savedFilters.revenueRanges = [...sf.revenueRanges];
                if (sf.technologies.length > 0) savedFilters.technologies = [...sf.technologies];
                if (sourceFilter !== 'all') savedFilters.sourceFilter = sourceFilter;
                if (strengthFilter !== 'all') savedFilters.strengthFilter = strengthFilter;

                // Build a readable title
                const titleParts: string[] = [];
                if (sf.description) titleParts.push(sf.description);
                else if (sf.aiKeywords.length > 0) titleParts.push(sf.aiKeywords.slice(0, 3).join(', '));
                else if (sf.categories.length > 0) titleParts.push(sf.categories.join(', '));
                if (sf.employeeRanges.length > 0) titleParts.push(sf.employeeRanges.join('/') + ' emp');
                if (sf.country) titleParts.push(sf.country);
                if (sf.city) titleParts.push(sf.city);
                if (sf.fundingRounds.length > 0) {
                  const fundingLabels: Record<string, string> = {
                    'no-funding': 'No funding',
                    'pre-seed': 'Pre-Seed/Seed',
                    'series-a': 'Series A',
                    'series-b': 'Series B+',
                    'vc-backed': 'VC Backed',
                  };
                  titleParts.push(sf.fundingRounds.map(r => fundingLabels[r] || r).join(', '));
                }
                if (sf.fundingRecency !== 'any') {
                  titleParts.push(sf.fundingRecency === '6m' ? 'Funded < 6mo' : 'Funded < 1yr');
                }
                if (sf.foundedFrom || sf.foundedTo) {
                  titleParts.push(`Founded ${sf.foundedFrom || '…'}–${sf.foundedTo || '…'}`);
                }
                if (sf.revenueRanges.length > 0) titleParts.push('Revenue: ' + sf.revenueRanges.join(', '));
                if (sf.connectedYears.length > 0 || sf.connectedMonths.length > 0) {
                  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                  const parts = [
                    ...sf.connectedYears,
                    ...sf.connectedMonths.map(m => months[parseInt(m) - 1] || m),
                  ];
                  titleParts.push('Connected ' + parts.join(', '));
                }

                const title = titleParts.join(' · ') || 'Saved search';
                const huntId = Date.now().toString();
                setHunts(prev => [...prev, { id: huntId, title, keywords, filters: savedFilters, isActive: true }]);
                setSelectedHunt(huntId);
              }}>
                Save search
              </button>
            </div>
          )}
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
                    } else if (e.key === 'Enter' && searchQuery.trim().length > 0) {
                      setAppliedSearchQuery(searchQuery.trim());
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
                  <button className="u-search-clear" onClick={() => { setSearchQuery(''); setAppliedSearchQuery(''); }}>×</button>
                )}
                <kbd className="u-kbd">⌘K</kbd>
              </div>
            </div>

            <div className="u-topbar-right">
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
                className={`u-action-btn u-notif-btn ${inlinePanel?.type === 'notifications' ? 'active' : ''}`}
                title="Notifications"
                onClick={() => {
                  if (inlinePanel?.type === 'notifications') {
                    setInlinePanel(null);
                  } else {
                    setInlinePanel({ type: 'notifications' });
                    // Mark all as read when opening
                    notificationsApi.markAllRead().then(() => {
                      setNotificationCount(0);
                      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
                    }).catch(() => {});
                  }
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                {notificationCount > 0 && (
                  <span className="u-notif-badge">{notificationCount}</span>
                )}
              </button>
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
            {!sidebarOpen && (
              <button className="u-action-btn u-filter-toggle" onClick={() => setSidebarOpen(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 6h16M4 12h10M4 18h6" />
                </svg>
                Filters
                {activeFilterCount > 0 && <span className="u-filter-toggle-badge">{activeFilterCount}</span>}
              </button>
            )}
            <div className="u-fast-group">
              {([
                { key: 'all', label: 'All', count: stats.total },
                { key: 'mine', label: 'Mine', count: stats.myCompanies },
                { key: 'spaces', label: 'Network', count: stats.spaceCompanies },
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
          </div>

          {/* ── AI explanation banner ─────────────────────────── */}
          {aiExplanation && (
            <div className="u-ai-banner">
              <span className="u-ai-banner-icon">AI</span>
              <span className="u-ai-banner-text">{aiExplanation}</span>
              {lastAiQuery && (
                <button className="u-ai-banner-save" onClick={saveAsHunt}>Save as Hunt</button>
              )}
              <button className="u-ai-banner-dismiss" onClick={() => { setAiExplanation(null); setLastAiQuery(null); }}>×</button>
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
                {activeFilterCount > 0 || appliedSearchQuery ? (
                  <>
                    <span className="u-grid-empty-icon">🔍</span>
                    <span>No companies match your filters</span>
                    <button onClick={clearAllFilters}>Clear all filters</button>
                  </>
                ) : mergedCompanies.length === 0 ? (
                  <>
                    <span className="u-grid-empty-icon">📅</span>
                    <span>Connect your calendar to get started</span>
                    <button onClick={() => setInlinePanel({ type: 'settings' })}>Connect Calendar</button>
                  </>
                ) : (
                  <>
                    <span className="u-grid-empty-icon">🔍</span>
                    <span>No results found</span>
                  </>
                )}
              </div>
            ) : (() => {
              const renderCard = (company: MergedCompany) => (
                <div
                  key={company.domain}
                  className={[
                    'u-tile',
                    expandedDomain === company.domain ? 'expanded' : '',
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
                    <span className="u-tile-meta-badge u-tile-meta-badge--contacts">{company.totalCount} {company.totalCount === 1 ? 'contact' : 'contacts'}</span>
                    {company.employeeCount ? <span className="u-tile-meta-badge u-tile-meta-badge--enrich">{company.employeeCount.toLocaleString()} emp</span> : null}
                    {company.country ? <span className="u-tile-meta-badge u-tile-meta-badge--enrich">{company.city ? `${company.city}, ` : ''}{company.country}</span> : null}
                    {company.lastFundingRound ? <span className="u-tile-meta-badge u-tile-meta-badge--funding">{formatFundingRound(company.lastFundingRound)}</span> : null}
                  </div>
                  {expandedDomain === company.domain && (
                    <div className="u-tile-body">
                      {company.myContacts.length > 0 && (
                        <>
                          <div className="u-tile-section-label u-tile-section-label--mine">
                            Your contacts ({company.myContacts.length})
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
                            From network ({company.spaceContacts.length})
                          </div>
                          {company.spaceContacts.slice(0, 4).map(c => {
                            const spaceName = c.spaceId ? spaces.find(s => s.id === c.spaceId)?.name : null;
                            return (
                              <div key={c.id} className="u-contact u-contact--space">
                                <span className="u-contact-private-icon">👤</span>
                                <div className="u-contact-info">
                                  <span className="u-contact-name">{c.title || 'Contact'}</span>
                                  {spaceName && <span className="u-contact-title">from {spaceName}</span>}
                                </div>
                                <button className="u-contact-action" onClick={(e) => { e.stopPropagation(); openIntroPanel(company); }}>Intro</button>
                              </div>
                            );
                          })}
                          {company.spaceContacts.length > 4 && (
                            <div className="u-tile-more">+{company.spaceContacts.length - 4} more from network</div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );

              // When filtered by a connection or space, split into new vs already known
              if (connectionFilter !== 'all' || spaceFilter !== 'all') {
                const newToYou = filteredCompanies.filter(c => c.myCount === 0 || c.spaceCount > 0);
                const alreadyKnown = filteredCompanies.filter(c => c.myCount > 0 && c.spaceCount === 0);
                let sourceName = '';
                if (connectionFilter !== 'all') {
                  const connPeer = connections.find(c => c.id === connectionFilter)?.peer;
                  sourceName = connPeer?.name || 'connection';
                } else {
                  const space = spaces.find(s => s.id === spaceFilter);
                  sourceName = space?.name || 'space';
                }
                return (
                  <>
                    {newToYou.length > 0 && (
                      <>
                        <div className="u-grid-section-header">
                          <span className="u-grid-section-title">New from {sourceName}</span>
                          <span className="u-grid-section-count">{newToYou.length}</span>
                        </div>
                        {newToYou.map(renderCard)}
                      </>
                    )}
                    {alreadyKnown.length > 0 && (
                      <>
                        <div className="u-grid-section-header u-grid-section-header--overlap">
                          <span className="u-grid-section-title">Already in your network</span>
                          <span className="u-grid-section-count">{alreadyKnown.length}</span>
                        </div>
                        {alreadyKnown.map(renderCard)}
                      </>
                    )}
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
              const fromSpace = inlinePanel.fromSpaceId ? spaces.find(s => s.id === inlinePanel.fromSpaceId) : null;
              const isMyContact = !!dc; // DisplayContact = user's own contact, no intro needed
              const isInNetwork = isMyContact || connections.some(conn => conn.peer.email === c.email && conn.status === 'accepted');
              return (
              <div className="u-panel-person">
                {fromSpace && (
                  <button className="u-panel-breadcrumb" onClick={() => setInlinePanel({ type: 'space', spaceId: fromSpace.id })}>
                    ← {fromSpace.emoji} {fromSpace.name}
                  </button>
                )}
                {!fromSpace && co && (
                  <button className="u-panel-breadcrumb" onClick={() => setInlinePanel({ type: 'company', company: co, fromSpaceId: inlinePanel.fromSpaceId })}>
                    ← {co.name}
                  </button>
                )}
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
                        <span className="u-panel-meta-tag u-panel-meta-tag--funding">{formatFundingRound(co.lastFundingRound)}</span>
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
                  {!isInNetwork && co && (
                    <button
                      className="u-primary-btn"
                      onClick={() => openIntroPanel(co, undefined, inlinePanel.fromSpaceId || undefined)}
                    >
                      ✨ Request Intro
                    </button>
                  )}
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
              const fromSpaceForCompany = inlinePanel.fromSpaceId ? spaces.find(s => s.id === inlinePanel.fromSpaceId) : null;
              return (
              <div className="u-panel-company">
                {fromSpaceForCompany && (
                  <button className="u-panel-breadcrumb" onClick={() => setInlinePanel({ type: 'space', spaceId: fromSpaceForCompany.id })}>
                    ← {fromSpaceForCompany.emoji} {fromSpaceForCompany.name}
                  </button>
                )}
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
                    <span className="u-panel-stat-value">{co.totalCount}</span>
                    <span className="u-panel-stat-label">Contacts</span>
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

                {/* Links — always show */}
                <div className="u-panel-links">
                  <a href={`https://${co.domain}`} target="_blank" rel="noopener noreferrer" className="u-panel-link-btn">
                    Website
                  </a>
                  {co.linkedinUrl && (
                    <a href={co.linkedinUrl} target="_blank" rel="noopener noreferrer" className="u-panel-link-btn">
                      LinkedIn
                    </a>
                  )}
                </div>

                {/* Description */}
                {co.description && (
                  <div className="u-panel-section">
                    <h4 className="u-panel-section-h">About</h4>
                    <p className="u-panel-section-text">{co.description}</p>
                  </div>
                )}

                {/* Details grid — show whatever we have */}
                {(co.industry || co.city || co.country || co.annualRevenue || co.totalFunding || co.lastFundingRound) && (
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
                        <span className="u-panel-detail-val">{formatFundingRound(co.lastFundingRound)}</span>
                      </div>
                    )}
                  </div>
                </div>
                )}

                {/* All contacts — space contacts shown with full detail */}
                {co.spaceContacts.length > 0 && (
                  <div className="u-panel-section">
                    <h4 className="u-panel-section-h">From network ({co.spaceContacts.length})</h4>
                    <div className="u-panel-contact-list">
                      {co.spaceContacts.map(c => {
                        const spaceName = c.spaceId ? spaces.find(s => s.id === c.spaceId)?.name : null;
                        return (
                          <div key={c.id} className="u-panel-contact-row u-panel-contact-row--private">
                            <div className="u-panel-contact-avatar-private">👤</div>
                            <div className="u-panel-contact-info">
                              <span className="u-panel-contact-name">{c.title || 'Contact'}</span>
                              {spaceName && <span className="u-panel-contact-title">from {spaceName}</span>}
                            </div>
                            <button className="u-panel-contact-intro-btn" onClick={(e) => { e.stopPropagation(); openIntroPanel(co, undefined, inlinePanel.fromSpaceId || undefined); }}>Intro</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {co.myContacts.length > 0 && (
                  <div className="u-panel-section">
                    <h4 className="u-panel-section-h">Your contacts ({co.myContacts.length})</h4>
                    <div className="u-panel-contact-list">
                      {co.myContacts.map(c => (
                        <div key={c.id} className="u-panel-contact-row" onClick={() => setInlinePanel({ type: 'person', contact: c, company: co, fromSpaceId: inlinePanel.fromSpaceId })}>
                          <PersonAvatar email={c.email} name={c.name} avatarUrl={c.photoUrl} size={28} />
                          <div className="u-panel-contact-info">
                            <span className="u-panel-contact-name">{c.name}</span>
                            <span className="u-panel-contact-title">{c.title || c.email}</span>
                          </div>
                          <span className={`u-strength u-strength--${c.connectionStrength}`}>{c.connectionStrength}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="u-panel-actions">
                  {co.spaceCount > 0 && (
                    <button className="u-primary-btn" onClick={() => openIntroPanel(co, undefined, inlinePanel.fromSpaceId || undefined)}>
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
              const thisSpaceRequests = spaceRequests[space.id] || [];
              return (
              <div className="u-panel-space">
                <button
                  className="u-panel-breadcrumb"
                  onClick={() => setInlinePanel({ type: 'network-manage' })}
                >
                  ← Spaces
                </button>
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

                {/* Intro Requests — all open requests in this space */}
                {(() => { const visibleRequests = thisSpaceRequests.filter(r => !dismissedRequestIds.has(r.id)); return visibleRequests.length > 0 ? (
                  <div className="u-panel-section">
                    <div className="u-panel-section-h">
                      Intro Requests
                      <span className="u-notif-inline-badge">{visibleRequests.length}</span>
                    </div>
                    <p className="u-panel-section-hint">Only you see these — the requester doesn't know who has the connection.</p>
                    <div className="u-panel-request-list">
                      {thisSpaceRequests.map(r => {
                        const nq = r.normalizedQuery || {};
                        const companyName = nq.companyName as string || 'a company';
                        const companyDomain = nq.companyDomain as string || '';
                        const companyId = nq.companyId as string || '';
                        const isMe = r.requester.id === currentUser?.id;
                        const timeAgo = getTimeAgo(r.createdAt);
                        const matchedCompany = mergedCompanies.find(c => (companyId && c.id === companyId) || (companyDomain && c.domain === companyDomain));
                        const myContactsAtCompany = matchedCompany?.myContacts || [];
                        const isOpen = r.status === 'open';
                        const isDeclining = decliningRequestId === r.id;
                        const isPickingContact = introPickerRequestId === r.id;

                        return (
                          <div key={r.id} className={`u-panel-request-card ${isMe ? 'sent' : ''} ${!isOpen ? 'resolved' : ''}`}>
                            {/* Header row: avatar, name, time, status */}
                            <div className="u-panel-request-top">
                              <div
                                className={`u-panel-request-avatar ${isMe ? 'sent' : ''} ${!isMe ? 'clickable' : ''}`}
                                onClick={() => { if (!isMe) setInlinePanel({ type: 'person', contact: { id: r.requester.id, name: r.requester.name, email: r.requester.email || '' }, fromSpaceId: space.id }); }}
                                title={!isMe ? `View ${r.requester.name}'s profile` : undefined}
                              >
                                {r.requester.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="u-panel-request-meta">
                                <span
                                  className={`u-panel-request-who ${!isMe ? 'clickable' : ''}`}
                                  onClick={() => { if (!isMe) setInlinePanel({ type: 'person', contact: { id: r.requester.id, name: r.requester.name, email: r.requester.email || '' }, fromSpaceId: space.id }); }}
                                  title={!isMe ? `View ${r.requester.name}'s profile` : undefined}
                                >
                                  {isMe ? 'You' : r.requester.name}
                                </span>
                                <span className="u-panel-request-time">{timeAgo}</span>
                              </div>
                              <span className={`u-panel-request-status u-panel-request-status--${r.status}`}>{r.status.toUpperCase()}</span>
                              {!isOpen && (
                                <button
                                  className="u-panel-request-dismiss"
                                  title="Dismiss"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDismissedRequestIds(prev => new Set(prev).add(r.id));
                                    // Delete from server if it's my request
                                    if (isMe) {
                                      requestsApi.delete(r.id).catch(() => {});
                                    }
                                  }}
                                >
                                  ×
                                </button>
                              )}
                            </div>

                            {/* Intent line */}
                            <p className="u-panel-request-intent">
                              {isMe ? 'You requested' : 'Requests'} an intro to{' '}
                              <span
                                className={`u-panel-request-company-link ${matchedCompany ? 'clickable' : ''}`}
                                onClick={() => { if (matchedCompany) setInlinePanel({ type: 'company', company: matchedCompany, fromSpaceId: space.id }); }}
                                title={matchedCompany ? `View ${companyName}` : undefined}
                              >
                                <CompanyLogo domain={companyDomain} name={companyName} size={14} />
                                {companyName}
                                {matchedCompany && <span className="u-panel-request-arrow">→</span>}
                              </span>
                            </p>

                            {/* Message */}
                            {r.rawText && (
                              <p className="u-panel-request-msg">"{r.rawText}"</p>
                            )}

                            {/* Your contacts at this company */}
                            {!isMe && myContactsAtCompany.length > 0 && (
                              <div className="u-panel-request-contacts">
                                <span className="u-panel-request-contacts-label">Your contacts at {companyName}:</span>
                                <div className="u-panel-request-contacts-list">
                                  {myContactsAtCompany.slice(0, 3).map(c => (
                                    <span
                                      key={c.id}
                                      className="u-panel-request-contact-chip clickable"
                                      onClick={() => setInlinePanel({ type: 'person', contact: c, company: matchedCompany, fromSpaceId: space.id })}
                                      title={`View ${c.name}'s profile`}
                                    >
                                      {c.name}
                                      {c.title && <span className="u-panel-request-contact-title"> · {c.title}</span>}
                                    </span>
                                  ))}
                                  {myContactsAtCompany.length > 3 && (
                                    <span className="u-panel-request-contact-chip u-panel-request-contact-more">+{myContactsAtCompany.length - 3} more</span>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Action buttons — only for others' requests that are still open */}
                            {!isMe && isOpen && !isDeclining && !isPickingContact && (
                              <div className="u-panel-request-actions">
                                <button
                                  className="u-req-action-btn u-req-action-btn--intro"
                                  onClick={() => {
                                    if (myContactsAtCompany.length === 0) {
                                      // No contacts — open a simple offer email
                                      openOfferIntroEmail({
                                        requesterEmail: r.requester.email || '',
                                        requesterName: r.requester.name,
                                        targetCompany: companyName,
                                      });
                                      offersApi.create({ requestId: r.id, message: 'Intro offered via email' }).catch(() => {});
                                    } else if (myContactsAtCompany.length === 1) {
                                      // One contact — open double intro immediately
                                      const contact = myContactsAtCompany[0];
                                      openDoubleIntroEmail({
                                        requesterEmail: r.requester.email || '',
                                        requesterName: r.requester.name,
                                        contactEmail: contact.email,
                                        contactName: contact.name,
                                        targetCompany: companyName,
                                      });
                                      offersApi.create({ requestId: r.id, message: `Intro to ${contact.name}` }).catch(() => {});
                                    } else {
                                      // Multiple contacts — show picker
                                      setIntroPickerRequestId(r.id);
                                    }
                                  }}
                                >
                                  Make Intro
                                </button>
                                <button
                                  className="u-req-action-btn u-req-action-btn--decline"
                                  onClick={() => { setDecliningRequestId(r.id); setDeclineReason(''); }}
                                >
                                  Decline
                                </button>
                              </div>
                            )}

                            {/* Contact picker for Make Intro */}
                            {isPickingContact && (
                              <div className="u-req-picker">
                                <span className="u-req-picker-label">Pick a contact to introduce:</span>
                                {myContactsAtCompany.map(c => (
                                  <button
                                    key={c.id}
                                    className="u-req-picker-item"
                                    onClick={() => {
                                      openDoubleIntroEmail({
                                        requesterEmail: r.requester.email || '',
                                        requesterName: r.requester.name,
                                        contactEmail: c.email,
                                        contactName: c.name,
                                        targetCompany: companyName,
                                      });
                                      offersApi.create({ requestId: r.id, message: `Intro to ${c.name}` }).catch(() => {});
                                      setIntroPickerRequestId(null);
                                    }}
                                  >
                                    <PersonAvatar email={c.email} name={c.name} avatarUrl={c.photoUrl} size={22} />
                                    <span className="u-req-picker-name">{c.name}</span>
                                    {c.title && <span className="u-req-picker-title">{c.title}</span>}
                                  </button>
                                ))}
                                <button className="u-req-picker-cancel" onClick={() => setIntroPickerRequestId(null)}>Cancel</button>
                              </div>
                            )}

                            {/* Decline form */}
                            {isDeclining && (
                              <div className="u-req-decline">
                                <textarea
                                  className="u-req-decline-input"
                                  placeholder="Reason (optional, stays anonymous)"
                                  rows={2}
                                  value={declineReason}
                                  onChange={e => setDeclineReason(e.target.value)}
                                />
                                <div className="u-req-decline-btns">
                                  <button
                                    className="u-req-action-btn u-req-action-btn--decline-confirm"
                                    onClick={async () => {
                                      try {
                                        await requestsApi.decline(r.id, declineReason.trim() || undefined);
                                        setSpaceRequests(prev => ({
                                          ...prev,
                                          [space.id]: (prev[space.id] || []).map(req =>
                                            req.id === r.id ? { ...req, status: 'declined' } : req
                                          ),
                                        }));
                                        fetchSpacesList();
                                      } catch (err) {
                                        console.error('Failed to decline:', err);
                                      }
                                      setDecliningRequestId(null);
                                      setDeclineReason('');
                                    }}
                                  >
                                    Confirm Decline
                                  </button>
                                  <button
                                    className="u-req-action-btn"
                                    onClick={() => { setDecliningRequestId(null); setDeclineReason(''); }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null; })()}

                {/* Space actions */}
                <div className="u-panel-actions">
                  {isOwner && space.inviteCode && (
                    <button className="u-action-btn" onClick={() => copyInviteCode(space.inviteCode!)}>
                      {copiedCode ? '✓ Copied!' : 'Copy invite code'}
                    </button>
                  )}
                  {!isOwner && (
                    <button className="u-action-btn u-action-btn--danger" onClick={() => { leaveSpace(space.id); setInlinePanel({ type: 'network-manage' }); }}>
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
                      const reqCount = s.openRequestCount || 0;
                      return (
                        <div key={s.id} className="u-panel-space-card" onClick={() => setInlinePanel({ type: 'space', spaceId: s.id })}>
                          <span className="u-panel-space-emoji">{s.emoji}</span>
                          <div className="u-panel-space-card-info">
                            <span className="u-panel-space-card-name">{s.name}</span>
                            <span className="u-panel-space-card-stats">{s.memberCount} members · {companyCount} companies</span>
                          </div>
                          {reqCount > 0 && (
                            <span className="u-panel-space-notif">
                              {reqCount} {reqCount === 1 ? 'request' : 'requests'}
                            </span>
                          )}
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
                    <button className="sb-space-action-btn primary" onClick={() => { setShowCreateSpace(v => !v); setShowJoinSpace(false); }}>
                      {showCreateSpace ? 'Cancel' : '+ Create'}
                    </button>
                    <button className="sb-space-action-btn" onClick={() => { setShowJoinSpace(v => !v); setShowCreateSpace(false); setJoinCode(''); setJoinStatus(null); }}>
                      {showJoinSpace ? 'Cancel' : 'Join'}
                    </button>
                  </div>

                  {/* Inline create space form */}
                  {showCreateSpace && (
                    <div className="sb-space-form-row" style={{ marginTop: '0.5rem' }}>
                      <input
                        className="sb-input sb-space-emoji-input"
                        value={newSpaceEmoji}
                        onChange={e => setNewSpaceEmoji(e.target.value)}
                        maxLength={2}
                        style={{ width: '2.5rem', textAlign: 'center' }}
                      />
                      <input
                        className="sb-input"
                        style={{ flex: 1 }}
                        placeholder="Space name"
                        value={newSpaceName}
                        onChange={e => setNewSpaceName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') createSpace(); }}
                        autoFocus
                      />
                      <button className="sb-space-action-btn primary" onClick={createSpace} disabled={!newSpaceName.trim()}>→</button>
                    </div>
                  )}

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
                    {connections.filter(c => c.status === 'accepted').map(c => {
                      const connReqCount = incomingRequests.filter(r => r.requester.id === c.peer.id && r.status === 'open' && !dismissedRequestIds.has(r.id)).length;
                      return (
                        <div key={c.id} className="u-panel-space-card" onClick={() => setInlinePanel({ type: 'connection', connectionId: c.id })}>
                          <PersonAvatar email={c.peer.email} name={c.peer.name} avatarUrl={c.peer.avatar} size={32} />
                          <div className="u-panel-space-card-info">
                            <span className="u-panel-space-card-name">{c.peer.name}</span>
                            <span className="u-panel-space-card-stats">{c.peer.email}</span>
                          </div>
                          {connReqCount > 0 && (
                            <span className="u-panel-space-notif">{connReqCount} {connReqCount === 1 ? 'request' : 'requests'}</span>
                          )}
                        </div>
                      );
                    })}
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
              const peerId = conn.peer.id;
              // Requests I sent to this peer + requests this peer sent to me
              const connRequests = [
                ...(myIntroRequests || []).filter(r => {
                  const nq = (r.normalizedQuery || {}) as Record<string, unknown>;
                  return nq.connectionPeerId === peerId;
                }).map(r => ({ ...r, requester: { id: currentUser?.id || '', name: currentUser?.name || 'You', email: currentUser?.email || '', avatar: currentUser?.avatar || null } })),
                ...incomingRequests.filter(r => r.requester.id === peerId),
              ].filter(r => !dismissedRequestIds.has(r.id));

              return (
              <div className="u-panel-space">
                <button className="u-panel-breadcrumb" onClick={() => setInlinePanel({ type: 'network-manage' })}>← Network</button>
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

                {/* Intro Requests for this connection */}
                {connRequests.length > 0 && (
                  <div className="u-panel-section">
                    <div className="u-panel-section-h">
                      Intro Requests
                      <span className="u-notif-inline-badge">{connRequests.length}</span>
                    </div>
                    <p className="u-panel-section-hint">Private between you and {conn.peer.name}.</p>
                    <div className="u-panel-request-list">
                      {connRequests.map(r => {
                        const nq = r.normalizedQuery || {};
                        const companyName = nq.companyName as string || 'a company';
                        const companyDomain = nq.companyDomain as string || '';
                        const companyId = nq.companyId as string || '';
                        const isMe = r.requester.id === currentUser?.id;
                        const timeAgo = getTimeAgo(r.createdAt);
                        const matchedCompany = mergedCompanies.find(c => (companyId && c.id === companyId) || (companyDomain && c.domain === companyDomain));
                        const myContactsAtCompany = matchedCompany?.myContacts || [];
                        const isOpen = r.status === 'open';
                        const isDeclining = decliningRequestId === r.id;
                        const isPickingContact = introPickerRequestId === r.id;

                        return (
                          <div key={r.id} className={`u-panel-request-card ${isMe ? 'sent' : ''} ${!isOpen ? 'resolved' : ''}`}>
                            <div className="u-panel-request-top">
                              <div className={`u-panel-request-avatar ${isMe ? 'sent' : ''}`}>
                                {r.requester.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="u-panel-request-meta">
                                <span className="u-panel-request-who">{isMe ? 'You' : r.requester.name}</span>
                                <span className="u-panel-request-time">{timeAgo}</span>
                              </div>
                              <span className={`u-panel-request-status u-panel-request-status--${r.status}`}>{r.status.toUpperCase()}</span>
                              {!isOpen && (
                                <button
                                  className="u-panel-request-dismiss"
                                  title="Dismiss"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDismissedRequestIds(prev => new Set(prev).add(r.id));
                                    if (isMe) requestsApi.delete(r.id).catch(() => {});
                                  }}
                                >×</button>
                              )}
                            </div>

                            <p className="u-panel-request-intent">
                              {isMe ? 'You requested' : 'Requests'} an intro to{' '}
                              <span
                                className={`u-panel-request-company-link ${matchedCompany ? 'clickable' : ''}`}
                                onClick={() => { if (matchedCompany) setInlinePanel({ type: 'company', company: matchedCompany }); }}
                              >
                                <CompanyLogo domain={companyDomain} name={companyName} size={14} />
                                {companyName}
                                {matchedCompany && <span className="u-panel-request-arrow">→</span>}
                              </span>
                            </p>

                            {r.rawText && <p className="u-panel-request-msg">"{r.rawText}"</p>}

                            {!isMe && myContactsAtCompany.length > 0 && (
                              <div className="u-panel-request-contacts">
                                <span className="u-panel-request-contacts-label">Your contacts at {companyName}:</span>
                                <div className="u-panel-request-contacts-list">
                                  {myContactsAtCompany.slice(0, 3).map(c => (
                                    <span key={c.id} className="u-panel-request-contact-chip clickable"
                                      onClick={() => setInlinePanel({ type: 'person', contact: c, company: matchedCompany })}
                                    >
                                      {c.name}
                                      {c.title && <span className="u-panel-request-contact-title"> · {c.title}</span>}
                                    </span>
                                  ))}
                                  {myContactsAtCompany.length > 3 && (
                                    <span className="u-panel-request-contact-chip u-panel-request-contact-more">+{myContactsAtCompany.length - 3} more</span>
                                  )}
                                </div>
                              </div>
                            )}

                            {!isMe && isOpen && !isDeclining && !isPickingContact && (
                              <div className="u-panel-request-actions">
                                <button
                                  className="u-req-action-btn u-req-action-btn--intro"
                                  onClick={() => {
                                    if (myContactsAtCompany.length === 0) {
                                      openOfferIntroEmail({ requesterEmail: r.requester.email || '', requesterName: r.requester.name, targetCompany: companyName });
                                      offersApi.create({ requestId: r.id, message: 'Intro offered via email' }).catch(() => {});
                                    } else if (myContactsAtCompany.length === 1) {
                                      const contact = myContactsAtCompany[0];
                                      openDoubleIntroEmail({ requesterEmail: r.requester.email || '', requesterName: r.requester.name, contactEmail: contact.email, contactName: contact.name, targetCompany: companyName });
                                      offersApi.create({ requestId: r.id, message: `Intro to ${contact.name}` }).catch(() => {});
                                    } else {
                                      setIntroPickerRequestId(r.id);
                                    }
                                  }}
                                >Make Intro</button>
                                <button className="u-req-action-btn u-req-action-btn--decline" onClick={() => { setDecliningRequestId(r.id); setDeclineReason(''); }}>Decline</button>
                              </div>
                            )}

                            {isPickingContact && (
                              <div className="u-req-picker">
                                <span className="u-req-picker-label">Pick a contact to introduce:</span>
                                {myContactsAtCompany.map(c => (
                                  <button key={c.id} className="u-req-picker-item" onClick={() => {
                                    openDoubleIntroEmail({ requesterEmail: r.requester.email || '', requesterName: r.requester.name, contactEmail: c.email, contactName: c.name, targetCompany: companyName });
                                    offersApi.create({ requestId: r.id, message: `Intro to ${c.name}` }).catch(() => {});
                                    setIntroPickerRequestId(null);
                                  }}>
                                    <span className="u-req-picker-name">{c.name}</span>
                                    {c.title && <span className="u-req-picker-title">{c.title}</span>}
                                  </button>
                                ))}
                                <button className="u-req-picker-cancel" onClick={() => setIntroPickerRequestId(null)}>Cancel</button>
                              </div>
                            )}

                            {isDeclining && (
                              <div className="u-req-decline">
                                <textarea className="u-req-decline-input" placeholder="Reason (optional, stays anonymous)" rows={2} value={declineReason} onChange={e => setDeclineReason(e.target.value)} />
                                <div className="u-req-decline-btns">
                                  <button className="u-req-action-btn u-req-action-btn--decline-confirm" onClick={async () => {
                                    try {
                                      await requestsApi.decline(r.id, declineReason.trim() || undefined);
                                      setIncomingRequests(prev => prev.map(req => req.id === r.id ? { ...req, status: 'declined' } : req));
                                    } catch (err) { console.error('Failed to decline:', err); }
                                    setDecliningRequestId(null); setDeclineReason('');
                                  }}>Confirm Decline</button>
                                  <button className="u-req-action-btn" onClick={() => { setDecliningRequestId(null); setDeclineReason(''); }}>Cancel</button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="u-panel-actions">
                  <button className="u-action-btn u-action-btn--danger" onClick={() => { removeConnection(conn.id); setInlinePanel({ type: 'network-manage' }); }}>
                    Disconnect
                  </button>
                </div>
              </div>
              );
            })()}

            {/* ── Notifications Panel ── */}
            {inlinePanel.type === 'notifications' && (
              <div className="u-panel-notifs">
                <h2>Notifications</h2>
                {notifications.length === 0 ? (
                  <div className="u-panel-empty">
                    <span className="u-panel-empty-icon">🔔</span>
                    <p>No notifications yet</p>
                  </div>
                ) : (() => {
                  const unread = notifications.filter(n => !n.isRead);
                  const read = notifications.filter(n => n.isRead);
                  const renderNotif = (n: (typeof notifications)[number]) => {
                      const data = (n.data || {}) as Record<string, unknown>;
                      const spaceId = data.spaceId as string | undefined;
                      const spaceEmoji = data.spaceEmoji as string | undefined;
                      const spaceName = data.spaceName as string | undefined;
                      const companyName = data.companyName as string | undefined;
                      const companyDomain = data.companyDomain as string | undefined;
                      const reason = data.reason as string | undefined;
                      const connPeerId = data.connectionPeerId as string | undefined;
                      const connPeerName = data.connectionPeerName as string | undefined;
                      const requesterId = data.requesterId as string | undefined;
                      const timeAgo = getTimeAgo(n.createdAt);
                      const isIntroType = ['intro_request', 'intro_offered', 'intro_declined'].includes(n.type);
                      const is1to1 = isIntroType && !spaceId && !!(connPeerId || requesterId);

                      // Find the connection for 1-1 notifications
                      const notifConn = connPeerId || requesterId
                        ? connections.find(c => c.peer.id === connPeerId || c.peer.id === requesterId)
                        : null;
                      // Find matching company for intro notifications
                      const notifCompanyId = data.companyId as string | undefined;
                      const matchedNotifCompany = isIntroType
                        ? mergedCompanies.find(c => (notifCompanyId && c.id === notifCompanyId) || (companyDomain && c.domain === companyDomain))
                        : undefined;
                      const isClickable = !!(spaceId || notifConn || matchedNotifCompany);

                      // Determine icon based on notification type
                      let icon = '🔔';
                      let accentClass = '';
                      if (n.type === 'intro_request') { icon = '🤝'; accentClass = 'intro'; }
                      else if (n.type === 'intro_offered') { icon = '✨'; accentClass = 'offered'; }
                      else if (n.type === 'intro_declined') { icon = '✗'; accentClass = 'declined'; }
                      else if (n.type === 'space_invited' || n.type === 'space_approved') { icon = '🎉'; accentClass = 'space-positive'; }
                      else if (n.type === 'space_member_joined') { icon = '👋'; accentClass = 'space-positive'; }
                      else if (n.type === 'space_join_request') { icon = '📩'; accentClass = 'space-neutral'; }
                      else if (n.type === 'space_member_left') { icon = '👤'; accentClass = 'space-neutral'; }
                      else if (n.type === 'space_removed') { icon = '🚫'; accentClass = 'space-negative'; }

                      return (
                        <div
                          key={n.id}
                          className={`u-panel-notif-card ${!n.isRead ? 'unread' : ''} ${isClickable ? 'clickable' : ''}`}
                          onClick={() => {
                            if (n.type === 'intro_request' && spaceId) {
                              // Connector sees request → go to space
                              setInlinePanel({ type: 'space', spaceId });
                            } else if (n.type === 'intro_request' && notifConn) {
                              // Connector sees 1-1 request → go to connection
                              setInlinePanel({ type: 'connection', connectionId: notifConn.id });
                            } else if (is1to1 && notifConn) {
                              // 1-1 declined/offered → go to person page
                              setInlinePanel({ type: 'connection', connectionId: notifConn.id });
                            } else if (matchedNotifCompany) {
                              // Requester sees declined/offered → go to company
                              setInlinePanel({ type: 'company', company: matchedNotifCompany });
                            } else if (spaceId) {
                              setInlinePanel({ type: 'space', spaceId });
                            } else if (notifConn) {
                              setInlinePanel({ type: 'connection', connectionId: notifConn.id });
                            }
                          }}
                        >
                          <div className={`u-panel-notif-icon ${accentClass}`}>{icon}</div>
                          <div className="u-panel-notif-body">
                            <div className="u-panel-notif-title">{n.title}</div>
                            {n.body && <div className="u-panel-notif-text">{n.body}</div>}
                            {/* Intro details: company + space/person tags */}
                            {isIntroType && (companyName || spaceName || is1to1) && (
                              <div className="u-panel-notif-tags">
                                {companyName && (
                                  <span className="u-panel-notif-tag u-panel-notif-tag--company">
                                    {companyDomain && <CompanyLogo domain={companyDomain} name={companyName} size={12} />}
                                    {companyName}
                                  </span>
                                )}
                                {spaceName && (
                                  <span className="u-panel-notif-tag u-panel-notif-tag--space">
                                    {spaceEmoji || '🫛'} {spaceName}
                                  </span>
                                )}
                                {is1to1 && (notifConn || connPeerName) && (
                                  <span className="u-panel-notif-tag u-panel-notif-tag--space">
                                    👤 {notifConn?.peer.name || connPeerName}
                                  </span>
                                )}
                              </div>
                            )}
                            {/* Decline reason */}
                            {n.type === 'intro_declined' && reason && (
                              <div className="u-panel-notif-reason">"{reason}"</div>
                            )}
                            <div className="u-panel-notif-footer">
                              <span className="u-panel-notif-time">{timeAgo}</span>
                              {!isIntroType && spaceId && spaceName && (
                                <span className="u-panel-notif-space">{spaceEmoji || '🫛'} {spaceName}</span>
                              )}
                            </div>
                          </div>
                          {isClickable && <span className="u-panel-notif-arrow">→</span>}
                        </div>
                      );
                    };
                  return (
                    <div className="u-panel-notif-list">
                      {unread.length > 0 && (
                        <>
                          <div className="u-panel-notif-section-label">New</div>
                          {unread.map(renderNotif)}
                        </>
                      )}
                      {read.length > 0 && (
                        <>
                          <div className="u-panel-notif-section-label u-panel-notif-section-label--earlier">Earlier</div>
                          {read.map(renderNotif)}
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

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

            {inlinePanel.type === 'intro-request' && inlinePanel.company && (() => {
              const co = inlinePanel.company;
              const iSrcFilter = inlinePanel.introSourceFilter || 'all';
              const iSpaceFilter = inlinePanel.introSpaceFilter || 'all';
              const iConnFilter = inlinePanel.introConnectionFilter || 'all';

              // If the user was filtering to "mine" (1-1) or a specific connection, don't send to any space
              const skipSpaces = iSrcFilter === 'mine' || iConnFilter !== 'all';

              // Group space contacts by space — only real spaces, not 1-1 connections
              const bySpace: Record<string, { spaceName: string; spaceEmoji: string; count: number }> = {};
              if (!skipSpaces) {
                co.spaceContacts.forEach(c => {
                  if (!c.spaceId) return; // skip 1-1 contacts
                  // If filtered to a specific space, only include that space
                  if (iSpaceFilter !== 'all' && c.spaceId !== iSpaceFilter) return;
                  const sp = spaces.find(s => s.id === c.spaceId);
                  if (!sp) return;
                  if (!bySpace[c.spaceId]) bySpace[c.spaceId] = { spaceName: sp.name, spaceEmoji: sp.emoji || '🫛', count: 0 };
                  bySpace[c.spaceId].count++;
                });
              }
              const spaceIds = Object.keys(bySpace);
              const hasSpaces = spaceIds.length > 0;

              // For 1-1: find the connection person
              const directConn = iConnFilter !== 'all' ? connections.find(c => c.id === iConnFilter) : null;
              const isDirectIntro = skipSpaces && !hasSpaces;

              return (
              <div className="u-panel-intro">
                <h2>Request Intro</h2>
                <div className="u-panel-target">
                  <CompanyLogo domain={co.domain} name={co.name} size={32} />
                  <span>{co.name}</span>
                </div>

                <div className="u-panel-section">
                  <p className="u-panel-section-text" style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    {hasSpaces
                      ? `Contacts at this company are shared through ${spaceIds.length === 1 ? bySpace[spaceIds[0]].spaceName : `${spaceIds.length} spaces`}. Describe what you'd like to discuss and the right connectors will be notified.`
                      : isDirectIntro && directConn
                        ? `This is a direct request to ${directConn.peer.name}. Describe what you'd like to discuss.`
                        : `You have ${co.myContacts.length} ${co.myContacts.length === 1 ? 'contact' : 'contacts'} at this company. Describe what you'd like to discuss.`}
                  </p>
                </div>

                {hasSpaces && (
                  <div className="u-panel-section">
                    <h4 className="u-panel-section-h">Will be sent to</h4>
                    <div className="u-panel-intro-spaces">
                      {spaceIds.map(sId => {
                        const s = bySpace[sId];
                        return (
                          <div key={sId} className="u-panel-intro-space-row">
                            <span className="u-panel-intro-space-name">{s.spaceEmoji} {s.spaceName}</span>
                            <span className="u-panel-intro-space-count">{s.count} {s.count === 1 ? 'contact' : 'contacts'}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {isDirectIntro && directConn && (
                  <div className="u-panel-section">
                    <h4 className="u-panel-section-h">Through</h4>
                    <div className="u-panel-intro-spaces">
                      <div className="u-panel-intro-space-row">
                        <span className="u-panel-intro-space-name">👤 {directConn.peer.name}</span>
                        <span className="u-panel-intro-space-count">{directConn.peer.email}</span>
                      </div>
                    </div>
                  </div>
                )}

                {isDirectIntro && !directConn && co.myContacts.length > 0 && (
                  <div className="u-panel-section">
                    <h4 className="u-panel-section-h">Your contacts</h4>
                    <div className="u-panel-intro-spaces">
                      {co.myContacts.slice(0, 3).map(c => (
                        <div key={c.id} className="u-panel-intro-space-row">
                          <span className="u-panel-intro-space-name">👤 {c.name}</span>
                          <span className="u-panel-intro-space-count">{c.title || c.email}</span>
                        </div>
                      ))}
                      {co.myContacts.length > 3 && (
                        <div className="u-panel-intro-space-row">
                          <span className="u-panel-intro-space-count">+{co.myContacts.length - 3} more</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <textarea
                  className="u-panel-textarea"
                  placeholder="What would you like to discuss?"
                  rows={3}
                  value={introRequestText}
                  onChange={e => setIntroRequestText(e.target.value)}
                  disabled={introRequestSending || introRequestSent}
                />

                {introRequestSent ? (
                  <div className="u-panel-actions">
                    <p style={{ color: 'var(--accent-primary)', fontSize: '0.85rem', margin: 0 }}>
                      Request sent! {hasSpaces ? `Connectors in ${spaceIds.length === 1 ? bySpace[spaceIds[0]].spaceName : `${spaceIds.length} spaces`} will be notified.` : 'The connector will be notified.'}
                    </p>
                    <button className="u-action-btn" onClick={() => {
                      setInlinePanel(null);
                      setIntroRequestSent(false);
                      setIntroRequestText('');
                    }}>Close</button>
                  </div>
                ) : (
                  <div className="u-panel-actions">
                    <button
                      className="u-primary-btn"
                      disabled={!introRequestText.trim() || introRequestSending}
                      onClick={async () => {
                        setIntroRequestSending(true);
                        try {
                          const normalizedQuery = {
                            companyName: co.name,
                            companyDomain: co.domain,
                            companyId: co.id,
                          };
                          if (hasSpaces) {
                            // Send a request to EACH relevant space
                            await Promise.all(spaceIds.map(sId =>
                              requestsApi.create({
                                rawText: introRequestText.trim(),
                                spaceId: sId,
                                normalizedQuery,
                              })
                            ));
                          } else {
                            // No spaces — send as 1-1 request, notify the connection peer
                            await requestsApi.create({
                              rawText: introRequestText.trim(),
                              connectionPeerId: directConn?.peer.id || undefined,
                              normalizedQuery,
                            });
                          }
                          setIntroRequestSent(true);
                          refreshIntroData();
                          fetchSpacesList();
                        } catch (err) {
                          console.error('Failed to send intro request:', err);
                          alert('Failed to send request. Please try again.');
                        } finally {
                          setIntroRequestSending(false);
                        }
                      }}
                    >
                      {introRequestSending ? 'Sending...' : 'Send Request'}
                    </button>
                    <button className="u-action-btn" onClick={() => {
                      setInlinePanel(null);
                      setIntroRequestText('');
                    }}>Cancel</button>
                  </div>
                )}
              </div>
              );
            })()}
        </div>
      )}
      </div>{/* end u-layout */}
    </div>
  );
}
