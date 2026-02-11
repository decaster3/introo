import { Link, useLocation, Navigate } from 'react-router-dom';
import { useAppState, useAppActions } from '../store';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { currentUser, currentUserId, isCalendarConnected, requests, isAuthenticated, isLoading, contacts } = useAppState();
  const { logout } = useAppActions();
  const location = useLocation();

  // Redirect to login if not authenticated
  if (!isLoading && !isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className="app-layout loading">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  // Redirect to onboarding if no contacts (except if already on certain pages)
  // Note: contacts must be undefined or empty array with length 0
  // We check for undefined separately to avoid redirect during initial load
  const hasContacts = Array.isArray(contacts) && contacts.length > 0;
  const allowedWithoutContacts = ['/onboarding', '/connect'].includes(location.pathname);
  
  // Only redirect if contacts array has been loaded (not undefined) and is empty
  if (contacts !== undefined && !hasContacts && !allowedWithoutContacts) {
    return <Navigate to="/onboarding" replace />;
  }

  // Count user's requests
  const userRequestsCount = (requests || []).filter((r) => r.requesterId === currentUserId).length;

  const navItems = [
    { path: '/home', label: 'Find Intros', icon: '🔍' },
    { path: '/network', label: 'Your Network', icon: '🌐' },
    { path: '/spaces', label: 'Your Spaces', icon: '✨' },
    { path: '/connect', label: 'Connect Data', icon: '📅' },
  ];

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <Link to="/home" className="logo">
            <span className="logo-icon">✨</span>
            <span className="logo-text">Introo</span>
          </Link>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="connection-status">
            <span className={`status-dot ${isCalendarConnected ? 'connected' : ''}`}></span>
            <span>{isCalendarConnected ? 'Calendar Connected' : 'Not Connected'}</span>
          </div>

          <div className="user-info">
            {currentUser?.avatar ? (
              <img src={currentUser.avatar} alt="" className="user-avatar-img" referrerPolicy="no-referrer" />
            ) : (
              <div className="user-avatar">{currentUser?.name?.charAt(0)}</div>
            )}
            <div className="user-details">
              <span className="user-name">{currentUser?.name}</span>
              <span className="user-stats">{userRequestsCount} requests</span>
            </div>
          </div>

          <button className="logout-btn" onClick={logout}>
            Sign Out
          </button>
        </div>
      </aside>

      <main className="main-content">
        {children}
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="mobile-nav">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`mobile-nav-item ${location.pathname === item.path ? 'active' : ''}`}
          >
            <span className="mobile-nav-icon">{item.icon}</span>
            <span className="mobile-nav-label">{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
