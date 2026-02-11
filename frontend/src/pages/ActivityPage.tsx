import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppState } from '../store';
import { PersonAvatar } from '../components';

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ActivityPage() {
  const { currentUser, requests, offers, users } = useAppState();

  // My requests (asks I've made)
  const myRequests = useMemo(() => {
    return requests
      .filter(r => r.requesterId === currentUser?.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [requests, currentUser?.id]);

  // My offers (intros I've offered)
  const myOffers = useMemo(() => {
    return offers
      .filter(o => o.introducerId === currentUser?.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [offers, currentUser?.id]);

  // Offers on my requests
  const offersOnMyRequests = useMemo(() => {
    const myRequestIds = new Set(myRequests.map(r => r.id));
    return offers.filter(o => myRequestIds.has(o.requestId));
  }, [offers, myRequests]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open':
        return <span className="status-badge open">Open</span>;
      case 'accepted':
        return <span className="status-badge accepted">In Progress</span>;
      case 'completed':
        return <span className="status-badge completed">Completed</span>;
      case 'pending':
        return <span className="status-badge pending">Pending</span>;
      case 'rejected':
        return <span className="status-badge rejected">Declined</span>;
      default:
        return <span className="status-badge">{status}</span>;
    }
  };

  return (
    <div className="activity-page">
      <div className="activity-header">
        <h1>Activity</h1>
        <Link to="/request/new" className="btn-primary">
          + New Ask
        </Link>
      </div>

      {/* Stats Overview */}
      <div className="activity-stats">
        <div className="stat-card">
          <span className="stat-number">{myRequests.length}</span>
          <span className="stat-label">Your Asks</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">{offersOnMyRequests.filter(o => o.status === 'pending').length}</span>
          <span className="stat-label">Pending Offers</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">{myOffers.length}</span>
          <span className="stat-label">Intros Offered</span>
        </div>
      </div>

      {/* My Asks */}
      <section className="activity-section">
        <h2>Your Asks</h2>
        {myRequests.length === 0 ? (
          <div className="empty-section">
            <p>You haven't asked for any intros yet.</p>
            <Link to="/request/new" className="btn-secondary">Ask for an intro</Link>
          </div>
        ) : (
          <div className="activity-list">
            {myRequests.map(request => {
              const requestOffers = offersOnMyRequests.filter(o => o.requestId === request.id);
              const pendingCount = requestOffers.filter(o => o.status === 'pending').length;
              
              return (
                <Link to={`/request/${request.id}`} key={request.id} className="activity-card">
                  <div className="activity-card-main">
                    <p className="activity-text">{request.rawText}</p>
                    <div className="activity-meta">
                      {getStatusBadge(request.status)}
                      <span className="activity-time">{timeAgo(new Date(request.createdAt))}</span>
                      {request.bidAmount > 0 && (
                        <span className="activity-bounty">${request.bidAmount}</span>
                      )}
                    </div>
                  </div>
                  {pendingCount > 0 && (
                    <div className="activity-badge">
                      {pendingCount} offer{pendingCount > 1 ? 's' : ''}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Intros I've Offered */}
      <section className="activity-section">
        <h2>Intros You've Offered</h2>
        {myOffers.length === 0 ? (
          <div className="empty-section">
            <p>You haven't offered any intros yet.</p>
            <Link to="/home" className="btn-secondary">Browse asks</Link>
          </div>
        ) : (
          <div className="activity-list">
            {myOffers.map(offer => {
              const request = requests.find(r => r.id === offer.requestId);
              const requester = users.find(u => u.id === request?.requesterId);
              
              return (
                <Link to={`/request/${offer.requestId}`} key={offer.id} className="activity-card">
                  <div className="activity-card-header">
                    <PersonAvatar 
                      email={requester?.email} 
                      name={requester?.name} 
                      avatarUrl={requester?.avatar}
                      size={32}
                    />
                    <span className="activity-to">To {requester?.name}</span>
                  </div>
                  <p className="activity-text">{request?.rawText}</p>
                  <div className="activity-meta">
                    {getStatusBadge(offer.status)}
                    <span className="activity-time">{timeAgo(new Date(offer.createdAt))}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
