import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useAppState, useAppActions } from '../store';
import { API_BASE, calendarApi, requestsApi, notificationsApi, offersApi, tagsApi, emailApi, viewsApi, type CalendarAccountInfo } from '../lib/api';
import { calculateStrength, type SpaceCompany, type DisplayContact, type MergedCompany, type ViewFilters, type SavedView, type ViewSortRule, type InlinePanel } from '../types';
import { PersonAvatar, CompanyLogo, OnboardingTour } from '../components';
import { ProfilePanel, SettingsPanel, NotificationsPanel } from '../components/panels';
import { useProfile } from '../hooks/useProfile';
import { useEnrichment } from '../hooks/useEnrichment';
import { useSpaceManagement } from '../hooks/useSpaceManagement';
import { useConnectionManagement } from '../hooks/useConnectionManagement';

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

// ─── Component ───────────────────────────────────────────────────────────────

export function AIHomePage() {
  const { isAuthenticated, currentUser, contacts: storeContacts, isCalendarConnected, isLoading: storeLoading, loadingPhase } = useAppState();
  const { logout, syncCalendar, refreshData } = useAppActions();
  const searchRef = useRef<HTMLInputElement>(null);

  // UI State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedView, setSelectedView] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'mine' | 'spaces' | 'both'>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [strengthFilter, setStrengthFilter] = useState<'all' | 'strong' | 'medium' | 'weak'>('all');
  const [spaceFilter, setSpaceFilter] = useState<string>('all');
  const [connectionFilter, setConnectionFilter] = useState<string>('all');
  const [sortBy] = useState<'relevance' | 'contacts' | 'name' | 'strength'>('relevance');

  // ─── Multi-sort & Group-by (Airtable-style) ────────────────────────────────
  type SortDir = 'asc' | 'desc';

  // Company fields
  type SortField = 'name' | 'contacts' | 'strength' | 'employees' | 'location' | 'industry' | 'funding' | 'tags' | 'connectedSince';
  interface SortRule { field: SortField; dir: SortDir }
  const SORT_FIELD_LABELS: Record<SortField, string> = {
    name: 'Company', contacts: 'Contacts', strength: 'Strength',
    employees: 'Employees', location: 'Location', industry: 'Industry',
    funding: 'Funding', tags: 'Tags', connectedSince: 'Connected Since',
  };
  const ALL_SORT_FIELDS: SortField[] = ['name', 'contacts', 'strength', 'employees', 'location', 'industry', 'funding', 'tags', 'connectedSince'];

  const [tableSorts, setTableSorts] = useState<SortRule[]>([]);
  const [groupByField, setGroupByField] = useState<SortField | null>(null);
  const [groupByDir, setGroupByDir] = useState<SortDir>('asc');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showSortPanel, setShowSortPanel] = useState(false);
  const [showGroupPanel, setShowGroupPanel] = useState(false);
  const sortPanelRef = useRef<HTMLDivElement>(null);
  const groupPanelRef = useRef<HTMLDivElement>(null);

  // People fields
  type PeopleSortField = 'name' | 'company' | 'strength' | 'meetings' | 'lastSeen' | 'source' | 'industry' | 'location' | 'employees' | 'funding' | 'tags' | 'connectedSince';
  interface PeopleSortRule { field: PeopleSortField; dir: SortDir }
  const PEOPLE_FIELD_LABELS: Record<PeopleSortField, string> = {
    name: 'Person', company: 'Company', strength: 'Strength',
    meetings: 'Meetings', lastSeen: 'Last met', source: 'Source',
    industry: 'Industry', location: 'Location', employees: 'Employees',
    funding: 'Funding', tags: 'Tags', connectedSince: 'Connected Since',
  };
  const ALL_PEOPLE_FIELDS: PeopleSortField[] = ['name', 'company', 'strength', 'meetings', 'lastSeen', 'source', 'industry', 'location', 'employees', 'funding', 'tags', 'connectedSince'];

  const [peopleSorts, setPeopleSorts] = useState<PeopleSortRule[]>([]);
  const [peopleGroupByField, setPeopleGroupByField] = useState<PeopleSortField | null>(null);
  const [peopleGroupByDir, setPeopleGroupByDir] = useState<SortDir>('asc');
  const [peopleCollapsedGroups, setPeopleCollapsedGroups] = useState<Set<string>>(new Set());
  const [showPeopleSortPanel, setShowPeopleSortPanel] = useState(false);
  const [showPeopleGroupPanel, setShowPeopleGroupPanel] = useState(false);
  const peopleSortPanelRef = useRef<HTMLDivElement>(null);
  const peopleGroupPanelRef = useRef<HTMLDivElement>(null);

  const [viewMode, setViewMode] = useState<'grid' | 'table'>(() => {
    try { const v = localStorage.getItem('introo_view_mode'); return v === 'table' ? 'table' : 'grid'; } catch { return 'grid'; }
  });
  const [entityTab, setEntityTab] = useState<'companies' | 'people'>('companies');
  const [peopleSortBy, setPeopleSortBy] = useState<'name' | 'company' | 'strength' | 'meetings' | 'lastSeen'>('meetings');
  const [peopleSortDir, setPeopleSortDir] = useState<'asc' | 'desc'>('desc');
  const [gridPage, setGridPage] = useState(0);
  const GRID_PAGE_SIZE = 50;
  const [excludeMyContacts, setExcludeMyContacts] = useState(true);
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [inlinePanel, setInlinePanel] = useState<InlinePanel | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 768);
  const [sidebarTab, setSidebarTab] = useState<'filters' | 'views'>('filters');
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [editingViewName, setEditingViewName] = useState('');
  const [introRequestText, setIntroRequestText] = useState('');
  const [introRequestSending, setIntroRequestSending] = useState(false);
  const [introRequestSent, setIntroRequestSent] = useState(false);
  const [introSelectedThrough, setIntroSelectedThrough] = useState<string | null>(null);
  const [introTipOpen, setIntroTipOpen] = useState(false);
  const [connMenuOpen, setConnMenuOpen] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const [notifications, setNotifications] = useState<Awaited<ReturnType<typeof notificationsApi.getAll>>>([]);
  const [myIntroRequests, setMyIntroRequests] = useState<Awaited<ReturnType<typeof requestsApi.getMine>>>([]);
  const [spaceRequests, setSpaceRequests] = useState<Record<string, { id: string; rawText: string; status: string; createdAt: string; normalizedQuery: Record<string, unknown>; requester: { id: string; name: string; email?: string; avatar: string | null } }[]>>({});
  const [decliningRequestId, setDecliningRequestId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [dismissedRequestIds, setDismissedRequestIds] = useState<Set<string>>(new Set());
  const [incomingRequests, setIncomingRequests] = useState<{ id: string; rawText: string; status: string; createdAt: string; normalizedQuery: Record<string, unknown>; requester: { id: string; name: string; email?: string; avatar: string | null } }[]>([]);
  const [introActionRequestId, setIntroActionRequestId] = useState<string | null>(null);
  const [introActionType, setIntroActionType] = useState<'ask-details' | 'make-intro' | 'ask-permission' | null>(null);
  const [introEmailSubject, setIntroEmailSubject] = useState('');
  const [introEmailBody, setIntroEmailBody] = useState('');
  const [introSelectedContact, setIntroSelectedContact] = useState<{ id: string; name: string; email: string; title?: string } | null>(null);
  const [introSending, setIntroSending] = useState(false);
  const [introToast, setIntroToast] = useState<string | null>(null);

  // ─── Onboarding activation state ────────────────────────────────────────────
  const [showNetworkSplash, setShowNetworkSplash] = useState(false);
  const [networkSplashData, setNetworkSplashData] = useState<{ contacts: number; companies: number; strong: number; topIndustry: string } | null>(null);
  const [, setCompanyPanelViewCount] = useState(0);
  const [showTagTip, setShowTagTip] = useState(false);
  const [showViewPrompt, setShowViewPrompt] = useState(false);
  const [viewPromptDismissed, setViewPromptDismissed] = useState(() => !!localStorage.getItem('introo_view_prompt_dismissed'));
  const [newSpaceCompanies, setNewSpaceCompanies] = useState<Set<string>>(new Set());
  const prevSpaceCompanyDomainsRef = useRef<Set<string>>(new Set());

  // AI search state
  const [aiParsing, setAiParsing] = useState(false);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [lastAiQuery, setLastAiQuery] = useState<{ query: string; keywords: string[] } | null>(null);

  // Profile form
  const { profileForm, profileSaving, profileDirty, updateProfileField, saveProfile } = useProfile(currentUser);

  // Notification refresh helper (passed to hooks)
  const refreshNotifications = useCallback(() => {
    notificationsApi.getAll().then(setNotifications).catch(() => {});
    notificationsApi.getUnreadCount().then(r => setNotificationCount(r.count)).catch(() => {});
  }, []);

  // Space management (hook)
  const {
    spaces, pendingSpaces, pendingMembers, spaceEmailInvites, loading,
    showCreateSpace, setShowCreateSpace,
    showJoinSpace, setShowJoinSpace,
    newSpaceName, setNewSpaceName,
    newSpaceEmoji, setNewSpaceEmoji,
    joinCode, setJoinCode,
    joinStatus, setJoinStatus, copiedCode,
    fetchSpacesList,
    createSpace, joinSpace, copyInviteCode,
    leaveSpace, inviteMemberToSpace,
    approveSpaceMember, rejectSpaceMember,
    acceptSpaceInvite, removeSpaceMember, rejectSpaceInvite,
    cancelSpaceEmailInvite,
  } = useSpaceManagement(currentUser?.id, refreshNotifications);

  // Connection management (hook)
  const {
    connections, connectionCompanies, pendingInvites,
    connectEmail, setConnectEmail,
    sendConnectionRequest, acceptConnection, rejectConnection, removeConnection,
    cancelInvite,
  } = useConnectionManagement(refreshNotifications);

  // Calendar state
  const [calendarSyncing, setCalendarSyncing] = useState(false);
  const [calendarAccounts, setCalendarAccounts] = useState<CalendarAccountInfo[]>([]);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);

  // Enrichment (hook)
  const { enriching, enrichProgress, enrichError, enrichStats, startEnrichment, stopEnrichment } = useEnrichment(refreshData, storeLoading);

  // Sidebar filter section open/closed state
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    'sort-group': false,
    source: true,
    network: false,
    tags: false,
    strength: false,
    description: false,
    'connected-time': false,
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
  const [spaceCompanies, setSpaceCompanies] = useState<SpaceCompany[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);

  // ─── Company tags (Airtable-style, persisted to localStorage) ──────────────
  const TAG_COLORS = [
    { bg: 'rgba(91,141,239,0.28)', text: '#d0dffc', border: 'rgba(91,141,239,0.35)' },
    { bg: 'rgba(168,85,247,0.28)', text: '#dcc5fa', border: 'rgba(168,85,247,0.35)' },
    { bg: 'rgba(236,72,153,0.25)', text: '#f8c4dc', border: 'rgba(236,72,153,0.32)' },
    { bg: 'rgba(245,158,11,0.25)', text: '#fde4a8', border: 'rgba(245,158,11,0.32)' },
    { bg: 'rgba(16,185,129,0.25)', text: '#b2edd8', border: 'rgba(16,185,129,0.32)' },
    { bg: 'rgba(239,68,68,0.25)',  text: '#fcc5c5', border: 'rgba(239,68,68,0.32)' },
    { bg: 'rgba(6,182,212,0.25)',  text: '#b5eef7', border: 'rgba(6,182,212,0.32)' },
    { bg: 'rgba(132,204,22,0.25)', text: '#ddf0b0', border: 'rgba(132,204,22,0.32)' },
  ];

  // Tag definitions: { name, colorIdx }
  const [tagDefs, setTagDefs] = useState<{ name: string; colorIdx: number }[]>(() => {
    try { return JSON.parse(localStorage.getItem('introo_tag_defs') || '[]'); } catch { return []; }
  });
  // Which tags are assigned to which domains
  const [companyTags, setCompanyTags] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem('introo_company_tags') || '{}'); } catch { return {}; }
  });
  const [tagPickerDomain, setTagPickerDomain] = useState<string | null>(null);
  const [tagPickerSearch, setTagPickerSearch] = useState('');
  const tagPickerRef = useRef<HTMLDivElement>(null);
  const [tagsLoadedFromServer, setTagsLoadedFromServer] = useState(false);

  // Load tags from the server on mount, then migrate localStorage data if server is empty
  useEffect(() => {
    if (!currentUser || tagsLoadedFromServer) return;
    tagsApi.getAll().then(data => {
      const serverHasTags = Object.keys(data.tagDefs).length > 0;
      const localHasTags = tagDefs.length > 0;

      if (serverHasTags) {
        // Server is source of truth: hydrate local state from server
        const defs: { name: string; colorIdx: number }[] = Object.entries(data.tagDefs).map(([name, color], idx) => {
          const matchIdx = TAG_COLORS.findIndex(c => c.text === color || c.bg.includes(color));
          return { name, colorIdx: matchIdx >= 0 ? matchIdx : idx % TAG_COLORS.length };
        });
        setTagDefs(defs);
        setCompanyTags(data.companyTags);
        localStorage.setItem('introo_tag_defs', JSON.stringify(defs));
        localStorage.setItem('introo_company_tags', JSON.stringify(data.companyTags));
      } else if (localHasTags) {
        // Migrate localStorage tags to server
        const serverTagDefs: Record<string, string> = {};
        tagDefs.forEach(t => { serverTagDefs[t.name] = TAG_COLORS[t.colorIdx % TAG_COLORS.length].text; });
        tagsApi.sync(serverTagDefs, companyTags).catch(() => {});
      }
      setTagsLoadedFromServer(true);
    }).catch(() => setTagsLoadedFromServer(true));
  }, [currentUser]);

  // Load saved views from server on mount
  useEffect(() => {
    if (!currentUser) return;
    viewsApi.getAll().then(views => {
      setSavedViews(views.map(v => ({
        id: v.id,
        title: v.title,
        keywords: v.keywords as string[],
        filters: v.filters as ViewFilters,
        sortRules: v.sortRules as ViewSortRule[],
        groupBy: v.groupBy as { field: string; dir: 'asc' | 'desc' } | null,
        isActive: false,
      })));
    }).catch(err => console.error('Failed to load views:', err));
  }, [currentUser]);

  // Close picker on outside click
  useEffect(() => {
    if (!tagPickerDomain) return;
    const handler = (e: MouseEvent) => {
      if (tagPickerRef.current && !tagPickerRef.current.contains(e.target as Node)) {
        setTagPickerDomain(null);
        setTagPickerSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [tagPickerDomain]);

  // Close sort/group panels on outside click
  useEffect(() => {
    if (!showSortPanel && !showGroupPanel) return;
    const handler = (e: MouseEvent) => {
      if (showSortPanel && sortPanelRef.current && !sortPanelRef.current.contains(e.target as Node)) {
        setShowSortPanel(false);
      }
      if (showGroupPanel && groupPanelRef.current && !groupPanelRef.current.contains(e.target as Node)) {
        setShowGroupPanel(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSortPanel, showGroupPanel]);

  // Close people sort/group panels on outside click
  useEffect(() => {
    if (!showPeopleSortPanel && !showPeopleGroupPanel) return;
    const handler = (e: MouseEvent) => {
      if (showPeopleSortPanel && peopleSortPanelRef.current && !peopleSortPanelRef.current.contains(e.target as Node)) {
        setShowPeopleSortPanel(false);
      }
      if (showPeopleGroupPanel && peopleGroupPanelRef.current && !peopleGroupPanelRef.current.contains(e.target as Node)) {
        setShowPeopleGroupPanel(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPeopleSortPanel, showPeopleGroupPanel]);

  const persistTagDefs = useCallback((defs: { name: string; colorIdx: number }[]) => {
    setTagDefs(defs);
    localStorage.setItem('introo_tag_defs', JSON.stringify(defs));
  }, []);

  const persistCompanyTags = useCallback((tags: Record<string, string[]>) => {
    setCompanyTags(tags);
    localStorage.setItem('introo_company_tags', JSON.stringify(tags));
  }, []);

  const createTag = useCallback((name: string) => {
    const n = name.trim();
    if (!n || tagDefs.some(t => t.name.toLowerCase() === n.toLowerCase())) return;
    const colorIdx = tagDefs.length % TAG_COLORS.length;
    persistTagDefs([...tagDefs, { name: n, colorIdx }]);
    // Persist to server
    const color = TAG_COLORS[colorIdx % TAG_COLORS.length].text;
    tagsApi.createTag(n, color).catch(() => {});
    return n;
  }, [tagDefs, persistTagDefs]);

  const deleteTagDef = useCallback((name: string) => {
    const usageCount = Object.values(companyTags).filter(tags => tags.includes(name)).length;
    if (usageCount > 1) {
      if (!window.confirm(`"${name}" is used on ${usageCount} companies. Delete it?`)) return;
    }
    persistTagDefs(tagDefs.filter(t => t.name !== name));
    const next = { ...companyTags };
    Object.keys(next).forEach(domain => {
      next[domain] = next[domain].filter(t => t !== name);
      if (next[domain].length === 0) delete next[domain];
    });
    persistCompanyTags(next);
    setTagFilter(prev => prev.filter(t => t !== name));
    setGridPage(0);
    // Persist to server
    tagsApi.deleteTag(name).catch(() => {});
  }, [tagDefs, companyTags, persistTagDefs, persistCompanyTags]);

  const toggleTagOnCompany = useCallback((domain: string, tagName: string) => {
    setCompanyTags(prev => {
      const existing = prev[domain] || [];
      const next = existing.includes(tagName)
        ? { ...prev, [domain]: existing.filter(t => t !== tagName) }
        : { ...prev, [domain]: [...existing, tagName] };
      if (next[domain]?.length === 0) delete next[domain];
      localStorage.setItem('introo_company_tags', JSON.stringify(next));
      return next;
    });
    // Persist to server
    tagsApi.toggleTag(tagName, domain).catch(() => {});
  }, []);

  const getTagColor = useCallback((name: string) => {
    const def = tagDefs.find(t => t.name === name);
    return def ? TAG_COLORS[def.colorIdx % TAG_COLORS.length] : TAG_COLORS[0];
  }, [tagDefs]);

  const allTags = useMemo(() => tagDefs.map(t => t.name), [tagDefs]);

  const [tagFilter, setTagFilter] = useState<string[]>([]);

  // Auto-expand sidebar sections that have active filters; auto-collapse when cleared
  const prevActiveSectionsRef = useRef<Set<string>>(new Set(['source']));
  useEffect(() => {
    const active = new Set<string>();
    active.add('source');
    if (tagFilter.length > 0) active.add('tags');
    if (strengthFilter !== 'all') active.add('strength');
    if (sidebarFilters.aiKeywords.length > 0 || sidebarFilters.excludeKeywords.length > 0 || sidebarFilters.description) active.add('description');
    if (sidebarFilters.connectedYears.length > 0 || sidebarFilters.connectedMonths.length > 0) active.add('connected-time');
    if (sidebarFilters.employeeRanges.length > 0) active.add('employees');
    if (sidebarFilters.country || sidebarFilters.city) active.add('location');
    if (sidebarFilters.fundingRounds.length > 0 || sidebarFilters.fundingRecency !== 'any') active.add('funding');
    if (sidebarFilters.foundedFrom || sidebarFilters.foundedTo) active.add('founded');
    if (sidebarFilters.revenueRanges.length > 0) active.add('revenue');
    if (sidebarFilters.technologies.length > 0) active.add('technologies');
    const prev = prevActiveSectionsRef.current;
    const toOpen = new Set<string>();
    const toClose = new Set<string>();
    active.forEach(s => { if (!prev.has(s)) toOpen.add(s); });
    prev.forEach(s => { if (!active.has(s) && s !== 'source') toClose.add(s); });
    if (toOpen.size > 0 || toClose.size > 0) {
      setOpenSections(p => {
        const next = { ...p };
        toOpen.forEach(s => { next[s] = true; });
        toClose.forEach(s => { next[s] = false; });
        return next;
      });
    }
    prevActiveSectionsRef.current = active;
  }, [strengthFilter, tagFilter, sidebarFilters]);

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
      sourceAccountEmails: c.sourceAccountEmails,
      meetings: c.meetings,
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
          source: 'mine', matchingViews: [], spaceIds: [], connectionIds: [],
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
          source: 'space', matchingViews: [], spaceIds: [], connectionIds: [],
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
          source: 'space', matchingViews: [], spaceIds: [], connectionIds: [],
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

    // ── Compute smart company-level strength ──
    // Uses the distribution of contact-level strengths, not just the best one.
    // A company with many strong contacts is definitively "strong" even if
    // some individual contacts are weak.
    const companies = Array.from(map.values());
    companies.forEach(co => {
      const my = co.myContacts;
      if (my.length === 0) return; // space-only → keep 'none'

      const strongCount = my.filter(c => c.connectionStrength === 'strong').length;
      const mediumCount = my.filter(c => c.connectionStrength === 'medium').length;
      const totalMeetings = my.reduce((sum, c) => sum + (c.meetingsCount || 0), 0);

      // Strong company: 3+ strong contacts, OR 5+ medium+strong, OR 10+ total meetings
      if (strongCount >= 3 || (strongCount + mediumCount) >= 5 || totalMeetings >= 15) {
        co.bestStrength = 'strong';
        co.hasStrongConnection = true;
      }
      // Medium company: any strong contact, OR 2+ medium, OR 5+ total meetings, OR 3+ contacts
      else if (strongCount >= 1 || mediumCount >= 2 || totalMeetings >= 5 || my.length >= 3) {
        co.bestStrength = 'medium';
        if (strongCount > 0) co.hasStrongConnection = true;
      }
      // Weak: everything else (few contacts, few meetings)
      else {
        co.bestStrength = 'weak';
      }
    });

    // Match savedViews (keywords + saved filters)
    const parseRevM = (rev: string | null | undefined): number => {
      if (!rev) return 0;
      const m = rev.match(/([\d.]+)/);
      return m ? parseFloat(m[1]) : 0;
    };
    companies.forEach(co => {
      savedViews.forEach(sv => {
        let matches = false;

        // Layout-only views (no keywords, no filters) match all companies
        const hasKeywords = sv.keywords && sv.keywords.length > 0;
        const hasFilters = sv.filters && Object.keys(sv.filters).length > 0;
        if (!hasKeywords && !hasFilters) {
          matches = true;
        }

        // Keyword matching
        if (!matches && hasKeywords) {
          const allText = [
            co.name, co.domain,
            co.description || '', co.industry || '',
            co.city || '', co.country || '',
            co.lastFundingRound || '', co.annualRevenue || '',
            ...co.myContacts.map(c => `${c.title} ${c.name}`),
            ...co.spaceContacts.map(c => `${c.title || ''} ${c.name}`),
          ].join(' ').toLowerCase();
          if (sv.keywords.some(k => allText.includes(k))) {
            matches = true;
          }
        }

        // Saved filter matching
        if (!matches && sv.filters) {
          const hf = sv.filters;
          let filterMatch = true;
          let hasAnyFilter = false;

          if (hf.sourceFilter && hf.sourceFilter !== 'all' && filterMatch) {
            hasAnyFilter = true;
            if (hf.sourceFilter === 'mine' && co.myCount === 0) filterMatch = false;
            else if (hf.sourceFilter === 'spaces' && co.spaceCount === 0) filterMatch = false;
            else if (hf.sourceFilter === 'both' && co.source !== 'both') filterMatch = false;
          }
          if (hf.strengthFilter && hf.strengthFilter !== 'all' && filterMatch) {
            hasAnyFilter = true;
            if (co.bestStrength !== hf.strengthFilter) filterMatch = false;
          }
          if (hf.spaceFilter && hf.spaceFilter !== 'all' && filterMatch) {
            hasAnyFilter = true;
            if (!co.spaceIds.includes(hf.spaceFilter)) filterMatch = false;
          }
          if (hf.connectionFilter && hf.connectionFilter !== 'all' && filterMatch) {
            hasAnyFilter = true;
            if (!co.connectionIds.includes(hf.connectionFilter)) filterMatch = false;
          }
          if (hf.accountFilter && hf.accountFilter !== 'all' && filterMatch) {
            hasAnyFilter = true;
            if (!co.myContacts.some(mc => mc.sourceAccountEmails?.includes(hf.accountFilter!))) filterMatch = false;
          }
          if (hf.employeeRanges && hf.employeeRanges.length > 0 && filterMatch) {
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
          if (hf.fundingRecency && hf.fundingRecency !== 'any' && filterMatch) {
            hasAnyFilter = true;
            const now = Date.now();
            const cutoff = hf.fundingRecency === '6m' ? now - 6 * 30 * 24 * 60 * 60 * 1000 : now - 365 * 24 * 60 * 60 * 1000;
            if (!co.lastFundingDate || new Date(co.lastFundingDate).getTime() < cutoff) filterMatch = false;
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
          if (hf.technologies && hf.technologies.length > 0 && filterMatch) {
            hasAnyFilter = true;
            const text = (co.description || '').toLowerCase();
            if (!hf.technologies.some(tech => text.includes(tech.toLowerCase()))) filterMatch = false;
          }
          if (hf.aiKeywords && hf.aiKeywords.length > 0 && filterMatch) {
            hasAnyFilter = true;
            const allText = [co.name, co.domain, co.description, co.industry, co.city, co.country].filter(Boolean).join(' ').toLowerCase();
            if (!hf.aiKeywords.some(kw => allText.includes(kw))) filterMatch = false;
          }
          if (hf.excludeKeywords && hf.excludeKeywords.length > 0 && filterMatch) {
            hasAnyFilter = true;
            const text = [co.description, co.industry, co.name].filter(Boolean).join(' ').toLowerCase();
            if (hf.excludeKeywords.some(ex => text.includes(ex))) filterMatch = false;
          }
          if (hf.tagFilter && hf.tagFilter.length > 0 && filterMatch) {
            hasAnyFilter = true;
            const tags = companyTags[co.domain] || [];
            if (!hf.tagFilter.every(t => tags.includes(t))) filterMatch = false;
          }
          if (hf.connectedYears && hf.connectedYears.length > 0 && filterMatch) {
            hasAnyFilter = true;
            const hasMatchingContact = co.myContacts.some(c => {
              const y = String(new Date(c.firstSeenAt).getFullYear());
              return hf.connectedYears!.includes(y);
            });
            if (!hasMatchingContact) filterMatch = false;
          }
          if (hf.connectedMonths && hf.connectedMonths.length > 0 && filterMatch) {
            hasAnyFilter = true;
            const hasMatchingContact = co.myContacts.some(c => {
              const m = String(new Date(c.firstSeenAt).getMonth() + 1);
              return hf.connectedMonths!.includes(m);
            });
            if (!hasMatchingContact) filterMatch = false;
          }

          if (hasAnyFilter && filterMatch) matches = true;
        }

        if (matches) co.matchingViews.push(sv.id);
      });
    });

    return companies.sort((a, b) => {
      // Both > mine > space, then by strong > count
      const sourceOrder = { both: 0, mine: 1, space: 2 };
      if (sourceOrder[a.source] !== sourceOrder[b.source]) return sourceOrder[a.source] - sourceOrder[b.source];
      if (a.hasStrongConnection !== b.hasStrongConnection) return a.hasStrongConnection ? -1 : 1;
      return b.totalCount - a.totalCount;
    });
  }, [contacts, spaceCompanies, connectionCompanies, savedViews, companyTags]);

  // Filter by search + active view + source + strength + space + sort
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

    // Filter by specific calendar account
    if (accountFilter !== 'all') {
      result = result.filter(c =>
        c.myContacts.some(mc => mc.sourceAccountEmails?.includes(accountFilter))
      );
    }

    // Filter by connection strength (uses company-level computed strength)
    if (strengthFilter !== 'all') {
      result = result.filter(c => c.bestStrength === strengthFilter);
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

    // Filter by tags
    if (tagFilter.length > 0) {
      result = result.filter(c => {
        const tags = companyTags[c.domain] || [];
        return tagFilter.every(t => tags.includes(t));
      });
    }

    // Filter by specific space
    if (spaceFilter !== 'all') {
      result = result.filter(c => c.spaceIds.includes(spaceFilter));
    }

    // Filter by specific connection
    if (connectionFilter !== 'all') {
      result = result.filter(c => c.connectionIds.includes(connectionFilter));
    }

    // View selected → don't filter, just sort matches to top (done after all filters)

    // Instant keyword filter (as you type)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const terms = q.split(/\s+/).filter(t => t.length > 0);
      result = result.filter(c => {
        const haystack = [
          c.name, c.domain, c.industry, c.description, c.city, c.country,
          ...c.myContacts.map(ct => `${ct.name} ${ct.title}`),
          ...c.spaceContacts.map(ct => `${ct.name} ${ct.title || ''}`),
        ].filter(Boolean).join(' ').toLowerCase();
        return terms.every(t => haystack.includes(t));
      });
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
      result = result.filter(c => {
        const text = [c.description, c.industry, c.name].filter(Boolean).join(' ').toLowerCase();
        return !sf.excludeKeywords.some(ex => text.includes(ex));
      });
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

    // Sort — multi-sort rules (Airtable-style), falling back to legacy sortBy
    const strengthOrder: Record<string, number> = { strong: 0, medium: 1, weak: 2, none: 3 };
    const getSortVal = (c: MergedCompany, field: SortField): string | number => {
      switch (field) {
        case 'name': return c.name.toLowerCase();
        case 'contacts': return c.totalCount;
        case 'strength': return strengthOrder[c.bestStrength] ?? 3;
        case 'employees': return c.employeeCount ?? 0;
        case 'location': return [c.city, c.country].filter(Boolean).join(', ').toLowerCase();
        case 'industry': return (c.industry || '').toLowerCase();
        case 'funding': return (c.lastFundingRound || '').toLowerCase();
        case 'tags': return (companyTags[c.domain] || []).join(',').toLowerCase();
        case 'connectedSince': {
          const dates = c.myContacts.map(ct => ct.firstSeenAt).filter(Boolean);
          if (dates.length === 0) return '';
          return dates.sort()[0];
        }
        default: return 0;
      }
    };

    const activeSorts: SortRule[] = tableSorts.length > 0 ? tableSorts : (sortBy !== 'relevance' ? [{ field: sortBy as SortField, dir: sortBy === 'contacts' ? 'desc' : 'asc' }] : []);
    if (groupByField || activeSorts.length > 0) {
      result = [...result].sort((a, b) => {
        // Group-by field always sorts first
        if (groupByField) {
          const ga = getSortVal(a, groupByField);
          const gb = getSortVal(b, groupByField);
          const cmp = typeof ga === 'number' && typeof gb === 'number' ? ga - gb : String(ga).localeCompare(String(gb));
          const grouped = groupByDir === 'desc' ? -cmp : cmp;
          if (grouped !== 0) return grouped;
        }
        // Then multi-sort rules
        for (const rule of activeSorts) {
          const va = getSortVal(a, rule.field);
          const vb = getSortVal(b, rule.field);
          const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
          const directed = rule.dir === 'desc' ? -cmp : cmp;
          if (directed !== 0) return directed;
        }
        return 0;
      });
    }

    // When a view is selected, filter to only matching companies
    if (selectedView) {
      result = result.filter(c => c.matchingViews.includes(selectedView));
    }

    return result;
  }, [mergedCompanies, selectedView, searchQuery, sourceFilter, accountFilter, strengthFilter, spaceFilter, connectionFilter, sortBy, sidebarFilters, tagFilter, companyTags, tableSorts, groupByField, groupByDir]);

  // Flatten filteredCompanies into a deduplicated people array
  interface FlatPerson {
    id: string; name: string; email: string; title: string;
    companyName: string; companyDomain: string;
    strength: 'strong' | 'medium' | 'weak' | 'none';
    meetings: number; lastSeen: string;
    firstSeenAt?: string;
    source: 'you' | string;
    photoUrl?: string | null;
    company: MergedCompany;
    isMyContact: boolean;
    displayContact?: DisplayContact;
  }

  const flatPeople = useMemo((): FlatPerson[] => {
    const seen = new Set<string>();
    const people: FlatPerson[] = [];

    for (const co of filteredCompanies) {
      for (const c of co.myContacts) {
        if (seen.has(c.email)) continue;
        seen.add(c.email);
        people.push({
          id: c.id, name: c.name, email: c.email, title: c.title || '',
          companyName: co.name, companyDomain: co.domain,
          strength: c.connectionStrength || 'none',
          meetings: c.meetingsCount || 0,
          lastSeen: c.lastSeenAt || '',
          firstSeenAt: c.firstSeenAt || '',
          source: 'you',
          photoUrl: c.photoUrl,
          company: co,
          isMyContact: true,
          displayContact: c,
        });
      }
      for (const c of co.spaceContacts) {
        if (seen.has(c.email)) continue;
        seen.add(c.email);
        people.push({
          id: c.id, name: c.name, email: c.email, title: c.title || '',
          companyName: co.name, companyDomain: co.domain,
          strength: 'none',
          meetings: 0,
          lastSeen: '',
          source: c.userName || 'Network',
          photoUrl: null,
          company: co,
          isMyContact: false,
        });
      }
    }

    const strengthVal: Record<string, number> = { strong: 0, medium: 1, weak: 2, none: 3 };
    const getPeopleSortVal = (p: FlatPerson, field: PeopleSortField): string | number => {
      switch (field) {
        case 'name': return p.name.toLowerCase();
        case 'company': return p.companyName.toLowerCase();
        case 'strength': return strengthVal[p.strength] ?? 3;
        case 'meetings': return p.meetings;
        case 'lastSeen': return p.lastSeen || '';
        case 'source': return p.source.toLowerCase();
        case 'industry': return (p.company.industry || '').toLowerCase();
        case 'location': return [p.company.city, p.company.country].filter(Boolean).join(', ').toLowerCase();
        case 'employees': return p.company.employeeCount ?? 0;
        case 'funding': return (p.company.lastFundingRound || '').toLowerCase();
        case 'tags': return (companyTags[p.companyDomain] || []).join(',').toLowerCase();
        case 'connectedSince': return p.firstSeenAt || '';
        default: return 0;
      }
    };

    // Build effective sort rules: legacy header-click sort, then toolbar multi-sorts
    const effectiveSorts: PeopleSortRule[] = peopleSorts.length > 0
      ? peopleSorts
      : [{ field: peopleSortBy, dir: peopleSortDir }];

    people.sort((a, b) => {
      // Group-by field sorts first
      if (peopleGroupByField) {
        const ga = getPeopleSortVal(a, peopleGroupByField);
        const gb = getPeopleSortVal(b, peopleGroupByField);
        const cmp = typeof ga === 'number' && typeof gb === 'number' ? ga - gb : String(ga).localeCompare(String(gb));
        const grouped = peopleGroupByDir === 'desc' ? -cmp : cmp;
        if (grouped !== 0) return grouped;
      }
      for (const rule of effectiveSorts) {
        const va = getPeopleSortVal(a, rule.field);
        const vb = getPeopleSortVal(b, rule.field);
        const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
        const directed = rule.dir === 'desc' ? -cmp : cmp;
        if (directed !== 0) return directed;
      }
      return 0;
    });

    return people;
  }, [filteredCompanies, peopleSortBy, peopleSortDir, peopleSorts, peopleGroupByField, peopleGroupByDir, companyTags]);

  const totalPeopleCount = useMemo(() => {
    const seen = new Set<string>();
    for (const co of filteredCompanies) {
      co.myContacts.forEach(c => seen.add(c.email));
      co.spaceContacts.forEach(c => seen.add(c.email));
    }
    return seen.size;
  }, [filteredCompanies]);

  // Reset page when filters change
  useEffect(() => { setGridPage(0); }, [filteredCompanies.length, excludeMyContacts, entityTab]);

  // Reset history expand when switching companies
  useEffect(() => { setHistoryExpanded(false); }, [inlinePanel]);

  // View match counts
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

  const viewMatchCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    savedViews.forEach(h => {
      counts[h.id] = mergedCompanies.filter(c => c.matchingViews.includes(h.id)).length;
    });
    return counts;
  }, [savedViews, mergedCompanies]);

  // Count active filters
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (sourceFilter !== 'all') n++;
    if (accountFilter !== 'all') n++;
    if (strengthFilter !== 'all') n++;
    if (spaceFilter !== 'all') n++;
    if (connectionFilter !== 'all') n++;
    const sf = sidebarFilters;
    if (sf.description) n++;
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
    if (tagFilter.length > 0) n++;
    return n;
  }, [sourceFilter, accountFilter, strengthFilter, spaceFilter, connectionFilter, sidebarFilters, tagFilter]);

  // Build removable pills for every active filter
  // Compute year/month counts from contacts for "Connected since" filter
  const timeFilterStats = useMemo(() => {
    const yearCounts: Record<string, number> = {};
    const monthCounts: Record<string, number> = {};
    contacts.forEach(c => {
      const d = new Date(c.firstSeenAt);
      const y = String(d.getFullYear());
      const m = String(d.getMonth() + 1);
      yearCounts[y] = (yearCounts[y] || 0) + 1;
      monthCounts[m] = (monthCounts[m] || 0) + 1;
    });
    const years = Object.keys(yearCounts).sort();
    return { yearCounts, monthCounts, years };
  }, [contacts]);

  // Build a complete ViewFilters snapshot from current filter state
  const buildViewFilters = useCallback((): ViewFilters => {
    const sf = sidebarFilters;
    const filters: ViewFilters = {};
    if (sf.description) filters.description = sf.description;
    if (sf.categories.length > 0) filters.categories = [...sf.categories];
    if (sf.aiKeywords.length > 0) filters.aiKeywords = [...sf.aiKeywords];
    if (sf.excludeKeywords.length > 0) filters.excludeKeywords = [...sf.excludeKeywords];
    if (sf.employeeRanges.length > 0) filters.employeeRanges = [...sf.employeeRanges];
    if (sf.country) filters.country = sf.country;
    if (sf.city) filters.city = sf.city;
    if (sf.fundingRounds.length > 0) filters.fundingRounds = [...sf.fundingRounds];
    if (sf.fundingRecency !== 'any') filters.fundingRecency = sf.fundingRecency;
    if (sf.foundedFrom) filters.foundedFrom = sf.foundedFrom;
    if (sf.foundedTo) filters.foundedTo = sf.foundedTo;
    if (sf.revenueRanges.length > 0) filters.revenueRanges = [...sf.revenueRanges];
    if (sf.technologies.length > 0) filters.technologies = [...sf.technologies];
    if (sf.connectedYears.length > 0) filters.connectedYears = [...sf.connectedYears];
    if (sf.connectedMonths.length > 0) filters.connectedMonths = [...sf.connectedMonths];
    if (sourceFilter !== 'all') filters.sourceFilter = sourceFilter;
    if (strengthFilter !== 'all') filters.strengthFilter = strengthFilter;
    if (tagFilter.length > 0) filters.tagFilter = [...tagFilter];
    if (spaceFilter !== 'all') filters.spaceFilter = spaceFilter;
    if (connectionFilter !== 'all') filters.connectionFilter = connectionFilter;
    if (accountFilter !== 'all') filters.accountFilter = accountFilter;
    return filters;
  }, [sidebarFilters, sourceFilter, strengthFilter, tagFilter, spaceFilter, connectionFilter, accountFilter]);

  const clearAllFilters = useCallback(() => {
    setSourceFilter('all');
    setAccountFilter('all');
    setStrengthFilter('all');
    setSpaceFilter('all');
    setConnectionFilter('all');
    setSelectedView(null);
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
    setTagFilter([]);
  }, []);

  // Stats
  const stats = useMemo(() => ({
    myCompanies: mergedCompanies.filter(c => c.source === 'mine' || c.source === 'both').length,
    spaceCompanies: mergedCompanies.filter(c => c.source === 'space' || c.source === 'both').length,
    overlap: mergedCompanies.filter(c => c.source === 'both').length,
    total: mergedCompanies.length,
    strongTies: contacts.filter(c => c.connectionStrength === 'strong').length,
  }), [mergedCompanies, contacts]);

  // Per-account company counts (for source sub-filter)
  const accountCompanyCounts = useMemo(() => {
    if (calendarAccounts.length <= 1) return {};
    const counts: Record<string, number> = {};
    calendarAccounts.forEach(a => { counts[a.email] = 0; });
    mergedCompanies.forEach(c => {
      c.myContacts.forEach(mc => {
        if (mc.sourceAccountEmails) {
          mc.sourceAccountEmails.forEach(email => {
            if (counts[email] !== undefined) counts[email]++;
          });
        }
      });
    });
    // Deduplicate: count companies not contacts
    const companyCounts: Record<string, number> = {};
    calendarAccounts.forEach(a => { companyCounts[a.email] = 0; });
    mergedCompanies.forEach(c => {
      const accountsOnCompany = new Set<string>();
      c.myContacts.forEach(mc => {
        mc.sourceAccountEmails?.forEach(email => accountsOnCompany.add(email));
      });
      accountsOnCompany.forEach(email => {
        if (companyCounts[email] !== undefined) companyCounts[email]++;
      });
    });
    return companyCounts;
  }, [mergedCompanies, calendarAccounts]);

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

  // ─── Onboarding activation effects ──────────────────────────────────────────

  // #1 Network splash: show after first sync completes
  const prevLoadingPhaseRef = useRef(loadingPhase);
  useEffect(() => {
    const prev = prevLoadingPhaseRef.current;
    prevLoadingPhaseRef.current = loadingPhase;
    if ((prev === 'syncing' || prev === 'enriching') && loadingPhase === 'ready' && !localStorage.getItem('introo_splash_seen')) {
      // Compute splash stats
      const strong = mergedCompanies.filter(c => c.hasStrongConnection).length;
      const industryCounts: Record<string, number> = {};
      mergedCompanies.forEach(c => {
        if (c.industry) {
          industryCounts[c.industry] = (industryCounts[c.industry] || 0) + 1;
        }
      });
      const topIndustry = Object.entries(industryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      setNetworkSplashData({
        contacts: contacts.length,
        companies: mergedCompanies.length,
        strong,
        topIndustry,
      });
      setShowNetworkSplash(true);
      localStorage.setItem('introo_splash_seen', 'true');
    }
  }, [loadingPhase]);


  // #6 Tag tip: show after viewing 3+ company panels
  useEffect(() => {
    if (inlinePanel?.type === 'company') {
      setCompanyPanelViewCount(prev => {
        const next = prev + 1;
        if (next === 3 && tagDefs.length === 0 && !localStorage.getItem('introo_tag_tip_seen')) {
          setTimeout(() => setShowTagTip(true), 500);
          localStorage.setItem('introo_tag_tip_seen', 'true');
        }
        return next;
      });
    }
  }, [inlinePanel]);

  // #7 View prompt: show after meaningful filters are applied (if no savedViews yet)
  // Only triggers when at least one "specific" sidebar filter is set (industry, size, keywords, funding, location, tags, etc.)
  // Simple top-level toggles (source, strength, connection) alone are not enough.
  useEffect(() => {
    if (viewPromptDismissed || savedViews.length > 0 || showViewPrompt || selectedView) return;
    if (localStorage.getItem('introo_view_prompt_dismissed')) return;
    const sf = sidebarFilters;
    const specificFilterCount =
      (sf.aiKeywords.length > 0 ? 1 : 0) +
      (sf.employeeRanges.length > 0 ? 1 : 0) +
      (sf.categories.length > 0 ? 1 : 0) +
      (sf.fundingRounds.length > 0 ? 1 : 0) +
      (sf.technologies.length > 0 ? 1 : 0) +
      (sf.revenueRanges.length > 0 ? 1 : 0) +
      (sf.country ? 1 : 0) +
      (sf.city ? 1 : 0) +
      (tagFilter.length > 0 ? 1 : 0) +
      (sf.connectedYears.length > 0 || sf.connectedMonths.length > 0 ? 1 : 0) +
      (sf.foundedFrom ? 1 : 0) +
      (sf.foundedTo ? 1 : 0);
    const shouldShow = specificFilterCount >= 2 || (specificFilterCount >= 1 && activeFilterCount >= 3);
    if (shouldShow) {
      const t = setTimeout(() => setShowViewPrompt(true), 1500);
      return () => clearTimeout(t);
    }
  }, [activeFilterCount, viewPromptDismissed, savedViews.length, selectedView, showViewPrompt, sidebarFilters, tagFilter]);

  // #8 Detect new Space companies appearing
  useEffect(() => {
    const currentSpaceDomains = new Set(
      mergedCompanies.filter(c => c.spaceCount > 0).map(c => c.domain)
    );
    const prev = prevSpaceCompanyDomainsRef.current;
    if (prev.size > 0) {
      const newOnes = new Set<string>();
      currentSpaceDomains.forEach(d => { if (!prev.has(d)) newOnes.add(d); });
      if (newOnes.size > 0) {
        setNewSpaceCompanies(newOnes);
        setTimeout(() => setNewSpaceCompanies(new Set()), 4000);
      }
    }
    prevSpaceCompanyDomainsRef.current = currentSpaceDomains;
  }, [mergedCompanies]);

  // ─── Keyboard ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') {
        // Close innermost layer first: tag picker → panel → search → view
        if (tagPickerDomain) {
          setTagPickerDomain(null);
          setTagPickerSearch('');
        } else if (inlinePanel) {
          setInlinePanel(null);
        } else if (searchQuery) {
          setSearchQuery('');
        } else if (selectedView) {
          setSelectedView(null);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tagPickerDomain, inlinePanel, searchQuery, selectedView]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  const toggleView = useCallback((viewId: string) => {
    setSelectedView(prev => {
      if (prev === viewId) {
        // Deactivating view — reset all filters to defaults
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
        setSourceFilter('all');
        setStrengthFilter('all');
        setTagFilter([]);
        setSpaceFilter('all');
        setConnectionFilter('all');
        setAccountFilter('all');
        setTableSorts([]);
        setGroupByField(null);
        return null;
      }
      // Restore full state from the saved view
      const view = savedViews.find(v => v.id === viewId);
      if (view) {
        // Sort & group
        if (view.sortRules && view.sortRules.length > 0) {
          setTableSorts(view.sortRules as SortRule[]);
        } else {
          setTableSorts([]);
        }
        if (view.groupBy) {
          setGroupByField(view.groupBy.field as SortField);
          setGroupByDir(view.groupBy.dir);
        } else {
          setGroupByField(null);
        }
        // Restore sidebar filters
        const f = view.filters || {};
        setSidebarFilters({
          description: f.description || '',
          categories: f.categories || [],
          excludeKeywords: Array.isArray(f.excludeKeywords) ? f.excludeKeywords : [],
          aiKeywords: f.aiKeywords || [],
          employeeRanges: f.employeeRanges || [],
          country: f.country || '',
          city: f.city || '',
          fundingRounds: f.fundingRounds || [],
          fundingRecency: (f.fundingRecency as 'any' | '6m' | '1y') || 'any',
          foundedFrom: f.foundedFrom || '',
          foundedTo: f.foundedTo || '',
          revenueRanges: f.revenueRanges || [],
          isHiring: false,
          technologies: f.technologies || [],
          connectedYears: f.connectedYears || [],
          connectedMonths: f.connectedMonths || [],
        });
        setSourceFilter((f.sourceFilter as 'all' | 'mine' | 'spaces' | 'both') || 'all');
        setStrengthFilter((f.strengthFilter as 'all' | 'strong' | 'medium' | 'weak') || 'all');
        setTagFilter(f.tagFilter || []);
        setSpaceFilter((f.spaceFilter as string) || 'all');
        setConnectionFilter((f.connectionFilter as string) || 'all');
        setAccountFilter((f.accountFilter as string) || 'all');
      }
      return viewId;
    });
    setExpandedDomain(null);
    setGridPage(0);
  }, [savedViews]);

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
      setSelectedView(null);
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
    } finally {
      setAiParsing(false);
    }
  }, [availableCountries, spaces]);

  // Save current AI search as a pinned view
  const saveAsView = useCallback(async () => {
    if (!lastAiQuery) return;
    const { query, keywords } = lastAiQuery;
    if (keywords.length > 0) {
      const sortRules: ViewSortRule[] = tableSorts.map(s => ({ field: s.field, dir: s.dir }));
      const groupBy = groupByField ? { field: groupByField, dir: groupByDir } : null;
      const savedFilters = buildViewFilters();
      try {
        const created = await viewsApi.create({ title: query, keywords, filters: savedFilters as Record<string, unknown>, sortRules, groupBy });
        setSavedViews(prev => [...prev, {
          id: created.id,
          title: created.title,
          keywords: created.keywords as string[],
          filters: created.filters as ViewFilters,
          sortRules: created.sortRules as ViewSortRule[],
          groupBy: created.groupBy as { field: string; dir: 'asc' | 'desc' } | null,
          isActive: true,
        }]);
        setSelectedView(created.id);
        setSidebarTab('views');
      } catch (err) {
        console.error('Failed to save view:', err);
      }
    }
    setLastAiQuery(null);
    setAiExplanation(null);
  }, [lastAiQuery, tableSorts, groupByField, groupByDir, buildViewFilters]);

  const removeView = useCallback((id: string) => {
    const prevViews = savedViews;
    setSavedViews(prev => prev.filter(h => h.id !== id));
    if (selectedView === id) setSelectedView(null);
    viewsApi.delete(id).catch(err => {
      console.error('Failed to delete view:', err);
      setSavedViews(prevViews);
    });
  }, [selectedView, savedViews]);

  const openIntroPanel = useCallback((company: MergedCompany, overrideSourceFilter?: string, overrideSpaceFilter?: string) => {
    setIntroSelectedThrough(null);
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
    emailApi.sendIntroOffer({
      recipientEmail: contact.email,
      recipientName: contact.name,
      targetCompany: companyName,
    }).catch(() => {});
  }, []);

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

  // Fetch calendar last sync time & connected accounts
  const refreshCalendarAccounts = useCallback(() => {
    calendarApi.getAccounts()
      .then(setCalendarAccounts)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshCalendarAccounts();

    // Auto-open settings if redirected from add-account callback
    const params = new URLSearchParams(window.location.search);
    if (params.get('panel') === 'settings') {
      setInlinePanel({ type: 'settings' });

      // Show error messages from add-account flow
      const error = params.get('error');
      if (error === 'already_linked') {
        alert('This Google account is already linked to another user.');
      } else if (error === 'duplicate_account') {
        alert('This is already your main account.');
      }

      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [refreshCalendarAccounts]);

  // Auto-sync calendars every 2 hours while the app is open
  useEffect(() => {
    if (!isCalendarConnected) return;
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const interval = setInterval(() => {
      console.log('[auto-sync] Running periodic calendar sync');
      calendarApi.sync().then(() => refreshCalendarAccounts()).catch(() => {});
    }, TWO_HOURS);
    return () => clearInterval(interval);
  }, [isCalendarConnected, refreshCalendarAccounts]);

  // Calendar sync handler (syncs all accounts + legacy primary)
  const handleCalendarSync = useCallback(async () => {
    if (calendarSyncing) return;
    setCalendarSyncing(true);
    try {
      await syncCalendar();
      refreshCalendarAccounts();
    } catch (err) {
      console.error('Calendar sync failed:', err);
    } finally {
      setCalendarSyncing(false);
    }
  }, [calendarSyncing, syncCalendar, refreshCalendarAccounts]);

  // Per-account sync handler
  const handleAccountSync = useCallback(async (accountId: string) => {
    if (syncingAccountId) return;
    setSyncingAccountId(accountId);
    try {
      await calendarApi.syncAccount(accountId);
      refreshCalendarAccounts();
    } catch (err) {
      console.error('Account sync failed:', err);
    } finally {
      setSyncingAccountId(null);
    }
  }, [syncingAccountId, refreshCalendarAccounts]);

  // Delete account handler
  const handleAccountDelete = useCallback(async (accountId: string) => {
    try {
      await calendarApi.deleteAccount(accountId);
      refreshCalendarAccounts();
    } catch (err) {
      console.error('Account delete failed:', err);
    }
  }, [refreshCalendarAccounts]);

  // ─── Active-sections set (for indicator dots) ──────────────────────────────
  const activeSectionIds = useMemo(() => {
    const s = new Set<string>();
    if (tagFilter.length > 0) s.add('tags');
    if (strengthFilter !== 'all') s.add('strength');
    if (sidebarFilters.aiKeywords.length > 0 || sidebarFilters.excludeKeywords.length > 0 || sidebarFilters.description) s.add('description');
    if (sidebarFilters.connectedYears.length > 0 || sidebarFilters.connectedMonths.length > 0) s.add('connected-time');
    if (sidebarFilters.employeeRanges.length > 0) s.add('employees');
    if (sidebarFilters.country || sidebarFilters.city) s.add('location');
    if (sidebarFilters.fundingRounds.length > 0 || sidebarFilters.fundingRecency !== 'any') s.add('funding');
    if (sidebarFilters.foundedFrom || sidebarFilters.foundedTo) s.add('founded');
    if (sidebarFilters.revenueRanges.length > 0) s.add('revenue');
    if (sidebarFilters.technologies.length > 0) s.add('technologies');
    if (groupByField || tableSorts.length > 0 || peopleGroupByField || peopleSorts.length > 0) s.add('sort-group');
    return s;
  }, [strengthFilter, tagFilter, sidebarFilters, groupByField, tableSorts, peopleGroupByField, peopleSorts]);

  // ─── Sidebar section helper ────────────────────────────────────────────────

  const SidebarSection = useCallback(({ id, icon, title, children }: {
    id: string; icon: string; title: string; children: React.ReactNode;
  }) => (
    <div className={`sb-section ${openSections[id] ? 'open' : ''}`}>
      <button className="sb-section-header" onClick={() => toggleSection(id)}>
        <span className="sb-section-icon">{icon}</span>
        <span className="sb-section-title">{title}</span>
        {!openSections[id] && activeSectionIds.has(id) && (
          <span className="sb-section-active-dot" />
        )}
        <svg className="sb-section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {openSections[id] && <div className="sb-section-body">{children}</div>}
    </div>
  ), [openSections, toggleSection, activeSectionIds]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  // Redirect to login if not authenticated (after all hooks have run)
  if (!storeLoading && !isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="u-root">
      <div className="u-ambient" />

      {introToast && (
        <div className={`u-toast ${introToast.includes('Failed') ? 'u-toast--error' : 'u-toast--success'}`}>
          {introToast}
        </div>
      )}

      {/* #1 Network stats splash screen after first sync */}
      {showNetworkSplash && networkSplashData && (
        <div className="ob-splash-overlay" onClick={() => setShowNetworkSplash(false)}>
          <div className="ob-splash" onClick={e => e.stopPropagation()}>
            <div className="ob-splash-orb" />
            <h2 className="ob-splash-title">Your network is ready</h2>
            <div className="ob-splash-stats">
              <div className="ob-splash-stat">
                <span className="ob-splash-stat-num">{networkSplashData.contacts}</span>
                <span className="ob-splash-stat-label">contacts</span>
              </div>
              <div className="ob-splash-stat">
                <span className="ob-splash-stat-num">{networkSplashData.companies}</span>
                <span className="ob-splash-stat-label">companies</span>
              </div>
              {networkSplashData.strong > 0 && (
                <div className="ob-splash-stat">
                  <span className="ob-splash-stat-num">{networkSplashData.strong}</span>
                  <span className="ob-splash-stat-label">strong ties</span>
                </div>
              )}
            </div>
            {networkSplashData.topIndustry && (
              <p className="ob-splash-insight">Your strongest vertical: <strong>{networkSplashData.topIndustry}</strong></p>
            )}
            <button className="ob-splash-btn" onClick={() => setShowNetworkSplash(false)}>
              Explore your network
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </button>
          </div>
        </div>
      )}

      {/* Interactive onboarding tour — shown once for new users, after splash is dismissed */}
      {!storeLoading && !loading && contacts.length > 0 && !showNetworkSplash && (
        <OnboardingTour />
      )}

      <div className="u-layout">
        {/* ═══════ LEFT SIDEBAR ═══════ */}
        <aside className={`sb ${sidebarOpen ? 'open' : 'closed'}`}>
          <div className="sb-header">
            <div className="sb-tabs">
              <button className={`sb-tab ${sidebarTab === 'filters' ? 'sb-tab--active' : ''}`} onClick={() => setSidebarTab('filters')}>
                Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </button>
              <button className={`sb-tab ${sidebarTab === 'views' ? 'sb-tab--active' : ''}`} onClick={() => setSidebarTab('views')}>
                Views{savedViews.length > 0 ? ` (${savedViews.length})` : ''}
              </button>
            </div>
            <button className="sb-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d={sidebarOpen ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
              </svg>
            </button>
          </div>
          {/* Active filter pills removed — count shown in tab label instead */}
          {/* ═══ Views Tab ═══ */}
          {sidebarTab === 'views' && (
            <div className="sb-scroll">
              <div className="sb-views-list">
                {savedViews.length === 0 ? (
                  <div className="sb-views-empty">
                    <span className="sb-views-empty-icon">📑</span>
                    <p className="sb-views-empty-title">No saved views yet</p>
                    <p className="sb-views-empty-desc">Apply filters, sorts, or groups on the Filters tab, then save them as a reusable view.</p>
                  </div>
                ) : (
                  savedViews.map(v => (
                    <div key={v.id} className={`sb-view-card ${selectedView === v.id ? 'sb-view-card--active' : ''}`} onClick={() => toggleView(v.id)}>
                      <div className="sb-view-card-row">
                        {editingViewId === v.id ? (
                          <input
                            className="sb-view-card-input"
                            autoFocus
                            value={editingViewName}
                            onClick={e => e.stopPropagation()}
                            onChange={e => setEditingViewName(e.target.value)}
                            onBlur={() => { if (editingViewName.trim()) { const newTitle = editingViewName.trim(); setSavedViews(prev => prev.map(sv => sv.id === v.id ? { ...sv, title: newTitle } : sv)); viewsApi.update(v.id, { title: newTitle }).catch(err => console.error('Failed to rename view:', err)); } setEditingViewId(null); }}
                            onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } if (e.key === 'Escape') { setEditingViewId(null); } }}
                          />
                        ) : (
                          <span className="sb-view-card-name">
                            {v.title}
                            <svg className="sb-view-card-pencil" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" onClick={e => { e.stopPropagation(); setEditingViewId(v.id); setEditingViewName(v.title); }}><path d="M17 3a2.85 2.85 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                          </span>
                        )}
                        <span className="sb-view-card-count">{viewMatchCounts[v.id] || 0}</span>
                        <button className="sb-view-card-x" onClick={e => { e.stopPropagation(); removeView(v.id); }} title="Delete view">×</button>
                      </div>
                      {(v.keywords && v.keywords.length > 0 || v.sortRules && v.sortRules.length > 0 || v.groupBy) && (
                        <div className="sb-view-card-meta">
                          {v.keywords && v.keywords.length > 0 && (
                            <span className="sb-view-card-tags">{v.keywords.slice(0, 3).join(', ')}{v.keywords.length > 3 ? ` +${v.keywords.length - 3}` : ''}</span>
                          )}
                          {v.sortRules && v.sortRules.length > 0 && (
                            <span className="sb-view-card-detail">Sort: {v.sortRules.map(s => s.field).join(', ')}</span>
                          )}
                          {v.groupBy && (
                            <span className="sb-view-card-detail">Group: {v.groupBy.field}</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ═══ Filters Tab ═══ */}
          {sidebarTab === 'filters' && <>
          <div className="sb-scroll">

            {/* ── Sort & Group (collapsible section) ── */}
            <SidebarSection id="sort-group" icon="⇅" title="Sort & Group">
              <div className="sb-sg-body">
                {/* Group */}
                <div className="sb-sg-inline">
                  <span className="sb-sg-tag">Group by</span>
                  {entityTab === 'companies' ? (
                    groupByField ? (
                      <div className="sb-sg-rule">
                        <select className="sb-sg-sel" value={groupByField} onChange={e => { setGroupByField(e.target.value as SortField); setCollapsedGroups(new Set()); setGridPage(0); }}>
                          {ALL_SORT_FIELDS.map(f => <option key={f} value={f}>{SORT_FIELD_LABELS[f]}</option>)}
                        </select>
                        <select className="sb-sg-sel sb-sg-sel--dir" value={groupByDir} onChange={e => { const dir = e.target.value as SortDir; setGroupByDir(dir); setTableSorts(prev => prev.map(s => s.field === groupByField ? { ...s, dir } : s)); setGridPage(0); }}>
                          <option value="asc">A → Z</option>
                          <option value="desc">Z → A</option>
                        </select>
                        <button className="sb-sg-x" onClick={() => { setGroupByField(null); setCollapsedGroups(new Set()); setGridPage(0); }}>×</button>
                      </div>
                    ) : (
                      <select className="sb-sg-sel sb-sg-sel--placeholder" value="" onChange={e => { if (e.target.value) { setGroupByField(e.target.value as SortField); setGroupByDir('asc'); setCollapsedGroups(new Set()); setGridPage(0); } }}>
                        <option value="" disabled>Choose a field...</option>
                        {ALL_SORT_FIELDS.map(f => <option key={f} value={f}>{SORT_FIELD_LABELS[f]}</option>)}
                      </select>
                    )
                  ) : (
                    peopleGroupByField ? (
                      <div className="sb-sg-rule">
                        <select className="sb-sg-sel" value={peopleGroupByField} onChange={e => { setPeopleGroupByField(e.target.value as PeopleSortField); setPeopleCollapsedGroups(new Set()); setGridPage(0); }}>
                          {ALL_PEOPLE_FIELDS.map(f => <option key={f} value={f}>{PEOPLE_FIELD_LABELS[f]}</option>)}
                        </select>
                        <select className="sb-sg-sel sb-sg-sel--dir" value={peopleGroupByDir} onChange={e => { const dir = e.target.value as SortDir; setPeopleGroupByDir(dir); setPeopleSorts(prev => prev.map(s => s.field === peopleGroupByField ? { ...s, dir } : s)); setGridPage(0); }}>
                          <option value="asc">A → Z</option>
                          <option value="desc">Z → A</option>
                        </select>
                        <button className="sb-sg-x" onClick={() => { setPeopleGroupByField(null); setPeopleCollapsedGroups(new Set()); setGridPage(0); }}>×</button>
                      </div>
                    ) : (
                      <select className="sb-sg-sel sb-sg-sel--placeholder" value="" onChange={e => { if (e.target.value) { setPeopleGroupByField(e.target.value as PeopleSortField); setPeopleGroupByDir('asc'); setPeopleCollapsedGroups(new Set()); setGridPage(0); } }}>
                        <option value="" disabled>Choose a field...</option>
                        {ALL_PEOPLE_FIELDS.map(f => <option key={f} value={f}>{PEOPLE_FIELD_LABELS[f]}</option>)}
                      </select>
                    )
                  )}
                </div>

                {/* Sort */}
                <div className="sb-sg-inline">
                  <span className="sb-sg-tag">Sort by</span>
                  {entityTab === 'companies' ? (
                    <>
                      {tableSorts.map((rule, idx) => (
                        <div key={idx} className="sb-sg-rule">
                          <select className="sb-sg-sel" value={rule.field} onChange={e => { const next = [...tableSorts]; next[idx] = { ...next[idx], field: e.target.value as SortField }; setTableSorts(next); setGridPage(0); }}>
                            {ALL_SORT_FIELDS.map(f => <option key={f} value={f}>{SORT_FIELD_LABELS[f]}</option>)}
                          </select>
                          <select className="sb-sg-sel sb-sg-sel--dir" value={rule.dir} onChange={e => { const dir = e.target.value as SortDir; const next = [...tableSorts]; next[idx] = { ...next[idx], dir }; setTableSorts(next); if (rule.field === groupByField) setGroupByDir(dir); setGridPage(0); }}>
                            <option value="asc">A → Z</option>
                            <option value="desc">Z → A</option>
                          </select>
                          <button className="sb-sg-x" onClick={() => { setTableSorts(tableSorts.filter((_, i) => i !== idx)); setGridPage(0); }}>×</button>
                        </div>
                      ))}
                      <button className="sb-sg-plus" onClick={() => { const used = new Set(tableSorts.map(s => s.field)); const next = ALL_SORT_FIELDS.find(f => !used.has(f)) || 'name'; setTableSorts([...tableSorts, { field: next, dir: 'asc' }]); }}>
                        + Add a sort
                      </button>
                    </>
                  ) : (
                    <>
                      {peopleSorts.map((rule, idx) => (
                        <div key={idx} className="sb-sg-rule">
                          <select className="sb-sg-sel" value={rule.field} onChange={e => { const next = [...peopleSorts]; next[idx] = { ...next[idx], field: e.target.value as PeopleSortField }; setPeopleSorts(next); setGridPage(0); }}>
                            {ALL_PEOPLE_FIELDS.map(f => <option key={f} value={f}>{PEOPLE_FIELD_LABELS[f]}</option>)}
                          </select>
                          <select className="sb-sg-sel sb-sg-sel--dir" value={rule.dir} onChange={e => { const dir = e.target.value as SortDir; const next = [...peopleSorts]; next[idx] = { ...next[idx], dir }; setPeopleSorts(next); if (rule.field === peopleGroupByField) setPeopleGroupByDir(dir); setGridPage(0); }}>
                            <option value="asc">A → Z</option>
                            <option value="desc">Z → A</option>
                          </select>
                          <button className="sb-sg-x" onClick={() => { setPeopleSorts(peopleSorts.filter((_, i) => i !== idx)); setGridPage(0); }}>×</button>
                        </div>
                      ))}
                      <button className="sb-sg-plus" onClick={() => { const used = new Set(peopleSorts.map(s => s.field)); const next = ALL_PEOPLE_FIELDS.find(f => !used.has(f)) || 'name'; setPeopleSorts([...peopleSorts, { field: next, dir: 'asc' }]); }}>
                        + Add a sort
                      </button>
                    </>
                  )}
                </div>
              </div>
            </SidebarSection>

            {/* ── Source ── */}
            <SidebarSection id="source" icon="📂" title="Source">
              <div className="sb-chips">
                {([
                  { key: 'all', label: 'All', count: stats.total },
                  { key: 'mine', label: 'Mine', count: stats.myCompanies },
                  { key: 'spaces', label: 'Network', count: stats.spaceCompanies },
                ] as const).map(f => (
                  <button
                    key={f.key}
                    className={`sb-chip sb-chip--${f.key} ${sourceFilter === f.key ? 'active' : ''}`}
                    onClick={() => { setSourceFilter(f.key); setAccountFilter('all'); setSpaceFilter('all'); setConnectionFilter('all'); }}
                  >
                    {f.label} <span className="sb-chip-count">{f.count}</span>
                  </button>
                ))}
              </div>

              {/* Per-account filter pills (visible when multiple calendar accounts) */}
              {calendarAccounts.length > 1 && (sourceFilter === 'all' || sourceFilter === 'mine') && (
                <div className="sb-accounts-list">
                  {calendarAccounts.map(a => {
                    const count = accountCompanyCounts[a.email] || 0;
                    if (count === 0) return null;
                    const emailLabel = a.email.split('@')[0];
                    return (
                      <button
                        key={a.email}
                        className={`sb-account-pill ${accountFilter === a.email ? 'active' : ''}`}
                        onClick={() => { setAccountFilter(accountFilter === a.email ? 'all' : a.email); setSourceFilter('mine'); setSpaceFilter('all'); setConnectionFilter('all'); }}
                        title={a.email}
                      >
                        <span className="sb-account-icon">📧</span>
                        <span className="sb-account-label">{emailLabel}</span>
                        <span className="sb-account-count">{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </SidebarSection>

            {/* ── My Network (spaces + connections) ── */}
            <SidebarSection id="network" icon="🌐" title="My Network">
              {/* Spaces */}
              {spaces.length > 0 && (
                <div className="sb-spaces-list">
                  <span className="sb-chips-label">Spaces</span>
                  {spaces.map(s => (
                    <button
                      key={s.id}
                      className={`sb-space-pill ${spaceFilter === s.id ? 'active' : ''}`}
                      onClick={() => { setSpaceFilter(spaceFilter === s.id ? 'all' : s.id); setSourceFilter('all'); setAccountFilter('all'); setConnectionFilter('all'); }}
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

              {/* Connections */}
              {connections.filter(c => c.status === 'accepted').length > 0 && (
                <div className="sb-spaces-list" style={{ marginTop: '0.35rem' }}>
                  <span className="sb-chips-label">Connections</span>
                  {connections.filter(c => c.status === 'accepted').map(c => (
                    <button
                      key={c.id}
                      className={`sb-space-pill ${connectionFilter === c.id ? 'active' : ''}`}
                      onClick={() => { setConnectionFilter(connectionFilter === c.id ? 'all' : c.id); setSpaceFilter('all'); setSourceFilter('all'); setAccountFilter('all'); }}
                      onDoubleClick={() => setInlinePanel({ type: 'connection', connectionId: c.id })}
                      title={`${c.peer.name} — ${c.peer.email}. Double-click for details.`}
                    >
                      <PersonAvatar email={c.peer.email} name={c.peer.name} avatarUrl={c.peer.avatar} size={20} />
                      <span className="sb-space-name">{c.peer.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Pending incoming connection requests */}
              {connections.filter(c => c.status === 'pending' && c.direction === 'received').length > 0 && (
                <div className="sb-spaces-list" style={{ marginTop: '0.35rem' }}>
                  <span className="sb-chips-label">Pending</span>
                  {connections.filter(c => c.status === 'pending' && c.direction === 'received').map(c => (
                    <div key={c.id} className="sb-conn-pending">
                      <PersonAvatar email={c.peer.email} name={c.peer.name} avatarUrl={c.peer.avatar} size={20} />
                      <span className="sb-space-name" style={{ flex: 1 }}>{c.peer.name}</span>
                      <button className="u-notif-accept-btn" style={{ fontSize: '0.6rem', padding: '0.15rem 0.4rem' }} onClick={() => acceptConnection(c.id)}>Accept</button>
                      <button className="u-notif-reject-btn" style={{ fontSize: '0.6rem', padding: '0.15rem 0.4rem' }} onClick={() => rejectConnection(c.id)}>×</button>
                    </div>
                  ))}
                </div>
              )}

              {spaces.length === 0 && connections.filter(c => c.status === 'accepted').length === 0 && (
                <p className="sb-empty-hint">No spaces or connections yet.</p>
              )}
            </SidebarSection>

            {/* ── Tags filter ── */}
            <SidebarSection id="tags" icon="🏷" title="Tags">
              {allTags.length > 0 && (
                <div className="sb-chips">
                  {allTags.map(t => {
                    const color = getTagColor(t);
                    const count = Object.values(companyTags).filter(tags => tags.includes(t)).length;
                    const isActive = tagFilter.includes(t);
                    return (
                      <button
                        key={t}
                        className={`sb-chip sb-chip--tag ${isActive ? 'active' : ''}`}
                        style={isActive ? { borderColor: color.border, background: color.bg, color: color.text } : {}}
                        onClick={() => { setTagFilter(prev =>
                          prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
                        ); setGridPage(0); }}
                        onContextMenu={e => { e.preventDefault(); deleteTagDef(t); }}
                      >
                        <span className="sb-tag-dot" style={{ background: color.text }} />
                        {t} <span className="sb-chip-count">{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <form className="sb-tag-add-form" onSubmit={e => {
                e.preventDefault();
                const input = e.currentTarget.querySelector('input') as HTMLInputElement;
                const val = input?.value.trim();
                if (val) { createTag(val); input.value = ''; }
              }}>
                <input className="sb-input sb-tag-add-input" placeholder="+ Add tag..." maxLength={30} />
              </form>
              {allTags.length === 0 && (
                <p className="sb-empty-hint">Type a name above to create your first tag.</p>
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
                  {timeFilterStats.years.map(y => (
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
                      {y} <span className="sb-chip-count">{timeFilterStats.yearCounts[y]}</span>
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
                      {m.label} {timeFilterStats.monthCounts[m.value] ? <span className="sb-chip-count">{timeFilterStats.monthCounts[m.value]}</span> : null}
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
              <div className="sb-chips">
                {[
                  { key: 'no-funding', label: 'No funding' },
                  { key: 'pre-seed', label: 'Pre-Seed / Seed' },
                  { key: 'series-a', label: 'Series A' },
                  { key: 'series-b', label: 'Series B+' },
                  { key: 'vc-backed', label: 'VC Backed' },
                ].map(r => {
                  const cnt = fundingRoundCounts[r.key] || 0;
                  return (
                  <label key={r.key} className={`sb-chip ${sidebarFilters.fundingRounds.includes(r.key) ? 'active' : ''} ${cnt === 0 ? 'sb-chip--empty' : ''}`}>
                    <input
                      type="checkbox"
                      checked={sidebarFilters.fundingRounds.includes(r.key)}
                      onChange={() => toggleFundingRound(r.key)}
                      style={{ display: 'none' }}
                    />
                    {r.label} <span className="sb-chip-count">{cnt}</span>
                  </label>
                  );
                })}
              </div>
              <label className="sb-field-label" style={{ marginTop: '0.5rem' }}>Last round date</label>
              <div className="sb-chips">
                {[
                  { key: 'any', label: 'Any time' },
                  { key: '6m', label: '< 6 months' },
                  { key: '1y', label: '< 1 year' },
                ].map(r => (
                  <button
                    key={r.key}
                    className={`sb-chip ${sidebarFilters.fundingRecency === r.key ? 'active' : ''}`}
                    onClick={() => setSidebarFilters(p => ({ ...p, fundingRecency: r.key as typeof p.fundingRecency }))}
                  >
                    {r.label}
                  </button>
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
          {/* Bottom actions — Save as View + Clear all */}
          {(activeFilterCount > 0 || groupByField || tableSorts.length > 0) && (
            <div className="sb-bottom-actions">
              <button className="sb-save-search-btn" onClick={() => {
                const sf = sidebarFilters;
                const keywords = [
                  ...sf.aiKeywords,
                  ...sf.categories.map(c => c.toLowerCase()),
                  ...(sf.description ? sf.description.toLowerCase().split(/\s+/).filter(w => w.length > 1) : []),
                ].filter((k, i, arr) => k && arr.indexOf(k) === i);

                const savedFilters = buildViewFilters();

                const titleParts: string[] = [];
                if (sf.description) titleParts.push(sf.description);
                else if (sf.aiKeywords.length > 0) titleParts.push(sf.aiKeywords.slice(0, 3).join(', '));
                else if (sf.categories.length > 0) titleParts.push(sf.categories.join(', '));
                if (sf.employeeRanges.length > 0) titleParts.push(sf.employeeRanges.join('/') + ' emp');
                if (sf.country) titleParts.push(sf.country);
                if (sf.city) titleParts.push(sf.city);
                if (sf.fundingRounds.length > 0) {
                  const fl: Record<string, string> = { 'no-funding': 'No funding', 'pre-seed': 'Pre-Seed/Seed', 'series-a': 'Series A', 'series-b': 'Series B+', 'vc-backed': 'VC Backed' };
                  titleParts.push(sf.fundingRounds.map(r => fl[r] || r).join(', '));
                }
                if (sf.fundingRecency !== 'any') titleParts.push(sf.fundingRecency === '6m' ? 'Funded < 6mo' : 'Funded < 1yr');
                if (sf.foundedFrom || sf.foundedTo) titleParts.push(`Founded ${sf.foundedFrom || '...'}–${sf.foundedTo || '...'}`);
                if (sf.revenueRanges.length > 0) titleParts.push('Revenue: ' + sf.revenueRanges.join(', '));
                if (sf.connectedYears.length > 0 || sf.connectedMonths.length > 0) {
                  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                  const parts = [...sf.connectedYears, ...sf.connectedMonths.map(m => months[parseInt(m) - 1] || m)];
                  titleParts.push('Connected ' + parts.join(', '));
                }
                if (strengthFilter !== 'all') titleParts.push(`Strength: ${strengthFilter}`);
                if (tagFilter.length > 0) titleParts.push(`Tags: ${tagFilter.join(', ')}`);
                if (groupByField) titleParts.push(`Grouped: ${SORT_FIELD_LABELS[groupByField]}`);
                if (tableSorts.length > 0) titleParts.push(`Sorted: ${tableSorts.map(s => SORT_FIELD_LABELS[s.field]).join(', ')}`);

                const title = titleParts.join(' · ') || 'Saved view';
                const sortRules: ViewSortRule[] = tableSorts.map(s => ({ field: s.field, dir: s.dir }));
                const groupBy = groupByField ? { field: groupByField, dir: groupByDir } : null;
                viewsApi.create({ title, keywords, filters: savedFilters as Record<string, unknown>, sortRules, groupBy }).then(created => {
                  setSavedViews(prev => [...prev, { id: created.id, title: created.title, keywords: created.keywords as string[], filters: created.filters as ViewFilters, sortRules: created.sortRules as ViewSortRule[], groupBy: created.groupBy as { field: string; dir: 'asc' | 'desc' } | null, isActive: true }]);
                  setSelectedView(created.id);
                  setSidebarTab('views');
                }).catch(err => console.error('Failed to save view:', err));
              }}>
                Save as View
              </button>
              {activeFilterCount > 0 && (
                <button className="sb-clear-all-btn" onClick={clearAllFilters}>
                  Clear all filters ({activeFilterCount})
                </button>
              )}
            </div>
          )}
          </>}
        </aside>

        {/* Sidebar reopen strip (always rendered when closed) */}
        {!sidebarOpen && (
          <button className="sb-reopen" onClick={() => setSidebarOpen(true)} title="Show sidebar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m9 18 6-6-6-6" />
            </svg>
            <span className="sb-reopen-label">Filters & Views</span>
          </button>
        )}

        {/* Mobile filter toggle (FAB) */}
        {!sidebarOpen && (
          <button className="sb-mobile-toggle" onClick={() => setSidebarOpen(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h10M4 18h6" /></svg>
            Filters & Views
            {activeFilterCount > 0 && <span className="sb-mobile-badge">{activeFilterCount}</span>}
          </button>
        )}

        {/* Mobile backdrop (closes sidebar) */}
        {sidebarOpen && <div className="sb-mobile-backdrop" onClick={() => setSidebarOpen(false)} />}

        {/* ═══════ MAIN CONTENT ═══════ */}
        <div className={`u-canvas ${inlinePanel ? 'has-panel' : ''}`}>
          {/* ── Top Bar ─────────────────────────────────────────── */}
          <header className="u-topbar">
            <a className="u-logo" href="/home" title="Introo">
              <span className="u-logo-mark">introo</span>
            </a>
            <div className={`u-omni ${searchFocused ? 'focused' : ''}`}>
              <div className="u-omni-input-row">
                <svg className="u-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  ref={searchRef}
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setGridPage(0); }}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  placeholder={aiParsing ? 'Parsing with AI...' : 'Search companies, contacts...'}
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
                {searchQuery.trim().length > 2 && !aiParsing && (
                  <button
                    className="u-ai-search-btn"
                    title="Deep search with AI (Enter)"
                    onMouseDown={e => { e.preventDefault(); aiSearch(searchQuery.trim()); }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M9 18h6"/><path d="M12 18v4"/>
                      <path d="M8 22h8"/>
                    </svg>
                    AI Deep Search
                  </button>
                )}
                {searchQuery && (
                  <button className="u-search-clear" onClick={() => setSearchQuery('')}>×</button>
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
                  <span className="u-enrich-spinner" />
                  {enrichProgress.contactsFree
                    ? `${enrichProgress.contactsFree.enriched + enrichProgress.contactsFree.skipped + enrichProgress.contactsFree.errors}/${enrichProgress.contactsFree.total}`
                    : 'Enriching...'}
                  <button className="u-topbar-enrich-stop" onClick={stopEnrichment} title="Stop enrichment">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor"/></svg>
                  </button>
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
                Filters & Views
                {activeFilterCount > 0 && <span className="u-filter-toggle-badge">{activeFilterCount}</span>}
              </button>
            )}
            {!sidebarOpen && (
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
                    <span>{f.label}</span>
                    <span className="u-ff-count">{f.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── AI explanation banner ─────────────────────────── */}
          {aiExplanation && (
            <div className="u-ai-banner">
              <span className="u-ai-banner-icon">AI</span>
              <span className="u-ai-banner-text">{aiExplanation}</span>
              {lastAiQuery && (
                <button className="u-ai-banner-save" onClick={saveAsView}>Save as View</button>
              )}
              <button className="u-ai-banner-dismiss" onClick={() => { setAiExplanation(null); setLastAiQuery(null); }}>×</button>
            </div>
          )}

          {/* ── Results bar with entity tabs ─────────────────── */}
          <div className="u-results-bar">
            <div className="u-entity-tabs">
              <button
                className={`u-entity-tab ${entityTab === 'companies' ? 'u-entity-tab--active' : ''}`}
                onClick={() => { setEntityTab('companies'); setGridPage(0); }}
              >
                Companies <span className="u-entity-tab-count">{filteredCompanies.length}</span>
              </button>
              <button
                className={`u-entity-tab ${entityTab === 'people' ? 'u-entity-tab--active' : ''}`}
                onClick={() => { setEntityTab('people'); setGridPage(0); }}
              >
                People <span className="u-entity-tab-count">{totalPeopleCount}</span>
              </button>
            </div>
            {activeFilterCount > 0 && (
              <button className="u-filters-clear" onClick={clearAllFilters}>
                Clear {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
              </button>
            )}
            <div className="u-results-right">
              <div className="u-view-toggle">
                <button className={`u-view-btn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => { setViewMode('grid'); localStorage.setItem('introo_view_mode', 'grid'); }} title="Card view">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                </button>
                <button className={`u-view-btn ${viewMode === 'table' ? 'active' : ''}`} onClick={() => { setViewMode('table'); localStorage.setItem('introo_view_mode', 'table'); }} title="Table view">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                </button>
              </div>
            </div>
          </div>

          {/* ── Enrichment banner ── */}
          {enriching && (
            <div className="u-enrich-banner">
              <div className="u-enrich-banner-icon"><span className="u-enrich-spinner" /></div>
              <div className="u-enrich-banner-body">
                <div className="u-enrich-banner-text">
                  Enriching your contacts with company data, titles, and LinkedIn profiles...
                </div>
                {enrichProgress.contactsFree && enrichProgress.contactsFree.total > 0 && (
                  <div className="u-enrich-banner-progress">
                    <div className="u-enrich-banner-bar">
                      <div
                        className="u-enrich-banner-fill"
                        style={{ width: `${Math.round(((enrichProgress.contactsFree.enriched + enrichProgress.contactsFree.skipped + enrichProgress.contactsFree.errors) / enrichProgress.contactsFree.total) * 100)}%` }}
                      />
                    </div>
                    <span className="u-enrich-banner-count">
                      {enrichProgress.contactsFree.enriched + enrichProgress.contactsFree.skipped + enrichProgress.contactsFree.errors} of {enrichProgress.contactsFree.total}
                    </span>
                  </div>
                )}
              </div>
              <button className="u-enrich-banner-stop" onClick={stopEnrichment} title="Stop enrichment">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="2" width="10" height="10" rx="1.5" fill="currentColor"/></svg>
                Stop
              </button>
            </div>
          )}

          {/* Enrichment needed banner — shows when no contacts have been processed yet */}
          {!enriching && enrichStats && enrichStats.contacts.total > 0 && enrichStats.contacts.enriched === 0 && (enrichStats.contacts.pending ?? 0) > 0 && (
            <div className="u-enrich-banner u-enrich-banner--needed">
              <div className="u-enrich-banner-icon">✨</div>
              <div className="u-enrich-banner-body">
                <div className="u-enrich-banner-text">
                  Your contacts need enrichment to show company data, logos, and titles.
                </div>
                <button className="u-enrich-banner-run" onClick={startEnrichment}>
                  Run enrichment now
                </button>
              </div>
            </div>
          )}

          {/* #7 View prompt — nudge to save filters as a view */}
          {showViewPrompt && activeFilterCount > 0 && (
            <div className="ob-hunt-prompt">
              <span className="ob-hunt-prompt-icon">🎯</span>
              <span className="ob-hunt-prompt-text">You've set filters. <strong>Save as a View</strong> to track matching companies over time.</span>
              <button className="ob-hunt-prompt-btn" onClick={() => {
                const sf = sidebarFilters;
                const savedFilters = buildViewFilters();
                const sortRules: ViewSortRule[] = tableSorts.map(s => ({ field: s.field, dir: s.dir }));
                const groupBy = groupByField ? { field: groupByField, dir: groupByDir } : null;
                const keywords = sf.aiKeywords.length > 0 ? sf.aiKeywords : ['custom'];
                viewsApi.create({ title: 'My first view', keywords, filters: savedFilters as Record<string, unknown>, sortRules, groupBy }).then(created => {
                  setSavedViews(prev => [...prev, { id: created.id, title: created.title, keywords: created.keywords as string[], filters: created.filters as ViewFilters, sortRules: created.sortRules as ViewSortRule[], groupBy: created.groupBy as { field: string; dir: 'asc' | 'desc' } | null, isActive: true }]);
                  setSelectedView(created.id);
                  setSidebarTab('views');
                }).catch(err => console.error('Failed to save view:', err));
                setShowViewPrompt(false);
                setViewPromptDismissed(true);
                localStorage.setItem('introo_view_prompt_dismissed', 'true');
              }}>Save as View</button>
              <button className="ob-hunt-prompt-dismiss" onClick={() => {
                setShowViewPrompt(false);
                setViewPromptDismissed(true);
                localStorage.setItem('introo_view_prompt_dismissed', 'true');
              }}>x</button>
            </div>
          )}

          {/* ── Company Grid ──────────────────────────────────── */}
          {entityTab === 'companies' && <div className={`u-grid ${viewMode === 'table' ? 'u-grid--table' : ''}`}>
            {loading || storeLoading ? (
              <div className="u-grid-loading-rich">
                <div className="u-loading-orb">
                  <div className="u-loading-orb-ring" />
                  <div className="u-loading-orb-ring u-loading-orb-ring--2" />
                  <div className="u-loading-orb-core" />
                </div>
                {loadingPhase === 'syncing' || loadingPhase === 'enriching' ? (
                  <>
                    <div className="u-loading-steps">
                      <div className={`u-loading-step ${loadingPhase === 'syncing' ? 'active' : 'done'}`}>
                        <span className="u-loading-step-icon">{loadingPhase === 'syncing' ? '⏳' : '✓'}</span>
                        <span>Syncing calendar events</span>
                      </div>
                      <div className={`u-loading-step ${loadingPhase === 'enriching' ? 'active' : loadingPhase === 'syncing' ? 'pending' : 'done'}`}>
                        <span className="u-loading-step-icon">{loadingPhase === 'enriching' ? '⏳' : loadingPhase === 'syncing' ? '○' : '✓'}</span>
                        <span>Importing contacts &amp; companies</span>
                      </div>
                      <div className="u-loading-step pending">
                        <span className="u-loading-step-icon">○</span>
                        <span>Building your network map</span>
                      </div>
                    </div>
                    <span className="u-loading-hint">First sync — this may take a moment...</span>
                  </>
                ) : (
                  <>
                    <div className="u-loading-steps">
                      <div className={`u-loading-step ${loadingPhase === 'init' ? 'active' : 'done'}`}>
                        <span className="u-loading-step-icon">{loadingPhase === 'init' ? '⏳' : '✓'}</span>
                        <span>Authenticating</span>
                      </div>
                      <div className={`u-loading-step ${loadingPhase === 'auth' ? 'active' : loadingPhase === 'init' ? 'pending' : 'done'}`}>
                        <span className="u-loading-step-icon">{loadingPhase === 'auth' ? '⏳' : loadingPhase === 'init' ? '○' : '✓'}</span>
                        <span>Loading your contacts</span>
                      </div>
                    </div>
                    <span className="u-loading-hint">Just a second...</span>
                  </>
                )}
              </div>
            ) : filteredCompanies.length === 0 ? (
              <div className="u-grid-empty">
                {activeFilterCount > 0 || searchQuery.trim() ? (
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
                    newSpaceCompanies.has(company.domain) ? 'u-tile--space-new' : '',
                  ].filter(Boolean).join(' ')}
                >
                  {/* User tags (hidden when grouped by tags — redundant with group header) */}
                  {groupByField !== 'tags' && ((companyTags[company.domain] && companyTags[company.domain].length > 0) || tagPickerDomain === company.domain) && (
                    <div className="u-tile-tags" onClick={e => e.stopPropagation()}>
                      {(companyTags[company.domain] || []).map(t => {
                        const color = getTagColor(t);
                        return (
                          <span key={t} className="u-tile-tag" style={{ background: color.bg, color: color.text, borderColor: color.border }}>
                            {t}
                          </span>
                        );
                      })}
                      <div className="u-tag-picker-wrap" ref={tagPickerDomain === company.domain ? tagPickerRef : undefined}>
                        <button className="u-tile-tag-add" onClick={() => { setTagPickerDomain(tagPickerDomain === company.domain ? null : company.domain); setTagPickerSearch(''); }}>+</button>
                        {tagPickerDomain === company.domain && (
                          <div className="u-tag-picker">
                            <input
                              className="u-tag-picker-input"
                              placeholder="Search or create..."
                              autoFocus
                              value={tagPickerSearch}
                              onChange={e => setTagPickerSearch(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && tagPickerSearch.trim()) {
                                  const existing = tagDefs.find(t => t.name.toLowerCase() === tagPickerSearch.trim().toLowerCase());
                                  if (existing) {
                                    toggleTagOnCompany(company.domain, existing.name);
                                  } else {
                                    const name = createTag(tagPickerSearch.trim());
                                    if (name) toggleTagOnCompany(company.domain, name);
                                  }
                                  setTagPickerSearch('');
                                }
                                if (e.key === 'Escape') { setTagPickerDomain(null); setTagPickerSearch(''); }
                              }}
                            />
                            <div className="u-tag-picker-list">
                              {tagDefs.filter(t => !tagPickerSearch || t.name.toLowerCase().includes(tagPickerSearch.toLowerCase())).map(t => {
                                const color = TAG_COLORS[t.colorIdx % TAG_COLORS.length];
                                const isSelected = (companyTags[company.domain] || []).includes(t.name);
                                return (
                                  <button key={t.name} className={`u-tag-picker-option ${isSelected ? 'selected' : ''}`} onClick={() => toggleTagOnCompany(company.domain, t.name)}>
                                    <span className="u-tag-picker-dot" style={{ background: color.text }} />
                                    <span className="u-tag-picker-name">{t.name}</span>
                                    {isSelected && <span className="u-tag-picker-check">✓</span>}
                                  </button>
                                );
                              })}
                              {tagPickerSearch.trim() && !tagDefs.some(t => t.name.toLowerCase() === tagPickerSearch.trim().toLowerCase()) && (
                                <button className="u-tag-picker-create" onClick={() => {
                                  const name = createTag(tagPickerSearch.trim());
                                  if (name) toggleTagOnCompany(company.domain, name);
                                  setTagPickerSearch('');
                                }}>
                                  + Create "<strong>{tagPickerSearch.trim()}</strong>"
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
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
                      {!(companyTags[company.domain]?.length) && tagPickerDomain !== company.domain && (
                        <button className="u-tile-btn u-tile-btn--tag" onClick={() => { setTagPickerDomain(company.domain); setTagPickerSearch(''); }} title="Add tag">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/>
                            <line x1="7" y1="7" x2="7.01" y2="7"/>
                          </svg>
                        </button>
                      )}
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
                    {enriching && !company.enrichedAt && !company.employeeCount && !company.country && (
                      <>
                        <span className="u-tile-meta-badge u-tile-shimmer" />
                        <span className="u-tile-meta-badge u-tile-shimmer u-tile-shimmer--short" />
                      </>
                    )}
                  </div>
                  {company.spaceCount > 0 && (() => {
                    // Resolve person names from connectionIds
                    const personNames: string[] = [];
                    company.connectionIds.forEach(cid => {
                      const conn = connections.find(c => c.id === cid);
                      if (conn?.peer?.name && !personNames.includes(conn.peer.name)) personNames.push(conn.peer.name);
                    });
                    // Resolve space names from spaceIds
                    const spaceNames: string[] = [];
                    company.spaceIds.forEach(sid => {
                      const s = spaces.find(sp => sp.id === sid);
                      if (s?.name && !spaceNames.includes(s.name)) spaceNames.push(s.name);
                    });
                    // When filtered by a person, show person names first; otherwise spaces first
                    const viaNames = connectionFilter !== 'all'
                      ? [...personNames, ...spaceNames]
                      : [...spaceNames, ...personNames];
                    if (viaNames.length === 0) return null;
                    const display = viaNames.length <= 2 ? viaNames.join(', ') : `${viaNames.slice(0, 2).join(', ')} +${viaNames.length - 2}`;
                    return (
                      <div className="u-tile-overlap" onClick={() => setInlinePanel({ type: 'company', company })}>
                        <span className="u-tile-overlap-text">via {display}</span>
                        <span className="u-tile-overlap-count">{company.spaceCount}</span>
                      </div>
                    );
                  })()}
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

              const isNetworkView = sourceFilter === 'spaces' || connectionFilter !== 'all' || spaceFilter !== 'all';
              const displayCompanies = isNetworkView && excludeMyContacts
                ? filteredCompanies.filter(c => !(c.myCount > 0 && c.spaceCount === 0))
                : filteredCompanies;

              const pageStart = gridPage * GRID_PAGE_SIZE;
              const pageEnd = pageStart + GRID_PAGE_SIZE;
              const totalPages = Math.ceil(displayCompanies.length / GRID_PAGE_SIZE);

              // Group-by logic
              const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
              const groupLabel = (c: MergedCompany): string => {
                if (!groupByField) return '';
                switch (groupByField) {
                  case 'name': return c.name.charAt(0).toUpperCase();
                  case 'contacts': {
                    const n = c.totalCount;
                    if (n >= 10) return '10+';
                    if (n >= 5) return '5–9';
                    if (n >= 2) return '2–4';
                    return '1';
                  }
                  case 'strength': return c.bestStrength === 'none' ? 'None' : c.bestStrength.charAt(0).toUpperCase() + c.bestStrength.slice(1);
                  case 'employees': {
                    const e = c.employeeCount;
                    if (!e) return 'Unknown';
                    if (e >= 1000) return '1000+';
                    if (e >= 100) return '100–999';
                    if (e >= 10) return '10–99';
                    return '1–9';
                  }
                  case 'location': return [c.city, c.country].filter(Boolean).join(', ') || 'Unknown';
                  case 'industry': return c.industry || 'Unknown';
                  case 'funding': return c.lastFundingRound ? formatFundingRound(c.lastFundingRound) || c.lastFundingRound : 'None';
                  case 'tags': return '';
                  case 'connectedSince': {
                    const dates = c.myContacts.map(ct => ct.firstSeenAt).filter(Boolean);
                    if (dates.length === 0) return 'Unknown';
                    const earliest = new Date(dates.sort()[0]);
                    return `${MONTH_NAMES[earliest.getMonth()]} ${earliest.getFullYear()}`;
                  }
                  default: return '';
                }
              };
              type GroupedSection = { label: string; companies: MergedCompany[] };
              const groupedSections: GroupedSection[] = (() => {
                if (!groupByField) return [{ label: '', companies: displayCompanies }];
                const map = new Map<string, MergedCompany[]>();
                if (groupByField === 'tags') {
                  for (const c of displayCompanies) {
                    const tags = companyTags[c.domain] || [];
                    if (tags.length === 0) {
                      if (!map.has('No tags')) map.set('No tags', []);
                      map.get('No tags')!.push(c);
                    } else {
                      for (const t of tags) {
                        if (!map.has(t)) map.set(t, []);
                        map.get(t)!.push(c);
                      }
                    }
                  }
                } else {
                  for (const c of displayCompanies) {
                    const label = groupLabel(c);
                    if (!map.has(label)) map.set(label, []);
                    map.get(label)!.push(c);
                  }
                }
                return Array.from(map.entries()).map(([label, companies]) => ({ label, companies }));
              })();
              return (
                <>
                  {isNetworkView && (
                    <div className="u-grid-filter-bar">
                      <label className="u-grid-exclude-label">
                        <input type="checkbox" checked={excludeMyContacts} onChange={e => { setExcludeMyContacts(e.target.checked); setGridPage(0); }} />
                        Exclude my companies
                      </label>
                      <span className="u-grid-section-count">{displayCompanies.length}</span>
                    </div>
                  )}
                  {viewMode === 'grid' && !groupByField && displayCompanies.slice(pageStart, pageEnd).map(renderCard)}

                  {viewMode === 'grid' && groupByField && (() => {
                    const renderPill = (label: string) => {
                      if (groupByField === 'tags') {
                        if (label === 'No tags') return <span className="u-group-pill u-group-pill--empty">No tags</span>;
                        const color = getTagColor(label);
                        return <span className="u-group-pill" style={{ background: color.bg, color: color.text, borderColor: color.border }}>{label}</span>;
                      }
                      if (groupByField === 'strength') {
                        return <span className={`u-group-pill u-group-pill--strength u-group-pill--${label.toLowerCase()}`}>{label}</span>;
                      }
                      return <span className="u-group-pill u-group-pill--default">{label}</span>;
                    };
                    return groupedSections.map(section => {
                      const isCollapsed = collapsedGroups.has(section.label);
                      return (
                        <div key={section.label} className="u-grid-group">
                          <div
                            className="u-grid-group-header"
                            onClick={() => setCollapsedGroups(prev => {
                              const next = new Set(prev);
                              if (next.has(section.label)) next.delete(section.label);
                              else next.add(section.label);
                              return next;
                            })}
                          >
                            <span className={`u-group-chevron ${isCollapsed ? 'u-group-chevron--collapsed' : ''}`}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                            </span>
                            {renderPill(section.label)}
                            <span className="u-group-count">{section.companies.length}</span>
                          </div>
                          {!isCollapsed && (
                            <div className="u-grid-group-cards">
                              {section.companies.map(c => renderCard(c))}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}

                  {viewMode === 'table' && (
                    <div className="u-table-wrap">
                      <table className="u-table">
                        <thead>
                          <tr>
                            <th className="u-th-company">Company</th>
                            <th className="u-th-contacts">Contacts</th>
                            <th className="u-th-strength">Strength</th>
                            <th className="u-th-employees">Employees</th>
                            <th className="u-th-location">Location</th>
                            <th className="u-th-industry">Industry</th>
                            <th className="u-th-funding">Funding</th>
                            <th className="u-th-tags">Tags</th>
                            <th className="u-th-actions"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const colCount = 9;
                            const renderRow = (company: MergedCompany) => {
                              const tags = companyTags[company.domain] || [];
                              const totalMeetings = company.myContacts.reduce((sum, c) => sum + (c.meetingsCount || 0), 0);
                              return (
                                <tr
                                  key={company.domain}
                                  className={`u-tr ${newSpaceCompanies.has(company.domain) ? 'u-tr--space-new' : ''}`}
                                  onClick={() => setInlinePanel({ type: 'company', company })}
                                >
                                  <td className="u-td-company">
                                    <div className="u-td-company-inner">
                                      <CompanyLogo domain={company.domain} name={company.name} size={22} />
                                      <div className="u-td-company-info">
                                        <span className="u-td-company-name">{company.name}</span>
                                        <span className="u-td-company-domain">{company.domain}</span>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="u-td-contacts">
                                    <span className="u-td-num">{company.totalCount}</span>
                                    {totalMeetings > 0 && <span className="u-td-meetings">{totalMeetings} mtg</span>}
                                  </td>
                                  <td className="u-td-strength">
                                    {company.bestStrength !== 'none' && (
                                      <span className={`u-td-strength-pill u-td-strength--${company.bestStrength}`}>
                                        {company.bestStrength}
                                      </span>
                                    )}
                                  </td>
                                  <td className="u-td-employees">
                                    {company.employeeCount ? company.employeeCount.toLocaleString() : enriching && !company.enrichedAt ? <span className="u-td-shimmer" /> : '—'}
                                  </td>
                                  <td className="u-td-location">
                                    {company.city || company.country
                                      ? [company.city, company.country].filter(Boolean).join(', ')
                                      : enriching && !company.enrichedAt ? <span className="u-td-shimmer" /> : '—'}
                                  </td>
                                  <td className="u-td-industry">
                                    {company.industry || (enriching && !company.enrichedAt ? <span className="u-td-shimmer" /> : '—')}
                                  </td>
                                  <td className="u-td-funding">
                                    {company.lastFundingRound ? formatFundingRound(company.lastFundingRound) : enriching && !company.enrichedAt ? <span className="u-td-shimmer" /> : '—'}
                                  </td>
                                  <td className="u-td-tags" onClick={e => e.stopPropagation()}>
                                    <div className="u-td-tags-inner">
                                      {tags.map(t => {
                                        const color = getTagColor(t);
                                        return <span key={t} className="u-td-tag" style={{ background: color.bg, color: color.text }}>{t}</span>;
                                      })}
                                      <div className="u-tag-picker-wrap" ref={tagPickerDomain === company.domain ? tagPickerRef : undefined}>
                                        <button
                                          className="u-td-tag-add"
                                          onClick={() => { setTagPickerDomain(tagPickerDomain === company.domain ? null : company.domain); setTagPickerSearch(''); }}
                                          title="Add tag"
                                        >+</button>
                                        {tagPickerDomain === company.domain && (
                                          <div className="u-tag-picker u-tag-picker--table">
                                            <input
                                              className="u-tag-picker-input"
                                              placeholder="Search or create..."
                                              autoFocus
                                              value={tagPickerSearch}
                                              onChange={e => setTagPickerSearch(e.target.value)}
                                              onKeyDown={e => {
                                                if (e.key === 'Enter' && tagPickerSearch.trim()) {
                                                  const existing = tagDefs.find(t => t.name.toLowerCase() === tagPickerSearch.trim().toLowerCase());
                                                  if (existing) {
                                                    toggleTagOnCompany(company.domain, existing.name);
                                                  } else {
                                                    const name = createTag(tagPickerSearch.trim());
                                                    if (name) toggleTagOnCompany(company.domain, name);
                                                  }
                                                  setTagPickerSearch('');
                                                }
                                                if (e.key === 'Escape') { setTagPickerDomain(null); setTagPickerSearch(''); }
                                              }}
                                            />
                                            <div className="u-tag-picker-list">
                                              {tagDefs.filter(t => !tagPickerSearch || t.name.toLowerCase().includes(tagPickerSearch.toLowerCase())).map(t => {
                                                const color = TAG_COLORS[t.colorIdx % TAG_COLORS.length];
                                                const isSelected = (companyTags[company.domain] || []).includes(t.name);
                                                return (
                                                  <button key={t.name} className={`u-tag-picker-option ${isSelected ? 'selected' : ''}`} onClick={() => toggleTagOnCompany(company.domain, t.name)}>
                                                    <span className="u-tag-picker-dot" style={{ background: color.text }} />
                                                    <span className="u-tag-picker-name">{t.name}</span>
                                                    {isSelected && <span className="u-tag-picker-check">✓</span>}
                                                  </button>
                                                );
                                              })}
                                              {tagPickerSearch.trim() && !tagDefs.some(t => t.name.toLowerCase() === tagPickerSearch.trim().toLowerCase()) && (
                                                <button className="u-tag-picker-create" onClick={() => {
                                                  const name = createTag(tagPickerSearch.trim());
                                                  if (name) toggleTagOnCompany(company.domain, name);
                                                  setTagPickerSearch('');
                                                }}>
                                                  + Create "<strong>{tagPickerSearch.trim()}</strong>"
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="u-td-actions" onClick={e => e.stopPropagation()}>
                                    {company.spaceCount > 0 && (
                                      <button className="u-td-intro-btn" onClick={() => openIntroPanel(company)}>Intro</button>
                                    )}
                                  </td>
                                </tr>
                              );
                            };

                            if (!groupByField) {
                              return displayCompanies.slice(pageStart, pageEnd).map(renderRow);
                            }
                            // Grouped rendering
                            const renderTblPill = (label: string) => {
                              if (groupByField === 'tags') {
                                if (label === 'No tags') return <span className="u-group-pill u-group-pill--empty">No tags</span>;
                                const color = getTagColor(label);
                                return <span className="u-group-pill" style={{ background: color.bg, color: color.text, borderColor: color.border }}>{label}</span>;
                              }
                              if (groupByField === 'strength') {
                                return <span className={`u-group-pill u-group-pill--strength u-group-pill--${label.toLowerCase()}`}>{label}</span>;
                              }
                              return <span className="u-group-pill u-group-pill--default">{label}</span>;
                            };

                            return groupedSections.map(section => {
                              const isCollapsed = collapsedGroups.has(section.label);
                              return (
                                <React.Fragment key={section.label}>
                                  <tr
                                    className="u-tr-group-header"
                                    onClick={() => setCollapsedGroups(prev => {
                                      const next = new Set(prev);
                                      if (next.has(section.label)) next.delete(section.label);
                                      else next.add(section.label);
                                      return next;
                                    })}
                                  >
                                    <td colSpan={colCount} className="u-td-group-header">
                                      <span className={`u-group-chevron ${isCollapsed ? 'u-group-chevron--collapsed' : ''}`}>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                                      </span>
                                      {renderTblPill(section.label)}
                                      <span className="u-group-count">{section.companies.length}</span>
                                    </td>
                                  </tr>
                                  {!isCollapsed && section.companies.map(renderRow)}
                                </React.Fragment>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>
                  )}

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
          </div>}

          {/* ── People Table ──────────────────────────────────── */}
          {entityTab === 'people' && (() => {
            const isPeopleNetworkView = sourceFilter === 'spaces' || connectionFilter !== 'all' || spaceFilter !== 'all';
            const displayPeople = isPeopleNetworkView && excludeMyContacts
              ? flatPeople.filter(p => !p.isMyContact)
              : flatPeople;
            const peoplePageStart = gridPage * GRID_PAGE_SIZE;
            const peoplePageEnd = peoplePageStart + GRID_PAGE_SIZE;
            const peopleTotalPages = Math.ceil(displayPeople.length / GRID_PAGE_SIZE);

            const handlePeopleSort = (col: typeof peopleSortBy) => {
              if (peopleSortBy === col) {
                setPeopleSortDir(d => d === 'asc' ? 'desc' : 'asc');
              } else {
                setPeopleSortBy(col);
                setPeopleSortDir(col === 'meetings' || col === 'lastSeen' ? 'desc' : 'asc');
              }
              setGridPage(0);
            };

            const sortIcon = (col: typeof peopleSortBy) =>
              peopleSortBy === col ? (peopleSortDir === 'asc' ? ' ↑' : ' ↓') : '';

            // People group-by logic
            const PEOPLE_MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
            const peopleGroupLabel = (p: FlatPerson): string => {
              if (!peopleGroupByField) return '';
              switch (peopleGroupByField) {
                case 'name': return p.name.charAt(0).toUpperCase();
                case 'company': return p.companyName || 'Unknown';
                case 'strength': return p.strength === 'none' ? 'None' : p.strength.charAt(0).toUpperCase() + p.strength.slice(1);
                case 'meetings': {
                  const m = p.meetings;
                  if (m >= 10) return '10+';
                  if (m >= 5) return '5–9';
                  if (m >= 1) return '1–4';
                  return '0';
                }
                case 'lastSeen': {
                  if (!p.lastSeen) return 'Never';
                  const days = Math.floor((Date.now() - new Date(p.lastSeen).getTime()) / (1000 * 60 * 60 * 24));
                  if (days <= 7) return 'This week';
                  if (days <= 30) return 'This month';
                  if (days <= 90) return 'Last 3 months';
                  if (days <= 365) return 'This year';
                  return 'Over a year ago';
                }
                case 'source': return p.source === 'you' ? 'You' : p.source;
                case 'industry': return p.company.industry || 'Unknown';
                case 'location': return [p.company.city, p.company.country].filter(Boolean).join(', ') || 'Unknown';
                case 'employees': {
                  const e = p.company.employeeCount;
                  if (!e) return 'Unknown';
                  if (e >= 1000) return '1000+';
                  if (e >= 100) return '100–999';
                  if (e >= 10) return '10–99';
                  return '1–9';
                }
                case 'funding': return p.company.lastFundingRound ? (formatFundingRound(p.company.lastFundingRound) || p.company.lastFundingRound) : 'None';
                case 'tags': return '';
                case 'connectedSince': {
                  if (!p.firstSeenAt) return 'Unknown';
                  const d = new Date(p.firstSeenAt);
                  return `${PEOPLE_MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
                }
                default: return '';
              }
            };
            type PeopleGroupedSection = { label: string; people: FlatPerson[] };
            const peopleGroupedSections: PeopleGroupedSection[] = (() => {
              if (!peopleGroupByField) return [{ label: '', people: displayPeople }];
              const map = new Map<string, FlatPerson[]>();
              if (peopleGroupByField === 'tags') {
                for (const p of displayPeople) {
                  const tags = companyTags[p.companyDomain] || [];
                  if (tags.length === 0) {
                    if (!map.has('No tags')) map.set('No tags', []);
                    map.get('No tags')!.push(p);
                  } else {
                    for (const t of tags) {
                      if (!map.has(t)) map.set(t, []);
                      map.get(t)!.push(p);
                    }
                  }
                }
              } else {
                for (const p of displayPeople) {
                  const label = peopleGroupLabel(p);
                  if (!map.has(label)) map.set(label, []);
                  map.get(label)!.push(p);
                }
              }
              return Array.from(map.entries()).map(([label, people]) => ({ label, people }));
            })();

            const colCount = 6;
            const renderPersonRow = (person: FlatPerson) => (
              <tr
                key={person.email}
                className="u-tr u-tr--person"
                onClick={() => {
                  const contact = person.displayContact || { id: person.id, name: person.name, email: person.email, title: person.title, userName: person.source };
                  setInlinePanel({ type: 'person', contact, company: person.company, fromPeopleTab: true });
                }}
              >
                <td className="u-td-person">
                  <div className="u-td-person-inner">
                    <PersonAvatar email={person.email} name={person.name} avatarUrl={person.photoUrl} size={28} />
                    <div className="u-td-person-info">
                      <span className="u-td-person-name">{person.name}</span>
                      {person.title && <span className="u-td-person-title">{person.title}</span>}
                    </div>
                  </div>
                </td>
                <td className="u-td-pcompany">
                  <div className="u-td-company-inner">
                    <CompanyLogo domain={person.companyDomain} name={person.companyName} size={20} />
                    <span className="u-td-company-name">{person.companyName}</span>
                  </div>
                </td>
                <td className="u-td-pstrength">
                  {person.strength !== 'none' && (
                    <span className={`u-td-strength-pill u-td-strength--${person.strength}`}>
                      {person.strength}
                    </span>
                  )}
                </td>
                <td className="u-td-pmeetings">
                  {person.meetings > 0 ? <span className="u-td-num">{person.meetings}</span> : <span className="u-td-muted">—</span>}
                </td>
                <td className="u-td-plastseen">
                  {person.lastSeen ? <span className="u-td-muted">{getTimeAgo(person.lastSeen)}</span> : <span className="u-td-muted">—</span>}
                </td>
                <td className="u-td-psource">
                  <span className={`u-td-source-badge ${person.source === 'you' ? 'u-td-source--you' : 'u-td-source--network'}`}>
                    {person.source === 'you' ? 'You' : person.source}
                  </span>
                </td>
              </tr>
            );

            const renderPersonCard = (person: FlatPerson) => (
              <div
                key={person.email}
                className="u-person-card"
                onClick={() => {
                  const contact = person.displayContact || { id: person.id, name: person.name, email: person.email, title: person.title, userName: person.source };
                  setInlinePanel({ type: 'person', contact, company: person.company, fromPeopleTab: true });
                }}
              >
                <div className="u-person-card-top">
                  <PersonAvatar email={person.email} name={person.name} avatarUrl={person.photoUrl} size={40} />
                  <div className="u-person-card-info">
                    <span className="u-person-card-name">{person.name}</span>
                    {person.title && <span className="u-person-card-title">{person.title}</span>}
                  </div>
                </div>
                <div className="u-person-card-company">
                  <CompanyLogo domain={person.companyDomain} name={person.companyName} size={16} />
                  <span>{person.companyName}</span>
                </div>
                <div className="u-person-card-meta">
                  {person.strength !== 'none' && (
                    <span className={`u-person-card-badge u-td-strength--${person.strength}`}>{person.strength}</span>
                  )}
                  {person.meetings > 0 && (
                    <span className="u-person-card-badge">{person.meetings} meeting{person.meetings !== 1 ? 's' : ''}</span>
                  )}
                  {person.lastSeen && (
                    <span className="u-person-card-badge u-person-card-badge--muted">{getTimeAgo(person.lastSeen)}</span>
                  )}
                </div>
                <div className="u-person-card-source">
                  <span className={`u-td-source-badge ${person.source === 'you' ? 'u-td-source--you' : 'u-td-source--network'}`}>
                    {person.source === 'you' ? 'You' : person.source}
                  </span>
                </div>
              </div>
            );

            const renderPeopleGroupPill = (label: string) => {
              if (peopleGroupByField === 'strength') {
                return <span className={`u-group-pill u-group-pill--strength u-group-pill--${label.toLowerCase()}`}>{label}</span>;
              }
              if (peopleGroupByField === 'tags') {
                if (label === 'No tags') return <span className="u-group-pill u-group-pill--empty">{label}</span>;
                const color = getTagColor(label);
                return <span className="u-group-pill" style={{ background: color.bg, color: color.text, borderColor: color.border }}>{label}</span>;
              }
              return <span className="u-group-pill u-group-pill--default">{label}</span>;
            };

            return (
              <>
                {isPeopleNetworkView && (
                  <div className="u-grid-filter-bar">
                    <label className="u-grid-exclude-label">
                      <input type="checkbox" checked={excludeMyContacts} onChange={e => { setExcludeMyContacts(e.target.checked); setGridPage(0); }} />
                      Exclude my contacts
                    </label>
                    <span className="u-grid-section-count">{displayPeople.length}</span>
                  </div>
                )}
                {/* ── Card view ── */}
                {viewMode === 'grid' && !peopleGroupByField && (
                  <div className="u-grid u-grid--people-cards">
                    {displayPeople.slice(peoplePageStart, peoplePageEnd).map(renderPersonCard)}
                  </div>
                )}
                {viewMode === 'grid' && peopleGroupByField && peopleGroupedSections.map(section => {
                  const isCollapsed = peopleCollapsedGroups.has(section.label);
                  return (
                    <div key={section.label} className="u-grid-group">
                      <div
                        className="u-grid-group-header"
                        onClick={() => setPeopleCollapsedGroups(prev => {
                          const next = new Set(prev);
                          if (next.has(section.label)) next.delete(section.label);
                          else next.add(section.label);
                          return next;
                        })}
                      >
                        <span className={`u-group-chevron ${isCollapsed ? 'u-group-chevron--collapsed' : ''}`}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                        </span>
                        {renderPeopleGroupPill(section.label)}
                        <span className="u-group-count">{section.people.length}</span>
                      </div>
                      {!isCollapsed && (
                        <div className="u-grid u-grid--people-cards">
                          {section.people.map(renderPersonCard)}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* ── Table view ── */}
                {viewMode === 'table' && (
                  <div className="u-grid u-grid--table">
                    <div className="u-table-wrap">
                      <table className="u-table u-table--people">
                        <thead>
                          <tr>
                            <th className="u-th-person" onClick={() => handlePeopleSort('name')} style={{ cursor: 'pointer' }}>Person{sortIcon('name')}</th>
                            <th className="u-th-pcompany" onClick={() => handlePeopleSort('company')} style={{ cursor: 'pointer' }}>Company{sortIcon('company')}</th>
                            <th className="u-th-pstrength" onClick={() => handlePeopleSort('strength')} style={{ cursor: 'pointer' }}>Strength{sortIcon('strength')}</th>
                            <th className="u-th-pmeetings" onClick={() => handlePeopleSort('meetings')} style={{ cursor: 'pointer' }}>Meetings{sortIcon('meetings')}</th>
                            <th className="u-th-plastseen" onClick={() => handlePeopleSort('lastSeen')} style={{ cursor: 'pointer' }}>Last met{sortIcon('lastSeen')}</th>
                            <th className="u-th-psource">Source</th>
                          </tr>
                        </thead>
                        <tbody>
                          {!peopleGroupByField && displayPeople.slice(peoplePageStart, peoplePageEnd).map(renderPersonRow)}
                          {peopleGroupByField && peopleGroupedSections.map(section => {
                            const isCollapsed = peopleCollapsedGroups.has(section.label);
                            return (
                              <React.Fragment key={section.label}>
                                <tr
                                  className="u-tr-group-header"
                                  onClick={() => setPeopleCollapsedGroups(prev => {
                                    const next = new Set(prev);
                                    if (next.has(section.label)) next.delete(section.label);
                                    else next.add(section.label);
                                    return next;
                                  })}
                                >
                                  <td colSpan={colCount} className="u-td-group-header">
                                    <span className={`u-group-chevron ${isCollapsed ? 'u-group-chevron--collapsed' : ''}`}>
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                                    </span>
                                    {renderPeopleGroupPill(section.label)}
                                    <span className="u-group-count">{section.people.length}</span>
                                  </td>
                                </tr>
                                {!isCollapsed && section.people.map(renderPersonRow)}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {!peopleGroupByField && peopleTotalPages > 1 && (
                  <div className="u-grid-pagination">
                    <button className="u-grid-page-btn" disabled={gridPage === 0} onClick={() => setGridPage(gridPage - 1)}>← Prev</button>
                    <span className="u-grid-page-info">{gridPage + 1} / {peopleTotalPages}</span>
                    <button className="u-grid-page-btn" disabled={gridPage >= peopleTotalPages - 1} onClick={() => setGridPage(gridPage + 1)}>Next →</button>
                  </div>
                )}
              </>
            );
          })()}

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
                {inlinePanel.fromPeopleTab && (
                  <button className="u-panel-breadcrumb" onClick={() => setInlinePanel(null)}>
                    ← People
                  </button>
                )}
                {!inlinePanel.fromPeopleTab && fromSpace && (
                  <button className="u-panel-breadcrumb" onClick={() => setInlinePanel({ type: 'space', spaceId: fromSpace.id })}>
                    ← {fromSpace.emoji} {fromSpace.name}
                  </button>
                )}
                {!inlinePanel.fromPeopleTab && !fromSpace && co && (
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

                {/* Source account badges (only when user has multiple accounts) */}
                {calendarAccounts.length > 1 && dc?.sourceAccountEmails && dc.sourceAccountEmails.length > 0 && (
                  <div className="u-panel-source-accounts">
                    {dc.sourceAccountEmails.map(email => (
                      <span key={email} className="u-panel-badge u-panel-badge--source">
                        {email}
                      </span>
                    ))}
                  </div>
                )}

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
                    <div className="u-panel-section-header u-panel-section-header--link" onClick={() => setInlinePanel({ type: 'company', company: co })}>
                      <CompanyLogo domain={co.domain} name={co.name} size={20} />
                      <span className="u-panel-section-title">{co.name}</span>
                      <span className="u-panel-section-arrow">→</span>
                      {co.linkedinUrl && (
                        <a href={co.linkedinUrl} target="_blank" rel="noopener noreferrer" className="u-panel-link-sm" onClick={e => e.stopPropagation()}>in</a>
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
                  <a
                    className="u-action-btn"
                    href={`mailto:${c.email}?subject=${encodeURIComponent(`Hi ${c.name || 'there'}`)}&body=${encodeURIComponent(`Hi ${c.name || 'there'},\n\nI wanted to reach out and connect.\n\nBest,\n${currentUser?.name || ''}`)}`}
                  >
                    ✉ Email
                  </a>
                </div>
              </div>
              );
            })()}

            {inlinePanel.type === 'company' && inlinePanel.company && (() => {
              const co = inlinePanel.company;
              const fromSpaceForCompany = inlinePanel.fromSpaceId ? spaces.find(s => s.id === inlinePanel.fromSpaceId) : null;
              return (
              <div className="u-panel-company">
                {inlinePanel.fromProfile && (
                  <button className="u-panel-breadcrumb" onClick={() => setInlinePanel({ type: 'profile' })}>
                    ← My Profile
                  </button>
                )}
                {fromSpaceForCompany && !inlinePanel.fromProfile && (
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

                {/* #6 Tag tip */}
                {showTagTip && (
                  <div className="ob-tag-tip">
                    <span className="ob-tag-tip-icon">🏷</span>
                    <span>Tag companies you care about to organize and filter them later.</span>
                    <button className="ob-tag-tip-dismiss" onClick={() => setShowTagTip(false)}>Got it</button>
                  </div>
                )}

                {/* Quick stats */}
                {(() => {
                  const totalMeetings = co.myContacts.reduce((sum, c) => sum + (c.meetingsCount || 0), 0);
                  return (
                    <div className="u-panel-company-stats">
                      <div className="u-panel-stat">
                        <span className="u-panel-stat-value">{co.totalCount}</span>
                        <span className="u-panel-stat-label">Contacts</span>
                      </div>
                      {totalMeetings > 0 && (
                        <div className="u-panel-stat">
                          <span className="u-panel-stat-value">{totalMeetings}</span>
                          <span className="u-panel-stat-label">Meetings</span>
                        </div>
                      )}
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
                  );
                })()}

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

                {/* Tags */}
                <div className="u-panel-tags">
                  <div className="u-panel-tags-list">
                    {(companyTags[co.domain] || []).map(t => {
                      const color = getTagColor(t);
                      return (
                        <span key={t} className="u-panel-tag" style={{ background: color.bg, color: color.text, borderColor: color.border }}>
                          {t}
                          <button className="u-panel-tag-x" style={{ color: color.text }} onClick={() => toggleTagOnCompany(co.domain, t)}>×</button>
                        </span>
                      );
                    })}
                    <div className="u-tag-picker-wrap" ref={tagPickerDomain === co.domain ? tagPickerRef : undefined}>
                      <button className="u-panel-tag-add" onClick={() => { setTagPickerDomain(tagPickerDomain === co.domain ? null : co.domain); setTagPickerSearch(''); }}>+ Add tag</button>
                      {tagPickerDomain === co.domain && (
                        <div className="u-tag-picker u-tag-picker--panel">
                          <input
                            className="u-tag-picker-input"
                            placeholder="Search or create..."
                            autoFocus
                            value={tagPickerSearch}
                            onChange={e => setTagPickerSearch(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && tagPickerSearch.trim()) {
                                const existing = tagDefs.find(t => t.name.toLowerCase() === tagPickerSearch.trim().toLowerCase());
                                if (existing) {
                                  toggleTagOnCompany(co.domain, existing.name);
                                } else {
                                  const name = createTag(tagPickerSearch.trim());
                                  if (name) toggleTagOnCompany(co.domain, name);
                                }
                                setTagPickerSearch('');
                              }
                              if (e.key === 'Escape') { setTagPickerDomain(null); setTagPickerSearch(''); }
                            }}
                          />
                          <div className="u-tag-picker-list">
                            {tagDefs.filter(t => !tagPickerSearch || t.name.toLowerCase().includes(tagPickerSearch.toLowerCase())).map(t => {
                              const color = TAG_COLORS[t.colorIdx % TAG_COLORS.length];
                              const isSelected = (companyTags[co.domain] || []).includes(t.name);
                              return (
                                <button key={t.name} className={`u-tag-picker-option ${isSelected ? 'selected' : ''}`} onClick={() => toggleTagOnCompany(co.domain, t.name)}>
                                  <span className="u-tag-picker-dot" style={{ background: color.text }} />
                                  <span className="u-tag-picker-name">{t.name}</span>
                                  {isSelected && <span className="u-tag-picker-check">✓</span>}
                                  <button className="u-tag-picker-del" onClick={e => { e.stopPropagation(); deleteTagDef(t.name); }} title="Delete tag">×</button>
                                </button>
                              );
                            })}
                            {tagPickerSearch.trim() && !tagDefs.some(t => t.name.toLowerCase() === tagPickerSearch.trim().toLowerCase()) && (
                              <button className="u-tag-picker-create" onClick={() => {
                                const name = createTag(tagPickerSearch.trim());
                                if (name) toggleTagOnCompany(co.domain, name);
                                setTagPickerSearch('');
                              }}>
                                + Create "<strong>{tagPickerSearch.trim()}</strong>"
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Description */}
                {co.description && (
                  <div className="u-panel-section">
                    <h4 className="u-panel-section-h">About</h4>
                    <p className="u-panel-section-text">{co.description}</p>
                  </div>
                )}

                {/* Meeting history */}
                {(() => {
                  const allMeetings: { title: string; date: string; contactName: string }[] = [];
                  co.myContacts.forEach(c => {
                    if (c.meetings && c.meetings.length > 0) {
                      c.meetings.forEach(m => allMeetings.push({ title: m.title, date: m.date, contactName: c.name }));
                    }
                  });
                  const seen = new Set<string>();
                  const unique = allMeetings.filter(m => {
                    const key = `${m.title}|${m.date}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                  });
                  unique.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                  if (unique.length === 0) return null;
                  const visible = historyExpanded ? unique : unique.slice(0, 5);
                  const hasMore = unique.length > 5;
                  return (
                    <div className="u-panel-section">
                      <h4 className="u-panel-section-h">History</h4>
                      <div className="u-panel-history">
                        {visible.map((m, i) => {
                          const d = new Date(m.date);
                          const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                          return (
                            <div key={i} className="u-panel-history-item">
                              <div className="u-panel-history-dot" />
                              <div className="u-panel-history-content">
                                <span className="u-panel-history-title">{m.title}</span>
                                <span className="u-panel-history-meta">{dateStr}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {hasMore && (
                        <button className="u-panel-history-toggle" onClick={() => setHistoryExpanded(!historyExpanded)}>
                          {historyExpanded ? 'Show less' : `Show all ${unique.length} meetings`}
                        </button>
                      )}
                    </div>
                  );
                })()}

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
                        {isOwner && m.user.id !== space.ownerId && (
                          <button
                            className="u-notif-reject-btn"
                            style={{ fontSize: '0.6rem', padding: '0.1rem 0.35rem', flexShrink: 0 }}
                            onClick={() => { if (window.confirm(`Remove ${m.user.name} from this space?`)) removeSpaceMember(space.id, m.user.id); }}
                            title="Remove member"
                          >×</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Invite member */}
                {isOwner && (
                  <div className="u-panel-section">
                    <h4 className="u-panel-section-h">Invite member</h4>
                    <input
                      id={`space-invite-${space.id}`}
                      className="sb-input"
                      placeholder="Invite anyone by email"
                      onKeyDown={e => {
                        if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                          const input = e.currentTarget;
                          inviteMemberToSpace(space.id, input.value);
                          input.value = '';
                        }
                      }}
                    />
                    <button className="sb-space-action-btn primary" style={{ marginTop: '0.35rem', width: '100%' }} onClick={() => {
                      const input = document.getElementById(`space-invite-${space.id}`) as HTMLInputElement;
                      if (input?.value.trim()) { inviteMemberToSpace(space.id, input.value); input.value = ''; }
                    }}>+ Invite</button>
                    <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', marginTop: '0.3rem', display: 'block', lineHeight: 1.4 }}>Works with anyone — if they're not on Introo yet, we'll send them an invite.</span>
                    {/* Pending invitations (existing users + email invites for non-users) */}
                    {((pendingMembers[space.id] || []).length > 0 || (spaceEmailInvites[space.id] || []).length > 0) && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: '0.3rem' }}>Pending invitations</span>
                        {(pendingMembers[space.id] || []).map(m => (
                          <div key={m.id} className="u-panel-contact-row" style={{ opacity: 0.7 }}>
                            <PersonAvatar email={m.user.email} name={m.user.name} avatarUrl={m.user.avatar} size={24} />
                            <div className="u-panel-contact-info">
                              <span className="u-panel-contact-name">{m.user.name}</span>
                              <span className="u-panel-contact-title">{m.user.email}</span>
                            </div>
                            <span className="u-panel-badge" style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24', fontSize: '0.6rem' }}>invited</span>
                          </div>
                        ))}
                        {(spaceEmailInvites[space.id] || []).map(inv => (
                          <div key={inv.id} className="u-panel-contact-row" style={{ opacity: 0.5 }}>
                            <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', flexShrink: 0, color: 'rgba(255,255,255,0.4)' }}>✉</div>
                            <div className="u-panel-contact-info">
                              <span className="u-panel-contact-name">{inv.email}</span>
                              <span className="u-panel-contact-title">Not yet signed up</span>
                            </div>
                            <button className="u-notif-reject-btn" style={{ fontSize: '0.6rem', padding: '0.15rem 0.4rem', flexShrink: 0 }} onClick={() => cancelSpaceEmailInvite(space.id, inv.id)} title="Cancel invite">✕</button>
                          </div>
                        ))}
                      </div>
                    )}
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
                            {!isMe && isOpen && !isDeclining && introActionRequestId !== r.id && (
                              <div className="u-panel-request-actions">
                                <button
                                  className="u-req-action-btn u-req-action-btn--intro"
                                  onClick={() => {
                                    setIntroActionRequestId(r.id);
                                    setIntroActionType(null);
                                    setIntroEmailSubject('');
                                    setIntroEmailBody('');
                                    setIntroSelectedContact(myContactsAtCompany.length === 1 ? myContactsAtCompany[0] : null);
                                  }}
                                >
                                  Make Intro
                                </button>
                                <button
                                  className="u-req-action-btn u-req-action-btn--done"
                                  onClick={async () => {
                                    try {
                                      await requestsApi.markDone(r.id);
                                      setSpaceRequests(prev => ({
                                        ...prev,
                                        [space.id]: (prev[space.id] || []).map(req =>
                                          req.id === r.id ? { ...req, status: 'accepted' } : req
                                        ),
                                      }));
                                      setIntroToast('Intro marked as done!');
                                      setTimeout(() => setIntroToast(null), 3000);
                                    } catch (err) {
                                      console.error('Failed to mark as done:', err);
                                    }
                                  }}
                                >
                                  Intro Done
                                </button>
                                <button
                                  className="u-req-action-btn u-req-action-btn--decline"
                                  onClick={() => { setDecliningRequestId(r.id); setDeclineReason(''); }}
                                >
                                  Decline
                                </button>
                              </div>
                            )}

                            {/* Intro action flow */}
                            {introActionRequestId === r.id && !introActionType && (() => {
                              return (
                                <div className="u-intro-flow">
                                  {myContactsAtCompany.length > 1 && !introSelectedContact && (
                                    <div className="u-intro-contact-pick">
                                      <span className="u-intro-contact-pick-label">Who do you want to introduce?</span>
                                      {myContactsAtCompany.map(c => (
                                        <button key={c.id} className="u-intro-contact-pick-item" onClick={() => setIntroSelectedContact(c)}>
                                          {c.name}{c.title && <span className="u-intro-contact-pick-title"> · {c.title}</span>}
                                        </button>
                                      ))}
                                      <button className="u-intro-cancel" onClick={() => { setIntroActionRequestId(null); setIntroSelectedContact(null); }}>Cancel</button>
                                    </div>
                                  )}
                                  {(myContactsAtCompany.length <= 1 || introSelectedContact) && (() => {
                                    const cn = introSelectedContact?.name || myContactsAtCompany[0]?.name || 'your contact';
                                    const cf = cn.split(' ')[0];
                                    const rn = r.requester.name;
                                    const rf = rn.split(' ')[0];
                                    return (
                                    <div className="u-intro-tags">
                                      <button className="u-intro-tag" onClick={() => {
                                        setIntroActionType('ask-details');
                                        setIntroEmailSubject(`About your intro request to ${companyName}`);
                                        setIntroEmailBody(`Hi ${rf},\n\nI saw your request for an intro to someone at ${companyName}. I know ${cf} there and may be able to help.\n\nBefore I reach out, could you share a bit more about what you're looking for? For example:\n- What's the context for this intro?\n- What would you like to discuss with them?\n- Any specific goals or topics?\n\nJust want to make sure the intro is as useful as possible for both of you. Reply to this email and let me know.\n\nBest,\n${currentUser?.name || ''}`);
                                      }}>
                                        Ask {rf} for details
                                      </button>
                                      <button className="u-intro-tag" onClick={() => {
                                        setIntroActionType('make-intro');
                                        setIntroEmailSubject(`Introduction: ${rn} ↔ ${cn} (${companyName})`);
                                        setIntroEmailBody(`Hi ${cf} and ${rf},\n\nI'd love to connect you two.\n\n${cf} — ${rf} is interested in connecting with someone at ${companyName}, and I thought you'd be a great person to talk to.\n\n${rf} — ${cf} is at ${companyName}. I think you'll have a lot to discuss.\n\nFeel free to reply all to continue the conversation right here in this thread.\n\nBest,\n${currentUser?.name || ''}`);
                                      }}>
                                        Make intro
                                      </button>
                                      <button className="u-intro-tag" onClick={() => {
                                        setIntroActionType('ask-permission');
                                        setIntroEmailSubject(`Would you be open to an intro? (${companyName})`);
                                        setIntroEmailBody(`Hi ${cf},\n\nI have someone in my network who's looking to connect with someone at ${companyName}. I thought of you and wanted to check — would you be open to an introduction?\n\nNo pressure at all — just reply to this email and let me know.\n\nBest,\n${currentUser?.name || ''}`);
                                      }}>
                                        Ask {cf} if OK to make intro
                                      </button>
                                      <button className="u-intro-cancel" onClick={() => { setIntroActionRequestId(null); setIntroSelectedContact(null); }}>Cancel</button>
                                    </div>
                                    );
                                  })()}
                                </div>
                              );
                            })()}

                            {/* Email composer */}
                            {introActionRequestId === r.id && introActionType && (() => {
                              const contact = introSelectedContact || myContactsAtCompany[0];
                              const recipientLabel = introActionType === 'ask-details'
                                ? `To: ${r.requester.email || r.requester.name}`
                                : introActionType === 'ask-permission' && contact
                                ? `To: ${contact.email || contact.name}`
                                : `To: ${contact?.email || ''}, ${r.requester.email || ''}`;
                              const ccLabel = `CC: ${currentUser?.email || 'you'}`;
                              return (
                              <div className="u-intro-email">
                                <div className="u-intro-email-recipients">
                                  <span className="u-intro-email-recipient">{recipientLabel}</span>
                                  <span className="u-intro-email-cc">{ccLabel}</span>
                                </div>
                                <label className="u-intro-email-label">Subject</label>
                                <input
                                  className="u-intro-email-subject"
                                  value={introEmailSubject}
                                  onChange={e => setIntroEmailSubject(e.target.value)}
                                />
                                <label className="u-intro-email-label">Message</label>
                                <textarea
                                  className="u-intro-email-body"
                                  rows={8}
                                  value={introEmailBody}
                                  onChange={e => setIntroEmailBody(e.target.value)}
                                />
                                <div className="u-intro-email-actions">
                                  <button
                                    className="u-intro-email-send"
                                    disabled={introSending}
                                    onClick={async () => {
                                      setIntroSending(true);
                                      try {
                                        if (introActionType === 'make-intro' && contact) {
                                          await emailApi.sendDoubleIntro({
                                            requesterEmail: r.requester.email || '',
                                            requesterName: r.requester.name,
                                            contactEmail: contact.email,
                                            contactName: contact.name,
                                            targetCompany: companyName,
                                          });
                                          await offersApi.create({ requestId: r.id, message: `Intro to ${contact.name}` });
                                        } else if (introActionType === 'ask-details') {
                                          await emailApi.sendContact({
                                            recipientEmail: r.requester.email || '',
                                            recipientName: r.requester.name,
                                            subject: introEmailSubject,
                                            body: introEmailBody,
                                          });
                                        } else if (introActionType === 'ask-permission' && contact) {
                                          await emailApi.sendContact({
                                            recipientEmail: contact.email,
                                            recipientName: contact.name,
                                            subject: introEmailSubject,
                                            body: introEmailBody,
                                          });
                                        }
                                        setIntroActionRequestId(null);
                                        setIntroActionType(null);
                                        setIntroSelectedContact(null);
                                        setIntroToast('Email sent!');
                                        setTimeout(() => setIntroToast(null), 3000);
                                      } catch (err) {
                                        console.error('Failed to send intro email:', err);
                                        setIntroToast('Failed to send email');
                                        setTimeout(() => setIntroToast(null), 3000);
                                      } finally {
                                        setIntroSending(false);
                                      }
                                    }}
                                  >
                                    {introSending ? 'Sending...' : 'Send Email'}
                                  </button>
                                  <button className="u-intro-cancel" onClick={() => { setIntroActionType(null); }}>Back</button>
                                </div>
                              </div>
                              );
                            })()}

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

            {/* ── Profile Edit Panel ── */}
            {inlinePanel.type === 'profile' && currentUser && (
              <ProfilePanel
                currentUser={currentUser}
                profileForm={profileForm}
                profileDirty={profileDirty}
                profileSaving={profileSaving}
                mergedCompanies={mergedCompanies}
                onUpdateField={updateProfileField}
                onSave={saveProfile}
                onNavigate={setInlinePanel}
              />
            )}

            {/* ── Network Panel (Spaces + 1:1 Connections) ── */}
            {(inlinePanel.type === 'network-manage' || inlinePanel.type === 'spaces-manage' || inlinePanel.type === 'connections-manage') && (
              <div className="u-panel-spaces">
                <h2>Your Network</h2>
                <p className="u-panel-space-meta">{spaces.length} spaces · {connections.filter(c => c.status === 'accepted').length} connections</p>

                {/* My Profile Card (compact) */}
                {currentUser && (
                  <div className="u-panel-space-card" onClick={() => setInlinePanel({ type: 'profile' })} style={{ cursor: 'pointer' }}>
                    <PersonAvatar email={currentUser.email} name={currentUser.name} avatarUrl={currentUser.avatar} size={36} />
                    <div className="u-panel-space-card-info" style={{ minWidth: 0 }}>
                      <span className="u-panel-space-card-name">{currentUser.name}</span>
                      <span className="u-panel-space-card-stats">
                        {currentUser.title || currentUser.company
                          ? [currentUser.title, currentUser.company].filter(Boolean).join(' at ')
                          : currentUser.email}
                      </span>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </div>
                )}

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
                    {spaces.length === 0 && pendingSpaces.length === 0 && (
                      <div className="ob-space-templates">
                        <p className="ob-space-templates-hint">Create your first circle to pool networks</p>
                        {[
                          { emoji: '👥', name: 'My team', desc: 'Share contacts with your team' },
                          { emoji: '💰', name: 'Investor circle', desc: 'Pool deal flow with co-investors' },
                          { emoji: '🌐', name: 'Industry peers', desc: 'Connect with peers in your field' },
                        ].map(tmpl => (
                          <button
                            key={tmpl.name}
                            className="ob-space-template-btn"
                            onClick={() => {
                              setNewSpaceName(tmpl.name);
                              setNewSpaceEmoji(tmpl.emoji);
                              setShowCreateSpace(true);
                              setShowJoinSpace(false);
                            }}
                          >
                            <span className="ob-space-template-emoji">{tmpl.emoji}</span>
                            <div className="ob-space-template-info">
                              <span className="ob-space-template-name">{tmpl.name}</span>
                              <span className="ob-space-template-desc">{tmpl.desc}</span>
                            </div>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Pending spaces — invitations to accept or requests awaiting approval */}
                  {pendingSpaces.length > 0 && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.35rem' }}>Invitations</span>
                      {pendingSpaces.map(ps => (
                        <div key={ps.id} className="u-panel-space-card">
                          <span className="u-panel-space-emoji">{ps.emoji}</span>
                          <div className="u-panel-space-card-info">
                            <span className="u-panel-space-card-name">{ps.name}</span>
                            <span className="u-panel-space-card-stats">You've been invited</span>
                          </div>
                          <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
                            <button className="u-notif-accept-btn" style={{ fontSize: '0.6rem', padding: '0.15rem 0.4rem' }} onClick={() => acceptSpaceInvite(ps.id)}>Accept</button>
                            <button className="u-notif-reject-btn" style={{ fontSize: '0.6rem', padding: '0.15rem 0.4rem' }} onClick={() => rejectSpaceInvite(ps.id)}>Decline</button>
                          </div>
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

                  {/* Pending requests + Invited (not yet signed up) */}
                  {(connections.filter(c => c.status === 'pending').length > 0 || pendingInvites.length > 0) && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: '0.35rem' }}>Pending</span>
                      {connections.filter(c => c.status === 'pending').map(c => (
                        <div key={c.id} className="u-panel-space-card" style={{ opacity: c.direction === 'sent' ? 0.6 : 1 }}>
                          <PersonAvatar email={c.peer.email} name={c.peer.name} avatarUrl={c.peer.avatar} size={32} />
                          <div className="u-panel-space-card-info">
                            <span className="u-panel-space-card-name">{c.peer.name}</span>
                            <span className="u-panel-space-card-stats">{c.direction === 'sent' ? 'Waiting for response' : 'Wants to connect'}</span>
                          </div>
                          {c.direction === 'received' ? (
                            <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
                              <button className="u-notif-accept-btn" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }} onClick={() => acceptConnection(c.id)}>Accept</button>
                              <button className="u-notif-reject-btn" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }} onClick={() => rejectConnection(c.id)}>✕</button>
                            </div>
                          ) : (
                            <button className="u-notif-reject-btn" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', flexShrink: 0 }} onClick={() => removeConnection(c.id)} title="Revoke invitation">✕</button>
                          )}
                        </div>
                      ))}
                      {pendingInvites.map(inv => (
                        <div key={inv.id} className="u-panel-space-card" style={{ opacity: 0.5 }}>
                          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', flexShrink: 0, color: 'rgba(255,255,255,0.4)' }}>✉</div>
                          <div className="u-panel-space-card-info">
                            <span className="u-panel-space-card-name">{inv.email}</span>
                            <span className="u-panel-space-card-stats">Invited — not yet signed up</span>
                          </div>
                          <button className="u-notif-reject-btn" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', flexShrink: 0 }} onClick={() => cancelInvite(inv.id)} title="Cancel invite">✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="sb-space-form" style={{ marginTop: '0.5rem' }}>
                    <input
                      className="sb-input"
                      placeholder="Invite anyone by email"
                      value={connectEmail}
                      onChange={e => setConnectEmail(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && connectEmail.trim()) { sendConnectionRequest(connectEmail); } }}
                    />
                    <button className="sb-space-action-btn primary" style={{ marginTop: '0.35rem', width: '100%' }} onClick={() => sendConnectionRequest(connectEmail)} disabled={!connectEmail.trim()}>+ Connect</button>
                    <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', marginTop: '0.35rem', display: 'block', lineHeight: 1.4 }}>Works with anyone — if they're not on Introo yet, we'll send them an invite.</span>
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
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="u-panel-name-row">
                      <h2>{conn.peer.name}</h2>
                      <div className="u-panel-top-menu-wrap">
                        <button className="u-panel-top-menu-btn" onClick={() => setConnMenuOpen(!connMenuOpen)}>⋯</button>
                        {connMenuOpen && (
                          <>
                            <div className="u-panel-top-menu-overlay" onClick={() => setConnMenuOpen(false)} />
                            <div className="u-panel-top-menu-dropdown">
                              <button className="u-panel-top-menu-item u-panel-top-menu-item--danger" onClick={() => { setConnMenuOpen(false); removeConnection(conn.id); setInlinePanel({ type: 'network-manage' }); }}>
                                Disconnect
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
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

                            {!isMe && isOpen && !isDeclining && introActionRequestId !== r.id && (
                              <div className="u-panel-request-actions">
                                <button
                                  className="u-req-action-btn u-req-action-btn--intro"
                                  onClick={() => {
                                    setIntroActionRequestId(r.id);
                                    setIntroActionType(null);
                                    setIntroEmailSubject('');
                                    setIntroEmailBody('');
                                    setIntroSelectedContact(myContactsAtCompany.length === 1 ? myContactsAtCompany[0] : null);
                                  }}
                                >Make Intro</button>
                                <button className="u-req-action-btn u-req-action-btn--done" onClick={async () => {
                                  try {
                                    await requestsApi.markDone(r.id);
                                    setIncomingRequests(prev => prev.map(req => req.id === r.id ? { ...req, status: 'accepted' } : req));
                                    setIntroToast('Intro marked as done!');
                                    setTimeout(() => setIntroToast(null), 3000);
                                  } catch (err) { console.error('Failed to mark as done:', err); }
                                }}>Intro Done</button>
                                <button className="u-req-action-btn u-req-action-btn--decline" onClick={() => { setDecliningRequestId(r.id); setDeclineReason(''); }}>Decline</button>
                              </div>
                            )}

                            {/* Intro action flow */}
                            {introActionRequestId === r.id && !introActionType && (() => {
                              return (
                                <div className="u-intro-flow">
                                  {myContactsAtCompany.length > 1 && !introSelectedContact && (
                                    <div className="u-intro-contact-pick">
                                      <span className="u-intro-contact-pick-label">Who do you want to introduce?</span>
                                      {myContactsAtCompany.map(c => (
                                        <button key={c.id} className="u-intro-contact-pick-item" onClick={() => setIntroSelectedContact(c)}>
                                          {c.name}{c.title && <span className="u-intro-contact-pick-title"> · {c.title}</span>}
                                        </button>
                                      ))}
                                      <button className="u-intro-cancel" onClick={() => { setIntroActionRequestId(null); setIntroSelectedContact(null); }}>Cancel</button>
                                    </div>
                                  )}
                                  {(myContactsAtCompany.length <= 1 || introSelectedContact) && (() => {
                                    const cn = introSelectedContact?.name || myContactsAtCompany[0]?.name || 'your contact';
                                    const cf = cn.split(' ')[0];
                                    const rn = r.requester.name;
                                    const rf = rn.split(' ')[0];
                                    return (
                                    <div className="u-intro-tags">
                                      <button className="u-intro-tag" onClick={() => {
                                        setIntroActionType('ask-details');
                                        setIntroEmailSubject(`About your intro request to ${companyName}`);
                                        setIntroEmailBody(`Hi ${rf},\n\nI saw your request for an intro to someone at ${companyName}. I know ${cf} there and may be able to help.\n\nBefore I reach out, could you share a bit more about what you're looking for? For example:\n- What's the context for this intro?\n- What would you like to discuss with them?\n- Any specific goals or topics?\n\nJust want to make sure the intro is as useful as possible for both of you. Reply to this email and let me know.\n\nBest,\n${currentUser?.name || ''}`);
                                      }}>
                                        Ask {rf} for details
                                      </button>
                                      <button className="u-intro-tag" onClick={() => {
                                        setIntroActionType('make-intro');
                                        setIntroEmailSubject(`Introduction: ${rn} ↔ ${cn} (${companyName})`);
                                        setIntroEmailBody(`Hi ${cf} and ${rf},\n\nI'd love to connect you two.\n\n${cf} — ${rf} is interested in connecting with someone at ${companyName}, and I thought you'd be a great person to talk to.\n\n${rf} — ${cf} is at ${companyName}. I think you'll have a lot to discuss.\n\nFeel free to reply all to continue the conversation right here in this thread.\n\nBest,\n${currentUser?.name || ''}`);
                                      }}>
                                        Make intro
                                      </button>
                                      <button className="u-intro-tag" onClick={() => {
                                        setIntroActionType('ask-permission');
                                        setIntroEmailSubject(`Would you be open to an intro? (${companyName})`);
                                        setIntroEmailBody(`Hi ${cf},\n\nI have someone in my network who's looking to connect with someone at ${companyName}. I thought of you and wanted to check — would you be open to an introduction?\n\nNo pressure at all — just reply to this email and let me know.\n\nBest,\n${currentUser?.name || ''}`);
                                      }}>
                                        Ask {cf} if OK to make intro
                                      </button>
                                      <button className="u-intro-cancel" onClick={() => { setIntroActionRequestId(null); setIntroSelectedContact(null); }}>Cancel</button>
                                    </div>
                                    );
                                  })()}
                                </div>
                              );
                            })()}

                            {/* Email composer */}
                            {introActionRequestId === r.id && introActionType && (() => {
                              const contact = introSelectedContact || myContactsAtCompany[0];
                              const recipientLabel = introActionType === 'ask-details'
                                ? `To: ${r.requester.email || r.requester.name}`
                                : introActionType === 'ask-permission' && contact
                                ? `To: ${contact.email || contact.name}`
                                : `To: ${contact?.email || ''}, ${r.requester.email || ''}`;
                              const ccLabel = `CC: ${currentUser?.email || 'you'}`;
                              return (
                              <div className="u-intro-email">
                                <div className="u-intro-email-recipients">
                                  <span className="u-intro-email-recipient">{recipientLabel}</span>
                                  <span className="u-intro-email-cc">{ccLabel}</span>
                                </div>
                                <label className="u-intro-email-label">Subject</label>
                                <input
                                  className="u-intro-email-subject"
                                  value={introEmailSubject}
                                  onChange={e => setIntroEmailSubject(e.target.value)}
                                />
                                <label className="u-intro-email-label">Message</label>
                                <textarea
                                  className="u-intro-email-body"
                                  rows={8}
                                  value={introEmailBody}
                                  onChange={e => setIntroEmailBody(e.target.value)}
                                />
                                <div className="u-intro-email-actions">
                                  <button
                                    className="u-intro-email-send"
                                    disabled={introSending}
                                    onClick={async () => {
                                      setIntroSending(true);
                                      try {
                                        if (introActionType === 'make-intro' && contact) {
                                          await emailApi.sendDoubleIntro({
                                            requesterEmail: r.requester.email || '',
                                            requesterName: r.requester.name,
                                            contactEmail: contact.email,
                                            contactName: contact.name,
                                            targetCompany: companyName,
                                          });
                                          await offersApi.create({ requestId: r.id, message: `Intro to ${contact.name}` });
                                        } else if (introActionType === 'ask-details') {
                                          await emailApi.sendContact({
                                            recipientEmail: r.requester.email || '',
                                            recipientName: r.requester.name,
                                            subject: introEmailSubject,
                                            body: introEmailBody,
                                          });
                                        } else if (introActionType === 'ask-permission' && contact) {
                                          await emailApi.sendContact({
                                            recipientEmail: contact.email,
                                            recipientName: contact.name,
                                            subject: introEmailSubject,
                                            body: introEmailBody,
                                          });
                                        }
                                        setIntroActionRequestId(null);
                                        setIntroActionType(null);
                                        setIntroSelectedContact(null);
                                        setIntroToast('Email sent!');
                                        setTimeout(() => setIntroToast(null), 3000);
                                      } catch (err) {
                                        console.error('Failed to send intro email:', err);
                                        setIntroToast('Failed to send email');
                                        setTimeout(() => setIntroToast(null), 3000);
                                      } finally {
                                        setIntroSending(false);
                                      }
                                    }}
                                  >
                                    {introSending ? 'Sending...' : 'Send Email'}
                                  </button>
                                  <button className="u-intro-cancel" onClick={() => { setIntroActionType(null); }}>Back</button>
                                </div>
                              </div>
                              );
                            })()}

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

              </div>
              );
            })()}

            {/* ── Notifications Panel ── */}
            {inlinePanel.type === 'notifications' && (
              <NotificationsPanel
                notifications={notifications}
                connections={connections}
                mergedCompanies={mergedCompanies}
                pendingSpaces={pendingSpaces}
                onNavigate={setInlinePanel}
                onAcceptConnection={acceptConnection}
                onRejectConnection={rejectConnection}
                onAcceptSpaceInvite={acceptSpaceInvite}
                onRejectSpaceInvite={rejectSpaceInvite}
                onDeleteNotification={(id) => {
                  notificationsApi.deleteOne(id).then(() => {
                    setNotifications(prev => prev.filter(n => n.id !== id));
                    notificationsApi.getUnreadCount().then(r => setNotificationCount(r.count)).catch(() => {});
                  }).catch(() => {});
                }}
                onClearAllNotifications={() => {
                  notificationsApi.deleteAll().then(() => {
                    setNotifications([]);
                    setNotificationCount(0);
                  }).catch(() => {});
                }}
              />
            )}

            {/* ── Settings Panel ── */}
            {inlinePanel.type === 'settings' && (
              <SettingsPanel
                currentUser={currentUser}
                isCalendarConnected={isCalendarConnected}
                calendarAccounts={calendarAccounts}
                calendarSyncing={calendarSyncing}
                syncingAccountId={syncingAccountId}
                enriching={enriching}
                enrichStats={enrichStats}
                enrichError={enrichError}
                enrichProgress={enrichProgress}
                onCalendarSync={handleCalendarSync}
                onAccountSync={handleAccountSync}
                onAccountDelete={handleAccountDelete}
                onStartEnrichment={startEnrichment}
                onStopEnrichment={stopEnrichment}
                onLogout={logout}
              />
            )}

            {inlinePanel.type === 'intro-request' && inlinePanel.company && (() => {
              const co = inlinePanel.company;

              // Build all available "through" options from the company's actual overlaps
              type IntroOption = { type: 'space'; id: string; label: string; emoji: string; count: number; titles: string[] }
                              | { type: 'connection'; id: string; label: string; peerId: string; peerEmail: string; count: number; titles: string[] };
              const introOptions: IntroOption[] = [];

              // Collect contacts per space and their titles
              const spaceContactData: Record<string, { count: number; titles: string[] }> = {};
              co.spaceContacts.forEach(c => {
                if (c.spaceId) {
                  if (!spaceContactData[c.spaceId]) spaceContactData[c.spaceId] = { count: 0, titles: [] };
                  spaceContactData[c.spaceId].count++;
                  if (c.title && !spaceContactData[c.spaceId].titles.includes(c.title)) spaceContactData[c.spaceId].titles.push(c.title);
                }
              });
              co.spaceIds.forEach(sid => {
                const sp = spaces.find(s => s.id === sid);
                const data = spaceContactData[sid] || { count: 0, titles: [] };
                if (sp) introOptions.push({ type: 'space', id: sid, label: sp.name, emoji: sp.emoji || '🫛', count: data.count, titles: data.titles });
              });

              // Collect contacts per connection from the raw connectionCompanies data
              co.connectionIds.forEach(cid => {
                const conn = connections.find(c => c.id === cid);
                if (!conn) return;
                // Find the matching company in connectionCompanies for this connection + domain
                const cc = connectionCompanies.find(c => c.connectionId === cid && c.domain === co.domain);
                const count = cc?.contacts.length || 0;
                const titles: string[] = [];
                cc?.contacts.forEach(c => {
                  if (c.title && !titles.includes(c.title)) titles.push(c.title);
                });
                introOptions.push({ type: 'connection', id: cid, label: conn.peer.name, peerId: conn.peer.id, peerEmail: conn.peer.email, count, titles });
              });

              // Auto-select: if filtered to a specific connection, pre-select it; if filtered to a space, pre-select it; otherwise first option
              const iConnFilter = inlinePanel.introConnectionFilter || 'all';
              const iSpaceFilter = inlinePanel.introSpaceFilter || 'all';
              const defaultSelected = iConnFilter !== 'all'
                ? introOptions.find(o => o.type === 'connection' && o.id === iConnFilter)?.id
                : iSpaceFilter !== 'all'
                  ? introOptions.find(o => o.type === 'space' && o.id === iSpaceFilter)?.id
                  : introOptions[0]?.id;

              // Use a ref-like pattern via state key to track selection within the IIFE
              // We'll use introSelectedThrough state for this
              const selectedId = introSelectedThrough || defaultSelected || '';
              const selected = introOptions.find(o => o.id === selectedId) || introOptions[0];

              // Auto-set default on first render
              if (!introSelectedThrough && defaultSelected) {
                setTimeout(() => setIntroSelectedThrough(defaultSelected), 0);
              }

              return (
              <div className="u-panel-intro">
                <h2>Request Intro</h2>
                <div className="u-panel-target">
                  <CompanyLogo domain={co.domain} name={co.name} size={32} />
                  <span>{co.name}</span>
                </div>

                <div className="u-panel-section">
                  <p className="u-panel-section-text" style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    {selected?.type === 'connection'
                      ? `This is a direct request to ${selected.label}. Describe what you'd like to discuss.`
                      : selected?.type === 'space'
                        ? `Contacts at this company are shared through ${selected.label}. Describe what you'd like to discuss and the right connectors will be notified.`
                        : `Describe what you'd like to discuss.`}
                  </p>
                </div>

                {introOptions.length > 0 && (
                  <div className="u-panel-section">
                    <h4 className="u-panel-section-h">Through</h4>
                    <div className="u-panel-intro-spaces">
                      {introOptions.map(opt => (
                        <div
                          key={opt.id}
                          className={`u-panel-intro-space-row u-panel-intro-space-row--selectable ${selectedId === opt.id ? 'u-panel-intro-space-row--selected' : ''}`}
                          onClick={() => setIntroSelectedThrough(opt.id)}
                        >
                          <span className="u-panel-intro-space-name">
                            {opt.type === 'space' ? `${opt.emoji} ${opt.label}` : `👤 ${opt.label}`}
                          </span>
                          {opt.titles.length > 0 && (
                            <span className="u-panel-intro-option-subtitle">Knows: {opt.titles.filter(Boolean).join(', ')}</span>
                          )}
                          <span className="u-panel-intro-space-count">
                            {opt.count} {opt.count === 1 ? 'contact' : 'contacts'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {introOptions.length === 0 && co.myContacts.length > 0 && (
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

                <div className="u-panel-textarea-wrap">
                  <textarea
                    className="u-panel-textarea"
                    placeholder="What would you like to discuss?"
                    rows={3}
                    value={introRequestText}
                    onChange={e => setIntroRequestText(e.target.value)}
                    disabled={introRequestSending || introRequestSent}
                  />
                  <span className="u-panel-textarea-hint" onClick={() => setIntroTipOpen(!introTipOpen)}>?</span>
                  {introTipOpen && (
                    <div className="u-panel-textarea-tooltip">
                      Be specific about what you need. Mention what's in it for them — rev share, partnership, deal %. Keep it to 2-3 sentences.
                    </div>
                  )}
                </div>

                {introRequestSent ? (
                  <div className="u-panel-actions">
                    <p style={{ color: 'var(--accent-primary)', fontSize: '0.85rem', margin: 0 }}>
                      Request sent! {selected ? `${selected.label} will be notified.` : 'The connector will be notified.'}
                    </p>
                    <button className="u-action-btn" onClick={() => {
                      setInlinePanel(null);
                      setIntroRequestSent(false);
                      setIntroRequestText('');
                      setIntroSelectedThrough(null);
                    }}>Close</button>
                  </div>
                ) : (
                  <div className="u-panel-actions">
                    <button
                      className="u-primary-btn"
                      disabled={!introRequestText.trim() || introRequestSending || !selected}
                      onClick={async () => {
                        setIntroRequestSending(true);
                        try {
                          const normalizedQuery: Record<string, unknown> = {
                            companyName: co.name,
                            companyDomain: co.domain,
                            companyId: co.id,
                          };
                          if (selected?.type === 'space') {
                            await requestsApi.create({
                              rawText: introRequestText.trim(),
                              spaceId: selected.id,
                              normalizedQuery,
                            });
                          } else if (selected?.type === 'connection') {
                            normalizedQuery.connectionPeerId = selected.peerId;
                            normalizedQuery.connectionPeerName = selected.label;
                            await requestsApi.create({
                              rawText: introRequestText.trim(),
                              connectionPeerId: selected.peerId,
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
                      setIntroSelectedThrough(null);
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
