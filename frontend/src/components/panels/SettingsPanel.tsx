import { calendarApi, type CalendarAccountInfo } from '../../lib/api';
import { PersonAvatar } from '../../components';
import { resetOnboarding } from '../../components/OnboardingTour';
import type { User } from '../../types';

interface SettingsPanelProps {
  currentUser: User | null;
  isCalendarConnected: boolean;
  calendarAccounts: CalendarAccountInfo[];
  calendarSyncing: boolean;
  syncingAccountId: string | null;
  enriching: boolean;
  enrichStats: {
    contacts: { total: number; enriched: number; identified?: number; notFound?: number; pending?: number };
    companies: { total: number; enriched: number };
    lastEnrichedAt?: string | null;
  } | null;
  enrichError: string | null;
  enrichProgress: {
    contacts: { total: number; enriched: number; skipped: number; errors: number; done: boolean } | null;
    companies: { total: number; enriched: number; skipped: number; errors: number; done: boolean } | null;
    contactsFree?: { total: number; enriched: number; skipped: number; errors: number; done: boolean; error?: string | null } | null;
  };
  onCalendarSync: () => void;
  onAccountSync: (accountId: string) => void;
  onAccountDelete: (accountId: string) => void;
  onStartEnrichment: () => void;
  onStopEnrichment: () => void;
  onLogout: () => void;
}

