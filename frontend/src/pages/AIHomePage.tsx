import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../store';
import { API_BASE } from '../lib/api';
import { calculateStrength } from '../types';
import { CommandPalette } from '../components/CommandPalette';
import { PersonAvatar, CompanyLogo } from '../components';

// ============================================================================
// Types
// ============================================================================

interface SpaceCompany {
  id: string;
  domain: string;
  name: string;
  industry?: string;
  contactCount: number;
  contacts: {
    id: string;
    name: string;
    email: string;
    title?: string;
    userId: string;
    userName: string;
  }[];
}

interface Space {
  id: string;
  name: string;
  emoji: string;
  memberCount?: number;
}

interface DisplayContact {
  id: string;
  name: string;
  email: string;
  title: string;
  company: string;
  companyDomain: string;
  lastSeenAt: string;
  meetingsCount: number;
  connectionStrength: 'strong' | 'medium' | 'weak';
}

interface Company {
  domain: string;
  name: string;
  contacts: DisplayContact[];
  contactCount: number;
  hasStrongConnection: boolean;
}

interface ActiveHunt {
  id: string;
  title: string;
  query: string;
  targetRole?: string;
  targetIndustry?: string;
  targetCompanySize?: string;
  matchCount: number;
  isActive: boolean;
  createdAt: string;
}

interface Signal {
  id: string;
  type: 'job_change' | 'new_connection' | 'company_news' | 'match_found';
  title: string;
  description: string;
  timestamp: string;
  actionLabel?: string;
  actionUrl?: string;
  person?: {
    name: string;
    email?: string;
    avatar?: string;
  };
}

type NetworkTab = 'mine' | 'spaces' | 'connections';

// ============================================================================
// Component
// ============================================================================

