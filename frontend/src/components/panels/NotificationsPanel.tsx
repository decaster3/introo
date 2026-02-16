import { notificationsApi } from '../../lib/api';
import { CompanyLogo } from '../../components';
import type { DirectConnection, MergedCompany, PendingSpace, InlinePanel } from '../../types';

// Helper - duplicated from AIHomePage helpers for self-containment
function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

type Notification = Awaited<ReturnType<typeof notificationsApi.getAll>>[number];

interface NotificationsPanelProps {
  notifications: Notification[];
  connections: DirectConnection[];
  mergedCompanies: MergedCompany[];
  pendingSpaces: PendingSpace[];
  onNavigate: (panel: InlinePanel) => void;
  onAcceptConnection: (id: string) => void;
  onRejectConnection: (id: string) => void;
  onAcceptSpaceInvite: (spaceId: string) => void;
  onRejectSpaceInvite: (spaceId: string) => void;
  onDeleteNotification: (id: string) => void;
  onClearAllNotifications: () => void;
}

export function NotificationsPanel({
  notifications, connections, mergedCompanies, pendingSpaces,
  onNavigate, onAcceptConnection, onRejectConnection,
  onAcceptSpaceInvite, onRejectSpaceInvite,
  onDeleteNotification, onClearAllNotifications,
}: NotificationsPanelProps) {
  if (notifications.length === 0) {
    return (
      <div className="u-panel-notifs">
        <h2>Notifications</h2>
        <div className="u-panel-empty">
          <span className="u-panel-empty-icon">🔔</span>
          <p>No notifications yet</p>
        </div>
      </div>
    );
  }

  const unread = notifications.filter(n => !n.isRead);
  const read = notifications.filter(n => n.isRead);

  const renderNotif = (n: Notification) => {
    const data = (n.data || {}) as Record<string, unknown>;
    const spaceId = data.spaceId as string | undefined;
    const spaceEmoji = data.spaceEmoji as string | undefined;
    const spaceName = data.spaceName as string | undefined;
    const companyName = data.companyName as string | undefined;
    const companyDomain = data.companyDomain as string | undefined;
    const reason = data.reason as string | undefined;
    const connPeerId = data.connectionPeerId as string | undefined;
    const connPeerName = data.connectionPeerName as string | undefined;
    const requesterId = data.requesterId as string | undefined;
    const timeAgo = getTimeAgo(n.createdAt);
    const isIntroType = ['intro_request', 'intro_offered', 'intro_declined'].includes(n.type);
    const is1to1 = isIntroType && !spaceId && !!(connPeerId || requesterId);

    const notifConn = connPeerId || requesterId
      ? connections.find(c => c.peer.id === connPeerId || c.peer.id === requesterId)
      : null;
    const notifCompanyId = data.companyId as string | undefined;
    const matchedNotifCompany = isIntroType
      ? mergedCompanies.find(c => (notifCompanyId && c.id === notifCompanyId) || (companyDomain && c.domain === companyDomain))
      : undefined;
    const isClickable = !!(spaceId || notifConn || matchedNotifCompany);

    let icon = '🔔';
    let accentClass = '';
    if (n.type === 'intro_request') { icon = '🤝'; accentClass = 'intro'; }
    else if (n.type === 'intro_offered') { icon = '✨'; accentClass = 'offered'; }
    else if (n.type === 'intro_declined') { icon = '✗'; accentClass = 'declined'; }
    else if (n.type === 'space_invited' || n.type === 'space_approved') { icon = '🎉'; accentClass = 'space-positive'; }
    else if (n.type === 'space_member_joined') { icon = '👋'; accentClass = 'space-positive'; }
    else if (n.type === 'space_join_request') { icon = '📩'; accentClass = 'space-neutral'; }
    else if (n.type === 'space_member_left') { icon = '👤'; accentClass = 'space-neutral'; }
    else if (n.type === 'space_removed') { icon = '🚫'; accentClass = 'space-negative'; }
    else if (n.type === 'connection_request') { icon = '👋'; accentClass = 'space-positive'; }
    else if (n.type === 'connection_accepted') { icon = '🤝'; accentClass = 'space-positive'; }

    const connRequestId = data.connectionId as string | undefined;
    const isConnType = n.type === 'connection_request' || n.type === 'connection_accepted';
    const connRequestPending = n.type === 'connection_request' && connRequestId
      ? connections.find(c => c.id === connRequestId && c.status === 'pending' && c.direction === 'received')
      : null;
    const connFromNotif = isConnType && connRequestId
      ? connections.find(c => c.id === connRequestId)
      : null;

    const isClickableFinal = isClickable || !!(connFromNotif && connFromNotif.status === 'accepted');

    return (
      <div
        key={n.id}
        className={`u-panel-notif-card ${!n.isRead ? 'unread' : ''} ${isClickableFinal ? 'clickable' : ''}`}
        onClick={() => {
          if (isConnType && connFromNotif && connFromNotif.status === 'accepted') {
            onNavigate({ type: 'connection', connectionId: connFromNotif.id });
            if (!n.isRead) notificationsApi.markAsRead(n.id);
            return;
          }
          if (n.type === 'intro_request' && spaceId) {
            onNavigate({ type: 'space', spaceId });
          } else if (n.type === 'intro_request' && notifConn) {
            onNavigate({ type: 'connection', connectionId: notifConn.id });
          } else if (is1to1 && notifConn) {
            onNavigate({ type: 'connection', connectionId: notifConn.id });
          } else if (matchedNotifCompany) {
            onNavigate({ type: 'company', company: matchedNotifCompany });
          } else if (spaceId) {
            onNavigate({ type: 'space', spaceId });
          } else if (notifConn) {
            onNavigate({ type: 'connection', connectionId: notifConn.id });
          }
        }}
      >
        <div className={`u-panel-notif-icon ${accentClass}`}>{icon}</div>
        <div className="u-panel-notif-body">
          <div className="u-panel-notif-title">{n.title}</div>
          {n.body && <div className="u-panel-notif-text">{n.body}</div>}
          {isIntroType && (companyName || spaceName || is1to1) && (
            <div className="u-panel-notif-tags">
              {companyName && (
                <span className="u-panel-notif-tag u-panel-notif-tag--company">
                  {companyDomain && <CompanyLogo domain={companyDomain} name={companyName} size={12} />}
                  {companyName}
                </span>
              )}
              {spaceName && (
                <span className="u-panel-notif-tag u-panel-notif-tag--space">
                  {spaceEmoji || '🫛'} {spaceName}
                </span>
              )}
              {is1to1 && (notifConn || connPeerName) && (
                <span className="u-panel-notif-tag u-panel-notif-tag--space">
                  👤 {notifConn?.peer.name || connPeerName}
                </span>
              )}
            </div>
          )}
          {n.type === 'intro_declined' && reason && (
            <div className="u-panel-notif-reason">"{reason}"</div>
          )}
          {connRequestPending && (
            <>
              <div className="u-panel-notif-actions" onClick={e => e.stopPropagation()}>
                <button className="u-notif-accept-btn" onClick={() => { onAcceptConnection(connRequestPending.id); notificationsApi.markAsRead(n.id); }}>Accept</button>
                <button className="u-notif-reject-btn" onClick={() => { onRejectConnection(connRequestPending.id); notificationsApi.markAsRead(n.id); }}>Decline</button>
              </div>
              <div className="u-panel-notif-footer"><span className="u-panel-notif-time">{timeAgo}</span></div>
            </>
          )}
          {n.type === 'connection_request' && !connRequestPending && (
            <div className="u-panel-notif-footer">
              <span className="u-panel-notif-time" style={{ fontStyle: 'italic' }}>Handled · {timeAgo}</span>
            </div>
          )}
          {n.type === 'connection_accepted' && (
            <div className="u-panel-notif-footer"><span className="u-panel-notif-time">{timeAgo}</span></div>
          )}
          {n.type === 'space_invited' && spaceId && pendingSpaces.some(ps => ps.id === spaceId) && (
            <>
              <div className="u-panel-notif-actions" onClick={e => e.stopPropagation()}>
                <button className="u-notif-accept-btn" onClick={() => { onAcceptSpaceInvite(spaceId); notificationsApi.markAsRead(n.id); }}>Accept</button>
                <button className="u-notif-reject-btn" onClick={() => { onRejectSpaceInvite(spaceId); notificationsApi.markAsRead(n.id); }}>Decline</button>
              </div>
              <div className="u-panel-notif-footer"><span className="u-panel-notif-time">{timeAgo}</span></div>
            </>
          )}
          {n.type === 'space_invited' && spaceId && !pendingSpaces.some(ps => ps.id === spaceId) && (
            <div className="u-panel-notif-footer">
              <span className="u-panel-notif-time" style={{ fontStyle: 'italic' }}>Handled · {timeAgo}</span>
            </div>
          )}
          {!isConnType && n.type !== 'space_invited' && (
            <div className="u-panel-notif-footer">
              <span className="u-panel-notif-time">{timeAgo}</span>
              {!isIntroType && spaceId && spaceName && (
                <span className="u-panel-notif-space">{spaceEmoji || '🫛'} {spaceName}</span>
              )}
            </div>
          )}
        </div>
        <button
          className="u-notif-delete-btn"
          title="Delete notification"
          onClick={(e) => { e.stopPropagation(); onDeleteNotification(n.id); }}
        >×</button>
        {isClickableFinal && <span className="u-panel-notif-arrow">→</span>}
      </div>
    );
  };

  return (
    <div className="u-panel-notifs">
      <div className="u-panel-notifs-header">
        <h2>Notifications</h2>
        {notifications.length > 0 && (
          <button
            className="u-notif-clear-all-btn"
            onClick={onClearAllNotifications}
            title="Clear all notifications"
          >
            Clear all
          </button>
        )}
      </div>
      <div className="u-panel-notif-list">
        {unread.length > 0 && (
          <>
            <div className="u-panel-notif-section-label">New</div>
            {unread.map(renderNotif)}
          </>
        )}
        {read.length > 0 && (
          <>
            <div className="u-panel-notif-section-label u-panel-notif-section-label--earlier">Earlier</div>
            {read.map(renderNotif)}
          </>
        )}
      </div>
    </div>
  );
}
