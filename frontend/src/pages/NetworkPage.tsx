import { useMemo, useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAppState, useAppDispatch } from '../store';
import { SignalBuilderModal, Signal } from '../components/SignalBuilderModal';
import type { Contact as StoreContact } from '../store/types';

interface DisplayMeeting {
  id: string;
  title: string;
  date: Date;
  duration?: number;
}

// Display-friendly contact interface (derived from StoreContact)
interface DisplayContact {
  id: string;
  name: string;
  email: string;
  avatar: string;
  title: string;
  company: string;
  companyDomain: string;
  linkedinUrl?: string;
  lastContacted: Date;
  lastEventTitle?: string;
  meetings: DisplayMeeting[];
  meetingsCount: number;
  connectionStrength: 'strong' | 'medium' | 'weak';
}

function calculateStrength(lastSeenAt: string, meetingsCount: number): 'strong' | 'medium' | 'weak' {
  const daysSince = Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / (1000 * 60 * 60 * 24));
  if (daysSince <= 7 && meetingsCount >= 3) return 'strong';
  if (daysSince <= 30 && meetingsCount >= 2) return 'medium';
  return 'weak';
}

interface SignalMatch {
  id: string;
  signalId: string;
  entityType: 'contact' | 'company';
  entityId: string;
  summary: string;
  data: any;
  isRead: boolean;
  matchedAt: string;
  signal: {
    id: string;
    name: string;
    entityType: string;
    triggerType: string;
  };
  entity: any;
}

