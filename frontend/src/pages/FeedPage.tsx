import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppState, useAppDispatch } from '../store';

export function FeedPage() {
  const { requests, offers, currentUserId, users } = useAppState();
  const dispatch = useAppDispatch();
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
  const [offerMessage, setOfferMessage] = useState('');

  // Show open requests from other users
  const openRequests = requests.filter(
    (r) => r.status === 'open' && r.requesterId !== currentUserId
  );

  const handleSubmitOffer = (requestId: string) => {
    if (!offerMessage.trim()) return;

    dispatch({
      type: 'ADD_OFFER',
      payload: {
        id: `offer-${Date.now()}`,
        requestId,
        introducerId: currentUserId,
        message: offerMessage,
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    });

    setOfferMessage('');
    setExpandedRequest(null);
  };

  const hasOffered = (requestId: string) =>
    offers.some((o) => o.requestId === requestId && o.introducerId === currentUserId);

  return (
    <div className="feed-page">
      <header className="page-header">
        <h1>Intro Requests Feed</h1>
        <p className="subtitle">Browse open requests and offer your connections.</p>
      </header>

      {openRequests.length === 0 ? (
        <div className="empty-state">
          <h2>No Open Requests</h2>
          <p>Check back later or switch users to create a request.</p>
        </div>
      ) : (
        <div className="feed-list">
          {openRequests.map((request) => {
            const requester = users.find((u) => u.id === request.requesterId);
            const requestOfferCount = offers.filter((o) => o.requestId === request.id).length;
            const isExpanded = expandedRequest === request.id;
            const alreadyOffered = hasOffered(request.id);

            return (
              <div key={request.id} className="feed-card">
                <div className="feed-card-header">
                  <div className="requester-info">
                    <div className="avatar">{requester?.name.charAt(0)}</div>
                    <div>
                      <span className="requester-name">{requester?.name}</span>
                      <span className="timestamp">
                        {new Date(request.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="bounty-badge">
                    {request.bidAmount} {request.currency}
                  </div>
                </div>

                <div className="feed-card-body">
                  <p className="request-text">"{request.rawText}"</p>
                  <div className="query-tags-mini">
                    {request.normalizedQuery.targetDomain && (
                      <span className="tag">{request.normalizedQuery.targetDomain}</span>
                    )}
                    {request.normalizedQuery.industry && (
                      <span className="tag">{request.normalizedQuery.industry}</span>
                    )}
                    {request.normalizedQuery.sizeBucket && (
                      <span className="tag">{request.normalizedQuery.sizeBucket}</span>
                    )}
                    {request.normalizedQuery.geo && (
                      <span className="tag">{request.normalizedQuery.geo}</span>
                    )}
                  </div>
                </div>

                <div className="feed-card-footer">
                  <span className="offer-count">
                    {requestOfferCount} offer{requestOfferCount !== 1 ? 's' : ''}
                  </span>
                  <div className="feed-actions">
                    <Link to={`/request/${request.id}`} className="btn-link">
                      View Details
                    </Link>
                    {alreadyOffered ? (
                      <span className="already-offered">✓ Offered</span>
                    ) : (
                      <button
                        className="btn-secondary"
                        onClick={() => setExpandedRequest(isExpanded ? null : request.id)}
                      >
                        {isExpanded ? 'Cancel' : 'Make Offer'}
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && !alreadyOffered && (
                  <div className="inline-offer-form">
                    <textarea
                      value={offerMessage}
                      onChange={(e) => setOfferMessage(e.target.value)}
                      placeholder="I know the VP of Engineering at Stripe and can make a warm intro..."
                      rows={3}
                    />
                    <button
                      className="btn-primary"
                      onClick={() => handleSubmitOffer(request.id)}
                      disabled={!offerMessage.trim()}
                    >
                      Submit Offer
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
