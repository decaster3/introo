import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../store';
import { API_BASE } from '../lib/api';
import { calculateStrength } from '../types';
import { PromptBar } from '../components/PromptBar';
import { SuggestionCard } from '../components/SuggestionCard';
import { CommandPalette } from '../components/CommandPalette';
import { NetworkView } from '../components/NetworkView';

interface Suggestion {
  id: string;
  type: 'help_opportunity' | 'reconnect' | 'pending_ask' | 'ai_insight' | 'network_insight';
  title: string;
  description: string;
  context?: string;
  primaryAction: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  person?: {
    name: string;
    email?: string;
    avatar?: string | null;
    company?: string;
  };
  metadata?: {
    strength?: 'strong' | 'medium' | 'weak';
    timeAgo?: string;
    count?: number;
  };
}

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

type ViewMode = 'home' | 'my-network' | 'space-reach' | 'search-results';

export function AIHomePage() {
  const navigate = useNavigate();
  const { currentUser, contacts: storeContacts, requests, users } = useAppState();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [promptValue, setPromptValue] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('home');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Space data
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [spaceCompanies, setSpaceCompanies] = useState<SpaceCompany[]>([]);
  const [loadingSpaces, setLoadingSpaces] = useState(false);

  // Transform contacts for display
  const contacts = useMemo(() => {
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

  // Fetch spaces on mount
  useEffect(() => {
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
      .catch(console.error);
  }, []);

  // Fetch space companies when viewing space reach
  useEffect(() => {
    if (viewMode === 'space-reach' && spaces.length > 0) {
      setLoadingSpaces(true);
      
      // Fetch companies from all spaces
      Promise.all(
        spaces.map(space =>
          fetch(`${API_BASE}/api/spaces/${space.id}/reach`, { credentials: 'include' })
            .then(res => res.ok ? res.json() : { companies: [] })
            .catch(() => ({ companies: [] }))
        )
      ).then(results => {
        // Merge companies from all spaces
        const companyMap = new Map<string, SpaceCompany>();
        
        results.forEach(result => {
          (result.companies || []).forEach((company: SpaceCompany) => {
            if (!companyMap.has(company.domain)) {
              companyMap.set(company.domain, company);
            } else {
              // Merge contacts
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
        setLoadingSpaces(false);
      });
    }
  }, [viewMode, spaces]);

  // Transform space companies for NetworkView
  const networkSpaceCompanies = useMemo(() => {
    return spaceCompanies.map(company => ({
      domain: company.domain,
      name: company.name,
      contactCount: company.contactCount,
      hasStrongConnection: false, // Could compute from data
      contacts: company.contacts.map(c => ({
        id: c.id,
        name: c.name,
        email: c.email,
        title: c.title,
        company: company.name,
        companyDomain: company.domain,
        connectionStrength: 'medium' as const,
        userId: c.userId,
        userName: c.userName,
      })),
    }));
  }, [spaceCompanies]);

  // Generate AI suggestions based on data
  const suggestions = useMemo((): Suggestion[] => {
    const items: Suggestion[] = [];

    // Network insight - show if user has a good network
    if (contacts.length > 0 && viewMode === 'home') {
      const strongCount = contacts.filter(c => c.connectionStrength === 'strong').length;
      const companyCount = new Set(contacts.map(c => c.companyDomain)).size;
      
      items.push({
        id: 'network-insight',
        type: 'network_insight',
        title: `Your network spans ${companyCount} companies`,
        description: `${strongCount} strong connections, ${contacts.length} total contacts`,
        context: spaces.length > 0 
          ? `Plus ${spaces.length} space${spaces.length > 1 ? 's' : ''} with combined reach`
          : 'Join a space to expand your reach',
        primaryAction: {
          label: 'View my network',
          onClick: () => setViewMode('my-network'),
        },
        secondaryAction: spaces.length > 0 ? {
          label: 'View space reach',
          onClick: () => setViewMode('space-reach'),
        } : undefined,
        metadata: {
          count: companyCount,
        },
      });
    }

    // 1. Help opportunities - requests from others that match your network
    const otherRequests = requests.filter(r => r.requesterId !== currentUser?.id && r.status === 'open');
    
    otherRequests.slice(0, 3).forEach(request => {
      const requester = request.requester ?? users.find(u => u.id === request.requesterId);
      const targetDomain = request.normalizedQuery?.targetDomain;
      const matchingContacts = targetDomain 
        ? contacts.filter(c => c.companyDomain === targetDomain)
        : [];

      if (matchingContacts.length > 0) {
        items.push({
          id: `help-${request.id}`,
          type: 'help_opportunity',
          title: `${requester?.name || 'Someone'} needs an intro`,
          description: request.rawText,
          context: `You know ${matchingContacts.length} ${matchingContacts.length === 1 ? 'person' : 'people'} at ${request.normalizedQuery?.targetCompany || 'this company'}`,
          person: requester ? {
            name: requester.name,
            email: requester.email,
            avatar: requester.avatar,
          } : undefined,
          primaryAction: {
            label: 'Offer to help',
            onClick: () => navigate(`/request/${request.id}`),
          },
          secondaryAction: {
            label: 'Not now',
            onClick: () => dismissSuggestion(`help-${request.id}`),
          },
          metadata: {
            strength: matchingContacts[0].connectionStrength,
            count: matchingContacts.length,
          },
        });
      }
    });

    // 2. Reconnect suggestions - contacts you haven't talked to in a while
    const staleContacts = contacts
      .filter(c => {
        const daysSince = Math.floor((Date.now() - new Date(c.lastSeenAt).getTime()) / (1000 * 60 * 60 * 24));
        return daysSince > 30 && c.connectionStrength !== 'weak';
      })
      .slice(0, 2);

    staleContacts.forEach(contact => {
      const daysSince = Math.floor((Date.now() - new Date(contact.lastSeenAt).getTime()) / (1000 * 60 * 60 * 24));
      items.push({
        id: `reconnect-${contact.id}`,
        type: 'reconnect',
        title: `Reconnect with ${contact.name}`,
        description: `${contact.title}${contact.company ? ` at ${contact.company}` : ''}`,
        context: `Last connected ${daysSince} days ago`,
        person: {
          name: contact.name,
          email: contact.email,
          company: contact.company,
        },
        primaryAction: {
          label: 'Reach out',
          onClick: () => handleReconnect(contact.email),
        },
        secondaryAction: {
          label: 'Remind me later',
          onClick: () => dismissSuggestion(`reconnect-${contact.id}`),
        },
        metadata: {
          strength: contact.connectionStrength,
          timeAgo: `${daysSince}d`,
        },
      });
    });

    // 3. Pending asks - your open requests
    const myOpenRequests = requests.filter(r => r.requesterId === currentUser?.id && r.status === 'open');
    
    if (myOpenRequests.length > 0) {
      items.push({
        id: 'pending-asks',
        type: 'pending_ask',
        title: `Your pending asks`,
        description: myOpenRequests.map(r => r.normalizedQuery?.targetCompany || r.rawText.slice(0, 50)).join(', '),
        context: `${myOpenRequests.length} active ${myOpenRequests.length === 1 ? 'request' : 'requests'}`,
        primaryAction: {
          label: 'View all',
          onClick: () => navigate('/dashboard'),
        },
        metadata: {
          count: myOpenRequests.length,
        },
      });
    }

    return items;
  }, [requests, contacts, users, currentUser, spaces, viewMode, navigate]);

  // Keyboard shortcut for command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      }
      if (e.key === 'Escape') {
        if (viewMode !== 'home') {
          setViewMode('home');
          setSearchQuery('');
        } else {
          setIsCommandPaletteOpen(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode]);

  // Handle prompt submission - parse intent
  const handlePromptSubmit = useCallback(async (query: string) => {
    setIsProcessing(true);
    
    const lowerQuery = query.toLowerCase();
    
    // Parse user intent
    if (lowerQuery.includes('my network') || lowerQuery.includes('my contacts') || lowerQuery.includes('who do i know')) {
      setViewMode('my-network');
      setSearchQuery('');
    } else if (lowerQuery.includes('space') && (lowerQuery.includes('reach') || lowerQuery.includes('network'))) {
      setViewMode('space-reach');
      setSearchQuery('');
    } else if (lowerQuery.startsWith('who') || lowerQuery.startsWith('find') || lowerQuery.startsWith('search')) {
      // Extract search term
      const searchTerm = query
        .replace(/^(who do i know at|who do i know|find|search for|search|show me)\s*/i, '')
        .replace(/[?]/g, '')
        .trim();
      
      if (searchTerm) {
        setSearchQuery(searchTerm);
        setViewMode('search-results');
      }
    } else if (lowerQuery.includes('intro') || lowerQuery.includes('meet')) {
      // Request intro flow
      navigate('/request/new');
    } else {
      // Default to search
      setSearchQuery(query);
      setViewMode('search-results');
    }
    
    setIsProcessing(false);
    setPromptValue('');
  }, [navigate]);

  const handleReconnect = (email: string) => {
    window.open(`mailto:${email}?subject=Hey!&body=Hi! Just wanted to reconnect...`, '_blank');
  };

  const dismissSuggestion = (id: string) => {
    console.log('Dismissed:', id);
  };

  const handleContactClick = (contact: { id: string }) => {
    navigate(`/contact/${contact.id}`);
  };

  const handleRequestIntro = (company: { name: string; domain: string }) => {
    navigate(`/request/new?company=${encodeURIComponent(company.name)}&domain=${encodeURIComponent(company.domain)}`);
  };

  // Get placeholder text based on view
  const getPlaceholder = () => {
    if (viewMode === 'my-network' || viewMode === 'space-reach') {
      return 'Search companies or people...';
    }
    return 'Who do you want to meet? Try "show my network" or "space reach"';
  };

  return (
    <div className="ai-home">
      {/* Ambient background */}
      <div className="ai-home-ambient" />
      
      {/* Main content */}
      <div className="ai-home-content">
        {/* Hero section with prompt */}
        <div className={`ai-home-hero ${viewMode !== 'home' ? 'compact' : ''}`}>
          {viewMode === 'home' && (
            <>
              <h1 className="ai-home-greeting">
                {getGreeting()}, {currentUser?.name?.split(' ')[0] || 'there'}
              </h1>
              <p className="ai-home-subtitle">
                Who do you want to meet today?
              </p>
            </>
          )}
          
          <PromptBar
            value={viewMode !== 'home' ? searchQuery : promptValue}
            onChange={viewMode !== 'home' ? setSearchQuery : setPromptValue}
            onSubmit={handlePromptSubmit}
            isProcessing={isProcessing}
            placeholder={getPlaceholder()}
          />
          
          {viewMode === 'home' ? (
            <div className="ai-home-shortcuts">
              <button 
                className="shortcut-hint"
                onClick={() => setIsCommandPaletteOpen(true)}
              >
                <kbd>⌘</kbd><kbd>K</kbd>
                <span>to search anything</span>
              </button>
            </div>
          ) : (
            <div className="ai-home-back">
              <button 
                className="back-button"
                onClick={() => { setViewMode('home'); setSearchQuery(''); }}
              >
                ← Back to home
              </button>
              
              {/* View mode tabs */}
              <div className="view-mode-tabs">
                <button 
                  className={`view-mode-tab ${viewMode === 'my-network' ? 'active' : ''}`}
                  onClick={() => setViewMode('my-network')}
                >
                  👤 My Network
                </button>
                {spaces.length > 0 && (
                  <button 
                    className={`view-mode-tab ${viewMode === 'space-reach' ? 'active' : ''}`}
                    onClick={() => setViewMode('space-reach')}
                  >
                    🌐 Space Reach
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Network View (when not in home mode) */}
        {viewMode !== 'home' && (
          <NetworkView
            contacts={contacts}
            spaceCompanies={networkSpaceCompanies}
            spaces={spaces.map(s => ({
              ...s,
              contactCount: 0,
              companyCount: spaceCompanies.length,
            }))}
            isLoading={loadingSpaces}
            searchQuery={searchQuery}
            viewMode={viewMode === 'search-results' ? 'my-network' : viewMode}
            onContactClick={handleContactClick}
            onRequestIntro={handleRequestIntro}
          />
        )}

        {/* AI-driven feed (only in home mode) */}
        {viewMode === 'home' && (
          <div className="ai-home-feed">
            {suggestions.length > 0 ? (
              <>
                <div className="feed-section-header">
                  <span className="feed-section-icon">✨</span>
                  <span>Suggested for you</span>
                </div>
                
                <div className="suggestion-list">
                  {suggestions.map(suggestion => (
                    <SuggestionCard key={suggestion.id} suggestion={suggestion} />
                  ))}
                </div>
              </>
            ) : (
              <div className="ai-home-empty">
                <div className="empty-icon">🌱</div>
                <h3>Your network is growing</h3>
                <p>Connect your calendar to unlock intro suggestions</p>
              </div>
            )}
          </div>
        )}

        {/* Network stats (only in home mode) */}
        {viewMode === 'home' && (
          <div className="ai-home-stats">
            <button className="stat-item clickable" onClick={() => setViewMode('my-network')}>
              <span className="stat-value">{contacts.length}</span>
              <span className="stat-label">connections</span>
            </button>
            <div className="stat-divider" />
            <button className="stat-item clickable" onClick={() => setViewMode('my-network')}>
              <span className="stat-value">
                {contacts.filter(c => c.connectionStrength === 'strong').length}
              </span>
              <span className="stat-label">strong ties</span>
            </button>
            <div className="stat-divider" />
            <button className="stat-item clickable" onClick={() => setViewMode('my-network')}>
              <span className="stat-value">
                {new Set(contacts.map(c => c.companyDomain)).size}
              </span>
              <span className="stat-label">companies</span>
            </button>
            {spaces.length > 0 && (
              <>
                <div className="stat-divider" />
                <button className="stat-item clickable" onClick={() => setViewMode('space-reach')}>
                  <span className="stat-value">{spaces.length}</span>
                  <span className="stat-label">spaces</span>
                </button>
              </>
            )}
          </div>
        )}
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