// Date range options
const dateRangeOptions = [
  { label: 'Any time', value: 'all' },
  { label: 'Today', value: 'today' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Last 90 days', value: '90d' },
  { label: 'Last 6 months', value: '6m' },
  { label: 'Last year', value: '1y' },
  { label: 'Over a year ago', value: 'older' },
];

export function NetworkPage() {
  const { contacts: storeContacts } = useAppState();
  const dispatch = useAppDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Add Contact Modal state
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContact, setNewContact] = useState({
    name: '',
    email: '',
    title: '',
    company: '',
  });
  const viewParam = searchParams.get('view');
  const initialView = viewParam === 'companies' ? 'companies' : viewParam === 'signals' ? 'signals' : 'people';
  
  const [view, setView] = useState<'people' | 'companies' | 'signals'>(initialView);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'strength' | 'name'>('recent');
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  
  // Filter states
  const [showFilters, setShowFilters] = useState(false);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [selectedTitles, setSelectedTitles] = useState<string[]>([]);
  const [selectedStrengths, setSelectedStrengths] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<string>('all');
  const [companySearch, setCompanySearch] = useState('');
  const [titleSearch, setTitleSearch] = useState('');

  // Signals state
  const [signals, setSignals] = useState<Signal[]>([]);
  const [signalMatches, setSignalMatches] = useState<SignalMatch[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [showSignalBuilder, setShowSignalBuilder] = useState(false);
  const [editingSignal, setEditingSignal] = useState<Signal | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [approvingAll, setApprovingAll] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [companyPage, setCompanyPage] = useState(1);
  const ITEMS_PER_PAGE = 50;
  const COMPANIES_PER_PAGE = 20;

  // Count pending (unapproved) contacts
  const pendingCount = useMemo(() => {
    return storeContacts.filter(c => !c.isApproved).length;
  }, [storeContacts]);

  // Approve all pending contacts
  const handleApproveAll = async () => {
    setApprovingAll(true);
    try {
      const res = await fetch('/api/relationships/contacts/approve-all', {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        // Reload the page to refresh contacts
        window.location.reload();
      }
    } catch (e) {
      console.error('Failed to approve contacts:', e);
    } finally {
      setApprovingAll(false);
    }
  };

  // Transform store contacts to display format
  // Show all approved contacts, using email prefix as name fallback
  const allContacts: DisplayContact[] = useMemo(() => {
    return storeContacts
      .filter(c => c.isApproved)
      .map(c => ({
        id: c.id,
        name: c.name || c.email.split('@')[0], // Fallback to email prefix
        email: c.email,
        avatar: '', // No fake avatars - use initials instead
        title: c.title || '', // Only show if we actually have it
        company: c.company?.name || '',
        companyDomain: c.company?.domain || c.email.split('@')[1] || '',
        lastContacted: new Date(c.lastSeenAt),
        lastEventTitle: c.lastEventTitle,
        meetings: (c.meetings || []).map(m => ({
          id: m.id,
          title: m.title,
          date: new Date(m.date),
          duration: m.duration,
        })),
        meetingsCount: c.meetingsCount,
        connectionStrength: calculateStrength(c.lastSeenAt, c.meetingsCount),
      }));
  }, [storeContacts]);

  // Extract unique companies and titles for filters
  const uniqueCompanies = useMemo(() => {
    const companies = new Map<string, number>();
    allContacts.forEach(c => {
      if (c.company) {
        companies.set(c.company, (companies.get(c.company) || 0) + 1);
      }
    });
    return Array.from(companies.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [allContacts]);

  const uniqueTitles = useMemo(() => {
    const titles = new Map<string, number>();
    allContacts.forEach(c => {
      if (c.title) {
        // Normalize title for grouping
        const normalized = c.title.toLowerCase().trim();
        titles.set(normalized, (titles.get(normalized) || 0) + 1);
      }
    });
    return Array.from(titles.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20) // Top 20 titles
      .map(([name, count]) => ({ name, count }));
  }, [allContacts]);

  // Handle view toggle
  const handleViewChange = (newView: 'people' | 'companies' | 'signals') => {
    setView(newView);
    if (newView === 'companies') {
      setSearchParams({ view: 'companies' });
    } else if (newView === 'signals') {
      setSearchParams({ view: 'signals' });
    } else {
      setSearchParams({});
    }
  };

  // Fetch signals data
  useEffect(() => {
    if (view === 'signals') {
      fetchSignals();
      fetchSignalMatches();
    }
  }, [view]);

  // Fetch unread count on mount
  useEffect(() => {
    fetchUnreadCount();
  }, []);

  const fetchSignals = async () => {
    try {
      const res = await fetch('/api/signals', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setSignals(data);
      }
    } catch (e) {
      console.error('Failed to fetch signals:', e);
    }
  };

  const fetchSignalMatches = async () => {
    setSignalsLoading(true);
    try {
      const res = await fetch('/api/signals/matches', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setSignalMatches(data);
      }
    } catch (e) {
      console.error('Failed to fetch signal matches:', e);
    } finally {
      setSignalsLoading(false);
    }
  };

  const fetchUnreadCount = async () => {
    try {
      const res = await fetch('/api/signals/matches/count', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.count);
      }
    } catch (e) {
      console.error('Failed to fetch unread count:', e);
    }
  };

  const markMatchAsRead = async (matchId: string) => {
    try {
      await fetch(`/api/signals/matches/${matchId}/read`, {
        method: 'POST',
        credentials: 'include',
      });
      setSignalMatches(prev =>
        prev.map(m => m.id === matchId ? { ...m, isRead: true } : m)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (e) {
      console.error('Failed to mark match as read:', e);
    }
  };

  const markAllAsRead = async () => {
    try {
      await fetch('/api/signals/matches/read-all', {
        method: 'POST',
        credentials: 'include',
      });
      setSignalMatches(prev => prev.map(m => ({ ...m, isRead: true })));
      setUnreadCount(0);
    } catch (e) {
      console.error('Failed to mark all as read:', e);
    }
  };

  const deleteSignal = async (signalId: string) => {
    if (!confirm('Delete this signal? All matches will also be deleted.')) return;
    try {
      await fetch(`/api/signals/${signalId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      setSignals(prev => prev.filter(s => s.id !== signalId));
      setSignalMatches(prev => prev.filter(m => m.signalId !== signalId));
    } catch (e) {
      console.error('Failed to delete signal:', e);
    }
  };

  // Check if date matches range
  const matchesDateRange = (date: Date, range: string): boolean => {
    const now = Date.now();
    const days = Math.floor((now - date.getTime()) / (1000 * 60 * 60 * 24));
    
    switch (range) {
      case 'today': return days === 0;
      case '7d': return days <= 7;
      case '30d': return days <= 30;
      case '90d': return days <= 90;
      case '6m': return days <= 180;
      case '1y': return days <= 365;
      case 'older': return days > 365;
      default: return true;
    }
  };

  // Filter contacts with all criteria
  const filteredContacts = useMemo(() => {
    let contacts = [...allContacts];

    // Text search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      contacts = contacts.filter(c => 
        c.name.toLowerCase().includes(query) ||
        c.company.toLowerCase().includes(query) ||
        c.title.toLowerCase().includes(query) ||
        c.email.toLowerCase().includes(query)
      );
    }

    // Company filter
    if (selectedCompanies.length > 0) {
      contacts = contacts.filter(c => selectedCompanies.includes(c.company));
    }

    // Title filter
    if (selectedTitles.length > 0) {
      contacts = contacts.filter(c => 
        selectedTitles.some(t => c.title.toLowerCase().includes(t))
      );
    }

    // Strength filter
    if (selectedStrengths.length > 0) {
      contacts = contacts.filter(c => selectedStrengths.includes(c.connectionStrength));
    }

    // Date range filter
    if (dateRange !== 'all') {
      contacts = contacts.filter(c => matchesDateRange(c.lastContacted, dateRange));
    }

    return contacts.sort((a, b) => {
      if (sortBy === 'recent') {
        return b.lastContacted.getTime() - a.lastContacted.getTime();
      }
      if (sortBy === 'strength') {
        const strengthOrder = { strong: 3, medium: 2, weak: 1 };
        return strengthOrder[b.connectionStrength] - strengthOrder[a.connectionStrength];
      }
      return a.name.localeCompare(b.name);
    });
  }, [searchQuery, sortBy, selectedCompanies, selectedTitles, selectedStrengths, dateRange, allContacts]);

  // Paginate contacts
  const totalPages = Math.ceil(filteredContacts.length / ITEMS_PER_PAGE);
  const paginatedContacts = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredContacts.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredContacts, currentPage, ITEMS_PER_PAGE]);

  // Reset to page 1 when filters change
  const filterKey = `${searchQuery}-${sortBy}-${selectedCompanies.join(',')}-${selectedTitles.join(',')}-${selectedStrengths.join(',')}-${dateRange}`;
  useEffect(() => {
    setCurrentPage(1);
  }, [filterKey]);

  // Group contacts by company (also filtered)
  const companiesWithContacts = useMemo(() => {
    const companyMap = new Map<string, { company: string; domain: string; contacts: DisplayContact[] }>();
    
    // Only include contacts that have a company name
    filteredContacts
      .filter(contact => contact.company && contact.company.trim() !== '')
      .forEach(contact => {
        if (!companyMap.has(contact.company)) {
          companyMap.set(contact.company, {
            company: contact.company,
            domain: contact.companyDomain,
            contacts: [],
          });
        }
        companyMap.get(contact.company)!.contacts.push(contact);
      });

    let companies = Array.from(companyMap.values());

    return companies.sort((a, b) => {
      if (sortBy === 'strength') {
        return b.contacts.length - a.contacts.length;
      }
      if (sortBy === 'recent') {
        const aRecent = Math.max(...a.contacts.map(c => c.lastContacted.getTime()));
        const bRecent = Math.max(...b.contacts.map(c => c.lastContacted.getTime()));
        return bRecent - aRecent;
      }
      return a.company.localeCompare(b.company);
    });
  }, [filteredContacts, sortBy]);

  // Paginate companies
  const totalCompanyPages = Math.ceil(companiesWithContacts.length / COMPANIES_PER_PAGE);
  const paginatedCompanies = useMemo(() => {
    const start = (companyPage - 1) * COMPANIES_PER_PAGE;
    return companiesWithContacts.slice(start, start + COMPANIES_PER_PAGE);
  }, [companiesWithContacts, companyPage, COMPANIES_PER_PAGE]);

  // Reset company page when view changes or filters change
  useEffect(() => {
    setCompanyPage(1);
  }, [filterKey, view]);

  // Filter companies list for filter panel
  const filteredCompanyOptions = useMemo(() => {
    if (!companySearch) return uniqueCompanies.slice(0, 15);
    return uniqueCompanies.filter(c => 
      c.name.toLowerCase().includes(companySearch.toLowerCase())
    ).slice(0, 15);
  }, [uniqueCompanies, companySearch]);

  // Filter titles list for filter panel
  const filteredTitleOptions = useMemo(() => {
    if (!titleSearch) return uniqueTitles;
    return uniqueTitles.filter(t => 
      t.name.toLowerCase().includes(titleSearch.toLowerCase())
    );
  }, [uniqueTitles, titleSearch]);

  const daysSince = (date: Date) => {
    const days = Math.round((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.round(days / 7)}w ago`;
    if (days < 365) return `${Math.round(days / 30)}mo ago`;
    return `${Math.round(days / 365)}y ago`;
  };

  const toggleCompany = (company: string) => {
    setSelectedCompanies(prev => 
      prev.includes(company) 
        ? prev.filter(c => c !== company)
        : [...prev, company]
    );
  };

  const toggleTitle = (title: string) => {
    setSelectedTitles(prev => 
      prev.includes(title) 
        ? prev.filter(t => t !== title)
        : [...prev, title]
    );
  };

  const toggleStrength = (strength: string) => {
    setSelectedStrengths(prev => 
      prev.includes(strength) 
        ? prev.filter(s => s !== strength)
        : [...prev, strength]
    );
  };

  const clearAllFilters = () => {
    setSelectedCompanies([]);
    setSelectedTitles([]);
    setSelectedStrengths([]);
    setDateRange('all');
    setSearchQuery('');
  };

  const activeFilterCount = 
    selectedCompanies.length + 
    selectedTitles.length + 
    selectedStrengths.length + 
    (dateRange !== 'all' ? 1 : 0);

  const handleAddContact = () => {
    if (!newContact.name || !newContact.email) return;
    
    const contact: StoreContact = {
      id: `contact-${Date.now()}`,
      name: newContact.name,
      email: newContact.email,
      title: newContact.title || null,
      isApproved: true,
      meetingsCount: 1,
      lastSeenAt: new Date().toISOString(),
      company: newContact.company ? {
        id: `company-${Date.now()}`,
        domain: newContact.email.split('@')[1] || '',
        name: newContact.company,
        logo: null,
      } : null,
    };
    
    // Save to localStorage for persistence
    const savedContacts = localStorage.getItem('spaces_contacts');
    let userContacts: StoreContact[] = [];
    try {
      userContacts = savedContacts ? JSON.parse(savedContacts) : [];
    } catch (e) {
      console.warn('Failed to parse saved contacts, resetting:', e);
    }
    userContacts.push(contact);
    localStorage.setItem('spaces_contacts', JSON.stringify(userContacts));
    
    dispatch({ type: 'ADD_CONTACT', payload: contact });
    setNewContact({ name: '', email: '', title: '', company: '' });
    setShowAddContact(false);
  };

  return (
    <div className="crm-page">
      <div className="crm-header">
        <div className="crm-title">
          <h1>Your Network</h1>
          <p className="crm-subtitle">
            {view === 'companies' ? (
              <>
                {companiesWithContacts.length} companies
                {totalCompanyPages > 1 && ` • Page ${companyPage} of ${totalCompanyPages}`}
              </>
            ) : (
              <>
                {filteredContacts.length} people
                {totalPages > 1 && ` • Page ${currentPage} of ${totalPages}`}
              </>
            )}
            {pendingCount > 0 && (
              <span style={{ marginLeft: '0.5rem', color: '#ff6b4a' }}>
                ({pendingCount} pending)
              </span>
            )}
            {activeFilterCount > 0 && (
              <button className="clear-filters-btn" onClick={clearAllFilters}>
                Clear {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
              </button>
            )}
          </p>
        </div>
        <div className="crm-header-actions">
          {pendingCount > 0 && (
            <button 
              className="btn-secondary"
              onClick={handleApproveAll}
              disabled={approvingAll}
              style={{ marginRight: '0.5rem' }}
            >
              {approvingAll ? 'Approving...' : `Approve ${pendingCount} Pending`}
            </button>
          )}
          <button 
            className="btn-primary"
            onClick={() => setShowAddContact(true)}
          >
            + Add Contact
          </button>
          <button 
            className={`filter-toggle-btn ${showFilters ? 'active' : ''}`}
            onClick={() => setShowFilters(!showFilters)}
          >
            <span>⚙️</span> Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
          </button>
        </div>
      </div>

      <div className="crm-layout">
        {/* Filter Sidebar */}
        {showFilters && (
          <aside className="crm-filters">
            {/* Last Contact Date */}
            <div className="filter-section">
              <h3 className="filter-title">Last Contact</h3>
              <div className="filter-options date-options">
                {dateRangeOptions.map(option => (
                  <button
                    key={option.value}
                    className={`filter-chip ${dateRange === option.value ? 'active' : ''}`}
                    onClick={() => setDateRange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Connection Strength */}
            <div className="filter-section">
              <h3 className="filter-title">Connection Strength</h3>
              <div className="filter-options">
                {['strong', 'medium', 'weak'].map(strength => (
                  <label key={strength} className="filter-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedStrengths.includes(strength)}
                      onChange={() => toggleStrength(strength)}
                    />
                    <span className={`strength-label ${strength}`}>
                      <span className={`strength-dot ${strength}`}></span>
                      {strength.charAt(0).toUpperCase() + strength.slice(1)}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Company Filter */}
            <div className="filter-section">
              <h3 className="filter-title">
                Company
                {selectedCompanies.length > 0 && (
                  <span className="filter-count">{selectedCompanies.length}</span>
                )}
              </h3>
              <input
                type="text"
                className="filter-search"
                placeholder="Search companies..."
                value={companySearch}
                onChange={(e) => setCompanySearch(e.target.value)}
              />
              <div className="filter-list">
                {filteredCompanyOptions.map(({ name, count }) => (
                  <label key={name} className="filter-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedCompanies.includes(name)}
                      onChange={() => toggleCompany(name)}
                    />
                    <span className="filter-label-text">
                      {name}
                      <span className="filter-label-count">{count}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Title/Role Filter */}
            <div className="filter-section">
              <h3 className="filter-title">
                Role / Title
                {selectedTitles.length > 0 && (
                  <span className="filter-count">{selectedTitles.length}</span>
                )}
              </h3>
              <input
                type="text"
                className="filter-search"
                placeholder="Search roles..."
                value={titleSearch}
                onChange={(e) => setTitleSearch(e.target.value)}
              />
              <div className="filter-list">
                {filteredTitleOptions.map(({ name, count }) => (
                  <label key={name} className="filter-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedTitles.includes(name)}
                      onChange={() => toggleTitle(name)}
                    />
                    <span className="filter-label-text">
                      {name.charAt(0).toUpperCase() + name.slice(1)}
                      <span className="filter-label-count">{count}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </aside>
        )}

        {/* Main Content */}
        <div className="crm-content">
          {/* View Toggle */}
          <div className="crm-toolbar">
            <div className="view-toggle">
              <button 
                className={`toggle-btn ${view === 'people' ? 'active' : ''}`}
                onClick={() => handleViewChange('people')}
              >
                People
              </button>
              <button 
                className={`toggle-btn ${view === 'companies' ? 'active' : ''}`}
                onClick={() => handleViewChange('companies')}
              >
                Companies
              </button>
              <button 
                className={`toggle-btn ${view === 'signals' ? 'active' : ''}`}
                onClick={() => handleViewChange('signals')}
              >
                Signals {unreadCount > 0 && <span className="tab-badge">{unreadCount}</span>}
              </button>
            </div>

            <div className="crm-controls">
              <div className="search-box">
                <span className="search-icon">🔍</span>
                <input
                  type="text"
                  placeholder={view === 'people' ? 'Search people...' : 'Search companies...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="sort-controls">
                <button 
                  className={`sort-btn ${sortBy === 'recent' ? 'active' : ''}`}
                  onClick={() => setSortBy('recent')}
                >
                  Recent
                </button>
                <button 
                  className={`sort-btn ${sortBy === 'strength' ? 'active' : ''}`}
                  onClick={() => setSortBy('strength')}
                >
                  {view === 'people' ? 'Strength' : 'Most Contacts'}
                </button>
                <button 
                  className={`sort-btn ${sortBy === 'name' ? 'active' : ''}`}
                  onClick={() => setSortBy('name')}
                >
                  A-Z
                </button>
              </div>
            </div>
          </div>

          {/* Active Filters Tags */}
          {activeFilterCount > 0 && (
            <div className="active-filters">
              {dateRange !== 'all' && (
                <span className="filter-tag">
                  {dateRangeOptions.find(o => o.value === dateRange)?.label}
                  <button onClick={() => setDateRange('all')}>×</button>
                </span>
              )}
              {selectedStrengths.map(s => (
                <span key={s} className="filter-tag">
                  {s.charAt(0).toUpperCase() + s.slice(1)} connection
                  <button onClick={() => toggleStrength(s)}>×</button>
                </span>
              ))}
              {selectedCompanies.map(c => (
                <span key={c} className="filter-tag">
                  {c}
                  <button onClick={() => toggleCompany(c)}>×</button>
                </span>
              ))}
              {selectedTitles.map(t => (
                <span key={t} className="filter-tag">
                  {t}
                  <button onClick={() => toggleTitle(t)}>×</button>
                </span>
              ))}
            </div>
          )}

          {/* People View */}
          {view === 'people' && (
            <>
              {filteredContacts.length === 0 ? (
                <div className="empty-network">
                  <div className="empty-icon">🔍</div>
                  <h2>No results</h2>
                  <p>Try adjusting your filters</p>
                  {activeFilterCount > 0 && (
                    <button className="btn-secondary" onClick={clearAllFilters}>
                      Clear all filters
                    </button>
                  )}
                </div>
              ) : (
                <>
                <div className="contacts-grid">
                  {paginatedContacts.map(contact => (
                    <Link to={`/contact/${contact.id}`} key={contact.id} className="contact-card">
                      <div className="contact-card-header">
                        <div className="contact-card-avatar contact-initials">
                          {contact.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                        </div>
                        <span className={`strength-indicator ${contact.connectionStrength}`} title={`${contact.connectionStrength} connection`} />
                      </div>
                      <div className="contact-card-body">
                        <h3 className="contact-card-name">{contact.name}</h3>
                        <p className="contact-card-company">{contact.company || contact.companyDomain}</p>
                        {contact.title && <p className="contact-card-title">{contact.title}</p>}
                      </div>
                      <div className="contact-card-stats">
                        <span className="stats-meetings">{contact.meetingsCount} meeting{contact.meetingsCount !== 1 ? 's' : ''}</span>
                        <span className="stats-last">Last: {daysSince(contact.lastContacted)}</span>
                      </div>
                      <div className="contact-card-footer">
                        <span className="contact-card-email">{contact.email}</span>
                      </div>
                    </Link>
                  ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="pagination">
                    <button 
                      className="pagination-btn"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      ← Previous
                    </button>
                    <div className="pagination-pages">
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let page: number;
                        if (totalPages <= 5) {
                          page = i + 1;
                        } else if (currentPage <= 3) {
                          page = i + 1;
                        } else if (currentPage >= totalPages - 2) {
                          page = totalPages - 4 + i;
                        } else {
                          page = currentPage - 2 + i;
                        }
                        return (
                          <button
                            key={page}
                            className={`pagination-page ${currentPage === page ? 'active' : ''}`}
                            onClick={() => setCurrentPage(page)}
                          >
                            {page}
                          </button>
                        );
                      })}
                      {totalPages > 5 && currentPage < totalPages - 2 && (
                        <>
                          <span className="pagination-ellipsis">...</span>
                          <button
                            className="pagination-page"
                            onClick={() => setCurrentPage(totalPages)}
                          >
                            {totalPages}
                          </button>
                        </>
                      )}
                    </div>
                    <button 
                      className="pagination-btn"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                    >
                      Next →
                    </button>
                  </div>
                )}
                </>
              )}
            </>
          )}

          {/* Companies View */}
          {view === 'companies' && (
            <>
              {companiesWithContacts.length === 0 ? (
                <div className="empty-network">
                  <div className="empty-icon">🏢</div>
                  <h2>No companies found</h2>
                  <p>
                    {filteredContacts.length > 0 
                      ? 'Your contacts don\'t have company information yet.'
                      : 'Try adjusting your filters'}
                  </p>
                  {activeFilterCount > 0 && (
                    <button className="btn-secondary" onClick={clearAllFilters}>
                      Clear all filters
                    </button>
                  )}
                </div>
              ) : (
                <>
                <div className="companies-list">
                  {paginatedCompanies.map(({ company, domain, contacts }, index) => (
                    <div key={company || `company-${index}`} className="company-card" style={{ padding: '1rem' }}>
                      <div 
                        style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '1rem',
                          cursor: 'pointer'
                        }}
                        onClick={() => setExpandedCompany(expandedCompany === company ? null : company)}
                      >
                        <div style={{ 
                          width: '48px', 
                          height: '48px', 
                          background: '#1d1d24', 
                          borderRadius: '8px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#ff6b4a',
                          fontWeight: 700,
                          fontSize: '1.25rem',
                          flexShrink: 0
                        }}>
                          {company ? company.charAt(0).toUpperCase() : '?'}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: '#f5f5f7', fontWeight: 600, fontSize: '1rem' }}>
                            {company || 'Unknown Company'}
                          </div>
                          <div style={{ color: '#6b6b76', fontSize: '0.8rem' }}>
                            {domain || 'No domain'}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                          <span style={{ 
                            color: '#a1a1aa', 
                            fontSize: '0.85rem',
                            background: '#1d1d24',
                            padding: '0.25rem 0.5rem',
                            borderRadius: '4px'
                          }}>
                            {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
                          </span>
                          <span style={{ color: '#6b6b76', fontSize: '0.7rem' }}>▼</span>
                        </div>
                      </div>
                      
                      {expandedCompany === company && (
                        <div className="company-contacts">
                          {contacts.map(contact => (
                            <Link to={`/contact/${contact.id}`} key={contact.id} className="company-contact-row">
                              <div className="contact-row-avatar contact-initials">
                                {contact.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                              </div>
                              <div className="contact-row-info">
                                <span className="contact-row-name">{contact.name}</span>
                                <span className="contact-row-email">{contact.email}</span>
                                {contact.title && <span className="contact-row-title">{contact.title}</span>}
                              </div>
                              <div className="contact-row-meta">
                                <span className={`strength-badge ${contact.connectionStrength}`}>
                                  {contact.connectionStrength}
                                </span>
                                <span className="contact-row-time">{daysSince(contact.lastContacted)}</span>
                              </div>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Company Pagination */}
                {totalCompanyPages > 1 && (
                  <div className="pagination">
                    <button 
                      className="pagination-btn"
                      onClick={() => setCompanyPage(p => Math.max(1, p - 1))}
                      disabled={companyPage === 1}
                    >
                      ← Previous
                    </button>
                    <div className="pagination-pages">
                      {Array.from({ length: Math.min(5, totalCompanyPages) }, (_, i) => {
                        let page: number;
                        if (totalCompanyPages <= 5) {
                          page = i + 1;
                        } else if (companyPage <= 3) {
                          page = i + 1;
                        } else if (companyPage >= totalCompanyPages - 2) {
                          page = totalCompanyPages - 4 + i;
                        } else {
                          page = companyPage - 2 + i;
                        }
                        return (
                          <button
                            key={page}
                            className={`pagination-page ${companyPage === page ? 'active' : ''}`}
                            onClick={() => setCompanyPage(page)}
                          >
                            {page}
                          </button>
                        );
                      })}
                      {totalCompanyPages > 5 && companyPage < totalCompanyPages - 2 && (
                        <>
                          <span className="pagination-ellipsis">...</span>
                          <button
                            className="pagination-page"
                            onClick={() => setCompanyPage(totalCompanyPages)}
                          >
                            {totalCompanyPages}
                          </button>
                        </>
                      )}
                    </div>
                    <button 
                      className="pagination-btn"
                      onClick={() => setCompanyPage(p => Math.min(totalCompanyPages, p + 1))}
                      disabled={companyPage === totalCompanyPages}
                    >
                      Next →
                    </button>
                  </div>
                )}
                </>
              )}
            </>
          )}

          {/* Signals View */}
          {view === 'signals' && (
            <div className="signals-view">
              {/* Signals Header */}
              <div className="signals-header">
                <div className="signals-header-left">
                  <h2>Your Signals</h2>
                  <span className="signals-count">{signals.length} active signal{signals.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="signals-header-right">
                  {signalMatches.some(m => !m.isRead) && (
                    <button className="btn-text" onClick={markAllAsRead}>
                      Mark all as read
                    </button>
                  )}
                  <button className="btn-primary" onClick={() => setShowSignalBuilder(true)}>
                    + New Signal
                  </button>
                </div>
              </div>

              {/* Active Signals Pills */}
              {signals.length > 0 && (
                <div className="signals-pills">
                  {signals.map(signal => (
                    <div 
                      key={signal.id} 
                      className={`signal-pill ${signal.isActive ? 'active' : 'inactive'}`}
                      onClick={() => setEditingSignal(signal)}
                      style={{ cursor: 'pointer' }}
                    >
                      <span className="signal-pill-icon">
                        {signal.entityType === 'person' ? '👤' : '🏢'}
                      </span>
                      <span className="signal-pill-name">{signal.name}</span>
                      {signal._count && signal._count.matches > 0 && (
                        <span className="signal-pill-badge">{signal._count.matches}</span>
                      )}
                      <button 
                        className="signal-pill-delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSignal(signal.id);
                        }}
                        title="Delete signal"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Signal Matches */}
              {signalsLoading ? (
                <div className="signals-loading">Loading signals...</div>
              ) : signalMatches.length === 0 ? (
                <div className="signals-empty">
                  <div className="empty-icon">📡</div>
                  <h2>No signals triggered yet</h2>
                  <p>
                    {signals.length === 0 
                      ? 'Create your first signal to start tracking updates about your network.'
                      : 'Your signals are active and monitoring. Updates will appear here.'}
                  </p>
                  {signals.length === 0 && (
                    <button className="btn-primary" onClick={() => setShowSignalBuilder(true)}>
                      Create Your First Signal
                    </button>
                  )}
                </div>
              ) : (
                <div className="signals-list">
                  {signalMatches.map(match => (
                    <div 
                      key={match.id} 
                      className={`signal-match-card ${match.isRead ? 'read' : 'unread'}`}
                      onClick={() => !match.isRead && markMatchAsRead(match.id)}
                    >
                      <div className="signal-match-indicator">
                        {!match.isRead && <span className="unread-dot" />}
                      </div>
                      <div className="signal-match-avatar">
                        <span className="avatar-fallback">
                          {match.entity?.name?.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase() || '?'}
                        </span>
                      </div>
                      <div className="signal-match-content">
                        <div className="signal-match-header">
                          <span className="signal-match-entity">
                            {match.entity?.name || 'Unknown'}
                          </span>
                          <span className="signal-match-signal">
                            {match.signal.name}
                          </span>
                        </div>
                        <p className="signal-match-summary">{match.summary}</p>
                        <div className="signal-match-meta">
                          <span className="signal-match-type">
                            {match.signal.entityType === 'person' ? '👤 Person' : '🏢 Company'}
                          </span>
                          <span className="signal-match-time">
                            {daysSince(new Date(match.matchedAt))}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Signal Builder Modal */}
      {showSignalBuilder && (
        <SignalBuilderModal 
          onClose={() => setShowSignalBuilder(false)}
          onSaved={() => {
            setShowSignalBuilder(false);
            fetchSignals();
          }}
        />
      )}

      {/* Signal Edit Modal */}
      {editingSignal && (
        <SignalBuilderModal 
          signal={editingSignal}
          onClose={() => setEditingSignal(null)}
          onSaved={() => {
            setEditingSignal(null);
            fetchSignals();
          }}
        />
      )}

      {/* Add Contact Modal */}
      {showAddContact && (
        <div className="modal-overlay" onClick={() => setShowAddContact(false)}>
          <div className="modal-content add-contact-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add Contact</h2>
              <button className="modal-close" onClick={() => setShowAddContact(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Name *</label>
                <input
                  type="text"
                  placeholder="John Doe"
                  value={newContact.name}
                  onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Email *</label>
                <input
                  type="email"
                  placeholder="john@company.com"
                  value={newContact.email}
                  onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Title</label>
                <input
                  type="text"
                  placeholder="Product Manager"
                  value={newContact.title}
                  onChange={(e) => setNewContact({ ...newContact, title: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Company</label>
                <input
                  type="text"
                  placeholder="Acme Inc"
                  value={newContact.company}
                  onChange={(e) => setNewContact({ ...newContact, company: e.target.value })}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowAddContact(false)}>
                Cancel
              </button>
              <button 
                className="btn-primary" 
                onClick={handleAddContact}
                disabled={!newContact.name || !newContact.email}
              >
                Add Contact
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
