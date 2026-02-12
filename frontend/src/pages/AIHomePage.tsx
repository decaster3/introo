import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAppState } from '../store';
import { calculateStrength } from '../types';
import { PromptBar } from '../components/PromptBar';
import { SuggestionCard } from '../components/SuggestionCard';
import { CommandPalette } from '../components/CommandPalette';

interface Suggestion {
  id: string;
  type: 'help_opportunity' | 'reconnect' | 'pending_ask' | 'ai_insight';
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

export function AIHomePage() {
  const { currentUser, contacts: storeContacts, requests, users } = useAppState();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [promptValue, setPromptValue] = useState('');

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

  // Generate AI suggestions based on data
  const suggestions = useMemo((): Suggestion[] => {
    const items: Suggestion[] = [];

    // 1. Help opportunities - requests from others that match your network
    const otherRequests = requests.filter(r => r.requesterId !== currentUser?.id && r.status === 'open');
    
    otherRequests.forEach(request => {
      const requester = request.requester ?? users.find(u => u.id === request.requesterId);
      const targetDomain = request.normalizedQuery?.targetDomain;
      const matchingContacts = targetDomain 
        ? contacts.filter(c => c.companyDomain === targetDomain)
        : [];

      if (matchingContacts.length > 0 || Math.random() > 0.5) { // Show some even without matches
        items.push({
          id: `help-${request.id}`,
          type: 'help_opportunity',
          title: `${requester?.name || 'Someone'} needs an intro`,
          description: request.rawText,
          context: matchingContacts.length > 0 
            ? `You know ${matchingContacts.length} ${matchingContacts.length === 1 ? 'person' : 'people'} at ${request.normalizedQuery?.targetCompany || 'this company'}`
            : undefined,
          person: requester ? {
            name: requester.name,
            email: requester.email,
            avatar: requester.avatar,
          } : undefined,
          primaryAction: {
            label: 'Offer to help',
            onClick: () => handleOfferHelp(request.id),
          },
          secondaryAction: {
            label: 'Not now',
            onClick: () => dismissSuggestion(`help-${request.id}`),
          },
          metadata: matchingContacts.length > 0 ? {
            strength: matchingContacts[0].connectionStrength,
            count: matchingContacts.length,
          } : undefined,
        });
      }
    });

    // 2. Reconnect suggestions - contacts you haven't talked to in a while
    const staleContacts = contacts
      .filter(c => {
        const daysSince = Math.floor((Date.now() - new Date(c.lastSeenAt).getTime()) / (1000 * 60 * 60 * 24));
        return daysSince > 30 && c.connectionStrength !== 'weak';
      })
      .slice(0, 3);

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
          onClick: () => window.location.href = '/requests',
        },
        metadata: {
          count: myOpenRequests.length,
        },
      });
    }

    return items;
  }, [requests, contacts, users, currentUser]);

  // Keyboard shortcut for command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      }
      if (e.key === 'Escape') {
        setIsCommandPaletteOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handlePromptSubmit = useCallback(async (query: string) => {
    setIsProcessing(true);
    
    // Simulate AI processing
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // TODO: Integrate with actual AI/search backend
    console.log('Processing query:', query);
    
    setIsProcessing(false);
    setPromptValue('');
  }, []);

  const handleOfferHelp = (requestId: string) => {
    // Navigate to request detail or open email
    window.location.href = `/request/${requestId}`;
  };

  const handleReconnect = (email: string) => {
    window.open(`mailto:${email}?subject=Hey!&body=Hi! Just wanted to reconnect...`, '_blank');
  };

  const dismissSuggestion = (id: string) => {
    // TODO: Persist dismissal
    console.log('Dismissed:', id);
  };

  return (
    <div className="ai-home">
      {/* Ambient background */}
      <div className="ai-home-ambient" />
      
      {/* Main content */}
      <div className="ai-home-content">
        {/* Hero section with prompt */}
        <div className="ai-home-hero">
          <h1 className="ai-home-greeting">
            {getGreeting()}, {currentUser?.name?.split(' ')[0] || 'there'}
          </h1>
          <p className="ai-home-subtitle">
            Who do you want to meet today?
          </p>
          
          <PromptBar
            value={promptValue}
            onChange={setPromptValue}
            onSubmit={handlePromptSubmit}
            isProcessing={isProcessing}
            placeholder="I need an intro to the CTO at Stripe..."
          />
          
          <div className="ai-home-shortcuts">
            <button 
              className="shortcut-hint"
              onClick={() => setIsCommandPaletteOpen(true)}
            >
              <kbd>⌘</kbd><kbd>K</kbd>
              <span>to search anything</span>
            </button>
          </div>
        </div>

        {/* AI-driven feed */}
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

        {/* Network stats (minimal) */}
        <div className="ai-home-stats">
          <div className="stat-item">
            <span className="stat-value">{contacts.length}</span>
            <span className="stat-label">connections</span>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <span className="stat-value">
              {contacts.filter(c => c.connectionStrength === 'strong').length}
            </span>
            <span className="stat-label">strong ties</span>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <span className="stat-value">
              {new Set(contacts.map(c => c.companyDomain)).size}
            </span>
            <span className="stat-label">companies</span>
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