export function SettingsPanel({
  currentUser, isCalendarConnected, calendarAccounts,
  calendarSyncing, syncingAccountId,
  enriching, enrichStats, enrichError, enrichProgress,
  onCalendarSync, onAccountSync, onAccountDelete,
  onStartEnrichment, onStopEnrichment, onLogout,
}: SettingsPanelProps) {
  return (
    <div className="u-panel-settings">
      <h2>Settings</h2>

      {/* Main Account */}
      <div className="u-panel-section">
        <h4 className="u-panel-section-h">Main Account</h4>
        {currentUser && (() => {
          const primaryAcct = calendarAccounts.find(a => currentUser.email && a.email.toLowerCase() === currentUser.email.toLowerCase());
          return (
            <>
              <div className="u-settings-account">
                <PersonAvatar email={currentUser.email} name={currentUser.name} avatarUrl={currentUser.avatar} size={40} />
                <div className="u-settings-account-info">
                  <span className="u-settings-account-name">{currentUser.name}</span>
                  <span className="u-settings-account-email">{currentUser.email}</span>
                </div>
                {isCalendarConnected && (
                  <button
                    className="u-action-btn"
                    onClick={() => primaryAcct ? onAccountSync(primaryAcct.id) : onCalendarSync()}
                    disabled={calendarSyncing || (primaryAcct ? syncingAccountId === primaryAcct.id : false)}
                    style={{ marginLeft: 'auto', flexShrink: 0 }}
                  >
                    {(primaryAcct && syncingAccountId === primaryAcct.id) || (!primaryAcct && calendarSyncing) ? 'Syncing...' : 'Sync'}
                  </button>
                )}
              </div>
              {primaryAcct && (
                <span className="u-settings-sync-meta">
                  {primaryAcct.contactsCount} contacts
                  {primaryAcct.lastSyncedAt && (
                    <> &middot; last synced {new Date(primaryAcct.lastSyncedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                  )}
                </span>
              )}
            </>
          );
        })()}
      </div>

      <span className="u-settings-hint">People can find and connect with you using your main or any connected email.</span>

      {/* Connected Accounts */}
      <div className="u-panel-section">
        <h4 className="u-panel-section-h">Connected Accounts</h4>

        {calendarAccounts
          .filter(acct => !(currentUser?.email && acct.email.toLowerCase() === currentUser.email.toLowerCase()))
          .map(acct => (
            <div key={acct.id} className="u-settings-row">
              <div className="u-settings-row-info">
                <span className="u-settings-row-label">{acct.email}</span>
                <span className="u-settings-row-status">
                  <span className="u-settings-dot connected" /> {acct.contactsCount} contacts
                  {acct.lastSyncedAt && <> &middot; synced {new Date(acct.lastSyncedAt).toLocaleDateString()}</>}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                <button className="u-action-btn" onClick={() => onAccountSync(acct.id)} disabled={syncingAccountId === acct.id}>
                  {syncingAccountId === acct.id ? 'Syncing...' : 'Sync'}
                </button>
                <button className="u-action-btn" style={{ color: 'var(--danger, #e55)' }} onClick={() => onAccountDelete(acct.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))
        }

        {isCalendarConnected && (
          <div className="u-settings-row" style={{ borderTop: '1px solid var(--border)', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
            <div className="u-settings-row-info">
              <span className="u-settings-row-label">Add Google Account</span>
              <span className="u-settings-row-status">Connect additional calendars</span>
            </div>
            <button className="u-action-btn" onClick={() => { window.location.href = calendarApi.getAddAccountUrl(); }}>
              + Add
            </button>
          </div>
        )}

        <div className="u-settings-row u-settings-row-disabled">
          <div className="u-settings-row-info">
            <span className="u-settings-row-label">LinkedIn</span>
            <span className="u-settings-row-status">Import connections</span>
          </div>
          <span className="u-settings-coming-soon">Coming soon</span>
        </div>
        <div className="u-settings-row u-settings-row-disabled">
          <div className="u-settings-row-info">
            <span className="u-settings-row-label">Microsoft Outlook</span>
            <span className="u-settings-row-status">Calendar & email contacts</span>
          </div>
          <span className="u-settings-coming-soon">Coming soon</span>
        </div>
        <div className="u-settings-row u-settings-row-disabled">
          <div className="u-settings-row-info">
            <span className="u-settings-row-label">Email (Gmail / IMAP)</span>
            <span className="u-settings-row-status">People you've emailed</span>
          </div>
          <span className="u-settings-coming-soon">Coming soon</span>
        </div>
      </div>

      {/* Data Enrichment */}
      <div className="u-panel-section">
        <h4 className="u-panel-section-h">Data Enrichment</h4>
        <div className="u-settings-row">
          <div className="u-settings-row-info">
            <span className="u-settings-row-label">Auto-enrich</span>
            <span className="u-settings-row-status">
              {enriching ? (
                <><span className="u-enrich-spinner" /> Running...</>
              ) : enrichStats ? (
                <>{enrichStats.contacts.identified ?? 0} contacts &amp; {enrichStats.companies.enriched} companies enriched{(enrichStats.contacts.notFound ?? 0) > 0 ? <>, {enrichStats.contacts.notFound} not found</> : null}{(enrichStats.contacts.pending ?? 0) > 0 ? <> &middot; <strong>{enrichStats.contacts.pending} new</strong></> : null}</>
              ) : (
                <>Loading...</>
              )}
            </span>
          </div>
          {enriching ? (
            <button
              className="u-action-btn u-action-btn--stop"
              onClick={onStopEnrichment}
            >
              Stop
            </button>
          ) : (
            <button
              className="u-action-btn"
              onClick={onStartEnrichment}
              disabled={!enrichStats || (enrichStats.contacts.pending ?? 0) === 0}
            >
              {enrichStats && (enrichStats.contacts.pending ?? 0) > 0
                ? `Enrich ${enrichStats.contacts.pending} new`
                : 'All enriched'}
            </button>
          )}
        </div>
        <span className="u-settings-meta">
          {enrichStats?.lastEnrichedAt ? (
            <>Last updated {new Date(enrichStats.lastEnrichedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}. </>
          ) : null}
          Runs automatically every week.
        </span>
        {enrichError && !enriching && (
          <div style={{ marginTop: '0.4rem', padding: '0.35rem 0.5rem', background: 'rgba(229,115,115,0.12)', border: '1px solid rgba(229,115,115,0.3)', borderRadius: '6px', fontSize: '0.72rem', color: '#e57373' }}>
            {enrichError}
          </div>
        )}
        {enriching && (enrichProgress.contacts || enrichProgress.companies || enrichProgress.contactsFree) && (
          <div className="u-enrich-progress" style={{ marginTop: '0.5rem' }}>
            {enrichProgress.contactsFree && (
              <div className="u-enrich-progress-row">
                <span className="u-enrich-progress-label">Contacts</span>
                <div className="u-enrich-progress-bar">
                  <div
                    className="u-enrich-progress-fill"
                    style={{ width: `${enrichProgress.contactsFree.total > 0 ? ((enrichProgress.contactsFree.enriched + enrichProgress.contactsFree.skipped + enrichProgress.contactsFree.errors) / enrichProgress.contactsFree.total) * 100 : 0}%` }}
                  />
                </div>
                <span className="u-enrich-progress-text">
                  {enrichProgress.contactsFree.enriched}/{enrichProgress.contactsFree.total}
                  {enrichProgress.contactsFree.done && ' ✓'}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <button
        className="u-settings-replay-tour"
        onClick={() => { resetOnboarding(); window.location.reload(); }}
      >
        Replay onboarding tour
      </button>

      <button className="u-settings-logout-bottom" onClick={onLogout}>
        Log out
      </button>
    </div>
  );
}
