import { useNavigate, Link } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { useAppState } from '../store';

export function LandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAppState();
  const [visible, setVisible] = useState(false);
  const featuresRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      navigate('/home');
    }
  }, [isAuthenticated, isLoading, navigate]);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={`lp ${visible ? 'lp--visible' : ''}`}>
      {/* Ambient background */}
      <div className="lp-ambient" />

      {/* Nav */}
      <nav className="lp-nav">
        <div className="lp-nav-brand">
          <span className="lp-nav-logo">introo</span>
        </div>
        <Link to="/login" className="lp-nav-cta">
          Sign in
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </Link>
      </nav>

      {/* Hero */}
      <section className="lp-hero">
        <div className="lp-hero-badge">Invite-only</div>
        <h1 className="lp-hero-title">
          Stop reaching out.<br />Start getting introduced.
        </h1>
        <p className="lp-hero-sub">
          Introo reads your meetings and builds a living map of your professional network.
          Share it with trusted circles. Get warm intros to anyone, through people who already know you.
        </p>
        <div className="lp-hero-actions">
          <div className="lp-invite-box">
            <div className="lp-invite-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="3" />
                <path d="M22 7l-10 6L2 7" />
              </svg>
            </div>
            <div className="lp-invite-text">
              <strong>Introo is invite-only</strong>
              <p>Get an invite from someone already on the platform, or ask your team to add you to their Space.</p>
            </div>
          </div>
          <Link to="/login" className="lp-btn-secondary">
            Already have an invite? Sign in
          </Link>
        </div>
      </section>

      {/* Visual divider — animated network */}
      <section className="lp-visual">
        <div className="lp-network">
          <svg className="lp-network-svg" viewBox="0 0 800 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Connections */}
            <line x1="200" y1="100" x2="400" y2="60" className="lp-net-line lp-net-line--1" />
            <line x1="200" y1="100" x2="350" y2="150" className="lp-net-line lp-net-line--2" />
            <line x1="400" y1="60" x2="600" y2="100" className="lp-net-line lp-net-line--3" />
            <line x1="350" y1="150" x2="600" y2="100" className="lp-net-line lp-net-line--4" />
            <line x1="400" y1="60" x2="350" y2="150" className="lp-net-line lp-net-line--5" />
            <line x1="100" y1="70" x2="200" y2="100" className="lp-net-line lp-net-line--6" />
            <line x1="600" y1="100" x2="700" y2="60" className="lp-net-line lp-net-line--7" />
            <line x1="600" y1="100" x2="680" y2="160" className="lp-net-line lp-net-line--8" />
            {/* Nodes */}
            <circle cx="100" cy="70" r="5" className="lp-net-node lp-net-node--sm" />
            <circle cx="200" cy="100" r="8" className="lp-net-node lp-net-node--you" />
            <circle cx="400" cy="60" r="7" className="lp-net-node" />
            <circle cx="350" cy="150" r="6" className="lp-net-node" />
            <circle cx="600" cy="100" r="8" className="lp-net-node lp-net-node--target" />
            <circle cx="700" cy="60" r="5" className="lp-net-node lp-net-node--sm" />
            <circle cx="680" cy="160" r="5" className="lp-net-node lp-net-node--sm" />
            {/* Labels */}
            <text x="200" y="125" className="lp-net-label">You</text>
            <text x="600" y="125" className="lp-net-label">Target</text>
            <text x="375" y="45" className="lp-net-label lp-net-label--muted">Mutual</text>
          </svg>
        </div>
      </section>

      {/* How it works */}
      <section className="lp-steps" ref={featuresRef}>
        <div className="lp-steps-grid">
          <div className="lp-step">
            <div className="lp-step-num">01</div>
            <h3 className="lp-step-title">Get invited</h3>
            <p className="lp-step-desc">
              A colleague, investor, or friend sends you an invite.
              Sign in with Google and your calendar syncs automatically.
            </p>
          </div>
          <div className="lp-step">
            <div className="lp-step-num">02</div>
            <h3 className="lp-step-title">See your real network</h3>
            <p className="lp-step-desc">
              Every contact enriched with company data, funding stage, headcount, 
              and connection strength — automatically. Your network, finally visible.
            </p>
          </div>
          <div className="lp-step">
            <div className="lp-step-num">03</div>
            <h3 className="lp-step-title">Form trusted circles</h3>
            <p className="lp-step-desc">
              Create private Spaces with colleagues, investors, or founders.
              Pool your collective networks and discover overlapping reach.
            </p>
          </div>
          <div className="lp-step">
            <div className="lp-step-num">04</div>
            <h3 className="lp-step-title">Get warm intros</h3>
            <p className="lp-step-desc">
              Found a target company? See who in your circle knows someone there.
              Request an introduction. No more cold emails.
            </p>
          </div>
        </div>
      </section>

      {/* Value props */}
      <section className="lp-values">
        <h2 className="lp-values-title">Why teams choose Introo</h2>
        <div className="lp-values-grid">
          <div className="lp-value">
            <div className="lp-value-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <h4>Calendar-native</h4>
            <p>No CRM imports. No CSV uploads. Your meetings are the source of truth.</p>
          </div>
          <div className="lp-value">
            <div className="lp-value-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <h4>Private by default</h4>
            <p>Your contacts are only visible to you. You choose what to share, with whom.</p>
          </div>
          <div className="lp-value">
            <div className="lp-value-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <h4>Multiplayer</h4>
            <p>Spaces let your team, syndicate, or community pool network reach without exposing raw contacts.</p>
          </div>
          <div className="lp-value">
            <div className="lp-value-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <h4>Enriched automatically</h4>
            <p>Company data, funding, headcount, and LinkedIn profiles — filled in without lifting a finger.</p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="lp-cta">
        <h2 className="lp-cta-title">Your network is your unfair advantage.<br />Make it visible.</h2>
        <p className="lp-cta-sub">Introo is invite-only. Ask someone on the platform to send you an invite, or have your team add you to their Space.</p>
        <Link to="/login" className="lp-btn-secondary lp-btn-secondary--lg">
          Already invited? Sign in
        </Link>
      </section>

      {/* Footer */}
      <footer className="lp-footer">
        <span className="lp-footer-brand">introo</span>
        <div className="lp-footer-links">
          <Link to="/docs">Docs</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
        </div>
        <span className="lp-footer-copy">&copy; 2026 Aspeen Inc.</span>
      </footer>
    </div>
  );
}