export function AIHomePage() {
  const navigate = useNavigate();
  const { contacts: storeContacts } = useAppState();
  
  // UI State
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [networkTab, setNetworkTab] = useState<NetworkTab>('mine');
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [showAddHunt, setShowAddHunt] = useState(false);
  const [newHuntQuery, setNewHuntQuery] = useState('');
  
  // Data State
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [spaceCompanies, setSpaceCompanies] = useState<SpaceCompany[]>([]);
  const [loadingSpaces, setLoadingSpaces] = useState(true);
  const [activeHunts, setActiveHunts] = useState<ActiveHunt[]>([
    // Demo data - would come from API
    {
      id: '1',
      title: 'CTO at Series A Fintech',
      query: 'CTO OR "Chief Technology Officer" fintech series-a',
      targetRole: 'CTO',
      targetIndustry: 'fintech',
      matchCount: 0,
      isActive: true,
      createdAt: new Date().toISOString(),
    },
  ]);
  const [signals, setSignals] = useState<Signal[]>([]);

  // Transform contacts
  const contacts: DisplayContact[] = useMemo(() => {
    return storeContacts
      .filter(c => c.isApproved)
      .map(c => ({
        id: c.id,
        name: c.name || c.email.split('@')[0],
        email: c.email,
        title: c.title || '',
        company: c.company?.name || '',
        companyDomain: c.company?.domain || c.email.split('@')[1] || '',
        lastSeenAt: c.lastSeenAt,
        meetingsCount: c.meetingsCount,
        connectionStrength: calculateStrength(c.lastSeenAt, c.meetingsCount),
      }));
  }, [storeContacts]);

  // Group contacts by company
  const myCompanies = useMemo((): Company[] => {
    const companyMap = new Map<string, Company>();
    
    contacts.forEach(contact => {
      const domain = contact.companyDomain || 'unknown';
      if (!companyMap.has(domain)) {
        companyMap.set(domain, {
          domain,
          name: contact.company || domain,
          contacts: [],
          contactCount: 0,
          hasStrongConnection: false,
        });
      }
      const company = companyMap.get(domain)!;
      company.contacts.push(contact);
      company.contactCount++;
      if (contact.connectionStrength === 'strong') {
        company.hasStrongConnection = true;
      }
    });

    return Array.from(companyMap.values())
      .sort((a, b) => {
        if (a.hasStrongConnection !== b.hasStrongConnection) {
          return a.hasStrongConnection ? -1 : 1;
        }
        return b.contactCount - a.contactCount;
      });
  }, [contacts]);

  // Calculate hunt matches
  const huntsWithMatches = useMemo(() => {
    return activeHunts.map(hunt => {
      const query = hunt.query.toLowerCase();
      const keywords = query.split(/\s+or\s+|\s+/i).filter(k => k.length > 2);
      
      let matchCount = 0;
      const matchedCompanies: string[] = [];
      
      contacts.forEach(contact => {
        const searchable = `${contact.title} ${contact.company} ${contact.name}`.toLowerCase();
        if (keywords.some(k => searchable.includes(k.replace(/"/g, '')))) {
          matchCount++;
          if (!matchedCompanies.includes(contact.companyDomain)) {
            matchedCompanies.push(contact.companyDomain);
          }
        }
      });

      // Also check space companies
      spaceCompanies.forEach(company => {
        company.contacts.forEach(contact => {
          const searchable = `${contact.title} ${company.name}`.toLowerCase();
          if (keywords.some(k => searchable.includes(k.replace(/"/g, '')))) {
            matchCount++;
          }
        });
      });

      return { ...hunt, matchCount, matchedCompanies };
    });
  }, [activeHunts, contacts, spaceCompanies]);

  // Generate signals from data
  useEffect(() => {
    const newSignals: Signal[] = [];
    
    // Recent strong connections
    const strongContacts = contacts
      .filter(c => c.connectionStrength === 'strong')
      .slice(0, 2);
    
    strongContacts.forEach(contact => {
      newSignals.push({
        id: `strong-${contact.id}`,
        type: 'new_connection',
        title: `Strong connection at ${contact.company}`,
        description: `${contact.name} - ${contact.title}`,
        timestamp: contact.lastSeenAt,
        person: { name: contact.name, email: contact.email },
      });
    });

    // Hunt matches
    huntsWithMatches.forEach(hunt => {
      if (hunt.matchCount > 0) {
        newSignals.push({
          id: `match-${hunt.id}`,
          type: 'match_found',
          title: `${hunt.matchCount} matches for "${hunt.title}"`,
          description: 'People in your network match this hunt',
          timestamp: new Date().toISOString(),
          actionLabel: 'View matches',
        });
      }
    });

    setSignals(newSignals.slice(0, 5));
  }, [contacts, huntsWithMatches]);

  // Fetch spaces
  useEffect(() => {
    setLoadingSpaces(true);
    fetch(`${API_BASE}/api/spaces`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSpaces(data.map((s: any) => ({
            id: s.id,
            name: s.name,
            emoji: s.emoji,
            memberCount: s.members?.length || 0,
          })));
        }
      })
      .catch(console.error)
      .finally(() => setLoadingSpaces(false));
  }, []);

  // Fetch space companies
  useEffect(() => {
    if (spaces.length > 0) {
      Promise.all(
        spaces.map(space =>
          fetch(`${API_BASE}/api/spaces/${space.id}/reach`, { credentials: 'include' })
            .then(res => res.ok ? res.json() : { companies: [] })
            .catch(() => ({ companies: [] }))
        )
      ).then(results => {
        const companyMap = new Map<string, SpaceCompany>();
        
        results.forEach(result => {
          (result.companies || []).forEach((company: SpaceCompany) => {
            if (!companyMap.has(company.domain)) {
              companyMap.set(company.domain, company);
            } else {
              const existing = companyMap.get(company.domain)!;
              const existingEmails = new Set(existing.contacts.map(c => c.email));
              company.contacts.forEach(contact => {
                if (!existingEmails.has(contact.email)) {
                  existing.contacts.push(contact);
                  existing.contactCount++;
                }
              });
            }
          });
        });
        
        setSpaceCompanies(Array.from(companyMap.values()).sort((a, b) => b.contactCount - a.contactCount));
      });
    }
  }, [spaces]);

  // Filter companies
  const filteredCompanies = useMemo(() => {
    const companies = networkTab === 'spaces' ? spaceCompanies.map(c => ({
      ...c,
      contacts: c.contacts.map(contact => ({
        ...contact,
        title: contact.title || '',
        company: c.name,
        companyDomain: c.domain,
        lastSeenAt: new Date().toISOString(),
        meetingsCount: 0,
        connectionStrength: 'medium' as const,
      })),
      hasStrongConnection: false,
    })) : myCompanies;

    if (!searchQuery) return companies;
    
    const q = searchQuery.toLowerCase();
    return companies.filter(c => 
      c.name.toLowerCase().includes(q) ||
      c.domain.toLowerCase().includes(q) ||
      c.contacts.some(contact => 
        contact.name.toLowerCase().includes(q) ||
        contact.title?.toLowerCase().includes(q)
      )
    );
  }, [myCompanies, spaceCompanies, searchQuery, networkTab]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      }
      if (e.key === 'Escape') {
        setIsCommandPaletteOpen(false);
        setSearchQuery('');
        setShowAddHunt(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Actions
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleAddHunt = () => {
    if (!newHuntQuery.trim()) return;
    
    const newHunt: ActiveHunt = {
      id: Date.now().toString(),
      title: newHuntQuery,
      query: newHuntQuery,
      matchCount: 0,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    
    setActiveHunts(prev => [...prev, newHunt]);
    setNewHuntQuery('');
    setShowAddHunt(false);
  };

  const handleRemoveHunt = (huntId: string) => {
    setActiveHunts(prev => prev.filter(h => h.id !== huntId));
  };

  const handleRequestIntro = (companyName: string, domain: string) => {
    navigate(`/request/new?company=${encodeURIComponent(companyName)}&domain=${encodeURIComponent(domain)}`);
  };

  const handleContactClick = (contactId: string) => {
    navigate(`/contact/${contactId}`);
  };

  // Stats
  const stats = {
    myContacts: contacts.length,
    myCompanies: myCompanies.length,
    spaceCompanies: spaceCompanies.length,
    spaceContacts: spaceCompanies.reduce((sum, c) => sum + c.contactCount, 0),
    totalReach: myCompanies.length + spaceCompanies.length,
  };

  return (
    <div className="unified-home">
      {/* Ambient background */}
      <div className="unified-ambient" />

      {/* Main Layout */}
      <div className="unified-layout">
        {/* Left Panel - Active Hunts & Signals */}
        <aside className="unified-sidebar">
          {/* Active Hunts */}
          <section className="sidebar-section">
            <div className="sidebar-section-header">
              <div className="sidebar-section-title">
                <span className="section-icon">🎯</span>
                <span>Active Hunts</span>
              </div>
              <button 
                className="sidebar-action-btn"
                onClick={() => setShowAddHunt(true)}
              >
                +
              </button>
            </div>

            <div className="hunts-list">
              {huntsWithMatches.map(hunt => (
                <div key={hunt.id} className={`hunt-card ${hunt.matchCount > 0 ? 'has-matches' : ''}`}>
                  <div className="hunt-content">
                    <span className="hunt-title">{hunt.title}</span>
                    <span className="hunt-meta">
                      {hunt.matchCount > 0 ? (
                        <span className="hunt-matches">{hunt.matchCount} matches</span>
                      ) : (
                        <span className="hunt-no-matches">No matches yet</span>
                      )}
                    </span>
                  </div>
                  <button 
                    className="hunt-remove"
                    onClick={() => handleRemoveHunt(hunt.id)}
                  >
                    ×
                  </button>
                </div>
              ))}

              {showAddHunt && (
                <div className="hunt-add-form">
                  <input
                    type="text"
                    value={newHuntQuery}
                    onChange={(e) => setNewHuntQuery(e.target.value)}
                    placeholder="e.g., VP Sales at SaaS"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddHunt();
                      if (e.key === 'Escape') setShowAddHunt(false);
                    }}
                  />
                  <div className="hunt-add-actions">
                    <button onClick={handleAddHunt}>Add</button>
                    <button onClick={() => setShowAddHunt(false)}>Cancel</button>
                  </div>
                </div>
              )}

              {activeHunts.length === 0 && !showAddHunt && (
                <div className="hunts-empty">
                  <p>Add long-running searches</p>
                  <p className="hunts-empty-hint">e.g., "CTO at fintech"</p>
                </div>
              )}
            </div>
          </section>

          {/* Signals */}
          <section className="sidebar-section">
            <div className="sidebar-section-header">
              <div className="sidebar-section-title">
                <span className="section-icon">📡</span>
                <span>Signals</span>
              </div>
            </div>

            <div className="signals-list">
              {signals.length === 0 ? (
                <div className="signals-empty">
                  <p>Network signals will appear here</p>
                </div>
              ) : (
                signals.map(signal => (
                  <div key={signal.id} className={`signal-card signal-card--${signal.type}`}>
                    <div className="signal-content">
                      <span className="signal-title">{signal.title}</span>
                      <span className="signal-description">{signal.description}</span>
                    </div>
                    {signal.actionLabel && (
                      <button className="signal-action">{signal.actionLabel}</button>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Quick Stats */}
          <div className="sidebar-stats">
            <div className="sidebar-stat">
              <span className="sidebar-stat-value">{stats.myContacts}</span>
              <span className="sidebar-stat-label">contacts</span>
            </div>
            <div className="sidebar-stat">
              <span className="sidebar-stat-value">{stats.totalReach}</span>
              <span className="sidebar-stat-label">companies</span>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="unified-main">
          {/* Search Bar */}
          <div className="unified-search-wrapper">
            <div className={`unified-search ${searchFocused ? 'focused' : ''}`}>
              <div className="search-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder="Search network, find intros, or type a question..."
              />
              <div className="search-shortcuts">
                <kbd>⌘K</kbd>
              </div>
            </div>
          </div>

          {/* Network Tabs */}
          <div className="network-tabs-bar">
            <button 
              className={`network-tab-btn ${networkTab === 'mine' ? 'active' : ''}`}
              onClick={() => setNetworkTab('mine')}
            >
              <span className="tab-emoji">👤</span>
              <span>My Network</span>
              <span className="tab-badge">{stats.myCompanies}</span>
            </button>
            <button 
              className={`network-tab-btn ${networkTab === 'spaces' ? 'active' : ''}`}
              onClick={() => setNetworkTab('spaces')}
            >
              <span className="tab-emoji">🌐</span>
              <span>Spaces</span>
              <span className="tab-badge">{stats.spaceCompanies}</span>
            </button>
            <button 
              className={`network-tab-btn ${networkTab === 'connections' ? 'active' : ''}`}
              onClick={() => setNetworkTab('connections')}
            >
              <span className="tab-emoji">🤝</span>
              <span>1:1 Connections</span>
              <span className="tab-badge">0</span>
            </button>

            {/* Request Intro Button */}
            <button 
              className="request-intro-main-btn"
              onClick={() => navigate('/request/new')}
            >
              <span>✨</span>
              <span>Request Intro</span>
            </button>
          </div>

          {/* Space Pills (when on spaces tab) */}
          {networkTab === 'spaces' && spaces.length > 0 && (
            <div className="spaces-pills-bar">
              {spaces.map(space => (
                <span key={space.id} className="space-pill-item">
                  {space.emoji} {space.name}
                </span>
              ))}
              <button 
                className="add-space-btn"
                onClick={() => navigate('/spaces')}
              >
                + Join Space
              </button>
            </div>
          )}

          {/* Companies Grid */}
          <div className="companies-grid">
            {loadingSpaces && networkTab === 'spaces' ? (
              <div className="grid-loading">
                <div className="loading-spinner" />
                <span>Loading network...</span>
              </div>
            ) : filteredCompanies.length === 0 ? (
              <div className="grid-empty">
                {searchQuery ? (
                  <>
                    <span className="empty-icon">🔍</span>
                    <span>No results for "{searchQuery}"</span>
                    <button onClick={() => setSearchQuery('')}>Clear search</button>
                  </>
                ) : networkTab === 'spaces' ? (
                  <>
                    <span className="empty-icon">👥</span>
                    <span>Join spaces to see their network</span>
                    <button onClick={() => navigate('/spaces')}>Browse Spaces</button>
                  </>
                ) : (
                  <>
                    <span className="empty-icon">📅</span>
                    <span>Connect your calendar to build your network</span>
                    <button onClick={() => navigate('/connect')}>Connect Calendar</button>
                  </>
                )}
              </div>
            ) : (
              filteredCompanies.slice(0, 60).map(company => (
                <div 
                  key={company.domain} 
                  className={`company-tile ${expandedCompany === company.domain ? 'expanded' : ''}`}
                >
                  <div 
                    className="company-tile-header"
                    onClick={() => setExpandedCompany(
                      expandedCompany === company.domain ? null : company.domain
                    )}
                  >
                    <CompanyLogo domain={company.domain} name={company.name} size={32} />
                    <div className="company-tile-info">
                      <span className="company-tile-name">{company.name}</span>
                      <span className="company-tile-meta">
                        {company.contactCount} {company.contactCount === 1 ? 'person' : 'people'}
                        {company.hasStrongConnection && <span className="strong-indicator">●</span>}
                      </span>
                    </div>
                    {networkTab === 'spaces' && (
                      <button 
                        className="tile-intro-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRequestIntro(company.name, company.domain);
                        }}
                      >
                        Intro
                      </button>
                    )}
                  </div>
                  
                  {expandedCompany === company.domain && (
                    <div className="company-tile-contacts">
                      {company.contacts.slice(0, 4).map(contact => (
                        <div 
                          key={contact.id} 
                          className="tile-contact"
                          onClick={() => handleContactClick(contact.id)}
                        >
                          <PersonAvatar email={contact.email} name={contact.name} size={24} />
                          <div className="tile-contact-info">
                            <span className="tile-contact-name">{contact.name}</span>
                            <span className="tile-contact-title">{contact.title || contact.email}</span>
                          </div>
                          {'connectionStrength' in contact && (
                            <span className={`tile-strength tile-strength--${contact.connectionStrength}`}>
                              {contact.connectionStrength}
                            </span>
                          )}
                        </div>
                      ))}
                      {company.contacts.length > 4 && (
                        <div className="tile-more">+{company.contacts.length - 4} more</div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </main>
      </div>

      {/* Command Palette */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        contacts={contacts}
      />
    </div>
  );
}
