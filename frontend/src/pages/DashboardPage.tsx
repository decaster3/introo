import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppState } from '../store';
import { calculateStrengthScore } from '../lib/matching';
import { PersonAvatar } from '../components';
import { openOfferIntroEmail } from '../lib/offerIntro';

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function DashboardPage() {
  const { isCalendarConnected, relationships, currentUserId, requests, offers, currentUser, users } = useAppState();

  const [showAllMembers, setShowAllMembers] = useState(false);

  // Extract unique companies from relationships
  const companies = useMemo(() => {
    const companyMap = new Map<string, any>();
    relationships.forEach(r => {
      if (r.company && !companyMap.has(r.company.id)) {
        companyMap.set(r.company.id, r.company);
      }
    });
    return Array.from(companyMap.values());
  }, [relationships]);

  // Build intro paths from relationships (other users' connections)
  // Used for future feature - keeping for reference
  const _introPaths = useMemo(() => {
    const paths: Array<{
      introducer: any;
      company: any;
      edge: typeof relationships[0];
      strength: number;
    }> = [];

    for (const edge of relationships) {
      // Skip my own connections
      if (edge.userId === currentUserId) continue;
      
      const introducer = edge.user || users.find((u) => u.id === edge.userId);
      const company = edge.company;
      if (!introducer || !company) continue;
      const strength = calculateStrengthScore(edge);
      paths.push({ introducer, company, edge, strength });
    }
    return paths.sort((a, b) => b.strength - a.strength);
  }, [relationships, currentUserId, users]);
  void _introPaths; // Suppress unused warning

  // Get unique members
  const members = useMemo(() => {
    const memberMap = new Map<string, typeof users[0]>();
    relationships.forEach(r => {
      const user = users.find(u => u.id === r.userId);
      if (user) memberMap.set(user.id, user);
    });
    return Array.from(memberMap.values());
  }, [relationships]);

  // Get my connections (with company data)
  const myConnections = useMemo(() => {
    return relationships.filter(r => r.userId === currentUserId);
  }, [relationships, currentUserId]);

  // Get my companies for "Your Reach"
  const myCompanies = useMemo(() => {
    return myConnections
      .filter(r => r.company)
      .map(r => r.company!)
      .slice(0, 20);
  }, [myConnections]);

  if (!isCalendarConnected) {
    return (
      <div className="dashboard-page">
        <div className="empty-state">
          <h2>Calendar Not Connected</h2>
          <p>Connect your calendar to see your network relationships.</p>
          <Link to="/connect" className="btn-primary">Connect Calendar</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page social-feed">
      {/* Profile Header */}
      <div className="profile-header-card">
        <div className="profile-cover"></div>
        <div className="profile-main">
          <div className="profile-avatar-section">
            <PersonAvatar 
              email={currentUser?.email} 
              name={currentUser?.name} 
              avatarUrl={currentUser?.avatar}
              size={80}
            />
            <div className="online-indicator"></div>
          </div>
          <div className="profile-info">
            <h1 className="profile-name">{currentUser?.name}</h1>
            <p className="profile-handle">@{currentUser?.name.toLowerCase().replace(' ', '')}</p>
          </div>
          <div className="profile-stats">
            <div className="profile-stat">
              <span className="stat-number">{myConnections.length}</span>
              <span className="stat-label">Connections</span>
            </div>
            <div className="profile-stat">
              <span className="stat-number">{requests.filter(r => r.requesterId === currentUserId).length}</span>
              <span className="stat-label">Asks</span>
            </div>
            <div className="profile-stat">
              <span className="stat-number">{offers.filter(o => o.introducerId === currentUserId).length}</span>
              <span className="stat-label">Intros Made</span>
            </div>
          </div>
        </div>
      </div>

      {/* Community Members - People First */}
      <div className="social-card members-card">
        <div className="card-header">
          <div className="card-title-row">
            <span className="card-icon">👥</span>
            <h2>Innovators Community</h2>
          </div>
          <span className="member-count">{members.length} members</span>
        </div>
        <div className="members-grid">
          {(showAllMembers ? members : members.slice(0, 8)).map(member => (
            <div key={member.id} className="member-bubble">
              <PersonAvatar 
                email={member.email} 
                name={member.name} 
                avatarUrl={member.avatar}
                size={48}
              />
              <span className="member-name">{member.name.split(' ')[0]}</span>
            </div>
          ))}
          {members.length > 8 && !showAllMembers && (
            <button className="member-bubble more" onClick={() => setShowAllMembers(true)}>
              <span className="more-count">+{members.length - 8}</span>
            </button>
          )}
        </div>
        <div className="card-footer">
          <span className="network-stat">🌐 Connected to <strong>{companies.length} companies</strong> & <strong>{relationships.length} connections</strong></span>
        </div>
        
        {/* Your Reach - Companies you can intro to */}
        <div className="reach-section">
          <div className="reach-header">
            <span className="card-icon">🌐</span>
            <h3>Your Reach</h3>
          </div>
          <div className="reach-companies">
            {myCompanies.slice(0, 12).map((company) => (
              <div key={company.id} className="reach-company-bubble" title={company.name}>
                {company.logo ? (
                  <img src={company.logo} alt={company.name} />
                ) : (
                  <span>{company.name.charAt(0)}</span>
                )}
              </div>
            ))}
            {myCompanies.length > 12 && (
              <div className="reach-company-bubble more">
                +{myCompanies.length - 12}
              </div>
            )}
          </div>
          <p className="reach-summary">
            You can intro to <strong>{myConnections.length} companies</strong>
          </p>
        </div>
      </div>

      {/* Create a Post / Ask */}
      <div className="social-card create-post-card">
        <div className="create-post-content">
          <PersonAvatar 
            email={currentUser?.email} 
            name={currentUser?.name} 
            avatarUrl={currentUser?.avatar}
            size={40}
          />
          <Link to="/request/new" className="create-post-input">
            Who do you want to meet?
          </Link>
        </div>
        <div className="create-post-actions">
          <Link to="/request/new" className="post-action-btn">
            <span className="action-icon">🎯</span>
            Ask for Intro
          </Link>
          <button className="post-action-btn" disabled>
            <span className="action-icon">🤝</span>
            Offer Help
          </button>
        </div>
      </div>

      {/* Activity Feed - My Asks */}
      {requests.filter(r => r.requesterId === currentUserId).length > 0 && (
        <div className="social-card">
          <div className="card-header">
            <div className="card-title-row">
              <span className="card-icon">📤</span>
              <h2>Your Asks</h2>
            </div>
          </div>
          <div className="posts-feed">
            {requests.filter(r => r.requesterId === currentUserId).map(request => {
              const requestOffers = offers.filter(o => o.requestId === request.id);
              const acceptedOffer = requestOffers.find(o => o.status === 'accepted');
              const pendingOffers = requestOffers.filter(o => o.status === 'pending');
              
              return (
                <Link to={`/request/${request.id}`} key={request.id} className="post-item your-post">
                  <div className="post-header">
                    <PersonAvatar 
                      email={currentUser?.email} 
                      name={currentUser?.name} 
                      avatarUrl={currentUser?.avatar}
                      size={36}
                    />
                    <div className="post-meta">
                      <span className="post-author">You</span>
                      <span className="post-time">{timeAgo(new Date(request.createdAt))}</span>
                    </div>
                    <div className="post-bounty">${request.bidAmount}</div>
                  </div>
                  <p className="post-content">{request.rawText}</p>
                  <div className="post-footer">
                    <div className="post-status-row">
                      <span className={`post-status ${request.status}`}>
                        {request.status === 'open' && '🟢 Open'}
                        {request.status === 'accepted' && '🤝 In Progress'}
                        {request.status === 'completed' && '✅ Done'}
                      </span>
                      {acceptedOffer ? (
                        <span className="post-engagement">
                          ✨ {users.find(u => u.id === acceptedOffer.introducerId)?.name} is helping
                        </span>
                      ) : pendingOffers.length > 0 ? (
                        <span className="post-engagement highlight">
                          💬 {pendingOffers.length} {pendingOffers.length === 1 ? 'offer' : 'offers'} received
                        </span>
                      ) : (
                        <span className="post-engagement muted">Waiting for offers...</span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Feed - Asks from the community you can help with */}
      <div className="social-card">
        <div className="card-header">
          <div className="card-title-row">
            <span className="card-icon">🎯</span>
            <h2>Help Someone Out</h2>
          </div>
          <Link to="/feed" className="see-all-link">See all →</Link>
        </div>
        <div className="posts-feed">
          {(() => {
            const matchingRequests = requests
              .filter(r => r.requesterId !== currentUserId && r.status === 'open')
              .map(request => {
                const requester = users.find(u => u.id === request.requesterId);
                
                const myMatch = myConnections.find(conn => {
                  const company = conn.company;
                  if (!company) return false;
                  if (request.normalizedQuery?.targetDomain && company.domain?.includes(request.normalizedQuery.targetDomain)) return true;
                  if (request.normalizedQuery?.industry && company.industry === request.normalizedQuery.industry) return true;
                  return false;
                });
                
                if (!myMatch) return null;
                
                const matchedCompany = myMatch.company;
                const daysSinceLast = Math.round(
                  (Date.now() - new Date(myMatch.lastSeenAt).getTime()) / (1000 * 60 * 60 * 24)
                );
                const hasOffer = offers.some(o => o.requestId === request.id && o.introducerId === currentUserId);
                
                return { request, requester, matchedCompany, myMatch, daysSinceLast, hasOffer };
              })
              .filter(Boolean) as Array<{
                request: typeof requests[0];
                requester: typeof users[0] | undefined;
                matchedCompany: any;
                myMatch: typeof relationships[0];
                daysSinceLast: number;
                hasOffer: boolean;
              }>;
            
            if (matchingRequests.length === 0) {
              return (
                <div className="empty-feed">
                  <span className="empty-icon">🌱</span>
                  <p>No asks match your network yet</p>
                  <p className="empty-hint">When someone needs a connection you have, it'll show up here</p>
                </div>
              );
            }
            
            return matchingRequests.map(({ request, requester, matchedCompany, daysSinceLast, hasOffer }) => {
              return (
                <div key={request.id} className="post-item ask-post">
                  <div className="post-header">
                    <PersonAvatar 
                      email={requester?.email} 
                      name={requester?.name} 
                      avatarUrl={requester?.avatar}
                      size={36}
                    />
                    <div className="post-meta">
                      <span className="post-author">{requester?.name}</span>
                      <span className="post-time">{timeAgo(new Date(request.createdAt))}</span>
                    </div>
                    <div className="post-bounty">${request.bidAmount}</div>
                  </div>
                  
                  <p className="post-content">{request.rawText}</p>
                  
                  <div className="you-know-section">
                    <span className="you-know-label">💡 You know someone!</span>
                    <div className="connection-preview">
                      {matchedCompany?.logo ? (
                        <img src={matchedCompany.logo} alt="" className="connection-company-logo" />
                      ) : (
                        <div className="connection-avatar fallback">{matchedCompany?.name?.charAt(0)}</div>
                      )}
                      <div className="connection-details">
                        <span className="connection-name">{matchedCompany?.name}</span>
                        <span className="connection-last">Last contact {daysSinceLast}d ago</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="post-actions">
                    {hasOffer ? (
                      <span className="action-done">✓ You offered to help</span>
                    ) : (
                      <button 
                        className="action-btn primary"
                        onClick={() => requester?.email && openOfferIntroEmail({
                          requesterEmail: requester.email,
                          requesterName: requester.name || 'there',
                          targetCompany: request.normalizedQuery?.targetCompany || matchedCompany?.name || 'the company',
                          senderName: currentUser?.name,
                        })}
                      >
                        🤝 Offer to Intro
                      </button>
                    )}
                    <Link to={`/request/${request.id}`} className="action-btn secondary">View Details</Link>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </div>

    </div>
  );
}
