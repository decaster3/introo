import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState, useAppActions } from '../store';
import { API_BASE } from '../lib/api';
import type { CalendarAccount } from '../store/types';

const comingSoonIntegrations = [
  { 
    id: 'linkedin', 
    name: 'LinkedIn', 
    icon: '💼', 
    description: 'Import your professional connections',
  },
  { 
    id: 'gmail', 
    name: 'Gmail', 
    icon: '✉️', 
    description: 'Analyze your email communications',
  },
];

export function ConnectPage() {
  const { isCalendarConnected, contacts, currentUser } = useAppState();
  const { syncCalendar } = useAppActions();
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calendarAccounts, setCalendarAccounts] = useState<CalendarAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  
  // Consider connected if we have contacts (they must have come from somewhere)
  const hasContacts = Array.isArray(contacts) && contacts.length > 0;
  const effectivelyConnected = isCalendarConnected || hasContacts;

  // Fetch calendar accounts on mount
  useEffect(() => {
    fetchCalendarAccounts();
  }, []);

  const fetchCalendarAccounts = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/calendar/accounts`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setCalendarAccounts(data);
      }
    } catch (e) {
      console.error('Failed to fetch calendar accounts:', e);
    } finally {
      setLoadingAccounts(false);
    }
  };

  const handleConnect = async () => {
    setSyncing(true);
    setError(null);
    try {
      await syncCalendar();
      await fetchCalendarAccounts();
    } catch (err: any) {
      setError(err.message || 'Failed to sync calendar');
    } finally {
      setSyncing(false);
    }
  };

  const handleAddAnotherCalendar = () => {
    // Redirect to Google OAuth with prompt to select account
    const apiUrl = API_BASE || '';
    window.location.href = `${apiUrl}/auth/google?prompt=select_account`;
  };

  const handleSyncAccount = async (accountId: string) => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/calendar/accounts/${accountId}/sync`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to sync');
      }
      await fetchCalendarAccounts();
    } catch (err: any) {
      setError(err.message || 'Failed to sync calendar');
    } finally {
      setSyncing(false);
    }
  };

  const handleRemoveAccount = async (accountId: string) => {
    if (!confirm('Remove this calendar? Contacts from this calendar will remain.')) return;
    try {
      await fetch(`${API_BASE}/api/calendar/accounts/${accountId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      await fetchCalendarAccounts();
    } catch (err: any) {
      setError(err.message || 'Failed to remove calendar');
    }
  };

  const connectedCount = calendarAccounts.length + (effectivelyConnected ? 1 : 0);

  return (
    <div className="crm-page connect-page">
      <div className="crm-header">
        <div className="crm-title">
          <h1>Connect Your Data</h1>
          <p className="crm-subtitle">
            {connectedCount} integration{connectedCount !== 1 ? 's' : ''} connected
          </p>
        </div>
        {connectedCount > 0 && (
          <button className="btn-primary" onClick={() => navigate('/network')}>
            View Network →
          </button>
        )}
      </div>

      <div className="connect-content">
          {error && (
            <div className="connect-error-banner">
              <span>⚠️</span> {error}
              <button onClick={() => setError(null)}>×</button>
            </div>
          )}

          {/* Google Calendar Section */}
          <div className="calendar-section">
            <div className="section-header">
              <span className="section-icon">📅</span>
              <div className="section-header-text">
                <h3>Google Calendar</h3>
                <p>Connect your Google Workspace calendars to discover your network</p>
              </div>
            </div>

            {loadingAccounts ? (
              <div className="loading-state">Loading calendars...</div>
            ) : (
              <>
                {/* Connected calendars list */}
                {(effectivelyConnected || calendarAccounts.length > 0) && (
                  <div className="connected-calendars">
                    {effectivelyConnected && calendarAccounts.length === 0 && (
                      <div className="calendar-account-card">
                        <div className="account-info">
                          <span className="account-icon">📅</span>
                          <div>
                            <span className="account-email">{currentUser?.email || 'Primary Calendar'}</span>
                            <span className="account-meta">{contacts.length} contacts</span>
                          </div>
                        </div>
                        <div className="account-actions">
                          <button 
                            className="btn-text" 
                            onClick={handleConnect}
                            disabled={syncing}
                          >
                            {syncing ? 'Syncing...' : 'Sync'}
                          </button>
                        </div>
                      </div>
                    )}
                    {calendarAccounts.map(account => (
                      <div key={account.id} className="calendar-account-card">
                        <div className="account-info">
                          <span className="account-icon">📅</span>
                          <div>
                            <span className="account-email">{account.email}</span>
                            <span className="account-meta">
                              {account.contactsCount} contacts
                              {account.lastSyncedAt && ` • Last synced ${new Date(account.lastSyncedAt).toLocaleDateString()}`}
                            </span>
                          </div>
                        </div>
                        <div className="account-actions">
                          <button 
                            className="btn-text" 
                            onClick={() => handleSyncAccount(account.id)}
                            disabled={syncing}
                          >
                            Sync
                          </button>
                          <button 
                            className="btn-text danger" 
                            onClick={() => handleRemoveAccount(account.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add calendar button */}
                <div className="add-calendar-section">
                  {!effectivelyConnected && calendarAccounts.length === 0 ? (
                    <button 
                      className="btn-primary"
                      onClick={handleConnect}
                      disabled={syncing}
                    >
                      {syncing ? 'Connecting...' : 'Connect Google Calendar'}
                    </button>
                  ) : (
                    <button 
                      className="btn-secondary"
                      onClick={handleAddAnotherCalendar}
                    >
                      + Add Another Google Account
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Coming Soon Integrations */}
          <div className="integrations-grid coming-soon-section">
            {comingSoonIntegrations.map(integration => (
              <div 
                key={integration.id} 
                className="integration-card coming-soon"
              >
                <div className="integration-header">
                  <span className="integration-icon">{integration.icon}</span>
                  <span className="coming-soon-badge">Coming Soon</span>
                </div>
                <div className="integration-info">
                  <h3>{integration.name}</h3>
                  <p>{integration.description}</p>
                </div>
                <div className="integration-action">
                  <button className="btn-secondary" disabled>
                    Coming Soon
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="connect-info-section">
            <h2>Why connect your data?</h2>
            <div className="info-cards">
              <div className="info-card">
                <span className="info-icon">🔍</span>
                <h4>Discover Your Network</h4>
                <p>We analyze your meetings and communications to map your professional relationships.</p>
              </div>
              <div className="info-card">
                <span className="info-icon">🤝</span>
                <h4>Find Warm Intros</h4>
                <p>Get introduced to companies through people you already know and trust.</p>
              </div>
              <div className="info-card">
                <span className="info-icon">🔒</span>
                <h4>Private & Secure</h4>
                <p>Your data is encrypted and never shared. You control what's visible.</p>
              </div>
            </div>
          </div>
      </div>
    </div>
  );
}
