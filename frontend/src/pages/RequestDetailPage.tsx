import { useMemo, useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAppState, useAppDispatch } from '../store';
import { Contact } from './HomePage';

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

export function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser, requests, offers, users, contacts: storeContacts } = useAppState();
  const dispatch = useAppDispatch();
  const [showOfferForm, setShowOfferForm] = useState(false);
  const [offerMessage, setOfferMessage] = useState('');
  const [userSpaceMap, setUserSpaceMap] = useState<Record<string, { id: string; name: string; emoji: string }>>({});
  const [deleting, setDeleting] = useState(false);

  // Transform store contacts to display format
  const contacts: Contact[] = useMemo(() => {
    return storeContacts
      .filter(c => c.isApproved)
      .map(c => ({
        id: c.id,
        name: c.name || 'Unknown',
        email: c.email,
        avatar: `https://i.pravatar.cc/150?u=${c.email}`,
        title: c.title || '',
        company: c.company?.name || '',
        companyDomain: c.company?.domain || '',
        lastContacted: new Date(c.lastSeenAt),
        connectionStrength: calculateStrength(c.lastSeenAt, c.meetingsCount),
      }));
  }, [storeContacts]);

  // Fetch spaces to build user-space mapping
  useEffect(() => {
    fetch('/api/spaces', { credentials: 'include' })
      .then(res => res.json())
      .then((spaces: { id: string; name: string; emoji: string; members: { user: { id: string } }[] }[]) => {
        const map: Record<string, { id: string; name: string; emoji: string }> = {};
        spaces.forEach(space => {
          space.members.forEach(member => {
            map[member.user.id] = { id: space.id, name: space.name, emoji: space.emoji };
          });
        });
        setUserSpaceMap(map);
      })
      .catch((error) => {
        console.error('Failed to fetch spaces for user mapping:', error);
      });
  }, []);

  const request = requests.find((r) => r.id === id);
  const requestOffers = useMemo(
    () => offers.filter((o) => o.requestId === id),
    [offers, id]
  );
  
  const requester = request ? users.find((u) => u.id === request.requesterId) : null;
  const isMyRequest = request?.requesterId === currentUser?.id;

  // Find matching contacts for suggestions
  const matchingContacts = useMemo(() => {
    if (!request?.normalizedQuery?.targetDomain) return [];
    return contacts.filter(c => c.companyDomain === request.normalizedQuery.targetDomain);
  }, [request, contacts]);

  if (!request) {
    return (
      <div className="request-detail">
        <div className="detail-empty">
          <h2>Request Not Found</h2>
          <button className="btn-primary" onClick={() => navigate(-1)}>Go Back</button>
        </div>
      </div>
    );
  }

  const handleSubmitOffer = () => {
    if (!offerMessage.trim()) return;

    dispatch({
      type: 'ADD_OFFER',
      payload: {
        id: `offer-${Date.now()}`,
        requestId: request.id,
        introducerId: currentUser?.id || '',
        message: offerMessage,
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    });

    setOfferMessage('');
    setShowOfferForm(false);
  };

  const handleAcceptOffer = (offerId: string) => {
    dispatch({ type: 'UPDATE_OFFER_STATUS', payload: { offerId, status: 'accepted' } });
    dispatch({ type: 'UPDATE_REQUEST_STATUS', payload: { requestId: request.id, status: 'accepted' } });
  };

  const handleRejectOffer = (offerId: string) => {
    dispatch({ type: 'UPDATE_OFFER_STATUS', payload: { offerId, status: 'rejected' } });
  };

  const handleDeleteRequest = async () => {
    if (!request || !confirm('Are you sure you want to delete this request? This cannot be undone.')) return;
    
    setDeleting(true);
    try {
      const res = await fetch(`/api/requests/${request.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete request');
      }
      
      dispatch({ type: 'REMOVE_REQUEST', payload: request.id });
      navigate('/home');
    } catch (error) {
      console.error('Delete error:', error);
      alert(error instanceof Error ? error.message : 'Failed to delete request');
      setDeleting(false);
    }
  };

  const alreadyOffered = requestOffers.some((o) => o.introducerId === currentUser?.id);

  return (
    <div className="request-detail">
      {/* Header */}
      <div className="detail-header">
        <button className="back-link" onClick={() => navigate(-1)}>← Back</button>
        {isMyRequest && (
          <button 
            className="btn-danger" 
            onClick={handleDeleteRequest}
            disabled={deleting}
          >
            {deleting ? 'Deleting...' : 'Delete Request'}
          </button>
        )}
      </div>

      <div className="detail-layout">
        {/* Main Content */}
        <div className="detail-main">
          {/* Request Card */}
          <div className="detail-card">
            <div className="detail-card-header">
              <div className="requester-row">
                {requester?.avatar ? (
                  <img src={requester.avatar} alt="" className="detail-avatar" referrerPolicy="no-referrer" />
                ) : (
                  <div className="detail-avatar fallback">{requester?.name?.charAt(0)}</div>
                )}
                <div className="requester-details">
                  <span className="requester-name">{isMyRequest ? 'You' : requester?.name}</span>
                  {!isMyRequest && requester?.id && userSpaceMap[requester.id] && (
                    <span className="space-tag">
                      <span className="space-emoji">{userSpaceMap[requester.id].emoji}</span>
                      {userSpaceMap[requester.id].name}
                    </span>
                  )}
                  <span className="request-time">{timeAgo(new Date(request.createdAt))}</span>
                </div>
              </div>
              <div className="detail-badges">
                <span className={`status-badge ${request.status}`}>{request.status}</span>
                {request.bidAmount > 0 && (
                  <span className="bounty-badge">${request.bidAmount}</span>
                )}
              </div>
            </div>

            <p className="detail-text">{request.rawText}</p>

            {request.normalizedQuery?.targetDomain && (
              <div className="detail-target">
                <span className="target-label">Looking for:</span>
                <span className="target-company">{request.normalizedQuery.targetDomain}</span>
              </div>
            )}

            {request.space && (
              <div className="detail-space">
                Posted in <Link to={`/spaces/${request.space.id}`} className="space-link">{request.space.emoji} {request.space.name}</Link>
              </div>
            )}
          </div>

          {/* Matching Contacts - Only show if not my request and I have contacts */}
          {!isMyRequest && matchingContacts.length > 0 && (
            <div className="matching-contacts-card">
              <h3>You might be able to help!</h3>
              <p className="matching-subtitle">You know {matchingContacts.length} {matchingContacts.length === 1 ? 'person' : 'people'} at this company</p>
              
              <div className="matching-list">
                {matchingContacts.map(contact => (
                  <div key={contact.id} className="matching-contact">
                    <img src={contact.avatar} alt="" className="matching-avatar" />
                    <div className="matching-info">
                      <span className="matching-name">{contact.name}</span>
                      <span className="matching-title">{contact.title} at {contact.company}</span>
                    </div>
                    <span className={`strength-badge ${contact.connectionStrength}`}>
                      {contact.connectionStrength}
                    </span>
                  </div>
                ))}
              </div>

              {!alreadyOffered && request.status === 'open' && (
                <button className="btn-primary full-width" onClick={() => setShowOfferForm(true)}>
                  Offer to Introduce
                </button>
              )}
            </div>
          )}

          {/* Offer Form */}
          {showOfferForm && (
            <div className="offer-form-card">
              <h3>Make an Offer</h3>
              <p className="form-hint">Describe your connection and how you can help</p>
              <textarea
                value={offerMessage}
                onChange={(e) => setOfferMessage(e.target.value)}
                placeholder="I know [Name] at [Company]. We worked together at... I can introduce you because..."
                rows={4}
              />
              <div className="form-actions">
                <button className="btn-secondary" onClick={() => setShowOfferForm(false)}>Cancel</button>
                <button className="btn-primary" onClick={handleSubmitOffer} disabled={!offerMessage.trim()}>
                  Submit Offer
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Offers Sidebar */}
        <div className="detail-sidebar">
          <div className="sidebar-card">
            <div className="sidebar-header">
              <h3>Offers</h3>
              <span className="offer-count">{requestOffers.length}</span>
            </div>

            {requestOffers.length === 0 ? (
              <div className="no-offers">
                <p>No offers yet</p>
                {!isMyRequest && !alreadyOffered && request.status === 'open' && !showOfferForm && (
                  <button className="btn-secondary" onClick={() => setShowOfferForm(true)}>
                    Be the first to help
                  </button>
                )}
              </div>
            ) : (
              <div className="offers-list">
                {requestOffers.map((offer) => {
                  const introducer = users.find((u) => u.id === offer.introducerId);
                  const isMyOffer = offer.introducerId === currentUser?.id;
                  
                  return (
                    <div key={offer.id} className={`offer-card ${offer.status}`}>
                      <div className="offer-header">
                        <div className="offer-user">
                          {introducer?.avatar ? (
                            <img src={introducer.avatar} alt="" className="offer-avatar" />
                          ) : (
                            <div className="offer-avatar fallback">{introducer?.name?.charAt(0)}</div>
                          )}
                          <div className="offer-user-info">
                            <span className="offer-user-name">{isMyOffer ? 'You' : introducer?.name}</span>
                            <span className="offer-time">{timeAgo(new Date(offer.createdAt))}</span>
                          </div>
                        </div>
                        <span className={`status-badge ${offer.status}`}>{offer.status}</span>
                      </div>
                      
                      <p className="offer-message">{offer.message}</p>

                      {isMyRequest && offer.status === 'pending' && (
                        <div className="offer-actions">
                          <button className="btn-reject" onClick={() => handleRejectOffer(offer.id)}>
                            Decline
                          </button>
                          <button className="btn-accept" onClick={() => handleAcceptOffer(offer.id)}>
                            Accept
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
