import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState, useAppActions } from '../store';

const integrations = [
  { 
    id: 'google', 
    name: 'Google Calendar', 
    icon: '📅', 
    description: 'Connect your Google Workspace calendar',
    connected: false 
  },
  { 
    id: 'outlook', 
    name: 'Outlook Calendar', 
    icon: '📆', 
    description: 'Connect your Microsoft 365 calendar',
    connected: false 
  },
  { 
    id: 'linkedin', 
    name: 'LinkedIn', 
    icon: '💼', 
    description: 'Import your professional connections',
    connected: false,
    comingSoon: true 
  },
  { 
    id: 'gmail', 
    name: 'Gmail', 
    icon: '✉️', 
    description: 'Analyze your email communications',
    connected: false,
    comingSoon: true 
  },
];

export function ConnectPage() {
  const { isCalendarConnected } = useAppState();
  const { syncCalendar } = useAppActions();
  const navigate = useNavigate();
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectedIds, setConnectedIds] = useState<string[]>(
    isCalendarConnected ? ['google'] : []
  );

  const handleConnect = async (integrationId: string) => {
    setSyncingId(integrationId);
    setError(null);
    try {
      await syncCalendar();
      setConnectedIds(prev => [...prev, integrationId]);
      // Don't navigate immediately, let user see the connected state
    } catch (err: any) {
      setError(err.message || 'Failed to sync calendar');
    } finally {
      setSyncingId(null);
    }
  };

  const connectedCount = connectedIds.length;

  return (
    <div className="crm-page">
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

      <div className="crm-layout">
        <div className="crm-content">
          {error && (
            <div className="connect-error-banner">
              <span>⚠️</span> {error}
              <button onClick={() => setError(null)}>×</button>
            </div>
          )}

          <div className="integrations-grid">
            {integrations.map(integration => {
              const isConnected = connectedIds.includes(integration.id);
              const isSyncing = syncingId === integration.id;
              
              return (
                <div 
                  key={integration.id} 
                  className={`integration-card ${isConnected ? 'connected' : ''} ${integration.comingSoon ? 'coming-soon' : ''}`}
                >
                  <div className="integration-header">
                    <span className="integration-icon">{integration.icon}</span>
                    {isConnected && <span className="connected-badge">✓ Connected</span>}
                    {integration.comingSoon && <span className="coming-soon-badge">Coming Soon</span>}
                  </div>
                  <div className="integration-info">
                    <h3>{integration.name}</h3>
                    <p>{integration.description}</p>
                  </div>
                  <div className="integration-action">
                    {isConnected ? (
                      <button className="btn-secondary" disabled>
                        Connected
                      </button>
                    ) : integration.comingSoon ? (
                      <button className="btn-secondary" disabled>
                        Coming Soon
                      </button>
                    ) : (
                      <button 
                        className="btn-primary"
                        onClick={() => handleConnect(integration.id)}
                        disabled={isSyncing}
                      >
                        {isSyncing ? (
                          <>
                            <span className="loading-spinner small"></span>
                            Connecting...
                          </>
                        ) : (
                          'Connect'
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
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
    </div>
  );
}
