import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAppState } from '../store';

function calculateStrength(lastSeenAt: string, meetingsCount: number): 'strong' | 'medium' | 'weak' {
  const daysSince = Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / (1000 * 60 * 60 * 24));
  if (daysSince <= 7 && meetingsCount >= 3) return 'strong';
  if (daysSince <= 30 && meetingsCount >= 2) return 'medium';
  return 'weak';
}

function daysSince(date: Date) {
  const days = Math.round((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { contacts: storeContacts } = useAppState();
  
  const contact = useMemo(() => {
    const baseContact = storeContacts.find(c => c.id === id);
    if (!baseContact) return null;
    
    return {
      id: baseContact.id,
      name: baseContact.name || baseContact.email.split('@')[0],
      email: baseContact.email,
      title: baseContact.title || null,
      company: baseContact.company?.name || null,
      companyDomain: baseContact.company?.domain || baseContact.email.split('@')[1] || '',
      companyLogo: baseContact.company?.logo || null,
      meetingsCount: baseContact.meetingsCount || 0,
      lastContacted: new Date(baseContact.lastSeenAt),
      connectionStrength: calculateStrength(baseContact.lastSeenAt, baseContact.meetingsCount),
    };
  }, [id, storeContacts]);

  if (!contact) {
    return (
      <div className="contact-detail-page">
        <div className="detail-empty">
          <h2>Contact not found</h2>
          <Link to="/network" className="btn-primary">Back to Network</Link>
        </div>
      </div>
    );
  }

  const initials = contact.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="contact-detail-page">
      <div className="contact-detail-header">
        <Link to="/network" className="back-link">← Back to Network</Link>
      </div>

      {/* Profile Card */}
      <div className="contact-profile-card">
        <div className="profile-banner">
          <div className="profile-avatar-wrapper">
            <div className="profile-avatar profile-initials">
              {initials}
            </div>
            <span className={`strength-dot ${contact.connectionStrength}`} />
          </div>
        </div>
        
        <div className="profile-info">
          <h1 className="profile-name">{contact.name}</h1>
          {contact.title && <p className="profile-headline">{contact.title}</p>}
          {contact.company && <p className="profile-company">{contact.company}</p>}
          
          <div className="profile-meta">
            <span className="meta-item">{contact.meetingsCount} meeting{contact.meetingsCount !== 1 ? 's' : ''}</span>
            <span className="meta-divider">·</span>
            <span className={`connection-strength ${contact.connectionStrength}`}>
              {contact.connectionStrength} connection
            </span>
          </div>

          <div className="profile-actions">
            <a href={`mailto:${contact.email}`} className="btn-primary">
              Send Email
            </a>
          </div>
        </div>
      </div>

      {/* Contact Info - Only show real data */}
      <div className="contact-section">
        <h2>Contact Info</h2>
        <div className="contact-info-list">
          <div className="contact-info-item">
            <span className="contact-info-label">Email</span>
            <a href={`mailto:${contact.email}`} className="contact-info-value link">{contact.email}</a>
          </div>
          {contact.company && (
            <div className="contact-info-item">
              <span className="contact-info-label">Company</span>
              <span className="contact-info-value">{contact.company}</span>
            </div>
          )}
          {contact.companyDomain && (
            <div className="contact-info-item">
              <span className="contact-info-label">Domain</span>
              <span className="contact-info-value">{contact.companyDomain}</span>
            </div>
          )}
          {contact.title && (
            <div className="contact-info-item">
              <span className="contact-info-label">Title</span>
              <span className="contact-info-value">{contact.title}</span>
            </div>
          )}
        </div>
      </div>

      {/* Meeting History - Real data */}
      <div className="contact-section">
        <h2>Connection History</h2>
        <div className="contact-info-list">
          <div className="contact-info-item">
            <span className="contact-info-label">Total Meetings</span>
            <span className="contact-info-value">{contact.meetingsCount}</span>
          </div>
          <div className="contact-info-item">
            <span className="contact-info-label">Last Contact</span>
            <span className="contact-info-value">{daysSince(contact.lastContacted)}</span>
          </div>
          <div className="contact-info-item">
            <span className="contact-info-label">Connection Strength</span>
            <span className={`contact-info-value connection-strength ${contact.connectionStrength}`}>
              {contact.connectionStrength.charAt(0).toUpperCase() + contact.connectionStrength.slice(1)}
            </span>
          </div>
        </div>
      </div>

      {/* Company Info - Only if we have it */}
      {contact.company && (
        <div className="contact-section">
          <h2>Company</h2>
          <div className="company-link-card">
            <div className="company-link-logo">
              {contact.companyLogo ? (
                <img src={contact.companyLogo} alt="" />
              ) : (
                contact.company.charAt(0)
              )}
            </div>
            <div className="company-link-info">
              <span className="company-link-name">{contact.company}</span>
              <span className="company-link-domain">{contact.companyDomain}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
