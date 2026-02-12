import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState } from '../store';
import { API_BASE } from '../lib/api';
import { calculateStrength } from '../types';
import { PersonAvatar, CompanyLogo } from '../components';
import { openOfferIntroEmail } from '../lib/offerIntro';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SpaceCompany {
  id: string;
  domain: string;
  name: string;
  industry?: string;
  contactCount: number;
  contacts: {
    id: string; name: string; email: string; title?: string;
    userId: string; userName: string;
  }[];
}

interface Space {
  id: string; name: string; emoji: string; memberCount?: number;
}

interface DisplayContact {
  id: string; name: string; email: string; title: string;
  company: string; companyDomain: string;
  lastSeenAt: string; meetingsCount: number;
  connectionStrength: 'strong' | 'medium' | 'weak';
}

interface MergedCompany {
  domain: string;
  name: string;
  myContacts: DisplayContact[];
  spaceContacts: { id: string; name: string; email: string; title?: string; userName: string }[];
  myCount: number;
  spaceCount: number;
  totalCount: number;
  hasStrongConnection: boolean;
  source: 'mine' | 'space' | 'both';
  matchingHunts: string[];
}

interface Hunt {
  id: string;
  title: string;
  keywords: string[];
  isActive: boolean;
}

interface InlinePanel {
  type: 'person' | 'intro-request' | 'intro-offer';
  company?: MergedCompany;
  contact?: DisplayContact | { id: string; name: string; email: string; title?: string; userName?: string };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AIHomePage() {
  const navigate = useNavigate();
  const { currentUser, contacts: storeContacts } = useAppState();
  const searchRef = useRef<HTMLInputElement>(null);

  // UI State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedHunt, setSelectedHunt] = useState<string | null>(null);
  const [showHuntInput, setShowHuntInput] = useState(false);
  const [newHuntText, setNewHuntText] = useState('');
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const [inlinePanel, setInlinePanel] = useState<InlinePanel | null>(null);
  const [showSignals, setShowSignals] = useState(false);

  // Data
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [spaceCompanies, setSpaceCompanies] = useState<SpaceCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [hunts, setHunts] = useState<Hunt[]>([
    { id: '1', title: 'CTO at Series A Fintech', keywords: ['cto', 'chief technology', 'fintech'], isActive: true },
  ]);

  // ─── Data transforms ────────────────────────────────────────────────────────

  const contacts: DisplayContact[] = useMemo(() => {
    return storeContacts.filter(c => c.isApproved).map(c => ({
      id: c.id,
      name: c.name || c.email.split('@')[0],
      email: c.email,
      title: c.title || '',
      company: c.company?.name || '',
      companyDomain: c.company?.domain || c.email.split('@')[1] || '',
      lastSeenAt: c.lastSeenAt,
      meetingsCount: c.meetingsCount,
      connectionStrength: calculateStrength(c.lastSeenAt, c.meetingsCount),
    }));
  }, [storeContacts]);

  // Merge my network + space network into unified view
  const mergedCompanies = useMemo((): MergedCompany[] => {
    const map = new Map<string, MergedCompany>();

    // My contacts
    contacts.forEach(c => {
      const d = c.companyDomain || 'unknown';
      if (!map.has(d)) {
        map.set(d, {
          domain: d, name: c.company || d,
          myContacts: [], spaceContacts: [],
          myCount: 0, spaceCount: 0, totalCount: 0,
          hasStrongConnection: false, source: 'mine', matchingHunts: [],
        });
      }
      const co = map.get(d)!;
      co.myContacts.push(c);
      co.myCount++;
      co.totalCount++;
      if (c.connectionStrength === 'strong') co.hasStrongConnection = true;
    });

    // Space contacts
    spaceCompanies.forEach(sc => {
      if (!map.has(sc.domain)) {
        map.set(sc.domain, {
          domain: sc.domain, name: sc.name,
          myContacts: [], spaceContacts: [],
          myCount: 0, spaceCount: 0, totalCount: 0,
          hasStrongConnection: false, source: 'space', matchingHunts: [],
        });
      }
      const co = map.get(sc.domain)!;
      sc.contacts.forEach(contact => {
        if (!co.spaceContacts.some(ec => ec.email === contact.email) &&
            !co.myContacts.some(mc => mc.email === contact.email)) {
          co.spaceContacts.push(contact);
          co.spaceCount++;
          co.totalCount++;
        }
      });
      if (co.myCount > 0 && co.spaceCount > 0) co.source = 'both';
      else if (co.spaceCount > 0 && co.myCount === 0) co.source = 'space';
    });

    // Match hunts
    const companies = Array.from(map.values());
    companies.forEach(co => {
      hunts.forEach(hunt => {
        const allText = [
          co.name, co.domain,
          ...co.myContacts.map(c => `${c.title} ${c.name}`),
          ...co.spaceContacts.map(c => `${c.title || ''} ${c.name}`),
        ].join(' ').toLowerCase();

        if (hunt.keywords.some(k => allText.includes(k))) {
          co.matchingHunts.push(hunt.id);
        }
      });
    });

    return companies.sort((a, b) => {
      // Both > mine > space, then by strong > count
      const sourceOrder = { both: 0, mine: 1, space: 2 };
      if (sourceOrder[a.source] !== sourceOrder[b.source]) return sourceOrder[a.source] - sourceOrder[b.source];
      if (a.hasStrongConnection !== b.hasStrongConnection) return a.hasStrongConnection ? -1 : 1;
      return b.totalCount - a.totalCount;
    });
  }, [contacts, spaceCompanies, hunts]);

  // Filter by search + active hunt
  const filteredCompanies = useMemo(() => {
    let result = mergedCompanies;

    // Filter by active hunt
    if (selectedHunt) {
      result = result.filter(c => c.matchingHunts.includes(selectedHunt));
    }

    // Filter by search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.domain.toLowerCase().includes(q) ||
        c.myContacts.some(contact => contact.name.toLowerCase().includes(q) || contact.title.toLowerCase().includes(q)) ||
        c.spaceContacts.some(contact => contact.name.toLowerCase().includes(q) || (contact.title || '').toLowerCase().includes(q))
      );
    }

    return result;
  }, [mergedCompanies, selectedHunt, searchQuery]);

  // Hunt match counts
  const huntMatchCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    hunts.forEach(h => {
      counts[h.id] = mergedCompanies.filter(c => c.matchingHunts.includes(h.id)).length;
    });
    return counts;
  }, [hunts, mergedCompanies]);

  // Stats
  const stats = useMemo(() => ({
    myCompanies: mergedCompanies.filter(c => c.source === 'mine' || c.source === 'both').length,
    spaceCompanies: mergedCompanies.filter(c => c.source === 'space' || c.source === 'both').length,
    overlap: mergedCompanies.filter(c => c.source === 'both').length,
    total: mergedCompanies.length,
    strongTies: contacts.filter(c => c.connectionStrength === 'strong').length,
  }), [mergedCompanies, contacts]);

  // Signals (derived)
  const signals = useMemo(() => {
    const items: { id: string; icon: string; text: string; detail: string; huntId?: string }[] = [];

    hunts.forEach(h => {
      const count = huntMatchCounts[h.id] || 0;
      if (count > 0) {
        items.push({
          id: `match-${h.id}`, icon: '🎯',
          text: `${count} companies match "${h.title}"`,
          detail: 'Click hunt to filter', huntId: h.id,
        });
      }
    });

    const overlapCount = stats.overlap;
    if (overlapCount > 0) {
      items.push({
        id: 'overlap', icon: '🔗',
        text: `${overlapCount} companies in both your & space networks`,
        detail: 'Best intro paths',
      });
    }

    return items;
  }, [hunts, huntMatchCounts, stats.overlap]);

  // ─── Data fetching ──────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/spaces`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSpaces(data.map((s: any) => ({ id: s.id, name: s.name, emoji: s.emoji, memberCount: s.members?.length || 0 })));
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (spaces.length === 0) return;
    Promise.all(
      spaces.map(s =>
        fetch(`${API_BASE}/api/spaces/${s.id}/reach`, { credentials: 'include' })
          .then(r => r.ok ? r.json() : { companies: [] }).catch(() => ({ companies: [] }))
      )
    ).then(results => {
      const map = new Map<string, SpaceCompany>();
      results.forEach(r => {
        (r.companies || []).forEach((c: SpaceCompany) => {
          if (!map.has(c.domain)) map.set(c.domain, c);
          else {
            const ex = map.get(c.domain)!;
            const emails = new Set(ex.contacts.map(x => x.email));
            c.contacts.forEach(x => { if (!emails.has(x.email)) { ex.contacts.push(x); ex.contactCount++; } });
          }
        });
      });
      setSpaceCompanies(Array.from(map.values()));
    });
  }, [spaces]);

  // ─── Keyboard ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setInlinePanel(null);
        setShowSignals(false);
        setSearchQuery('');
        setSelectedHunt(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ─── Actions ────────────────────────────────────────────────────────────────

  const toggleHunt = useCallback((huntId: string) => {
    setSelectedHunt(prev => prev === huntId ? null : huntId);
    setExpandedDomain(null);
  }, []);

  const addHunt = useCallback(() => {
    if (!newHuntText.trim()) return;
    const keywords = newHuntText.toLowerCase().split(/[\s,]+/).filter(k => k.length > 2);
    setHunts(prev => [...prev, {
      id: Date.now().toString(),
      title: newHuntText.trim(),
      keywords,
      isActive: true,
    }]);
    setNewHuntText('');
    setShowHuntInput(false);
  }, [newHuntText]);

  const removeHunt = useCallback((id: string) => {
    setHunts(prev => prev.filter(h => h.id !== id));
    if (selectedHunt === id) setSelectedHunt(null);
  }, [selectedHunt]);

  const openIntroPanel = useCallback((company: MergedCompany) => {
    setInlinePanel({ type: 'intro-request', company });
  }, []);

  const openPersonPanel = useCallback((contact: DisplayContact | { id: string; name: string; email: string; title?: string; userName?: string }, company?: MergedCompany) => {
    setInlinePanel({ type: 'person', contact, company });
  }, []);

  const handleOfferIntro = useCallback((contact: { email: string; name: string }, companyName: string) => {
    openOfferIntroEmail({
      requesterEmail: contact.email,
      requesterName: contact.name,
      targetCompany: companyName,
      senderName: currentUser?.name,
    });
  }, [currentUser]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="u-root">
      <div className="u-ambient" />

      <div className={`u-canvas ${inlinePanel ? 'has-panel' : ''}`}>
        {/* ── Top Bar ─────────────────────────────────────────────── */}
        <header className="u-topbar">
          <div className={`u-search ${searchFocused ? 'focused' : ''}`}>
            <svg className="u-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="Search people, companies..."
            />
            {searchQuery && (
              <button className="u-search-clear" onClick={() => setSearchQuery('')}>×</button>
            )}
            <kbd className="u-kbd">⌘K</kbd>
          </div>

          <div className="u-topbar-right">
            <button
              className={`u-signals-btn ${signals.length > 0 ? 'has-signals' : ''}`}
              onClick={() => setShowSignals(!showSignals)}
            >
              <span>📡</span>
              {signals.length > 0 && <span className="u-signals-badge">{signals.length}</span>}
            </button>
            <button className="u-action-btn" onClick={() => navigate('/spaces')}>
              Spaces
            </button>
            <button className="u-primary-btn" onClick={() => setInlinePanel({ type: 'intro-request' })}>
              ✨ Request Intro
            </button>
          </div>
        </header>

        {/* ── Signals Dropdown ────────────────────────────────────── */}
        {showSignals && (
          <div className="u-signals-dropdown">
            {signals.length === 0 ? (
              <div className="u-signals-empty">No new signals</div>
            ) : (
              signals.map(s => (
                <div
                  key={s.id}
                  className="u-signal-row"
                  onClick={() => { if (s.huntId) { toggleHunt(s.huntId); setShowSignals(false); } }}
                >
                  <span className="u-signal-icon">{s.icon}</span>
                  <div className="u-signal-text">
                    <span className="u-signal-main">{s.text}</span>
                    <span className="u-signal-detail">{s.detail}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Hunts Bar ───────────────────────────────────────────── */}
        <div className="u-hunts-bar">
          <span className="u-hunts-label">Hunts</span>
          {hunts.map(h => (
            <button
              key={h.id}
              className={`u-hunt-pill ${selectedHunt === h.id ? 'active' : ''} ${(huntMatchCounts[h.id] || 0) > 0 ? 'has-matches' : ''}`}
              onClick={() => toggleHunt(h.id)}
            >
              <span className="u-hunt-pill-text">{h.title}</span>
              {(huntMatchCounts[h.id] || 0) > 0 && (
                <span className="u-hunt-pill-count">{huntMatchCounts[h.id]}</span>
              )}
              <button className="u-hunt-pill-x" onClick={(e) => { e.stopPropagation(); removeHunt(h.id); }}>×</button>
            </button>
          ))}
          {showHuntInput ? (
            <div className="u-hunt-input-wrap">
              <input
                autoFocus
                value={newHuntText}
                onChange={e => setNewHuntText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addHunt(); if (e.key === 'Escape') setShowHuntInput(false); }}
                placeholder="VP Sales at SaaS..."
              />
              <button onClick={addHunt}>Add</button>
            </div>
          ) : (
            <button className="u-hunt-add" onClick={() => setShowHuntInput(true)}>+ Add hunt</button>
          )}
        </div>

        {/* ── Stats Strip ─────────────────────────────────────────── */}
        <div className="u-stats-strip">
          <span className="u-stat">
            <strong>{stats.total}</strong> companies
          </span>
          <span className="u-stat-dot" />
          <span className="u-stat">
            <strong>{contacts.length}</strong> contacts
          </span>
          <span className="u-stat-dot" />
          <span className="u-stat u-stat--highlight">
            <strong>{stats.overlap}</strong> overlap
          </span>
          <span className="u-stat-dot" />
          <span className="u-stat u-stat--strong">
            <strong>{stats.strongTies}</strong> strong
          </span>
          {selectedHunt && (
            <>
              <span className="u-stat-dot" />
              <span className="u-stat u-stat--filter">
                Showing <strong>{filteredCompanies.length}</strong> matches
                <button onClick={() => setSelectedHunt(null)}>Clear</button>
              </span>
            </>
          )}
        </div>

        {/* ── Company Grid ────────────────────────────────────────── */}
        <div className="u-grid">
          {loading ? (
            <div className="u-grid-loading"><div className="u-spinner" /> Loading...</div>
          ) : filteredCompanies.length === 0 ? (
            <div className="u-grid-empty">
              <span className="u-grid-empty-icon">{searchQuery || selectedHunt ? '🔍' : '📅'}</span>
              <span>{searchQuery ? `No results for "${searchQuery}"` : selectedHunt ? 'No matches for this hunt' : 'Connect your calendar to get started'}</span>
              {!searchQuery && !selectedHunt && (
                <button onClick={() => navigate('/connect')}>Connect Calendar</button>
              )}
            </div>
          ) : (
            filteredCompanies.slice(0, 80).map(company => (
              <div
                key={company.domain}
                className={[
                  'u-tile',
                  expandedDomain === company.domain ? 'expanded' : '',
                  company.source === 'both' ? 'u-tile--overlap' : '',
                  company.matchingHunts.length > 0 ? 'u-tile--hunt-match' : '',
                ].filter(Boolean).join(' ')}
              >
                {/* Source badge */}
                <div className={`u-tile-source u-tile-source--${company.source}`}>
                  {company.source === 'both' ? '⚡' : company.source === 'mine' ? '👤' : '🌐'}
                </div>

                {/* Hunt match indicator */}
                {company.matchingHunts.length > 0 && (
                  <div className="u-tile-hunt-tags">
                    {company.matchingHunts.map(hId => {
                      const h = hunts.find(x => x.id === hId);
                      return h ? <span key={hId} className="u-tile-hunt-tag">{h.title}</span> : null;
                    })}
                  </div>
                )}

                {/* Header */}
                <div
                  className="u-tile-header"
                  onClick={() => setExpandedDomain(expandedDomain === company.domain ? null : company.domain)}
                >
                  <CompanyLogo domain={company.domain} name={company.name} size={28} />
                  <div className="u-tile-info">
                    <span className="u-tile-name">{company.name}</span>
                    <span className="u-tile-meta">
                      {company.myCount > 0 && <span>{company.myCount} yours</span>}
                      {company.myCount > 0 && company.spaceCount > 0 && <span className="u-tile-meta-sep">·</span>}
                      {company.spaceCount > 0 && <span>{company.spaceCount} via spaces</span>}
                      {company.hasStrongConnection && <span className="u-tile-strong">●</span>}
                    </span>
                  </div>

                  {/* Quick actions */}
                  <div className="u-tile-actions" onClick={e => e.stopPropagation()}>
                    {company.spaceCount > 0 && (
                      <button className="u-tile-btn u-tile-btn--intro" onClick={() => openIntroPanel(company)}>
                        Intro
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded contacts */}
                {expandedDomain === company.domain && (
                  <div className="u-tile-body">
                    {/* My contacts */}
                    {company.myContacts.slice(0, 4).map(c => (
                      <div key={c.id} className="u-contact" onClick={() => openPersonPanel(c, company)}>
                        <PersonAvatar email={c.email} name={c.name} size={24} />
                        <div className="u-contact-info">
                          <span className="u-contact-name">{c.name}</span>
                          <span className="u-contact-title">{c.title || c.email}</span>
                        </div>
                        <span className={`u-strength u-strength--${c.connectionStrength}`}>{c.connectionStrength}</span>
                        <button className="u-contact-action" onClick={(e) => { e.stopPropagation(); handleOfferIntro(c, company.name); }}>
                          ✉
                        </button>
                      </div>
                    ))}
                    {/* Space contacts */}
                    {company.spaceContacts.slice(0, 4).map(c => (
                      <div key={c.id} className="u-contact u-contact--space" onClick={() => openPersonPanel(c, company)}>
                        <PersonAvatar email={c.email} name={c.name} size={24} />
                        <div className="u-contact-info">
                          <span className="u-contact-name">{c.name}</span>
                          <span className="u-contact-title">{c.title || 'Contact'} <span className="u-via">via {c.userName}</span></span>
                        </div>
                        <button className="u-contact-action" onClick={(e) => { e.stopPropagation(); openIntroPanel(company); }}>
                          Intro
                        </button>
                      </div>
                    ))}
                    {(company.myContacts.length + company.spaceContacts.length) > 8 && (
                      <div className="u-tile-more">+{company.myContacts.length + company.spaceContacts.length - 8} more</div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Inline Panel ────────────────────────────────────────────── */}
      {inlinePanel && (
        <div className="u-panel-overlay" onClick={() => setInlinePanel(null)}>
          <div className="u-panel" onClick={e => e.stopPropagation()}>
            <button className="u-panel-close" onClick={() => setInlinePanel(null)}>×</button>

            {inlinePanel.type === 'person' && inlinePanel.contact && (
              <div className="u-panel-person">
                <PersonAvatar email={inlinePanel.contact.email} name={inlinePanel.contact.name} size={56} />
                <h2>{inlinePanel.contact.name}</h2>
                <p className="u-panel-subtitle">
                  {inlinePanel.contact.title || ''}
                  {inlinePanel.company && ` at ${inlinePanel.company.name}`}
                </p>
                <p className="u-panel-email">{inlinePanel.contact.email}</p>

                {'connectionStrength' in inlinePanel.contact && (
                  <span className={`u-panel-strength u-strength--${(inlinePanel.contact as DisplayContact).connectionStrength}`}>
                    {(inlinePanel.contact as DisplayContact).connectionStrength} connection
                  </span>
                )}

                {'userName' in inlinePanel.contact && (inlinePanel.contact as any).userName && (
                  <span className="u-panel-via">via {(inlinePanel.contact as any).userName}</span>
                )}

                <div className="u-panel-actions">
                  <button
                    className="u-primary-btn"
                    onClick={() => {
                      if (inlinePanel.company) openIntroPanel(inlinePanel.company);
                    }}
                  >
                    ✨ Request Intro
                  </button>
                  <button
                    className="u-action-btn"
                    onClick={() => window.open(`mailto:${inlinePanel.contact!.email}`, '_blank')}
                  >
                    ✉ Email
                  </button>
                </div>
              </div>
            )}

            {inlinePanel.type === 'intro-request' && (
              <div className="u-panel-intro">
                <h2>✨ Request Intro</h2>
                {inlinePanel.company ? (
                  <>
                    <div className="u-panel-target">
                      <CompanyLogo domain={inlinePanel.company.domain} name={inlinePanel.company.name} size={32} />
                      <span>{inlinePanel.company.name}</span>
                    </div>

                    <div className="u-panel-paths">
                      <h4>Intro paths</h4>
                      {inlinePanel.company.spaceContacts.slice(0, 3).map(c => (
                        <div key={c.id} className="u-panel-path">
                          <PersonAvatar email={c.email} name={c.name} size={28} />
                          <div>
                            <span className="u-panel-path-name">{c.name}</span>
                            <span className="u-panel-path-via">via {c.userName}</span>
                          </div>
                        </div>
                      ))}
                      {inlinePanel.company.myContacts.slice(0, 2).map(c => (
                        <div key={c.id} className="u-panel-path">
                          <PersonAvatar email={c.email} name={c.name} size={28} />
                          <div>
                            <span className="u-panel-path-name">{c.name}</span>
                            <span className="u-panel-path-via">your contact · {c.connectionStrength}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <textarea className="u-panel-textarea" placeholder="What would you like to discuss with them?" rows={3} />

                    <div className="u-panel-actions">
                      <button className="u-primary-btn" onClick={() => navigate(`/request/new?company=${encodeURIComponent(inlinePanel.company!.name)}&domain=${encodeURIComponent(inlinePanel.company!.domain)}`)}>
                        Send Request
                      </button>
                      <button className="u-action-btn" onClick={() => setInlinePanel(null)}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="u-panel-hint">Who do you want an intro to?</p>
                    <input
                      className="u-panel-input"
                      placeholder="Company name or person..."
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          navigate(`/request/new`);
                        }
                      }}
                    />
                    <div className="u-panel-actions">
                      <button className="u-primary-btn" onClick={() => navigate('/request/new')}>Continue</button>
                      <button className="u-action-btn" onClick={() => setInlinePanel(null)}>Cancel</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
