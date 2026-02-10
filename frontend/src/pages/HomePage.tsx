import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppState } from '../store';

// Display-friendly contact interface (derived from store Contact)
export interface Contact {
  id: string;
  name: string;
  email: string;
  avatar: string;
  title: string;
  company: string;
  companyDomain: string;
  linkedinUrl?: string;
  lastContacted: Date;
  connectionStrength: 'strong' | 'medium' | 'weak';
}

// Alias for backward compatibility
type DisplayContact = Contact;

interface Space {
  id: string;
  name: string;
  emoji: string;
  members: { user: { id: string; name: string; avatar: string | null } }[];
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function calculateStrength(lastSeenAt: string, meetingsCount: number): 'strong' | 'medium' | 'weak' {
  const daysSince = Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / (1000 * 60 * 60 * 24));
  if (daysSince <= 7 && meetingsCount >= 3) return 'strong';
  if (daysSince <= 30 && meetingsCount >= 2) return 'medium';
  return 'weak';
}

export function HomePage() {
  const { currentUser, contacts: storeContacts, requests, offers, users } = useAppState();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [spacesLoading, setSpacesLoading] = useState(true);
  const [spacesError, setSpacesError] = useState<string | null>(null);
  const [askText, setAskText] = useState('');
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>('');

  // Transform store contacts to display format - only real data
  const contacts: DisplayContact[] = useMemo(() => {
    return storeContacts
      .filter(c => c.isApproved)
      .map(c => ({
        id: c.id,
        name: c.name || c.email.split('@')[0],
        email: c.email,
        avatar: '', // No fake avatars
        title: c.title || '',
        company: c.company?.name || '',
        companyDomain: c.company?.domain || c.email.split('@')[1] || '',
        lastContacted: new Date(c.lastSeenAt),
        connectionStrength: calculateStrength(c.lastSeenAt, c.meetingsCount),
      }));
  }, [storeContacts]);

  // Build user to space mapping from real spaces data
  const userSpaceMap = useMemo(() => {
    const map: Record<string, { id: string; name: string; emoji: string }> = {};
    spaces.forEach(space => {
      space.members.forEach(member => {
        map[member.user.id] = { id: space.id, name: space.name, emoji: space.emoji };
      });
    });
    return map;
  }, [spaces]);

  useEffect(() => {
    setSpacesLoading(true);
    setSpacesError(null);
    fetch('/api/spaces', { credentials: 'include' })
      .then(res => {
        if (!res.ok) throw new Error('Failed to load spaces');
        return res.json();
      })
      .then(data => {
        setSpaces(Array.isArray(data) ? data : []);
        setSpacesLoading(false);
      })
      .catch((err) => {
        setSpacesError(err.message);
        setSpacesLoading(false);
        setSpaces([]);
      });
  }, []);

  // My requests
  const myRequests = useMemo(() => {
    return requests
      .filter(r => r.requesterId === currentUser?.id)
      .map(r => ({
        ...r,
        offersCount: offers.filter(o => o.requestId === r.id).length,
        pendingOffers: offers.filter(o => o.requestId === r.id && o.status === 'pending').length,
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [requests, offers, currentUser]);

  // Community requests where I have a matching contact (Suggested for you)
  const suggestedRequests = useMemo(() => {
    return requests
      .filter(r => r.requesterId !== currentUser?.id && r.status === 'open')
      .map(r => {
        const targetDomain = r.normalizedQuery?.targetDomain;
        const matchingContacts = targetDomain 
          ? contacts.filter(c => c.companyDomain === targetDomain)
          : [];
        return {
          request: r,
          requester: users.find(u => u.id === r.requesterId),
          matchingContacts,
        };
      })
      .filter(item => item.matchingContacts.length > 0)
      .sort((a, b) => new Date(b.request.createdAt).getTime() - new Date(a.request.createdAt).getTime());
  }, [requests, users, currentUser]);

  // Other community requests (no matching contacts)
  const communityRequests = useMemo(() => {
    return requests
      .filter(r => r.requesterId !== currentUser?.id && r.status === 'open')
      .map(r => {
        const targetDomain = r.normalizedQuery?.targetDomain;
        const matchingContacts = targetDomain 
          ? contacts.filter(c => c.companyDomain === targetDomain)
          : [];
        return {
          request: r,
          requester: users.find(u => u.id === r.requesterId),
          matchingContacts,
        };
      })
      .filter(item => item.matchingContacts.length === 0)
      .sort((a, b) => new Date(b.request.createdAt).getTime() - new Date(a.request.createdAt).getTime());
  }, [requests, users, currentUser]);

  const handleAskSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!askText.trim() || !selectedSpaceId) return;
    window.location.href = `/request/new?text=${encodeURIComponent(askText)}&spaceId=${selectedSpaceId}`;
  };

  const uniqueCompanies = new Set(contacts.map(c => c.company));

  return (
    <div className="home-feed">
      {/* Quick Stats Bar */}
      <div className="stats-bar">
        <Link to="/network" className="stat-item clickable">
          <span className="stat-value">{contacts.length}</span>
          <span className="stat-label">Contacts</span>
        </Link>
        <Link to="/network?view=companies" className="stat-item clickable">
          <span className="stat-value">{uniqueCompanies.size}</span>
          <span className="stat-label">Companies</span>
        </Link>
        <Link to="/spaces" className="stat-item clickable">
          <span className="stat-value">{spacesLoading ? '...' : spaces.length}</span>
          <span className="stat-label">Spaces</span>
        </Link>
        <div className="stat-item">
          <span className="stat-value">{myRequests.filter(r => r.status === 'open').length}</span>
          <span className="stat-label">Active Asks</span>
        </div>
      </div>

      {/* Compose Box */}
      <div className="compose-box">
        <form onSubmit={handleAskSubmit}>
          <div className="compose-input-row">
            {currentUser?.avatar ? (
              <img src={currentUser.avatar} alt="" className="compose-avatar" referrerPolicy="no-referrer" />
            ) : (
              <div className="compose-avatar fallback">{currentUser?.name?.charAt(0)}</div>
            )}
            <input
              type="text"
              placeholder="Who do you want to meet? (e.g., 'Intro to someone at Stripe')"
              value={askText}
              onChange={(e) => setAskText(e.target.value)}
            />
          </div>
          <div className="compose-actions-row">
            <select 
              className="space-select"
              value={selectedSpaceId}
              onChange={(e) => setSelectedSpaceId(e.target.value)}
              disabled={spacesLoading}
            >
              <option value="">
                {spacesLoading ? 'Loading spaces...' : spacesError ? 'Error loading spaces' : 'Select Space'}
              </option>
              {spaces.map(space => (
                <option key={space.id} value={space.id}>
                  {space.emoji} {space.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn-primary" disabled={!askText.trim() || !selectedSpaceId}>
              Ask
            </button>
          </div>
        </form>
      </div>

      {/* Section: Your Requests */}
      {myRequests.length > 0 && (
        <div className="feed-section">
          <div className="section-header">
            <h2>Your Requests</h2>
            <span className="section-count">{myRequests.filter(r => r.status === 'open').length} active</span>
          </div>
          <div className="section-content">
            {myRequests.slice(0, 3).map(request => (
              <Link to={`/request/${request.id}`} key={request.id} className="request-card my-request">
                <div className="request-card-header">
                  <span className={`status-badge ${request.status}`}>{request.status}</span>
                  {request.bidAmount > 0 && <span className="bounty-badge">${request.bidAmount}</span>}
                  <span className="request-time">{timeAgo(new Date(request.createdAt))}</span>
                </div>
                <p className="request-text">{request.rawText}</p>
                {request.space && (
                  <div className="request-space-tag">
                    <span className="space-emoji">{request.space.emoji}</span>
                    <span className="space-name">{request.space.name}</span>
                  </div>
                )}
                {request.pendingOffers > 0 ? (
                  <div className="request-notification success">
                    {request.pendingOffers} offer{request.pendingOffers > 1 ? 's' : ''} waiting for review
                  </div>
                ) : request.status === 'open' ? (
                  <div className="request-notification muted">Waiting for offers...</div>
                ) : null}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Section: Suggested For You */}
      {suggestedRequests.length > 0 && (
        <div className="feed-section suggested">
          <div className="section-header">
            <h2>Suggested For You</h2>
            <span className="section-subtitle">You know someone who can help</span>
          </div>
          <div className="section-content">
            {suggestedRequests.map(({ request, requester, matchingContacts }) => {
              const requesterSpace = requester?.id ? userSpaceMap[requester.id] : null;
              return (
              <div key={request.id} className="request-card suggestion">
                <div className="request-card-header">
                  <div className="requester-info">
                    {requester?.avatar ? (
                      <img src={requester.avatar} alt="" className="requester-avatar" />
                    ) : (
                      <div className="requester-avatar fallback">{requester?.name?.charAt(0)}</div>
                    )}
                    <span className="requester-name">{requester?.name}</span>
                      {requesterSpace && (
                        <span className="space-tag">{requesterSpace.emoji} {requesterSpace.name}</span>
                      )}
                  </div>
                  {request.bidAmount > 0 && <span className="bounty-badge">${request.bidAmount}</span>}
                </div>
                <p className="request-text">{request.rawText}</p>
                
                {/* Show matching contacts */}
                <div className="suggestion-box">
                  <div className="suggestion-label">You know:</div>
                  {matchingContacts.slice(0, 2).map(contact => (
                    <div key={contact.id} className="contact-suggestion">
                      <div className="contact-avatar contact-initials">
                        {contact.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                      </div>
                      <div className="contact-info">
                        <span className="contact-name">{contact.name}</span>
                        <span className="contact-title">{contact.company || contact.companyDomain}</span>
                      </div>
                      <span className={`connection-strength ${contact.connectionStrength}`}>
                        {contact.connectionStrength}
                      </span>
                    </div>
                  ))}
                </div>
                
                <div className="request-actions">
                  <Link to={`/request/${request.id}`} className="btn-secondary">View Details</Link>
                  <button className="btn-primary">Offer Intro</button>
                </div>
              </div>
            );
            })}
          </div>
        </div>
      )}

      {/* Section: Community Asks */}
      {communityRequests.length > 0 && (
        <div className="feed-section">
          <div className="section-header">
            <h2>Community Asks</h2>
            <span className="section-count">{communityRequests.length} requests</span>
          </div>
          <div className="section-content">
            {communityRequests.map(({ request, requester }) => {
              const requesterSpace = requester?.id ? userSpaceMap[requester.id] : null;
              return (
              <div key={request.id} className="request-card community">
                <div className="request-card-header">
                  <div className="requester-info">
                    {requester?.avatar ? (
                      <img src={requester.avatar} alt="" className="requester-avatar" />
                    ) : (
                      <div className="requester-avatar fallback">{requester?.name?.charAt(0)}</div>
                    )}
                    <span className="requester-name">{requester?.name}</span>
                    {requesterSpace && (
                      <span className="space-tag">{requesterSpace.emoji} {requesterSpace.name}</span>
                    )}
                    <span className="request-time">{timeAgo(new Date(request.createdAt))}</span>
                  </div>
                  {request.bidAmount > 0 && <span className="bounty-badge">${request.bidAmount}</span>}
                </div>
                <p className="request-text">{request.rawText}</p>
                <div className="request-actions">
                  <Link to={`/request/${request.id}`} className="btn-text-link">View</Link>
                </div>
              </div>
            );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {myRequests.length === 0 && suggestedRequests.length === 0 && communityRequests.length === 0 && (
        <div className="empty-feed">
          <div className="empty-icon">🌱</div>
          <h3>Nothing here yet</h3>
          <p>Ask for an intro or join a space to see activity!</p>
        </div>
      )}
    </div>
  );
}
