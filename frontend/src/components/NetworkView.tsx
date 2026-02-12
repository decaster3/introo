import { useState, useMemo } from 'react';
import { PersonAvatar } from './PersonAvatar';
import { CompanyLogo } from './CompanyLogo';

interface Contact {
  id: string;
  name: string;
  email: string;
  title?: string;
  company?: string;
  companyDomain?: string;
  connectionStrength: 'strong' | 'medium' | 'weak';
  userId?: string;
  userName?: string;
}

interface Company {
  domain: string;
  name: string;
  contacts: Contact[];
  contactCount: number;
  hasStrongConnection: boolean;
}

interface Space {
  id: string;
  name: string;
  emoji: string;
  memberCount?: number;
  contactCount?: number;
  companyCount?: number;
}

interface NetworkViewProps {
  contacts: Contact[];
  spaceCompanies?: Company[];
  spaces?: Space[];
  isLoading?: boolean;
  searchQuery?: string;
  viewMode: 'my-network' | 'space-reach' | 'search-results';
  onContactClick?: (contact: Contact) => void;
  onRequestIntro?: (company: Company, contact?: Contact) => void;
}

export function NetworkView({
  contacts,
  spaceCompanies = [],
  spaces = [],
  isLoading,
  searchQuery,
  viewMode,
  onContactClick,
  onRequestIntro,
}: NetworkViewProps) {
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'companies' | 'people'>('companies');

  // Group my contacts by company
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
        // Strong connections first, then by contact count
        if (a.hasStrongConnection !== b.hasStrongConnection) {
          return a.hasStrongConnection ? -1 : 1;
        }
        return b.contactCount - a.contactCount;
      });
  }, [contacts]);

  // Filter based on search
  const filteredCompanies = useMemo(() => {
    const companies = viewMode === 'space-reach' ? spaceCompanies : myCompanies;
    if (!searchQuery) return companies.slice(0, 20);
    
    const query = searchQuery.toLowerCase();
    return companies.filter(c => 
      c.name.toLowerCase().includes(query) ||
      c.domain.toLowerCase().includes(query) ||
      c.contacts.some(contact => 
        contact.name.toLowerCase().includes(query) ||
        contact.title?.toLowerCase().includes(query)
      )
    ).slice(0, 20);
  }, [myCompanies, spaceCompanies, searchQuery, viewMode]);

  const filteredContacts = useMemo(() => {
    if (!searchQuery) return contacts.slice(0, 30);
    
    const query = searchQuery.toLowerCase();
    return contacts.filter(c =>
      c.name.toLowerCase().includes(query) ||
      c.email.toLowerCase().includes(query) ||
      c.company?.toLowerCase().includes(query) ||
      c.title?.toLowerCase().includes(query)
    ).slice(0, 30);
  }, [contacts, searchQuery]);

  // Stats
  const stats = useMemo(() => {
    if (viewMode === 'space-reach') {
      const totalContacts = spaceCompanies.reduce((sum, c) => sum + c.contactCount, 0);
      return {
        companies: spaceCompanies.length,
        contacts: totalContacts,
        strongConnections: spaceCompanies.filter(c => c.hasStrongConnection).length,
      };
    }
    return {
      companies: myCompanies.length,
      contacts: contacts.length,
      strongConnections: contacts.filter(c => c.connectionStrength === 'strong').length,
    };
  }, [viewMode, spaceCompanies, myCompanies, contacts]);

  if (isLoading) {
    return (
      <div className="network-view network-view--loading">
        <div className="network-loading">
          <div className="network-loading-spinner" />
          <span>Loading your network...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="network-view">
      {/* Header with stats */}
      <div className="network-header">
        <div className="network-title">
          {viewMode === 'space-reach' ? (
            <>
              <span className="network-title-icon">🌐</span>
              <span>Combined Space Reach</span>
            </>
          ) : viewMode === 'search-results' ? (
            <>
              <span className="network-title-icon">🔍</span>
              <span>Search Results</span>
            </>
          ) : (
            <>
              <span className="network-title-icon">👤</span>
              <span>Your Network</span>
            </>
          )}
        </div>
        
        <div className="network-stats-mini">
          <span className="network-stat">
            <strong>{stats.companies}</strong> companies
          </span>
          <span className="network-stat-divider">•</span>
          <span className="network-stat">
            <strong>{stats.contacts}</strong> people
          </span>
          <span className="network-stat-divider">•</span>
          <span className="network-stat">
            <strong>{stats.strongConnections}</strong> strong
          </span>
        </div>
      </div>

      {/* View toggle */}
      <div className="network-tabs">
        <button 
          className={`network-tab ${activeTab === 'companies' ? 'active' : ''}`}
          onClick={() => setActiveTab('companies')}
        >
          Companies
        </button>
        <button 
          className={`network-tab ${activeTab === 'people' ? 'active' : ''}`}
          onClick={() => setActiveTab('people')}
        >
          People
        </button>
      </div>

      {/* Space pills (if showing space reach) */}
      {viewMode === 'space-reach' && spaces.length > 0 && (
        <div className="network-spaces">
          {spaces.map(space => (
            <div key={space.id} className="network-space-pill">
              <span className="space-emoji">{space.emoji}</span>
              <span className="space-name">{space.name}</span>
              <span className="space-count">{space.companyCount} companies</span>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="network-content">
        {activeTab === 'companies' ? (
          <div className="network-companies">
            {filteredCompanies.length === 0 ? (
              <div className="network-empty">
                <span className="network-empty-icon">🏢</span>
                <span>No companies found</span>
              </div>
            ) : (
              filteredCompanies.map(company => (
                <div 
                  key={company.domain} 
                  className={`network-company-card ${expandedCompany === company.domain ? 'expanded' : ''}`}
                >
                  <div 
                    className="network-company-header"
                    onClick={() => setExpandedCompany(
                      expandedCompany === company.domain ? null : company.domain
                    )}
                  >
                    <CompanyLogo domain={company.domain} name={company.name} size={40} />
                    <div className="network-company-info">
                      <span className="network-company-name">{company.name}</span>
                      <span className="network-company-meta">
                        {company.contactCount} {company.contactCount === 1 ? 'contact' : 'contacts'}
                        {company.hasStrongConnection && (
                          <span className="strong-badge">● Strong</span>
                        )}
                      </span>
                    </div>
                    <div className="network-company-actions">
                      {viewMode === 'space-reach' && onRequestIntro && (
                        <button 
                          className="network-action-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRequestIntro(company);
                          }}
                        >
                          Request Intro
                        </button>
                      )}
                      <span className={`expand-indicator ${expandedCompany === company.domain ? 'expanded' : ''}`}>
                        ▾
                      </span>
                    </div>
                  </div>
                  
                  {expandedCompany === company.domain && (
                    <div className="network-company-contacts">
                      {company.contacts.slice(0, 5).map(contact => (
                        <div 
                          key={contact.id} 
                          className="network-contact-row"
                          onClick={() => onContactClick?.(contact)}
                        >
                          <PersonAvatar
                            email={contact.email}
                            name={contact.name}
                            size={32}
                          />
                          <div className="network-contact-info">
                            <span className="network-contact-name">{contact.name}</span>
                            <span className="network-contact-title">
                              {contact.title || contact.email}
                              {contact.userName && viewMode === 'space-reach' && (
                                <span className="via-badge">via {contact.userName}</span>
                              )}
                            </span>
                          </div>
                          <span className={`strength-indicator strength-indicator--${contact.connectionStrength}`}>
                            {contact.connectionStrength}
                          </span>
                        </div>
                      ))}
                      {company.contacts.length > 5 && (
                        <div className="network-contact-more">
                          +{company.contacts.length - 5} more
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="network-people">
            {filteredContacts.length === 0 ? (
              <div className="network-empty">
                <span className="network-empty-icon">👤</span>
                <span>No people found</span>
              </div>
            ) : (
              filteredContacts.map(contact => (
                <div 
                  key={contact.id} 
                  className="network-person-card"
                  onClick={() => onContactClick?.(contact)}
                >
                  <PersonAvatar
                    email={contact.email}
                    name={contact.name}
                    size={44}
                  />
                  <div className="network-person-info">
                    <span className="network-person-name">{contact.name}</span>
                    <span className="network-person-title">
                      {contact.title}
                      {contact.company && ` at ${contact.company}`}
                    </span>
                  </div>
                  <span className={`strength-indicator strength-indicator--${contact.connectionStrength}`}>
                    {contact.connectionStrength}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
