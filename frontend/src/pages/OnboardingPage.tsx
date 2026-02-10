import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState, useAppDispatch, useAppActions } from '../store';
import type { Contact } from '../store/types';
import { relationshipsApi } from '../lib/api';

export function OnboardingPage() {
  const { currentUser, contacts } = useAppState();
  const dispatch = useAppDispatch();
  const { syncCalendar } = useAppActions();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedContacts, setParsedContacts] = useState<Contact[]>([]);
  const [step, setStep] = useState<'choose' | 'review' | 'complete'>('choose');

  // If already has contacts, redirect
  if (contacts && contacts.length > 0 && step === 'choose') {
    navigate('/dashboard');
    return null;
  }

  const handleCalendarConnect = async () => {
    setIsProcessing(true);
    setError(null);
    
    try {
      // Sync the calendar
      await syncCalendar();
      
      // Then fetch ALL contacts (use high limit to get everything)
      const response = await relationshipsApi.getContacts({ limit: 1000 });
      
      // Handle different response formats (array or object with data)
      const realContacts = Array.isArray(response) 
        ? response 
        : (response?.data || []);
      
      if (!Array.isArray(realContacts)) {
        console.error('Unexpected contacts response format:', response);
        throw new Error('Failed to load contacts. Please try again.');
      }
      
      // Log how many we found
      const total = response?.pagination?.total || realContacts.length;
      console.log(`Loaded ${realContacts.length} of ${total} contacts`);
      
      // Transform API contacts to our Contact format
      const formattedContacts: Contact[] = realContacts.map((c: any) => ({
        id: c.id,
        email: c.email,
        name: c.name || null,
        title: c.title || null,
        isApproved: true,
        meetingsCount: c.meetingsCount || 1,
        lastSeenAt: c.lastSeenAt || new Date().toISOString(),
        company: c.company ? {
          id: c.company.id,
          domain: c.company.domain,
          name: c.company.name,
          logo: c.company.logo || `https://www.google.com/s2/favicons?domain=${c.company.domain}&sz=128`,
        } : null,
      }));
      
      if (formattedContacts.length === 0) {
        setError('No contacts found in your calendar. Try uploading a CSV instead.');
        setIsProcessing(false);
        return;
      }
      
      setParsedContacts(formattedContacts);
      setStep('review');
    } catch (err: any) {
      console.error('Calendar sync error:', err);
      const errorMessage = err.message || 'Failed to connect calendar. Please try again.';
      
      // Check if this is an auth error that requires re-login
      if (errorMessage.includes('expired') || errorMessage.includes('sign in') || err.needsReauth) {
        setError('Calendar access expired. Please sign out and sign in again to reconnect your calendar.');
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
          throw new Error('CSV must have a header row and at least one contact');
        }

        // Parse header
        const header = lines[0].toLowerCase().split(',').map(h => h.trim());
        const emailIndex = header.findIndex(h => h.includes('email'));
        const nameIndex = header.findIndex(h => h.includes('name') && !h.includes('company'));
        const titleIndex = header.findIndex(h => h.includes('title') || h.includes('role') || h.includes('position'));
        const companyIndex = header.findIndex(h => h.includes('company') || h.includes('organization'));

        if (emailIndex === -1) {
          throw new Error('CSV must have an "email" column');
        }

        const newContacts: Contact[] = [];
        
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
          const email = values[emailIndex];
          
          if (!email || !email.includes('@')) continue;
          
          const name = nameIndex !== -1 ? values[nameIndex] : email.split('@')[0];
          const title = titleIndex !== -1 ? values[titleIndex] : null;
          const companyName = companyIndex !== -1 ? values[companyIndex] : null;
          const domain = email.split('@')[1];

          newContacts.push({
            id: `csv-${Date.now()}-${i}`,
            email,
            name: name || null,
            title: title || null,
            isApproved: true,
            meetingsCount: 1,
            lastSeenAt: new Date().toISOString(),
            company: companyName ? {
              id: `company-${domain}`,
              domain,
              name: companyName,
              logo: `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
            } : null,
          });
        }

        if (newContacts.length === 0) {
          throw new Error('No valid contacts found in CSV');
        }

        setParsedContacts(newContacts);
        setStep('review');
      } catch (err: any) {
        setError(err.message || 'Failed to parse CSV');
      } finally {
        setIsProcessing(false);
      }
    };

    reader.onerror = () => {
      setError('Failed to read file');
      setIsProcessing(false);
    };

    reader.readAsText(file);
  };

  const handleAddContacts = () => {
    // Save to localStorage
    const savedContacts = localStorage.getItem('spaces_contacts');
    let existingContacts: Contact[] = [];
    try {
      existingContacts = savedContacts ? JSON.parse(savedContacts) : [];
    } catch (e) {
      console.warn('Failed to parse saved contacts, resetting:', e);
    }
    const allContacts = [...existingContacts, ...parsedContacts];
    localStorage.setItem('spaces_contacts', JSON.stringify(allContacts));

    // Update state
    parsedContacts.forEach(contact => {
      dispatch({ type: 'ADD_CONTACT', payload: contact });
    });

    setStep('complete');
    setTimeout(() => navigate('/network'), 1500);
  };

  const handleSkip = () => {
    // Add a single placeholder contact so they can proceed
    const placeholderContact: Contact = {
      id: `placeholder-${Date.now()}`,
      email: currentUser?.email || 'user@example.com',
      name: currentUser?.name || 'You',
      title: null,
      isApproved: true,
      meetingsCount: 0,
      lastSeenAt: new Date().toISOString(),
      company: null,
    };
    
    localStorage.setItem('spaces_contacts', JSON.stringify([placeholderContact]));
    dispatch({ type: 'ADD_CONTACT', payload: placeholderContact });
    navigate('/network');
  };

  if (step === 'complete') {
    return (
      <div className="onboarding-page">
        <div className="onboarding-card">
          <div className="onboarding-icon success">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h1>You're All Set!</h1>
          <p className="onboarding-description">
            Added {parsedContacts.length} contacts to your network. Redirecting...
          </p>
          <div className="loading-spinner"></div>
        </div>
      </div>
    );
  }

  if (step === 'review') {
    return (
      <div className="onboarding-page">
        <div className="onboarding-card wide">
          <button className="back-btn" onClick={() => setStep('choose')}>
            ← Back
          </button>
          <h1>Review Your Contacts</h1>
          <p className="onboarding-description">
            We found <strong>{parsedContacts.length} contacts</strong>. These will be added to your network.
          </p>

          <div className="contacts-list">
            {parsedContacts.map(contact => (
              <div key={contact.id} className="contact-item selected">
                <div className="contact-avatar">
                  {contact.company?.logo ? (
                    <img src={contact.company.logo} alt="" />
                  ) : (
                    <span>{(contact.name || contact.email).charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="contact-info">
                  <div className="contact-name">{contact.name || contact.email}</div>
                  <div className="contact-details">
                    {contact.company?.name && <span className="contact-company">{contact.company.name}</span>}
                    {contact.title && <span className="contact-title">{contact.title}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="onboarding-actions">
            <button className="btn-secondary" onClick={() => setStep('choose')}>
              Cancel
            </button>
            <button className="btn-primary btn-large" onClick={handleAddContacts}>
              Add {parsedContacts.length} Contacts
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Choose step
  return (
    <div className="onboarding-page">
      <div className="onboarding-card">
        <div className="onboarding-logo">
          <span className="logo-icon">✨</span>
          <h1>Welcome to Introo</h1>
        </div>
        <p className="onboarding-description">
          Build your professional network by connecting your calendar or uploading your contacts.
        </p>

        {error && (
          <div className="onboarding-error">
            {error}
            {(error.toLowerCase().includes('expired') || error.toLowerCase().includes('sign in') || error.toLowerCase().includes('reconnect')) && (
              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                <a href={`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/auth/logout`} className="btn-secondary">
                  Sign Out
                </a>
                <a href={`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/auth/google`} className="btn-primary">
                  Sign In Again
                </a>
              </div>
            )}
          </div>
        )}

        <div className="onboarding-options">
          {/* Calendar Option */}
          <button 
            className="onboarding-option-card"
            onClick={handleCalendarConnect}
            disabled={isProcessing}
          >
            <div className="option-icon">📅</div>
            <div className="option-content">
              <h3>Connect Calendar</h3>
              <p>We'll scan your meetings to find your professional contacts</p>
            </div>
            {isProcessing && <span className="loading-spinner small"></span>}
          </button>

          <div className="option-divider">
            <span>or</span>
          </div>

          {/* CSV Upload Option */}
          <button 
            className="onboarding-option-card"
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
          >
            <div className="option-icon">📄</div>
            <div className="option-content">
              <h3>Upload CSV</h3>
              <p>Import contacts from a spreadsheet with work emails</p>
            </div>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />

          <p className="csv-hint">
            CSV should have columns: email, name (optional), title (optional), company (optional)
          </p>
        </div>

        <div className="onboarding-footer">
          <button className="btn-text" onClick={handleSkip}>
            Skip for now →
          </button>
        </div>

        <p className="privacy-note">
          🔒 Your data stays private. We never share your contacts.
        </p>
      </div>
    </div>
  );
}
