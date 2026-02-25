import { useState } from 'react';
import { enrichmentApi } from '../../lib/api';
import { PersonAvatar, CompanyLogo } from '../../components';
import type { User, MergedCompany, InlinePanel } from '../../types';

interface ProfilePanelProps {
  currentUser: User;
  profileForm: { name: string; title: string; companyDomain: string; linkedinUrl: string; headline: string; city: string; country: string };
  profileDirty: boolean;
  profileSaving: boolean;
  mergedCompanies: MergedCompany[];
  onUpdateField: (field: string, value: string) => void;
  onSave: () => void;
  onNavigate: (panel: InlinePanel) => void;
}

export function ProfilePanel({
  currentUser, profileForm, profileDirty, profileSaving,
  mergedCompanies, onUpdateField, onSave, onNavigate,
}: ProfilePanelProps) {
  const labelStyle = { fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', marginBottom: '-0.2rem' } as const;
  const [companyLoading, setCompanyLoading] = useState(false);

  const openCompany = async () => {
    const domain = currentUser.companyDomain;
    if (!domain) return;
    setCompanyLoading(true);
    const existing = mergedCompanies.find(c => c.domain === domain);
    if (existing) {
      onNavigate({ type: 'company', company: existing, fromProfile: true });
      return;
    }
    try {
      const { company: co, source } = await enrichmentApi.lookupCompany(domain);
      const stub: MergedCompany = {
        id: co.id || undefined,
        domain: co.domain || domain,
        name: co.name || domain,
        myContacts: [], spaceContacts: [],
        myCount: 0, spaceCount: 0, totalCount: 0,
        hasStrongConnection: false, bestStrength: 'none',
        source: 'mine', matchingViews: [], spaceIds: [], connectionIds: [],
        employeeCount: co.employeeCount, foundedYear: co.foundedYear,
        annualRevenue: co.annualRevenue, totalFunding: co.totalFunding,
        lastFundingRound: co.lastFundingRound, lastFundingDate: co.lastFundingDate,
        city: co.city, country: co.country,
        industry: co.industry, description: co.description,
        linkedinUrl: co.linkedinUrl,
        enrichedAt: source !== 'none' ? co.enrichedAt || new Date().toISOString() : null,
      };
      onNavigate({ type: 'company', company: stub, fromProfile: true });
    } catch {
      onNavigate({ type: 'company', fromProfile: true, company: {
        domain, name: currentUser.company || domain,
        myContacts: [], spaceContacts: [],
        myCount: 0, spaceCount: 0, totalCount: 0,
        hasStrongConnection: false, bestStrength: 'none',
        source: 'mine', matchingViews: [], spaceIds: [], connectionIds: [],
      }});
    } finally {
      setCompanyLoading(false);
    }
  };

  return (
    <div className="u-panel-space">
      <div className="u-panel-space-hero">
        <PersonAvatar email={currentUser.email} name={currentUser.name} avatarUrl={currentUser.avatar} size={56} />
        <div>
          <h2>{currentUser.name}</h2>
          <span className="u-panel-space-meta">{currentUser.email}</span>
        </div>
      </div>

      <div className="u-panel-section">
        <h4 className="u-panel-section-h">Edit Profile</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <label style={labelStyle}>Name</label>
          <input className="sb-input" placeholder="Your name" value={profileForm.name} onChange={e => onUpdateField('name', e.target.value)} />
          <label style={labelStyle}>Job title</label>
          <input className="sb-input" placeholder="e.g. Product Manager" value={profileForm.title} onChange={e => onUpdateField('title', e.target.value)} />
          <label style={labelStyle}>Company website</label>
          <input className="sb-input" placeholder="e.g. acme.com" value={profileForm.companyDomain} onChange={e => onUpdateField('companyDomain', e.target.value)} />
          {currentUser.companyDomain && (
            <button
              className="u-panel-breadcrumb"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.1rem', fontSize: '0.7rem', padding: '0.3rem 0.5rem', background: 'rgba(255,255,255,0.04)', borderRadius: '0.4rem', opacity: companyLoading ? 0.5 : 1 }}
              onClick={openCompany}
              disabled={companyLoading}
            >
              <CompanyLogo domain={currentUser.companyDomain} name={currentUser.company || currentUser.companyDomain} size={16} />
              <span>{companyLoading ? 'Loading...' : (currentUser.company || currentUser.companyDomain)}</span>
              <span style={{ color: 'rgba(255,255,255,0.3)' }}>→</span>
            </button>
          )}
          <label style={labelStyle}>Headline / Bio</label>
          <input className="sb-input" placeholder="Short description about you" value={profileForm.headline} onChange={e => onUpdateField('headline', e.target.value)} />
          <label style={labelStyle}>LinkedIn URL</label>
          <input className="sb-input" placeholder="https://linkedin.com/in/..." value={profileForm.linkedinUrl} onChange={e => onUpdateField('linkedinUrl', e.target.value)} />
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <div style={{ flex: 1 }}>
              <label style={{ ...labelStyle, display: 'block', marginBottom: '0.15rem' }}>City</label>
              <input className="sb-input" placeholder="City" value={profileForm.city} onChange={e => onUpdateField('city', e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ ...labelStyle, display: 'block', marginBottom: '0.15rem' }}>Country</label>
              <input className="sb-input" placeholder="Country" value={profileForm.country} onChange={e => onUpdateField('country', e.target.value)} />
            </div>
          </div>
        </div>
        <button
          className={`u-action-btn ${profileDirty ? '' : 'u-action-btn--muted'}`}
          style={{ marginTop: '0.6rem', width: '100%' }}
          onClick={onSave}
          disabled={profileSaving || !profileDirty}
        >
          {profileSaving ? 'Saving...' : profileDirty ? 'Save changes' : 'No changes'}
        </button>
      </div>
    </div>
  );
}
