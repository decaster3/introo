import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../store';
import { API_BASE } from '../lib/api';
import { calculateStrength } from '../types';
import { PromptBar } from '../components/PromptBar';
import { CommandPalette } from '../components/CommandPalette';
import { PersonAvatar, CompanyLogo } from '../components';

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

export function AIHomePage() {
  const navigate = useNavigate();
  const { currentUser, contacts: storeContacts } = useAppState();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [promptValue, setPromptValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeNetworkTab, setActiveNetworkTab] = useState<'mine' | 'spaces'>('mine');
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  
  // Space data
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [spaceCompanies, setSpaceCompanies] = useState<SpaceCompany[]>([]);
  const [loadingSpaces, setLoadingSpaces] = useState(true);

  // Transform contacts for display
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

  // Fetch spaces on mount
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
        
        setSpaceCompanies(
          Array.from(companyMap.values())
            .sort((a, b) => b.contactCount - a.contactCount)
        );
      });
    }
  }, [spaces]);

  // Filter companies based on search
  const filteredMyCompanies = useMemo(() => {
    if (!searchQuery) return myCompanies;
    const q = searchQuery.toLowerCase();
    return myCompanies.filter(c => 
      c.name.toLowerCase().includes(q) ||
      c.domain.toLowerCase().includes(q) ||
      c.contacts.some(contact => 
        contact.name.toLowerCase().includes(q) ||
        contact.title?.toLowerCase().includes(q)
      )
    );
  }, [myCompanies, searchQuery]);

  const filteredSpaceCompanies = useMemo(() => {
    if (!searchQuery) return spaceCompanies;
    const q = searchQuery.toLowerCase();
    return spaceCompanies.filter(c => 
      c.name.toLowerCase().includes(q) ||
      c.domain.toLowerCase().includes(q) ||
      c.contacts.some(contact => 
        contact.name.toLowerCase().includes(q) ||
        contact.title?.toLowerCase().includes(q)
      )
    );
  }, [spaceCompanies, searchQuery]);

  // Keyboard shortcut for command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      }
      if (e.key === 'Escape') {
        setIsCommandPaletteOpen(false);
        setSearchQuery('');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handlePromptSubmit = useCallback(async (query: string) => {
    setIsProcessing(true);
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('intro') || lowerQuery.includes('meet') || lowerQuery.includes('need')) {
      navigate('/request/new');
    } else {
      setSearchQuery(query);
    }
    
    setIsProcessing(false);
    setPromptValue('');
  }, [navigate]);

  const handleContactClick = (contactId: string) => {
    navigate(`/contact/${contactId}`);
  };

  const handleRequestIntro = (companyName: string, domain: string) => {
    navigate(`/request/new?company=${encodeURIComponent(companyName)}&domain=${encodeURIComponent(domain)}`);
  };

  // Stats
  const myNetworkStats = {
    companies: myCompanies.length,
    contacts: contacts.length,
    strong: contacts.filter(c => c.connectionStrength === 'strong').length,
  };

  const spaceNetworkStats = {
    companies: spaceCompanies.length,
    contacts: spaceCompanies.reduce((sum, c) => sum + c.contactCount, 0),
    spaces: spaces.length,
  };

  return (
    <div className="ai-home">
      {/* Ambient background */}
      <div className="ai-home-ambient" />
      
      {/* Main content */}
      <div className="ai-home-content ai-home-content--full">
        {/* Compact header with prompt */}
        <div className="ai-home-header">
          <div className="ai-home-brand">
            <h1 className="ai-home-title">
              {getGreeting()}, {currentUser?.name?.split(' ')[0] || 'there'}
            </h1>
            <button 
              className="shortcut-btn"
              onClick={() => setIsCommandPaletteOpen(true)}
            >
              <kbd>⌘K</kbd>
            </button>
          </div>
          
          <PromptBar
            value={searchQuery || promptValue}
            onChange={(v) => {
              setPromptValue(v);
              setSearchQuery(v);
            }}
            onSubmit={handlePromptSubmit}
            isProcessing={isProcessing}
            placeholder="Search companies, people, or ask for an intro..."
          />
        </div>

        {/* Network Section */}
        <div className="network-section">
          {/* Tabs */}
          <div className="network-section-header">
            <div className="network-section-tabs">
              <button 
                className={`network-section-tab ${activeNetworkTab === 'mine' ? 'active' : ''}`}
                onClick={() => setActiveNetworkTab('mine')}
              >
                <span className="tab-icon">👤</span>
                <span className="tab-label">My Network</span>
                <span className="tab-count">{myNetworkStats.companies}</span>
              </button>
              <button 
                className={`network-section-tab ${activeNetworkTab === 'spaces' ? 'active' : ''}`}
                onClick={() => setActiveNetworkTab('spaces')}
              >
                <span className="tab-icon">🌐</span>
                <span className="tab-label">Space Reach</span>
                <span className="tab-count">{spaceNetworkStats.companies}</span>
              </button>
            </div>
            
            <div className="network-section-stats">
              {activeNetworkTab === 'mine' ? (
                <>
                  <span>{myNetworkStats.contacts} people</span>
                  <span className="stat-separator">•</span>
                  <span className="stat-highlight">{myNetworkStats.strong} strong</span>
                </>
              ) : (
                <>
                  <span>{spaceNetworkStats.contacts} people</span>
                  <span className="stat-separator">•</span>
                  <span>{spaceNetworkStats.spaces} spaces</span>
                </>
              )}
            </div>
          </div>

          {/* Space pills when viewing space reach */}
          {activeNetworkTab === 'spaces' && spaces.length > 0 && (
            <div className="space-pills">
              {spaces.map(space => (
                <span key={space.id} className="space-pill">
                  {space.emoji} {space.name}
                </span>
              ))}
            </div>
          )}

          {/* Companies grid */}
          <div className="network-grid">
            {activeNetworkTab === 'mine' ? (
              filteredMyCompanies.length === 0 ? (
                <div className="network-empty-state">
                  {searchQuery ? (
                    <>
                      <span className="empty-icon">🔍</span>
                      <span>No companies match "{searchQuery}"</span>
                    </>
                  ) : (
                    <>
                      <span className="empty-icon">📅</span>
                      <span>Connect your calendar to see your network</span>
                      <button className="btn-primary" onClick={() => navigate('/connect')}>
                        Connect Calendar
                      </button>
                    </>
                  )}
                </div>
              ) : (
                filteredMyCompanies.slice(0, 50).map(company => (
                  <div 
                    key={company.domain} 
                    className={`company-card ${expandedCompany === company.domain ? 'expanded' : ''}`}
                  >
                    <div 
                      className="company-card-header"
                      onClick={() => setExpandedCompany(
                        expandedCompany === company.domain ? null : company.domain
                      )}
                    >
                      <CompanyLogo domain={company.domain} name={company.name} size={36} />
                      <div className="company-card-info">
                        <span className="company-card-name">{company.name}</span>
                        <span className="company-card-meta">
                          {company.contactCount} {company.contactCount === 1 ? 'contact' : 'contacts'}
                          {company.hasStrongConnection && <span className="strong-dot" />}
                        </span>
                      </div>
                      <span className={`expand-chevron ${expandedCompany === company.domain ? 'open' : ''}`}>
                        ▾
                      </span>
                    </div>
                    
                    {expandedCompany === company.domain && (
                      <div className="company-card-contacts">
                        {company.contacts.slice(0, 5).map(contact => (
                          <div 
                            key={contact.id} 
                            className="contact-row"
                            onClick={() => handleContactClick(contact.id)}
                          >
                            <PersonAvatar email={contact.email} name={contact.name} size={28} />
                            <div className="contact-row-info">
                              <span className="contact-row-name">{contact.name}</span>
                              <span className="contact-row-title">{contact.title || contact.email}</span>
                            </div>
                            <span className={`strength-badge strength-badge--${contact.connectionStrength}`}>
                              {contact.connectionStrength}
                            </span>
                          </div>
                        ))}
                        {company.contacts.length > 5 && (
                          <div className="contact-row-more">+{company.contacts.length - 5} more</div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )
            ) : (
              loadingSpaces ? (
                <div className="network-loading">
                  <div className="spinner" />
                  <span>Loading space reach...</span>
                </div>
              ) : filteredSpaceCompanies.length === 0 ? (
                <div className="network-empty-state">
                  {searchQuery ? (
                    <>
                      <span className="empty-icon">🔍</span>
                      <span>No companies match "{searchQuery}"</span>
                    </>
                  ) : spaces.length === 0 ? (
                    <>
                      <span className="empty-icon">👥</span>
                      <span>Join a space to see combined network</span>
                      <button className="btn-primary" onClick={() => navigate('/spaces')}>
                        Browse Spaces
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="empty-icon">🏢</span>
                      <span>No companies in your spaces yet</span>
                    </>
                  )}
                </div>
              ) : (
                filteredSpaceCompanies.slice(0, 50).map(company => (
                  <div 
                    key={company.domain} 
                    className={`company-card company-card--space ${expandedCompany === company.domain ? 'expanded' : ''}`}
                  >
                    <div 
                      className="company-card-header"
                      onClick={() => setExpandedCompany(
                        expandedCompany === company.domain ? null : company.domain
                      )}
                    >
                      <CompanyLogo domain={company.domain} name={company.name} size={36} />
                      <div className="company-card-info">
                        <span className="company-card-name">{company.name}</span>
                        <span className="company-card-meta">
                          {company.contactCount} {company.contactCount === 1 ? 'contact' : 'contacts'}
                        </span>
                      </div>
                      <button 
                        className="request-intro-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRequestIntro(company.name, company.domain);
                        }}
                      >
                        Request Intro
                      </button>
                      <span className={`expand-chevron ${expandedCompany === company.domain ? 'open' : ''}`}>
                        ▾
                      </span>
                    </div>
                    
                    {expandedCompany === company.domain && (
                      <div className="company-card-contacts">
                        {company.contacts.slice(0, 5).map(contact => (
                          <div key={contact.id} className="contact-row">
                            <PersonAvatar email={contact.email} name={contact.name} size={28} />
                            <div className="contact-row-info">
                              <span className="contact-row-name">{contact.name}</span>
                              <span className="contact-row-title">
                                {contact.title || 'Contact'}
                                <span className="via-tag">via {contact.userName}</span>
                              </span>
                            </div>
                          </div>
                        ))}
                        {company.contacts.length > 5 && (
                          <div className="contact-row-more">+{company.contacts.length - 5} more</div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )
            )}
          </div>
        </div>
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

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
